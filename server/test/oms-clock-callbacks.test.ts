import { describe, it, expect, beforeEach } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl, type ControlState } from '../src/core/mode.js';
import { cashBalance, ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, queueForApproval, expireApprovals } from '../src/exec/oms.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { listIncidents } from '../src/exec/incidents.js';
import { bus } from '../src/core/bus.js';
import { get, J, run } from '../src/db/db.js';
import { setCrashHook } from '../src/exec/crashpoint.js';

const report = (id: string, last: number, expiresAt: number): any => {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(expiresAt).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } };
};

describe('OMS uses one clock (MA-11)', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('an entry evaluated at an injected time where the data is stale is denied, even if it is fresh by the wall clock', () => {
    const later = Date.now() + 30 * 60_000; // 30 min ahead: every quote is stale relative to this evaluation time
    const r = submitEntry(report(id, last, later + 60_000), 'bot', later);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/LAST_MOMENT_RISK_DENY|STALE|stale|no fresh/i);
    expect(openPositions()).toHaveLength(0);
  });
  it('consensus expiry is judged at the evaluation time, not the wall clock', () => {
    const t = Date.now();
    const r = submitEntry(report(id, last, t - 1), 'bot', t);
    expect(r.reason).toMatch(/CONSENSUS_EXPIRED/);
  });
  it('rows written by an entry carry the evaluation timestamp', () => {
    const t = Date.now();
    const r = submitEntry(report(id, last, t + 60_000), 'bot', t);
    expect(r.ok).toBe(true);
    expect(get<any>('SELECT opened_at FROM positions WHERE id=?', r.positionId).opened_at).toBe(t);
    expect(get<any>('SELECT ts FROM fills ORDER BY rowid DESC LIMIT 1').ts).toBe(t);
  });
});

