import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, ownerSetupPayload, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { modeGate } from '../src/qa/gates.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, queueForApproval, decideApproval, expireApprovals, executeExit, pauseNewOrders, emergencyStop } from '../src/exec/oms.js';
import { reportUnprotected, markRecovered } from '../src/exec/incidents.js';
import { reconcile } from '../src/portfolio/calendar.js';
import { all, get, J, run } from '../src/db/db.js';
import { failureGate } from '../src/core/ratelimit.js';
import { buildApp } from '../src/index.js';
import { JoeTradeEvent, RESERVED_JOE_EVENT_KINDS, type JoeTradeEvent as Ev } from '../src/joe/live/events.js';
import { decodeCursor, joeEvents, joeEventsForPosition } from '../src/joe/live/projection.js';
import { safeSymbol } from '../src/joe/live/narrator.js';
import type { DecisionReport } from '../src/decision/engine.js';

/** Trader Joe Live M1: the story feed is a read-only projection of committed PAPER records. */
const SRC = new URL('../src/', import.meta.url).pathname;
let id = ''; let last = 0;

function report(over: Partial<DecisionReport> = {}): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: 'ETHUSDT', instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any, ...over } as DecisionReport;
}
/** Persist a decision row the way the decision engine does (columns + full report JSON). */
function saveDecision(r: DecisionReport, decision: string, riskDecision: string | null, reasonCodes: string[] = [], createdAt = Date.now()) {
  const full = { ...r, risk: riskDecision ? { decision: riskDecision, reasonCodes } : null };
  run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    r.id, r.candidateId, r.instrumentId, 'crypto', 'LONG', 'trend_pullback', decision, 70, riskDecision, 'q', createdAt, J(full));
  return r;
}
const kinds = (evs: Ev[]) => evs.map((e) => e.kind);
const rowCounts = () => Object.fromEntries(all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .map((t) => [t.name, get<{ n: number }>(`SELECT COUNT(*) n FROM "${t.name}"`)!.n]));

beforeEach(() => {
  freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
  acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
});

describe('paper trade lifecycle story', () => {
  it('a stopped-out trade reads entry fill → stop monitored → exit fill → close at a loss → review, with money from the ledger', () => {
    const r = submitEntry(report(), 'bot'); expect(r.ok).toBe(true);
    setBook(id, last * 0.96); monitorPositions();
    const story = joeEventsForPosition(r.positionId!).events;
    expect(kinds(story)).toEqual(expect.arrayContaining(['PAPER_ENTRY_FILLED', 'STOP_MONITORING_STARTED', 'PAPER_EXIT_FILLED', 'POSITION_CLOSED', 'TRADE_REVIEW_RECORDED']));
    expect(story.indexOf(story.find((e) => e.kind === 'PAPER_ENTRY_FILLED')!)).toBeLessThan(story.indexOf(story.find((e) => e.kind === 'POSITION_CLOSED')!));

    const entry = story.find((e) => e.kind === 'PAPER_ENTRY_FILLED')!;
    const entryLedger = get<{ s: number }>('SELECT SUM(amount) s FROM ledger_entries WHERE ref=?', entry.links.orderId!)!.s;
    expect(entry.fields.ledgerCash).toBeCloseTo(entryLedger, 9);
    expect(entry.presentation.text).toMatch(/^SIMULATED PAPER fill recorded/);
    expect(entry.presentation.text).toMatch(/Not a real exchange execution/);

    const closed = story.find((e) => e.kind === 'POSITION_CLOSED')!;
    expect(closed.fields.netPnl).toBeLessThan(0);
    expect(closed.fields.netPnl).toBeCloseTo(reconcile().positionsRealized, 6); // same figure the reconciler uses
    expect(closed.fields.reconciled).toBe(true);
    expect(closed).toMatchObject({ severity: 'WARNING', presentation: { joeState: 'LOSS_REVIEW' } });
    expect(closed.presentation.text).toMatch(/after fees from the ledger: −\$/);
    expect(story.find((e) => e.kind === 'STOP_MONITORING_STARTED')!.presentation.text).toMatch(/not guaranteed/);
    expect(story.find((e) => e.kind === 'TRADE_REVIEW_RECORDED')!.presentation.joeState).toBe('LOSS_REVIEW');
  });

  it('a profitable close is reported neutrally, after fees', () => {
    const r = submitEntry(report(), 'bot');
    const qty = get<{ qty: number }>('SELECT qty FROM positions WHERE id=?', r.positionId!)!.qty;
    setBook(id, last * 1.02); executeExit(r.positionId!, qty, 'MANUAL');
    const closed = joeEventsForPosition(r.positionId!).events.find((e) => e.kind === 'POSITION_CLOSED')!;
    expect(closed.fields.netPnl).toBeGreaterThan(0);
    expect(closed.fields.reconciled).toBe(true);
    expect(closed.presentation.text).toMatch(/Past results do not predict future ones/);
    expect(closed.presentation.text).not.toMatch(/!|congrat|guarantee/i);
  });

  it('flags a ledger/position mismatch instead of hiding it', () => {
    const r = submitEntry(report(), 'bot');
    const qty = get<{ qty: number }>('SELECT qty FROM positions WHERE id=?', r.positionId!)!.qty;
    executeExit(r.positionId!, qty, 'MANUAL');
    run('UPDATE positions SET realized_pnl = realized_pnl + 5 WHERE id=?', r.positionId!); // simulated drift in the position's running total
    const closed = joeEventsForPosition(r.positionId!).events.find((e) => e.kind === 'POSITION_CLOSED')!;
    expect(closed.fields.reconciled).toBe(false);
    expect(closed.presentation.text).toMatch(/disagree, review needed/);
  });
});

