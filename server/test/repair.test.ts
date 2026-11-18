import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { closeDb, openDb, get, all, run, tx, inTransaction } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, executeExit, protectPositions } from '../src/exec/oms.js';
import { reconcile } from '../src/portfolio/calendar.js';
import type { DecisionReport } from '../src/decision/engine.js';

/** Regression tests for defects found in the production-repair audit (each failed before its fix). */
function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}

describe('R-OMS: order-book freshness', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); seedInstrument('BTCUSDT'); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('R-OMS-1 refuses an entry when the order book is stale even if the ticker is fresh', () => {
    market.deep.get(id)!.book!.ts = Date.now() - 10 * 60_000; // 10-minute-old book, ticker still fresh
    const r = submitEntry(report(id, last), 'bot');
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/STALE|book/i);
    expect(openPositions()).toHaveLength(0);
  });
  it('R-OMS-2 does not exit at a stale price; keeps the position and flags it', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.deep.get(id)!.book!.ts = Date.now() - 10 * 60_000; market.tickers.get(id)!.receivedAt = Date.now() - 10 * 60_000;
    expect(executeExit(pos.id, pos.qty, 'MANUAL_CLOSE')).toBeNull();
    expect(openPositions()).toHaveLength(1);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM journal WHERE kind='RISK'")!.n).toBeGreaterThan(0);
  });
  it('R-OMS-3 partial take-profit then stop keeps ledger, positions and stop order consistent', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    setBook(id, last * 1.05); monitorPositions(); // T1 partial
    const p = openPositions()[0];
    const stop = get<any>("SELECT qty FROM orders WHERE position_id=? AND purpose='PROTECTIVE_STOP' AND status='ACTIVE'", p.id);
    expect(stop.qty).toBeCloseTo(p.qty, 12);
    setBook(id, last * 0.95); monitorPositions(); // stopped at breakeven trail
    expect(openPositions()).toHaveLength(0);
    expect(reconcile().ok).toBe(true);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM fills")!.n).toBe(3); // entry + T1 + stop, no duplicates
  });
});

describe('R-PR7: CodeRabbit-verified fail-closed fixes', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  });
  it('nested tx joins the outer transaction and an inner failure rolls back everything (no isTransaction dependency)', () => {
    expect(() => tx(() => { run("INSERT INTO journal(id,ts,kind,summary) VALUES ('a',1,'X','outer')"); tx(() => { expect(inTransaction()).toBe(true); run("INSERT INTO journal(id,ts,kind,summary) VALUES ('b',1,'X','inner')"); throw new Error('boom'); }); })).toThrow('boom');
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM journal WHERE kind='X'")!.n).toBe(0);
    expect(inTransaction()).toBe(false);
    tx(() => tx(() => run("INSERT INTO journal(id,ts,kind,summary) VALUES ('c',1,'X','ok')")));
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM journal WHERE kind='X'")!.n).toBe(1);
  });
  it('a future-dated quote cannot anchor an exit and the position stays open', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0]; const future = Date.now() + 10 * 60_000;
    market.tickers.get(id)!.receivedAt = future; market.tickers.get(id)!.providerTs = future; market.deep.get(id)!.book!.ts = future;
    expect(executeExit(pos.id, pos.qty, 'MANUAL_CLOSE')).toBeNull();
    expect(openPositions()).toHaveLength(1);
  });
  it('two targets hit in one pass need combined book depth; otherwise nothing is booked and the position stays intact', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const before = openPositions()[0];
    setBook(id, last * 1.10); // jumps through T1 and T2 at once
    const b = market.deep.get(id)!.book!; b.bids = [[b.bids[0][0], before.qty * 0.6]]; // depth for one target only
    monitorPositions();
    const after = openPositions()[0];
    expect(after.qty).toBe(before.qty); expect(get<{ n: number }>("SELECT COUNT(*) n FROM fills")!.n).toBe(1); // entry only
    expect(JSON.parse(after.targets).targets.every((t: any) => !t.done)).toBe(true);
  });
  it('exits in one pass consume book depth in order: the second target is priced from the lower level', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const q = openPositions()[0].qty;
    setBook(id, last * 1.10); const b = market.deep.get(id)!.book!;
    b.bids = [[last * 1.10, q * 0.5], [last * 1.08, q * 0.6]]; // first level holds exactly one target
    monitorPositions();
    const exits = all<{ price: number; qty: number }>("SELECT f.price, f.qty FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.purpose<>'ENTRY' ORDER BY f.ts, f.rowid");
    expect(exits).toHaveLength(2);
    expect(exits[1].price).toBeLessThan(exits[0].price); // previously both filled at the top level
    // order created_at and fill ts come from the same clock reading: execution delays are never negative
    for (const r of all<{ d: number }>("SELECT f.ts - o.created_at d FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.purpose<>'ENTRY'")) expect(r.d).toBe(0);
  });
  it('a take-profit slice smaller than one lot is not marked done (it sold nothing) and stays eligible', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    const pos = openPositions()[0];
    market.instruments.get(id)!.stepSize = pos.qty * 0.6; // T1 slice (50%) now rounds below one lot
    setBook(id, last * 1.05); monitorPositions();
    const after = openPositions()[0];
    expect(after.qty).toBe(pos.qty); // nothing sold
    expect(JSON.parse(after.targets).targets[0].done).toBe(false);
  });
  it('protection reconciliation requires a fresh book deep enough for the stop', () => {
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
    expect(protectPositions().positions[0]).toMatchObject({ protected: true, issue: null });
    market.deep.get(id)!.book!.bids = [[last * 0.999, 1e-6]];
    expect(protectPositions().positions[0]).toMatchObject({ protected: false, issue: expect.stringMatching(/book/) });
  });
});

describe('R-API: validation and error classification', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeAll(async () => {
    closeDb(); openDb(':memory:'); market.reset(); seedInstrument('BTCUSDT');
    app = await buildApp();
    // a deliberately faulty route, registered before the app starts, to exercise the error classifier
    app.get('/api/__boom_test', async () => { throw new TypeError("Cannot read properties of undefined (reading 'secretInternal')"); });
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'repair passphrase' } }); cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  it('R-API-1 rejects an invalid chart interval with 400, never a crash', async () => {
    for (const iv of ['foo', '__proto__', 'constructor']) {
      const r = await app.inject({ url: `/api/instrument/BTCUSDT?interval=${iv}`, headers: { cookie } });
      expect(r.statusCode, iv).toBe(400); expect(r.json().error).toMatch(/interval/);
    }
    expect((await app.inject({ url: '/api/instrument/BTCUSDT?interval=4h', headers: { cookie } })).statusCode).toBe(200);
  });
  it('R-API-2 rejects malformed calendar months', async () => {
    expect((await app.inject({ url: '/api/calendar?month=2026-13', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/calendar?month=abc', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/calendar?month=2026-11', headers: { cookie } })).statusCode).toBe(200);
  });
  it('R-API-3 unexpected server faults are 500 with a request id and no internal details', async () => {
    const r = await app.inject({ url: '/api/__boom_test', headers: { cookie } });
    expect(r.statusCode).toBe(500); expect(r.body).not.toContain('secretInternal'); expect(r.json().requestId).toBe(r.headers['x-request-id']);
  });
  it('R-DB-1 expired sessions are pruned', async () => {
    run('INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?,?,?)', 'expired_hash', 1, 2);
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'repair passphrase' } });
    expect(get('SELECT 1 FROM sessions WHERE token_hash=?', 'expired_hash')).toBeUndefined();
  });
});