describe('post-commit callbacks are isolated (MA-17)', () => {
  it('a throwing position listener does not turn a committed stop exit into "exit failed"', () => {
    freshDb(); market.reset(); const { inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any;
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    expect(submitEntry(report(id, last, Date.now() + 60_000), 'bot').ok).toBe(true);
    const boom = () => { throw new Error('listener exploded'); };
    bus.on('position', boom);
    try {
      setBook(id, last * 0.96); monitorPositions();
      expect(openPositions()).toHaveLength(0);
      expect(listIncidents().filter((i: any) => /exit failed/.test(JSON.stringify(i)))).toHaveLength(0);
    } finally { bus.off('position', boom); }
  });
});

describe('duplicate instrument position under a concurrent writer (MA-20)', () => {
  it('a position opened between the risk check and the entry transaction blocks the second entry', () => {
    freshDb(); market.reset(); const { inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any;
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    // Simulate another writer committing a position on the same instrument right after this entry passed the gate.
    setCrashHook((p) => {
      if (p !== 'entry.preTx') return;
      setCrashHook(null);
      run("INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,max_hold_ms,decision_id,planned_risk) VALUES ('pos_other',?,?,'crypto','LONG','trend_pullback',0.1,?,?,?,'{}','OPEN',?,0,0,0,NULL,1)", PAPER_ACCOUNT, id, last, last * 0.97, last * 0.97, Date.now());
    });
    try {
      const r = submitEntry(report(id, last, Date.now() + 60_000), 'bot');
      expect(r.ok).toBe(false); expect(r.reason).toMatch(/DUPLICATE_INSTRUMENT_POSITION/);
      expect(openPositions().filter((p) => p.instrument === id)).toHaveLength(1);
    } finally { setCrashHook(null); }
  });
});

describe('paper entry rechecks mutable state under its write lock', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }));
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });

  function submitAfter(change: () => void, actor: 'bot' | 'owner') {
    setCrashHook(point => {
      if (point !== 'entry.preTx') return;
      setCrashHook(null);
      change();
    });
    try {
      const proposed = report(id, last, Date.now() + 60_000);
      if (actor === 'owner') {
        // An owner fill must come from the matching pending approval (Codex four-layer rule), as decideApproval does.
        proposed.decision = 'APPROVED_FOR_USER_CONFIRMATION';
        run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)',
          proposed.id, proposed.candidateId, id, 'crypto', 'LONG', proposed.strategy.id, proposed.decision, 70, Date.now(), J(proposed));
        expect(queueForApproval(proposed)).toBeTruthy();
      }
      const result = submitEntry(proposed, actor);
      expect(openPositions()).toHaveLength(0);
      expect(get('SELECT id FROM fills')).toBeUndefined();
      expect(get('SELECT id FROM orders WHERE purpose=?', 'PROTECTIVE_STOP')).toBeUndefined();
      expect(get('SELECT status FROM orders WHERE client_order_id=?', `entry-${proposed.candidateId}`)).toMatchObject({ status: 'REJECTED' });
      expect(submitEntry(proposed, actor).reason).toMatch(/DUPLICATE/);
      return result;
    } finally { setCrashHook(null); }
  }

  it('re-runs every risk-gate limit under the lock: positions opened by another process meanwhile block the entry', () => {
    const others = ['SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT'].map((sym, i) => seedInstrument(sym, { seed: 10 + i }) as any);
    const proposed = report(id, last, Date.now() + 60_000);
    setCrashHook(point => {
      if (point !== 'entry.preTx') return;
      setCrashHook(null);
      // Another process commits four small open positions between sizing and this lock (maxConcurrentPositions = 4).
      for (const [i, o] of others.entries()) {
        run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,realized_pnl,fees,planned_risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          `other-${i}`, PAPER_ACCOUNT, o.inst.id, 'crypto', 'LONG', 'trend_pullback', 0.0001, o.last, o.last * 0.97, o.last * 0.97, '{}', 'OPEN', Date.now(), 0, 0, 0.01);
      }
    });
    try {
      const result = submitEntry(proposed, 'bot');
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('LOCKED_RISK_DENY') });
      expect(result.reason).toContain('MAX_CONCURRENT_POSITIONS');
    } finally { setCrashHook(null); }
    expect(get('SELECT id FROM fills')).toBeUndefined();
    expect(cashBalance()).toBe(10_000);
  });

  it('expires a pending approval whose decision record is missing (no orphan pending order)', () => {
    const proposed = report(id, last, Date.now() + 60_000);
    proposed.decision = 'APPROVED_FOR_USER_CONFIRMATION';
    const orderId = queueForApproval(proposed)!; // no decisions row was ever written for it
    expireApprovals();
    expect(get<{ status: string }>('SELECT status FROM orders WHERE id=?', orderId)).toMatchObject({ status: 'EXPIRED' });
  });

  it('re-derives the position-size cap from current equity under the lock (CodeRabbit #23)', () => {
    const proposed = report(id, last, Date.now() + 60_000);
    const sized = evaluateRisk({ instrumentId: id, strategyId: proposed.strategy.id, side: 'buy', entryPrice: proposed.entryRef, stopPrice: proposed.stopLoss,
      idempotencyKey: `entry-${proposed.candidateId}`, traceId: 'tr' }).sizing!;
    // A withdrawal commits before the lock: enough cash remains for the order, but the 25% notional cap of what is left is smaller.
    const remaining = sized.notional * 2;
    setCrashHook(point => { if (point === 'entry.preTx') { setCrashHook(null); ledger(PAPER_ACCOUNT, 'WITHDRAW', -(10_000 - remaining)); } });
    try {
      const result = submitEntry(proposed, 'bot');
      expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('POSITION_NOTIONAL_LIMIT') });
    } finally { setCrashHook(null); }
    expect(get('SELECT id FROM fills')).toBeUndefined();
    expect(openPositions()).toHaveLength(0);
    expect(cashBalance()).toBeCloseTo(remaining, 6);
  });

  it('rejects a simulated fill whose executable price exceeds the equity cap', () => {
    const now = Date.UTC(2026, 10, 19, 12);
    market.reset();
    const { inst, last: price } = seedInstrument('ETHUSDT', { seed: 2, nowTs: now });
    acceptPolicy('owner', { ...DEFAULT_POLICY, maxPositionNotionalPct: 5 });
    const book = market.deep.get(inst.id)!.book!;
    const bestAsk = book.asks[0][0];
    book.asks = [[bestAsk, 0.001], [bestAsk * 1.001, 100]];
    const proposed = report(inst.id, price, now + 60_000);
    const planned = evaluateRisk({ instrumentId: inst.id, strategyId: proposed.strategy.id, side: 'buy', entryPrice: proposed.entryRef,
      stopPrice: proposed.stopLoss, idempotencyKey: `entry-${proposed.candidateId}`, traceId: 'tr' }, now);
    expect(planned.decision).toBe('ALLOW');
    expect(planned.sizing!.qty * bestAsk).toBeLessThanOrEqual(500);

    expect(submitEntry(proposed, 'bot', now)).toMatchObject({ ok: false, reason: expect.stringContaining('POSITION_NOTIONAL_LIMIT') });
    expect(get('SELECT id FROM fills')).toBeUndefined();
    expect(openPositions()).toHaveLength(0);
    expect(cashBalance()).toBe(10_000);
  });

  it('preserves cash and refuses the fill after a concurrent withdrawal', () => {
    const result = submitAfter(() => ledger(PAPER_ACCOUNT, 'WITHDRAW', -9_999), 'bot');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('INSUFFICIENT_CASH') });
    expect(cashBalance()).toBe(1);
  });

  it('refuses a fill sized under a superseded risk policy', () => {
    const result = submitAfter(() => acceptPolicy('owner', { ...DEFAULT_POLICY, riskPerTradePct: 0.25 }), 'bot');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('POLICY_CHANGED') });
    expect(cashBalance()).toBe(10_000);
  });

  it('refuses a fill after its strategy loses PAPER eligibility', () => {
    const result = submitAfter(() => run("UPDATE strategies SET status='SUSPENDED' WHERE id=?", 'trend_pullback'), 'bot');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('STRATEGY_NOT_PROMOTED') });
  });

  const changes: { actor: 'bot' | 'owner'; patch: Partial<ControlState>; reason: string }[] = [
    { actor: 'bot', patch: { pausedNewOrders: true }, reason: 'NEW_ORDERS_PAUSED' },
    { actor: 'owner', patch: { emergency: true }, reason: 'EMERGENCY_STOP_ACTIVE' },
    { actor: 'bot', patch: { mode: 'APPROVAL' }, reason: 'mode APPROVAL' },
    { actor: 'owner', patch: { mode: 'OBSERVE' }, reason: 'MODE_READ_ONLY' },
    { actor: 'bot', patch: { disabledStrategies: ['trend_pullback'] }, reason: 'STRATEGY_DISABLED' },
  ];
  it.each(changes)('refuses the $actor fill when $reason changes before the lock', ({ actor, patch, reason }) => {
    const result = submitAfter(() => updateControl('owner', patch, modeGate), actor);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
    expect(cashBalance()).toBe(10_000);
  });
});