describe('approvals, denials and no-trade outcomes', () => {
  it('a pending approval is shown, then replaced by the fill once approved (never regresses)', () => {
    const rep = saveDecision(report({ decision: 'APPROVED_FOR_USER_CONFIRMATION' }), 'APPROVED_FOR_USER_CONFIRMATION', 'ALLOW');
    const orderId = queueForApproval(rep)!;
    const pending = joeEvents().events.find((e) => e.kind === 'APPROVAL_PENDING')!;
    expect(pending).toMatchObject({ severity: 'WARNING', links: { orderId, decisionId: rep.id }, presentation: { joeState: 'APPROVAL' } });
    expect(pending.presentation.text).toMatch(/No order has been filled/);
    expect(decideApproval(orderId, true)).toMatchObject({ ok: true });
    const after = kinds(joeEvents().events);
    expect(after).not.toContain('APPROVAL_PENDING');
    expect(after).toContain('PAPER_ENTRY_FILLED');
  });
  it('owner rejection and expiry are reported as nothing filled', () => {
    const a = saveDecision(report({ decision: 'APPROVED_FOR_USER_CONFIRMATION' }), 'APPROVED_FOR_USER_CONFIRMATION', 'ALLOW');
    decideApproval(queueForApproval(a)!, false);
    const b = saveDecision(report({ decision: 'APPROVED_FOR_USER_CONFIRMATION', consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() - 1000).toISOString() } } as any), 'APPROVED_FOR_USER_CONFIRMATION', 'ALLOW');
    queueForApproval(b); expireApprovals();
    const evs = joeEvents().events;
    expect(evs.find((e) => e.kind === 'ORDER_CANCELLED')!.presentation.text).toMatch(/rejected by owner\. Nothing was filled/);
    expect(evs.find((e) => e.kind === 'ORDER_EXPIRED')!.presentation.text).toMatch(/Nothing was filled/);
    expect(kinds(evs)).not.toContain('PAPER_ENTRY_FILLED');
  });
  it('a risk denial explains the reason and creates no order story', () => {
    saveDecision(report(), 'REJECTED', 'DENY', ['SPREAD_TOO_WIDE', 'NEW_ORDERS_PAUSED']);
    const evs = joeEvents().events;
    expect(kinds(evs)).toEqual(['RISK_DENIED']);
    expect(evs[0].fields.reasons).toBe('SPREAD_TOO_WIDE; NEW_ORDERS_PAUSED');
    expect(evs[0].presentation.text).toMatch(/No order was submitted\. Joe cannot override this/);
  });
  it('maps decision outcomes to no-trade / waiting / recorded', () => {
    saveDecision(report(), 'INSUFFICIENT_DATA', null);
    saveDecision(report(), 'WAIT_FOR_CONFIRMATION', null);
    saveDecision(report(), 'APPROVED_FOR_MONITORING', 'ALLOW');
    expect(kinds(joeEvents().events).sort()).toEqual(['DECISION_RECORDED', 'NO_TRADE', 'WAITING_FOR_CONFIRMATION']);
  });
});

