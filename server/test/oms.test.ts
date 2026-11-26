import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, currentPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { strategyConfigVersion } from '../src/ops/tradingMandate.js';
import { updateControl, getControl } from '../src/core/mode.js';
import { setSetting } from '../src/core/settings.js';
import { ledger, PAPER_ACCOUNT, accountState, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, emergencyStop, cancelPendingEntries, closeAllPositions, closePosition, executeExit, queueForApproval, decideApproval, expireApprovals, listOrders } from '../src/exec/oms.js';
import { setCrashHook } from '../src/exec/crashpoint.js';
import * as lifecycle from '../src/ops/shutdown.js';
import { paperFillEvents } from '../src/exec/fillEvents.js';
import { paperChoiceOutcomes } from '../src/ditas/execution.js';
import { reconcile, calendar } from '../src/portfolio/calendar.js';
import { verifyAuditChain } from '../src/core/audit.js';
import { run, all, get, J, closeDb, openDb } from '../src/db/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkBook, QUALITY_LIMITS } from '../src/market/quality.js';
import type { DecisionReport } from '../src/decision/engine.js';
import { acquireOrRenewLease, type LeaseFence } from '../src/ops/lease.js';

function report(id: string, last: number, over: Partial<DecisionReport> = {}): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, createdAt: new Date().toISOString(), candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any, ...over } as DecisionReport;
}

function seedSpotCheckpoint(fence: LeaseFence, startedAt: number, state: 'RUNNING' | 'CLOSING_DRAINING_ENTRIES') {
  run(`INSERT INTO brainos_sessions (session_id, version, state, environment, mind, lease_holder, lease_acquired_at,
    fence_epoch, suspend_reason, started_at, updated_at, market_scope, capital_ceiling, risk_policy_version, authorized_by,
    authorized_at, expires_at, strategy_config_version)
    VALUES ('brainos-autopilot', 1, ?, 'PAPER', 'SPOT_PAPER', ?, ?, 1, ?, ?, ?, 'BINANCE_SPOT', 10000, ?, 'owner:test', ?, ?, ?)`,
    state, fence.holder, fence.acquired_at, state === 'RUNNING' ? 'NONE' : 'OWNER_CLOSE_REQUESTED', startedAt, startedAt,
    currentPolicy()!.version, startedAt, startedAt + 86_400_000, strategyConfigVersion());
}

