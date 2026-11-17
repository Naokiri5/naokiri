import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { closeDb, openDb, get, run } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, executeExit } from '../src/exec/oms.js';
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
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
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