describe('safety events', () => {
  it('protection problems are CRITICAL and recovery is reported separately', () => {
    const r = submitEntry(report(), 'bot');
    reportUnprotected({ id: r.positionId!, instrument: id }, 'no fresh executable price for exit');
    markRecovered(r.positionId!);
    const story = joeEventsForPosition(r.positionId!).events;
    expect(story.find((e) => e.kind === 'PROTECTION_ISSUE')).toMatchObject({ severity: 'CRITICAL', fields: { reason: 'no fresh executable price for exit' }, presentation: { joeState: 'DEGRADED' } });
    expect(story.find((e) => e.kind === 'PROTECTION_RECOVERED')!.presentation.joeState).toBe('RECOVERED');
  });
  it('a protection problem that comes back after recovery shows up as a NEW, later event (review finding 1)', () => {
    const r = submitEntry(report(), 'bot'); const t0 = Date.now();
    reportUnprotected({ id: r.positionId!, instrument: id }, 'stale book', t0);
    markRecovered(r.positionId!, t0 + 1000);
    const cursor = decodeCursor(joeEvents({ limit: 200 }).nextCursor!); // a client that has seen "recovered"
    reportUnprotected({ id: r.positionId!, instrument: id }, 'stale book again', t0 + 5000);
    const fresh = joeEvents({ after: cursor, limit: 50 }).events;
    expect(fresh.map((e) => [e.kind, e.occurredAt])).toEqual([['PROTECTION_ISSUE', t0 + 5000]]);
    expect(fresh[0].fields).toMatchObject({ reason: 'stale book again', currentStatus: 'OPEN', firstOpenedAt: t0 });
    const story = joeEventsForPosition(r.positionId!).events.filter((e) => e.kind.startsWith('PROTECTION'));
    expect(story.at(-1)!.kind).toBe('PROTECTION_ISSUE'); // the latest protection state is the relapse, not the old recovery
  });
  it('the stop card states whether the stop is still active and where it is now (review finding 2)', () => {
    const r = submitEntry(report(), 'bot');
    const live = joeEventsForPosition(r.positionId!).events.find((e) => e.kind === 'STOP_MONITORING_STARTED')!;
    expect(live.presentation.text).toMatch(/started monitoring a paper stop at .* still active, now at/);
    const qty = get<{ qty: number }>('SELECT qty FROM positions WHERE id=?', r.positionId!)!.qty;
    executeExit(r.positionId!, qty, 'MANUAL');
    const done = joeEventsForPosition(r.positionId!).events.find((e) => e.kind === 'STOP_MONITORING_STARTED')!;
    expect(done.fields.stopStatus).toBe('CANCELLED');
    expect(done.presentation.text).toMatch(/no longer active \(CANCELLED\)/);
    expect(done.presentation.joeState).toBe('EXPLAINING');
  });
  it('lifting the emergency stop while orders stay paused is reported, not dropped (review finding 3)', () => {
    emergencyStop('owner');
    updateControl('owner', { emergency: false }); // still paused
    const evs = joeEvents().events.filter((e) => e.source.table === 'audit_log');
    expect(kinds(evs)).toEqual(['EMERGENCY_STOP', 'CONTROLS_CHANGED']);
    expect(evs[1]).toMatchObject({ fields: { paused: true, emergency: false }, presentation: { joeState: 'HALTED' } });
    expect(evs[1].presentation.text).toMatch(/new orders paused = yes, emergency stop = no/);
  });
  it('pause, emergency stop and owner resume come from the audit log; other control changes are ignored', () => {
    pauseNewOrders('trader-joe');
    updateControl('owner', { pausedNewOrders: false });
    emergencyStop('owner');
    updateControl('owner', { disabledStrategies: ['trend_pullback'] }); // not a pause/resume change
    const evs = joeEvents().events.filter((e) => e.source.table === 'audit_log');
    expect(kinds(evs)).toEqual(['NEW_ORDERS_PAUSED', 'TRADING_RESUMED', 'EMERGENCY_STOP']);
    expect(evs[0]).toMatchObject({ severity: 'CRITICAL', fields: { actor: 'trader-joe' } });
  });
});