describe('Paper OMS lifecycle (Parts 17/20/26/27)', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('enters with book-walk fill, attaches OMS-monitored stop, exits on stop, reconciles', () => {
    const entry = report(id, last);
    const r = submitEntry(entry, 'bot');
    expect(r.ok).toBe(true);
    const pos = openPositions()[0]; expect(pos.entry_price).toBeGreaterThan(last); // paid the ask + impact
    expect(listOrders().some((o: any) => o.purpose === 'PROTECTIVE_STOP' && o.status === 'ACTIVE')).toBe(true);
    // duplicate submit is idempotent
    expect(submitEntry({ ...report(id, last), candidateId: (listOrders().find((o: any) => o.purpose === 'ENTRY') as any).client_order_id.slice(6) }, 'bot').ok).toBe(false);
    setBook(id, last * 0.96); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    const rec = reconcile(); expect(rec.ok).toBe(true); expect(rec.positionsRealized).toBeLessThan(0);
    expect(rec.positionsRealized).toBeGreaterThan(-60); // ≈ planned max loss (0.5% of 10k) incl. fees & gap
    const cal = calendar(new Date().toISOString().slice(0, 7)); expect(cal.summary.trades).toBe(1);
    expect(accountState().equity).toBeCloseTo(10_000 + rec.positionsRealized, 6);
    const entryEvent = paperFillEvents(0, 1);
    const exitEvent = paperFillEvents(entryEvent.nextAfter, 1);
    expect(entryEvent.events).toMatchObject([{ eventType: 'fill.recorded.v1', environment: 'PAPER', payload: { side: 'BUY', orderId: r.orderId } }]);
    expect(exitEvent.events).toMatchObject([{ payload: { side: 'SELL', closed: true, decisionId: entry.id } }]);
    expect(paperFillEvents(exitEvent.nextAfter, 1).events).toHaveLength(0);
    const [feedback] = paperChoiceOutcomes([entry.id, 'no-paper-trade']);
    expect(feedback.netPnl).toBeCloseTo(rec.positionsRealized, 9);
    expect(feedback.fees).toBeGreaterThan(0);
    expect(verifyAuditChain().ok).toBe(true);
  });
  it('preserves the combined portfolio cash floor after fees and recalculates headroom for the next entry', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, minUnallocatedReservePct: 94, minSettlementReservePct: 5 });
    const result = submitEntry(report(id, last), 'bot');
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const cash = accountState().cash;
    expect(cash).toBeGreaterThanOrEqual(9900 - 1e-8);
    expect(cash).toBeLessThan(9901);
    const second = seedInstrument('SOLUSDT', { seed: 3 });
    const denied = submitEntry(report(second.inst.id, second.last), 'bot');
    expect(denied.ok).toBe(false);
    expect(denied.reason).toContain('SIZE_BELOW_VENUE_MINIMUM');
    expect(openPositions()).toHaveLength(1);
    expect(accountState().cash).toBe(cash);
    expect(reconcile().ok).toBe(true);
    setBook(id, last * 0.96);
    monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });
  it('rechecks a newly tightened reserve policy at the entry write boundary', () => {
    setCrashHook(point => {
      if (point === 'entry.preTx') acceptPolicy('owner', { ...DEFAULT_POLICY, minUnallocatedReservePct: 95, minSettlementReservePct: 5 });
    });
    try {
      const denied = submitEntry(report(id, last), 'bot');
      expect(denied.ok).toBe(false);
      expect(denied.reason).toContain('CASH_RESERVE_FLOOR_REACHED');
    } finally { setCrashHook(null); }
    expect(openPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
    expect(paperFillEvents(0, 5).events).toHaveLength(0);
  });
  it('keeps the post-stop cooldown and filled-entry frequency cap across a WAL reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-antichurn-'));
    const file = join(dir, 'paper.sqlite');
    try {
      freshDb(true, file);
      acceptPolicy('owner', { ...DEFAULT_POLICY, postExitCooldownMs: 10000, stopLossCooldownMs: 30000,
        entryFrequencyWindowMs: 60000, maxEntriesPerWindow: 1 });
      updateControl('owner', { mode: 'PAPER' });
      ledger(PAPER_ACCOUNT, 'DEPOSIT', 10000);
      expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
      setBook(id, last * 0.96);
      monitorPositions();
      expect(openPositions()).toHaveLength(0);
      expect(reconcile().ok).toBe(true);
      const cash = accountState().cash;
      closeDb(); openDb(file);
      const denied = submitEntry(report(id, last * 0.96), 'bot');
      expect(denied.ok).toBe(false);
      expect(denied.reason).toContain('ASSET_POST_EXIT_COOLDOWN');
      expect(denied.reason).toContain('ENTRY_FREQUENCY_CAP');
      expect(accountState().cash).toBe(cash);
      expect(openPositions()).toHaveLength(0);
      expect(reconcile().ok).toBe(true);
    } finally {
      closeDb(); rmSync(dir, { recursive: true, force: true });
    }
  });
  it('detects offsetting closed-position PnL errors even when aggregate drift is zero', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    setBook(id, last * 0.96); monitorPositions();
    const second = seedInstrument('SOLUSDT', { seed: 3 });
    expect(submitEntry(report(second.inst.id, second.last), 'bot').ok).toBe(true);
    setBook(second.inst.id, second.last * 0.96); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(reconcile()).toMatchObject({ ok: true, closedPositions: 2, mismatchedClosedPositions: 0 });
    const closed = all<{id: string}>("SELECT id FROM positions WHERE status='CLOSED' ORDER BY id");
    run('UPDATE positions SET realized_pnl=realized_pnl+1 WHERE id=?', closed[0].id);
    run('UPDATE positions SET realized_pnl=realized_pnl-1 WHERE id=?', closed[1].id);
    const rec = reconcile();
    expect(rec.difference).toBeLessThan(1e-6);
    expect(rec).toMatchObject({ ok: false, mismatchedClosedPositions: 2 });
  });
  it('flags unlinked principal movements rather than silently ignoring them', () => {
    ledger(PAPER_ACCOUNT, 'BUY', -25, 'missing-order');
    expect(reconcile()).toMatchObject({ ok: false, orphanPrincipalEntries: 1 });
  });
  it.each(['SUBMITTING', 'AMBIGUOUS', 'PARTIALLY_FILLED', 'RESERVED', 'UNKNOWN_STATE'])(
    'blocks new entries on unresolved %s orders without blocking protection', status => {
      expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
      const second = seedInstrument('SOLUSDT', { seed: 3 });
      run("INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        'unresolved-fixture','unresolved-fixture',PAPER_ACCOUNT,'binance-paper',second.inst.id,'BUY','MARKET',1,status,'ENTRY',Date.now(),Date.now());
      const denied = submitEntry(report(second.inst.id, second.last), 'bot');
      expect(denied.ok).toBe(false);
      expect(denied.reason).toContain('UNRECONCILED_PAPER_ORDERS');
      setBook(id, last * 0.96); monitorPositions();
      expect(openPositions()).toHaveLength(0);
      expect(get('SELECT status FROM orders WHERE id=?','unresolved-fixture')).toEqual({ status });
    }
  );
  it('freezes new entries at the shutdown boundary but permits existing protective exits', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const second = seedInstrument('SOLUSDT', { seed: 3 });
    const candidate = report(second.inst.id, second.last);
    const cash = accountState().cash;
    const draining = vi.spyOn(lifecycle, 'isShuttingDown').mockReturnValue(false);
    setCrashHook(point => { if (point === 'entry.preTx') draining.mockReturnValue(true); });
    try {
      expect(submitEntry(candidate, 'bot')).toEqual({ ok: false, reason: 'PROCESS_SHUTTING_DOWN' });
      expect(submitEntry(report(second.inst.id, second.last), 'bot')).toEqual({ ok: false, reason: 'PROCESS_SHUTTING_DOWN' });
      expect(queueForApproval(report(second.inst.id, second.last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' }))).toBeNull();
      expect(accountState().cash).toBe(cash);
      expect(openPositions()).toHaveLength(1);
      expect(paperFillEvents(0, 10).events).toHaveLength(1);
      setBook(id, last * 0.96); monitorPositions();
      expect(openPositions()).toHaveLength(0);
      expect(paperFillEvents(0, 10).events).toHaveLength(2);
      expect(reconcile().ok).toBe(true);
    } finally { setCrashHook(null); draining.mockRestore(); }
  });
  it('rolls back a fill envelope with the failed OMS transaction', () => {
    const entry = report(id, last);
    setCrashHook((point) => { if (point === 'entry.precommit') throw new Error('fault before commit'); });
    try { expect(() => submitEntry(entry, 'bot')).toThrow('fault before commit'); }
    finally { setCrashHook(null); }
    expect(paperFillEvents(0, 5).events).toHaveLength(0);
    expect(openPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });
  it('takes partial profit, trails stop to breakeven (never widens), then exits', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    setBook(id, last * 1.05); monitorPositions(); // hits T1 (1.5R) & >1R ⇒ trail
    const p = openPositions()[0]; expect(p.qty).toBeGreaterThan(0); expect(p.stop_price).toBeGreaterThanOrEqual(p.entry_price);
    setBook(id, last * 1.0); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });
  it('rejects expired consensus and bot entries outside PAPER mode', () => {
    expect(submitEntry(report(id, last, { consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 1, opposition: 0, expiresAt: new Date(Date.now() - 1).toISOString() } }), 'bot').reason).toMatch(/EXPIRED/);
    updateControl('owner', { mode: 'APPROVAL' });
    expect(submitEntry(report(id, last), 'bot').ok).toBe(false);
  });
  it('approval workflow: queued → owner approves → filled', () => {
    updateControl('owner', { mode: 'APPROVAL' });
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)', rep.id, rep.candidateId, id, 'crypto', 'LONG', 'trend_pullback', rep.decision, 70, Date.now(), J(rep));
    const oid = queueForApproval(rep)!; expect(oid).toBeTruthy();
    const res = decideApproval(oid, true); expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
  });
  it('honors session close at the OMS write boundary and continues paper protection', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const original = openPositions()[0];
    const cash = accountState().cash;
    const engine = acquireOrRenewLease('engine', 'worker', 10_000)!;
    setCrashHook((point) => {
      if (point === 'entry.preTx') seedSpotCheckpoint(engine, Date.now(), 'CLOSING_DRAINING_ENTRIES');
    });
    try {
      expect(submitEntry(report(id, last), 'bot', undefined, engine)).toEqual({ ok: false, reason: 'SESSION_NOT_RUNNING' });
    } finally {
      setCrashHook(null);
    }
    expect(queueForApproval(report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' }), engine)).toBeNull();
    expect(listOrders()).toHaveLength(2);
    expect(accountState().cash).toBe(cash);
    expect(openPositions()).toMatchObject([{ id: original.id }]);
    setBook(id, last * 0.96);
    monitorPositions(undefined, engine);
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
  });
  it.each(['decision', 'order'] as const)('blocks approval if its %s predates the current spot session', (stale) => {
    const startedAt = Date.now();
    const decisionAt = startedAt - (stale === 'decision' ? 1 : 0);
    const pending = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION', createdAt: new Date(decisionAt).toISOString() });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)',
      pending.id, pending.candidateId, id, 'crypto', 'LONG', pending.strategy.id, pending.decision, 70, decisionAt, J(pending));
    const orderId = queueForApproval(pending)!;
    if (stale === 'order') run('UPDATE orders SET created_at=? WHERE id=?', startedAt - 1, orderId);
    const engine = acquireOrRenewLease('engine', 'worker', 10_000)!;
    seedSpotCheckpoint(engine, startedAt, 'RUNNING');
    expect(decideApproval(orderId, true)).toEqual({ ok: false, reason: 'STALE_OR_LOST_ENGINE_FENCE' });
    expect(decideApproval(orderId, true, engine)).toEqual({ ok: false, reason: 'ENTRY_EVIDENCE_OUTSIDE_SESSION' });
    expect(get('SELECT status FROM orders WHERE id=?', orderId)).toEqual({ status: 'PENDING_APPROVAL' });
    expect(accountState().cash).toBe(10_000);
  });
  it('rejects non-spot order evidence in a spot session', () => {
    const engine = acquireOrRenewLease('engine', 'worker', 10_000)!;
    seedSpotCheckpoint(engine, Date.now(), 'RUNNING');
    const candidate = report(id, last, { market: 'crypto-dex' });
    expect(submitEntry(candidate, 'bot', undefined, engine)).toEqual({
      ok: false, reason: 'MARKET_OUTSIDE_SESSION_MANDATE: UNSUPPORTED entry in a BINANCE_SPOT session' });
    expect(queueForApproval({ ...candidate, decision: 'APPROVED_FOR_USER_CONFIRMATION' }, engine)).toBeNull();
    expect(listOrders()).toHaveLength(0);
  });
  it('does not let automation consume an owner approval after a mode change', () => {
    const pending = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    const orderId = queueForApproval(pending)!;
    expect(submitEntry({ ...pending, decision: 'PAPER_TRADE' }, 'bot')).toMatchObject({ ok: false });
    expect(get('SELECT status FROM orders WHERE id=?', orderId)).toEqual({ status: 'PENDING_APPROVAL' });
    expect(openPositions()).toHaveLength(0);
  });
  it('locks owner approval when a legacy LIVE mode is persisted', () => {
    const pending = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)', pending.id, pending.candidateId, id, 'crypto', 'LONG', pending.strategy.id, pending.decision, 70, Date.now(), J(pending));
    const orderId = queueForApproval(pending)!;
    setSetting('control', { ...getControl(), mode: 'BOUNDED_LIVE' });
    expect(decideApproval(orderId, true)).toMatchObject({ ok: false, reason: expect.stringContaining('MODE_NOT_PAPER') });
    expect(openPositions()).toHaveLength(0);
  });
  it('expires an approval with missing evidence and preserves a different unknown execution', () => {
    const missing = queueForApproval(report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' }))!;
    const unknown = queueForApproval(report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' }))!;
    run("UPDATE orders SET status='NEW' WHERE id=?", unknown);
    expireApprovals();
    cancelPendingEntries('owner');
    expect(get('SELECT status FROM orders WHERE id=?', missing)).toEqual({ status: 'EXPIRED' });
    const other = seedInstrument('SOLUSDT', { seed: 5 });
    expect(submitEntry(report(other.inst.id, other.last), 'bot')).toMatchObject({
      ok: false, reason: expect.stringContaining('UNRECONCILED_PAPER_ORDERS'),
    });
    expect(get('SELECT status FROM orders WHERE id=?', unknown)).toEqual({ status: 'NEW' });
    expect(accountState().cash).toBe(10_000);
  });
  it.each(['approve', 'cancel'] as const)('preserves the winning %s transition if it lands before the fill transaction', (winner) => {
    updateControl('owner', { mode: 'APPROVAL' });
    const rep = report(id, last, { decision: 'APPROVED_FOR_USER_CONFIRMATION' });
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)', rep.id, rep.candidateId, id, 'crypto', 'LONG', rep.strategy.id, rep.decision, 70, Date.now(), J(rep));
    const oid = queueForApproval(rep)!;
    setCrashHook((point) => {
      if (point !== 'entry.preTx') return;
      setCrashHook(null);
      expect(decideApproval(oid, winner === 'approve').ok).toBe(true);
    });
    try {
      expect(decideApproval(oid, true).ok).toBe(false);
    } finally {
      setCrashHook(null);
    }
    const fills = winner === 'approve' ? 1 : 0;
    expect(all('SELECT id FROM fills WHERE order_id=?', oid)).toHaveLength(fills);
    expect(openPositions()).toHaveLength(fills);
    expect(get('SELECT status FROM orders WHERE id=?', oid)).toEqual({ status: fills ? 'FILLED' : 'CANCELLED' });
    expect(reconcile().ok).toBe(true);
  });
  it('honors a pause committed after risk evaluation and before the fill transaction', () => {
    setCrashHook((point) => {
      if (point !== 'entry.preTx') return;
      setCrashHook(null);
      updateControl('owner', { pausedNewOrders: true });
    });
    try {
      expect(submitEntry(report(id, last), 'bot')).toMatchObject({
        ok: false,
        reason: expect.stringContaining('NEW_ORDERS_PAUSED'),
      });
    } finally {
      setCrashHook(null);
    }
    expect(openPositions()).toHaveLength(0);
    expect(all('SELECT id FROM fills')).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });
  it('emergency stop: blocks, cancels, verifies protection, does not auto-close', () => {
    submitEntry(report(id, last), 'bot');
    const e = emergencyStop('owner');
    expect(getControl().emergency).toBe(true); expect(e.close).toBe('NOT_REQUESTED'); expect(e.protect.state).toBe('CONFIRMED');
    expect(openPositions()).toHaveLength(1);
    expect(() => closeAllPositions('trader-joe', 'CLOSE ALL')).toThrow();
    expect(() => closeAllPositions('owner', 'yes')).toThrow(/confirmation/);
    expect(closeAllPositions('owner', 'CLOSE ALL').state).toBe('CONFIRMED');
    expect(verifyAuditChain().ok).toBe(true);
  });
});

describe('Order-book freshness and fill accounting', () => {
  let id = ''; let last = 0;
  const OLD = () => Date.now() - 10 * 60_000;
  /** Move only the ticker (fresh), leaving the book untouched — the hot lane refreshes tickers more often than books. */
  const setTicker = (mid: number, ts = Date.now()) => Object.assign(market.tickers.get(id)!, { last: mid, bid: mid * 0.9999, ask: mid * 1.0001, receivedAt: ts });
  const sells = () => all<any>("SELECT o.purpose, f.qty, f.price, f.fee FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.side='SELL' ORDER BY f.ts, o.created_at");
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  // ── from PR #4 (fix/mia-4.1-audit-repairs), kept verbatim ──
  it('does not record a full exit when executable order-book depth is unavailable', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book = null;
    expect(executeExit(pos.id, pos.qty, 'TEST')).toBeNull();
    expect(openPositions()).toHaveLength(1);
    expect(openPositions()[0].qty).toBeCloseTo(pos.qty, 10);
    expect(listOrders().filter((o: any) => o.purpose === 'EXIT_TEST')).toHaveLength(0);
  });
  it('does not execute an exit against a stale order book', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book!.ts = Date.now() - 180_001;
    expect(executeExit(pos.id, pos.qty, 'STALE_BOOK')).toBeNull();
    expect(openPositions()).toHaveLength(1);
  });
  it.each([
    ['monitor.preTx', 'EXIT_STOP'],
    ['exit.preTx', 'EXIT_MANUAL_CLOSE'],
  ] as const)('rejects a book that expires at %s and exits once refreshed', (checkpoint, purpose) => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const position = openPositions()[0];
    const cash = accountState().cash;
    const exit = () => purpose === 'EXIT_STOP'
      ? monitorPositions()
      : executeExit(position.id, position.qty, 'MANUAL_CLOSE');

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const observedAt = Date.now();
      setBook(id, last * 0.96, observedAt - QUALITY_LIMITS.maxExecBookAgeMs + 10);
      setTicker(last * 0.96, observedAt);
      setCrashHook((point) => {
        if (point === checkpoint) vi.setSystemTime(observedAt + 20);
      });

      exit();

      expect(sells()).toHaveLength(0);
      expect(openPositions()).toEqual([position]);
      expect(accountState().cash).toBe(cash);
      expect(get('SELECT status FROM protection_incidents WHERE position_id=?', position.id)).toMatchObject({ status: 'OPEN' });

      setCrashHook(null);
      setBook(id, last * 0.96);
      exit();

      expect(openPositions()).toHaveLength(0);
      expect(sells()).toMatchObject([{ purpose, qty: position.qty }]);
      expect(reconcile().ok).toBe(true);
    } finally {
      setCrashHook(null);
      vi.useRealTimers();
    }
  });
  it('commits a target that sells the whole position after a venue minimum change', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const position = openPositions()[0];
    // The minimum rises after entry. A half-size exit would leave an unsellable remainder.
    market.instruments.get(id)!.minQty = position.qty * 0.6;
    setBook(id, last * 1.11);

    monitorPositions();

    expect(openPositions()).toHaveLength(0);
    expect(sells()).toMatchObject([{ purpose: 'EXIT_TARGET', qty: position.qty }]);
    const saved = get<{ targets: string }>('SELECT targets FROM positions WHERE id=?', position.id)!;
    expect(JSON.parse(saved.targets).targets.map((target: { done: boolean }) => target.done)).toEqual([true, false]);
    expect(reconcile().ok).toBe(true);
  });
  it('time exit sells the exact holding after rounding a preceding target to whole lots', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const position = openPositions()[0];
    const instrument = market.instruments.get(id)!;
    instrument.stepSize = instrument.minQty = position.qty / 3;
    run('UPDATE positions SET max_hold_ms=1000, opened_at=? WHERE id=?', Date.now() - 1000, position.id);
    setBook(id, last * 1.05);

    monitorPositions();

    expect(openPositions()).toHaveLength(0);
    const exits = sells();
    expect(exits).toHaveLength(2);
    const target = exits.find((fill) => fill.purpose === 'EXIT_TARGET');
    const timeExit = exits.find((fill) => fill.purpose === 'EXIT_TIME');
    expect(target?.qty).toBeCloseTo(instrument.stepSize, 10);
    expect(timeExit?.qty).toBeCloseTo(position.qty - target!.qty, 10);
    expect(reconcile().ok).toBe(true);
  });
  it('refuses to enter against a stale order book even when the ticker is fresh', () => {
    market.deep.get(id)!.book!.ts = Date.now() - QUALITY_LIMITS.maxExecBookAgeMs - 5_000;
    const r = submitEntry(report(id, last), 'bot');
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/ORDER_BOOK_STALE/);
    expect(openPositions()).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });
  it('limits the real depth-walk loss including the entry and buffered exit fees', () => {
    const book = market.deep.get(id)!.book!;
    const ask = market.price(id)!.ask!;
    // A fill near the allowable slippage boundary must remain within the trade budget.
    book.asks = [[ask, 0.01], [ask * 1.0016, 50]];
    const result = submitEntry(report(id, last), 'bot');
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const pos = openPositions()[0];
    const bufferedStop = pos.stop_price * (1 - DEFAULT_POLICY.stopFillBufferPct / 100);
    const executedRisk = pos.qty * (pos.entry_price - bufferedStop +
      DEFAULT_POLICY.feeRate * (pos.entry_price + bufferedStop));
    expect(pos.planned_risk).toBeCloseTo(executedRisk, 8);
    expect(executedRisk).toBeLessThanOrEqual(10_000 * DEFAULT_POLICY.riskPerTradePct / 100 + 1e-8);
    expect(all('SELECT id FROM fills')).toHaveLength(1);
  });

  it('keeps a capped fill that walks the book within the slippage policy inside the notional cap', () => {
    // The gate sizes a capped position at the worst permitted entry, so a depth walk within maxSlippageBps still fits.
    acceptPolicy('owner', { ...DEFAULT_POLICY, maxPositionNotionalPct: 1 });
    const book = market.deep.get(id)!.book!;
    const ask = market.price(id)!.ask!;
    book.asks = [[ask, 0.05], [ask * 1.0008, 50]];
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: true });
    const fill = all<{ qty: number; price: number }>('SELECT qty, price FROM fills')[0];
    expect(fill.price).toBeGreaterThan(ask);
    expect(fill.qty * fill.price).toBeLessThanOrEqual(100 + 1e-9);
    expect(reconcile().ok).toBe(true);
  });
  it('still refuses a depth walk beyond the slippage policy without booking anything', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, maxPositionNotionalPct: 1 });
    const book = market.deep.get(id)!.book!;
    const ask = market.price(id)!.ask!;
    book.asks = [[ask, 0.05], [ask * 1.01, 50]];
    expect(submitEntry(report(id, last), 'bot')).toMatchObject({ ok: false });
    expect(openPositions()).toHaveLength(0);
    expect(all('SELECT id FROM fills')).toHaveLength(0);
    expect(accountState().cash).toBe(10_000);
  });
  it('accepts the capped size when the executable depth fits within the policy cap', () => {
    acceptPolicy('owner', { ...DEFAULT_POLICY, maxPositionNotionalPct: 1 });
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    expect(pos.qty * pos.entry_price).toBeLessThanOrEqual(100);
    expect(reconcile().ok).toBe(true);
  });
  it('never prices a stop-out from a stale book or a ticker fallback: keeps it open and raises the alert', () => {
    // CLAUDE.md invariant #4 (PR #4): no synthetic fills. Originally (PR #3) this exit filled at a quote-based price.
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book!.ts = OLD(); // book still shows bids near `last`
    setTicker(last * 0.96); // the market has actually fallen through the stop
    monitorPositions();
    expect(openPositions()).toHaveLength(1); // not closed at a fabricated price
    expect(all("SELECT * FROM orders WHERE position_id=? AND purpose LIKE 'EXIT_%'", pos.id)).toHaveLength(0);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE severity='CRITICAL'")!.n).toBeGreaterThan(0);
    expect(reconcile().ok).toBe(true);
    // once a fresh book arrives, the stop executes against real depth
    setBook(id, last * 0.96); monitorPositions();
    expect(openPositions()).toHaveLength(0);
    expect(get<any>('SELECT exit_reason FROM positions WHERE id=?', pos.id).exit_reason).toBe('STOP');
    expect(reconcile().ok).toBe(true);
  });
  it('partial take-profit keeps position, protective stop, fills and cash in step, and is not repeated', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const entry = openPositions()[0]; const qty0 = entry.qty;
    setBook(id, last * 1.05); monitorPositions();
    const p = openPositions()[0]; const s1 = sells();
    expect(s1).toHaveLength(1); expect(s1[0].purpose).toBe('EXIT_TARGET');
    expect(s1[0].qty + p.qty).toBeCloseTo(qty0, 9);
    expect(Math.abs(p.qty / qty0 - 0.5)).toBeLessThan(0.01);
    const stop = get<any>("SELECT * FROM orders WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", p.id);
    expect(stop.qty).toBeCloseTo(p.qty, 9); expect(stop.stop_price).toBe(p.stop_price);
    const buy = get<any>("SELECT avg_price, filled_qty, fees FROM orders WHERE purpose='ENTRY' AND status='FILLED'");
    const expectedCash = 10_000 - buy.avg_price * buy.filled_qty - buy.fees + s1[0].price * s1[0].qty - s1[0].fee;
    expect(accountState().cash).toBeCloseTo(expectedCash, 6);
    expect(p.realized_pnl).toBeCloseTo(-buy.fees + (s1[0].price - p.entry_price) * s1[0].qty - s1[0].fee, 6);
    monitorPositions(); monitorPositions(); // same prices again: the target must not fill twice
    expect(sells()).toHaveLength(1); expect(openPositions()[0].qty).toBe(p.qty);
    setBook(id, last * 1.10); monitorPositions(); // second target closes the rest exactly
    expect(openPositions()).toHaveLength(0);
    expect(sells().reduce((a, f) => a + f.qty, 0)).toBeCloseTo(qty0, 9);
    expect(reconcile().ok).toBe(true);
    expect(all("SELECT id FROM orders WHERE purpose='PROTECTIVE_STOP' AND status='ACTIVE'")).toHaveLength(0);
  });
  it('never fills an exit from a thin book at top-of-book or an invented price: waits for real depth', () => {
    // CLAUDE.md invariant #4 (PR #4): sufficient fresh depth or no fill. Originally (PR #3) this booked a partial
    // fill plus a synthetic remainder below the worst visible bid.
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0]; const mid = last * 0.96; const ts = Date.now();
    market.deep.get(id)!.book = { bids: [[mid, pos.qty / 10], [mid * 0.999, pos.qty / 10]], asks: [[mid * 1.0002, 50]], ts };
    setTicker(mid, ts - 1);
    monitorPositions();
    expect(get<any>('SELECT status, qty FROM positions WHERE id=?', pos.id)).toMatchObject({ status: 'OPEN', qty: pos.qty });
    expect(sells()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
    setBook(id, mid); monitorPositions(); // real depth returns → the stop executes against it, below top-of-book
    const closed = get<any>('SELECT * FROM positions WHERE id=?', pos.id);
    expect(closed.status).toBe('CLOSED'); expect(closed.exit_price).toBeLessThanOrEqual(mid);
    expect(reconcile().ok).toBe(true);
  });
  it('manual close is refused when no fresh price exists, and changes nothing', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0]; const cash = accountState().cash;
    market.deep.get(id)!.book!.ts = OLD(); market.tickers.get(id)!.receivedAt = OLD();
    expect(() => closePosition('owner', pos.id)).toThrow(/fresh/);
    expect(openPositions()).toHaveLength(1); expect(sells()).toHaveLength(0); expect(accountState().cash).toBe(cash);
  });
  it('walkBook is exact by quantity and rejects crossed or empty books', () => {
    const book = { bids: [[99, 1], [98, 2]] as [number, number][], asks: [[101, 1], [102, 2]] as [number, number][], ts: Date.now() };
    const b = walkBook(book, 'buy', 2)!; expect(b.avgPrice).toBeCloseTo(101.5, 9); expect(b.filledFully).toBe(true); expect(b.worst).toBe(102);
    const s = walkBook(book, 'sell', 10)!; expect(s.filledFully).toBe(false); expect(s.filledQty).toBe(3);
    expect(walkBook({ ...book, bids: [[103, 1]] }, 'buy', 1)).toBe(null);
    expect(walkBook({ ...book, asks: [] }, 'buy', 1)).toBe(null);
    expect(walkBook(book, 'buy', 0)).toBe(null);
  });
});