describe('contract, ordering and idempotency', () => {
  function busyHistory() {
    const r = submitEntry(report(), 'bot'); setBook(id, last * 0.96); monitorPositions();
    saveDecision(report(), 'REJECTED', 'DENY', ['X']); saveDecision(report(), 'WAIT_FOR_CONFIRMATION', null);
    pauseNewOrders('owner');
    return r;
  }
  it('every event matches the contract, is PAPER, and never uses a reserved kind', () => {
    busyHistory();
    const evs = joeEvents({ limit: 200 }).events;
    expect(evs.length).toBeGreaterThanOrEqual(8);
    for (const e of evs) {
      expect(JoeTradeEvent.safeParse(e).success).toBe(true);
      expect(e.mode).toBe('PAPER');
      expect(RESERVED_JOE_EVENT_KINDS as readonly string[]).not.toContain(e.kind);
    }
    expect(new Set(evs.map((e) => e.eventId)).size).toBe(evs.length); // no duplicates
  });
  it('the same records always produce the same events (stable ids, stable order)', () => {
    busyHistory();
    expect(joeEvents({ limit: 200 })).toEqual(joeEvents({ limit: 200 }));
  });
  it('paging forward with the cursor returns every event exactly once, oldest first', () => {
    busyHistory();
    const everything = joeEvents({ limit: 200 }).events;
    const seen: Ev[] = []; let cursor = decodeCursor(`0~decision:start`);
    for (let i = 0; i < 50; i++) {
      const page = joeEvents({ after: cursor, limit: 3 });
      if (!page.events.length) break;
      seen.push(...page.events); cursor = decodeCursor(page.nextCursor!);
    }
    expect(seen.map((e) => e.eventId)).toEqual(everything.map((e) => e.eventId));
    for (let i = 1; i < seen.length; i++) expect(seen[i].occurredAt).toBeGreaterThanOrEqual(seen[i - 1].occurredAt);
  });
  it('reading the story never writes to the database', () => {
    const r = busyHistory();
    const before = rowCounts();
    joeEvents({ limit: 200 }); joeEventsForPosition(r.positionId!);
    expect(rowCounts()).toEqual(before);
  });
  it('pages correctly through many events that share one millisecond (review finding 4)', () => {
    const ts = Date.now() - 10_000;
    for (let i = 0; i < 120; i++) saveDecision(report(), 'WAIT_FOR_CONFIRMATION', null, [], ts);
    const seen = new Set<string>(); let cursor = decodeCursor(`0~decision:start`);
    for (let i = 0; i < 100; i++) {
      const page = joeEvents({ after: cursor, limit: 7 });
      if (!page.events.length) break;
      for (const e of page.events) { expect(seen.has(e.eventId)).toBe(false); seen.add(e.eventId); }
      cursor = decodeCursor(page.nextCursor!);
    }
    expect(seen.size).toBe(120);
  });
  it('a very long rejection reason is shortened, not silently dropped (review finding 5)', () => {
    const rep = saveDecision(report({ decision: 'APPROVED_FOR_USER_CONFIRMATION' }), 'APPROVED_FOR_USER_CONFIRMATION', 'ALLOW');
    const oid = queueForApproval(rep)!;
    run("UPDATE orders SET status='REJECTED', reject_reason=? WHERE id=?", 'RISK_CODE_'.repeat(200), oid);
    const ev = joeEvents().events.find((e) => e.kind === 'ORDER_REJECTED')!;
    expect(ev).toBeDefined();
    expect(String(ev.fields.reason).length).toBe(300);
  });
  it('rejects malformed cursors', () => {
    expect(decodeCursor('abc')).toBeNull();
    expect(decodeCursor("1~decision:x' OR 1=1")).toBeNull();
  });
  it('masks provider symbols that are not plain tickers', () => {
    expect(safeSymbol('crypto:binance:ETHUSDT')).toBe('ETHUSDT');
    expect(safeSymbol('crypto:binance:<img src=x>')).toBe('an unrecognised instrument');
    expect(safeSymbol(undefined)).toBe('an unrecognised instrument');
  });
});

describe('boundary', () => {
  it('the Joe Live module has no financial authority: it imports only DB reads, zod and its own files', () => {
    const dir = join(SRC, 'joe/live');
    const src = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    const imports = [...src.matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(new Set(imports.filter((i) => !i.startsWith('./')))).toEqual(new Set(['zod', '../../db/db.js']));
    expect(src).not.toMatch(/\b(run|tx)\(/); // no write helpers
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\s+(INTO|FROM|\w+\s+SET)/i);
  });
});

describe('routes', () => {
  it('need an owner session, validate input and return the story', async () => {
    failureGate.reset(); const app = await buildApp();
    try {
      const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('joe live route owner') })).headers['set-cookie']).split(';')[0];
      const r = submitEntry(report(), 'bot');
      expect((await app.inject({ url: '/api/joe/events' })).statusCode).toBe(401);
      expect((await app.inject({ url: `/api/joe/events/by-position/${r.positionId}` })).statusCode).toBe(401);
      const list = await app.inject({ url: '/api/joe/events?limit=10', headers: { cookie } });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toMatchObject({ mode: 'PAPER', projection: 'CURRENT_STATE' });
      expect(kinds(list.json().events)).toContain('PAPER_ENTRY_FILLED');
      const next = await app.inject({ url: `/api/joe/events?after=${encodeURIComponent(list.json().nextCursor)}`, headers: { cookie } });
      expect(next.json().events).toEqual([]);
      expect((await app.inject({ url: '/api/joe/events?after=nope', headers: { cookie } })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/joe/events?limit=5000', headers: { cookie } })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/joe/events?evil=1', headers: { cookie } })).statusCode).toBe(400);
      expect((await app.inject({ url: '/api/joe/events/by-position/..%2Fx', headers: { cookie } })).statusCode).toBe(400);
      const pos = await app.inject({ url: `/api/joe/events/by-position/${r.positionId}`, headers: { cookie } });
      expect(kinds(pos.json().events)).toEqual(expect.arrayContaining(['PAPER_ENTRY_FILLED', 'STOP_MONITORING_STARTED']));
    } finally { await app.close(); }
  });
});
