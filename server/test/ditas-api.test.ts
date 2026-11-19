import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { all, closeDb, get, J, run } from '../src/db/db.js';
import { sha256 } from '../src/core/util.js';
import { market } from '../src/market/store.js';
import { recordOpportunity, memoryDetail } from '../src/ditas/memory.js';
import type { Candidate } from '../src/workers/types.js';
import type { Candle } from '../src/market/types.js';
import { freshDb, seedInstrument, ownerSetupPayload } from './helpers.js';

const HOUR = 3_600_000, T = Date.UTC(2026, 10, 10, 0, 0, 1);
const opening = Math.ceil(T / HOUR) * HOUR;
const assumptions = { feeRate: 0.001, spreadBps: 2, slippageBps: 3, notional: 1000, maxParticipationRate: 0.1 };
const futureBars = (): Candle[] => Array.from({ length: 3 }, (_, i) => ({ t: opening + i * HOUR, o: 100, h: 112, l: 99, c: 110, v: 100 }));

describe('DITAS authenticated API and persisted service integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>, cookie: string;
  const headers = () => ({ cookie, 'x-mia-csrf': '1' });
  const post = (url: string, payload: any) => app.inject({ method: 'POST', url, headers: headers(), payload });
  const createEvent = (opts: { kind?: 'PROPOSAL' | 'NO_SIGNAL' | 'REJECTED'; badData?: boolean; suffix?: string; symbol?: string } = {}) => {
    const { inst } = seedInstrument(opts.symbol ?? 'DITASUSDT', { drift: 0, vol: 0 });
    if (opts.badData) market.tickers.get(inst.id)!.providerTs = T - HOUR;
    const kind = opts.kind ?? 'PROPOSAL';
    const candidate: Candidate = { id: `candidate-${opts.suffix ?? 'one'}`, eventId: `fixture-${opts.suffix ?? 'one'}`, traceId: 'fixture-trace', instrumentId: inst.id, symbol: inst.symbol, base: inst.base, market: inst.market, venue: inst.venue, strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h', regime: 'TREND_UP', createdAt: Date.now(),
      signal: { direction: 'long', entryRef: 100, stop: 95, targets: [{ r: 2, fraction: 1 }], maxHoldBars: 10, trailAfterR: null, trigger: 'test fixture only', invalidation: 'below 95', reasons: ['fixture'] } };
    return recordOpportunity({ kind, instrumentId: inst.id, strategyId: 'trend_pullback', interval: '1h', dedupeKey: `fixture-${kind}-${opts.suffix ?? 'one'}`, reason: 'integration fixture only', candidate: kind === 'NO_SIGNAL' ? undefined : candidate });
  };
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T);
    market.reset(); freshDb(false); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('ditas integration owner') });
    expect(r.statusCode).toBe(200); cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  afterEach(async () => { await app.close(); closeDb(); market.reset(); vi.useRealTimers(); });

  it('protects reads/writes and exposes an honest empty overview', async () => {
    expect((await app.inject({ url: '/api/ditas' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/ditas/twins', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/ditas/twins', headers: { cookie }, payload: {} })).statusCode).toBe(403);
    const r = await app.inject({ url: '/api/ditas', headers: headers() });
    expect(r.statusCode).toBe(200); const d = r.json();
    expect(d.counts).toEqual({ snapshots: 0, events: 0, twins: 0, forecasts: 0, outcomes: 0 });
    expect(d.actual).toMatchObject({ label: 'PAPER', orders: 0, fills: 0, closedPositions: 0, realizedPnl: 0 });
    expect(d.calibration).toMatchObject({ status: 'UNCALIBRATED', sample: 0, brierScore: null });
    expect(d.controls.mode).toBe('OBSERVE');
    expect((await app.inject({ url: '/api/ditas/events/absent', headers: headers() })).statusCode).toBe(404);
  });

  it('uses frozen depth, stores hashed provenance, and cannot write actual execution ledgers', async () => {
    const event = createEvent(), snapshot = memoryDetail(event.id)!.snapshot!;
    market.deep.get(event.instrumentId)!.book = null; // Later live-store changes must not rewrite the frozen evidence.
    vi.setSystemTime(T + 5 * HOUR);
    const candles = futureBars();
    const r = await post('/api/ditas/twins', { eventId: event.id, candles, assumptions, sourceReference: 'synthetic integration fixture' });
    expect(r.statusCode, r.body).toBe(200); const result = r.json();
    expect(result.result.kind).toBe('HYPOTHETICAL'); expect(result.result.shadow.state).toBe('CLOSED');
    expect(result.result.assumptions.liquidityObservedAt).toBe(snapshot.book.ts);
    expect(result.result.dataProvenance).toMatchObject({ kind: 'OWNER_UPLOADED_UNVERIFIED', bars: 3, historyHash: sha256(J(candles)) });
    const stored = get<any>('SELECT * FROM ditas_twin_runs WHERE id=?', result.id)!;
    expect(stored.hash).toBe(sha256(stored.result));
    for (const table of ['orders', 'fills', 'positions', 'ledger_entries']) expect(all(`SELECT * FROM ${table}`), table).toHaveLength(0);
    const overview = (await app.inject({ url: '/api/ditas', headers: headers() })).json();
    expect(overview.counts.twins).toBe(1); expect(overview.actual.realizedPnl).toBe(0);
  });

  it('rejects no-signal and failed-data events instead of inventing a shadow proposal', async () => {
    const noSignal = createEvent({ kind: 'NO_SIGNAL' });
    const badData = createEvent({ badData: true, suffix: 'bad' });
    expect(memoryDetail(badData.id)!.snapshot!.quality.status).toBe('FAIL');
    vi.setSystemTime(T + 5 * HOUR);
    for (const event of [noSignal, badData]) expect((await post('/api/ditas/twins', { eventId: event.id, candles: futureBars(), assumptions, sourceReference: 'fixture' })).statusCode).toBe(400);
    expect(all('SELECT * FROM ditas_twin_runs')).toHaveLength(0);
  });

  it('rejects future, cherry-picked, gapped history and request-side liquidity injection', async () => {
    const event = createEvent(), payload = { eventId: event.id, candles: futureBars(), assumptions, sourceReference: 'fixture' };
    expect((await post('/api/ditas/twins', payload)).statusCode).toBe(400); // Bars have not closed yet.
    vi.setSystemTime(T + 5 * HOUR);
    expect((await post('/api/ditas/twins', { ...payload, candles: futureBars().slice(1) })).statusCode).toBe(400);
    const gap = futureBars(); gap[1].t += HOUR;
    expect((await post('/api/ditas/twins', { ...payload, candles: gap })).statusCode).toBe(400);
    expect((await post('/api/ditas/twins', { ...payload, assumptions: { ...assumptions, availableNotional: 1e9 } })).statusCode).toBe(400);
    expect((await post('/api/ditas/twins', { ...payload, sourceReference: '' })).statusCode).toBe(400);
    expect(all('SELECT * FROM ditas_twin_runs')).toHaveLength(0);
  });

  it('requires explicit probability, fixed reference and future boundary for registered forecasts', async () => {
    const event = createEvent();
    const payload = { eventId: event.id, probability: 0.75, targetAt: opening + HOUR, referencePrice: 100, modelVersion: 'fixture-model-v1', promptVersion: 'fixture-prompt-v1' };
    for (const patch of [{ probability: undefined }, { probability: 75 }, { referencePrice: 101 }, { targetAt: T }, { targetAt: opening + HOUR + 1 }]) expect((await post('/api/ditas/forecasts', { ...payload, ...patch })).statusCode).toBe(400);
    const r = await post('/api/ditas/forecasts', payload);
    expect(r.statusCode, r.body).toBe(200); expect(r.json()).toMatchObject({ probability: 0.75, provenance: 'OWNER_REGISTERED_PROBABILITY', target: 'CLOSE_ABOVE_REFERENCE', referencePrice: 100 });
    expect((await post('/api/ditas/forecasts', payload)).statusCode).toBe(400);
    // A duplicate proposal record cannot multiply the same forecast target/model into an independent sample.
    const second = createEvent({ suffix: 'duplicate' });
    expect((await post('/api/ditas/forecasts', { ...payload, eventId: second.id })).statusCode).toBe(400);
    vi.setSystemTime(T + HOUR + 1);
    expect((await post('/api/ditas/forecasts', { ...payload, targetAt: opening + 3 * HOUR })).statusCode).toBe(400);
    expect(all('SELECT * FROM ditas_forecasts')).toHaveLength(1);
  });

  it('settles observations only after targets and never pools distinct calibration cohorts', async () => {
    const event = createEvent(), targetAt = opening + HOUR;
    const payload = { eventId: event.id, probability: 0.75, targetAt, referencePrice: 100, modelVersion: 'model-v1', promptVersion: 'prompt-v1' };
    const first = (await post('/api/ditas/forecasts', payload)).json();
    const second = (await post('/api/ditas/forecasts', { ...payload, probability: 0.25, modelVersion: 'model-v2' })).json();
    const observation = { forecastId: first.id, observedAt: targetAt, observedPrice: 110, sourceReference: 'fixture close' };
    expect((await post('/api/ditas/outcomes', observation)).statusCode).toBe(400);
    vi.setSystemTime(targetAt + 1000);
    expect((await post('/api/ditas/outcomes', { ...observation, observedAt: targetAt - 1 })).statusCode).toBe(400);
    expect((await post('/api/ditas/outcomes', observation)).json()).toMatchObject({ outcome: 1, provenance: 'OWNER_REPORTED_UNVERIFIED' });
    expect((await post('/api/ditas/outcomes', observation)).statusCode).toBe(400);
    expect((await post('/api/ditas/outcomes', { ...observation, forecastId: second.id, observedPrice: 90 })).statusCode).toBe(200);
    const pooled = (await app.inject({ url: '/api/ditas/calibration', headers: headers() })).json();
    expect(pooled).toMatchObject({ sample: 0, status: 'UNCALIBRATED', cohort: null }); expect(pooled.cohorts).toHaveLength(2);
    const cohort = (await app.inject({ url: `/api/ditas/calibration?cohort=${encodeURIComponent(first.cohort)}`, headers: headers() })).json();
    expect(cohort).toMatchObject({ sample: 1, status: 'UNCALIBRATED', brierScore: 0.0625 });
    expect(all('SELECT * FROM ditas_outcomes')).toHaveLength(2);
  });

  it('rejects forecast registration before evidence or after the 60-second window', async () => {
    const event = createEvent();
    const payload = { eventId: event.id, probability: 0.5, targetAt: opening + HOUR, referencePrice: 100, modelVersion: 'clock-fixture-v1', promptVersion: 'clock-prompt-v1' };
    vi.setSystemTime(T - 1);
    const rollback = await post('/api/ditas/forecasts', payload);
    expect(rollback.statusCode).toBe(400); expect(rollback.json().error).toMatch(/within 60 seconds/);
    vi.setSystemTime(T + 60_001);
    const expired = await post('/api/ditas/forecasts', payload);
    expect(expired.statusCode).toBe(400); expect(expired.json().error).toMatch(/within 60 seconds/);
    expect(all('SELECT * FROM ditas_forecasts')).toHaveLength(0);
    vi.setSystemTime(T + 60_000);
    expect((await post('/api/ditas/forecasts', payload)).statusCode).toBe(200);
  });

  it('keeps proposals early and late in the same bar in separate cohorts (different remaining horizon)', async () => {
    const early = createEvent({ suffix: 'early' });
    const payload = { eventId: early.id, probability: 0.5, targetAt: opening + HOUR, referencePrice: 100, modelVersion: 'phase-fixture-v1', promptVersion: 'phase-prompt-v1' };
    const first = (await post('/api/ditas/forecasts', payload)).json();
    vi.setSystemTime(T + 59 * 60_000); // same 1h bar, 59 minutes later
    const late = createEvent({ suffix: 'late', symbol: 'DITASBUSDT' }); // another instrument: cohorts pool across instruments
    const r = await post('/api/ditas/forecasts', { ...payload, eventId: late.id }); expect(r.statusCode, r.body).toBe(200); const second = r.json();
    expect(first.horizonBars).toBe(second.horizonBars); expect(first.registrationLagBucket).toBe(second.registrationLagBucket);
    expect(first.remainingQuarterBars).toBeGreaterThan(second.remainingQuarterBars);
    expect(first.cohort).not.toBe(second.cohort);
  });

  it('keeps otherwise matching forecast horizons separate across registration-lag buckets', async () => {
    const firstEvent = createEvent();
    const payload = { eventId: firstEvent.id, probability: 0.5, targetAt: opening + HOUR, referencePrice: 100, modelVersion: 'lag-fixture-v1', promptVersion: 'lag-prompt-v1' };
    const first = (await post('/api/ditas/forecasts', payload)).json();
    vi.setSystemTime(T + HOUR);
    const secondEvent = createEvent({ suffix: 'next-hour' });
    vi.setSystemTime(T + HOUR + 5000);
    const r = await post('/api/ditas/forecasts', { ...payload, eventId: secondEvent.id, targetAt: opening + 2 * HOUR });
    expect(r.statusCode, r.body).toBe(200); const second = r.json();
    expect(first.horizonBars).toBe(second.horizonBars);
    expect(first.registrationLagBucket).toBe(0); expect(second.registrationLagBucket).toBe(1);
    expect(first.cohort).not.toBe(second.cohort);
    const d = (await app.inject({ url: '/api/ditas/calibration', headers: headers() })).json();
    expect(d.cohorts).toHaveLength(2); expect(d.sample).toBe(0);
  });

  it('projects actual paper results from authoritative paper-account rows only', async () => {
    const addPosition = (id: string, account: string, status: string, pnl: number) => run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,exit_price,realized_pnl,fees,planned_risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, account, 'crypto:binance:DITASUSDT', 'crypto', 'LONG', 'trend_pullback', status === 'OPEN' ? 1 : 0, 100, 95, 95, '[]', status, T - HOUR, status === 'CLOSED' ? T : null, status === 'CLOSED' ? 110 : null, pnl, 9, 5);
    const addFill = (id: string, account: string, fee: number) => {
      run('INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, `client-${id}`, account, 'binance-paper', 'crypto:binance:DITASUSDT', 'BUY', 'MARKET', 1, 'FILLED', 'ENTRY', T, T);
      run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', `fill-${id}`, id, 1, 100, fee, 'TAKER', T);
    };
    addPosition('paper-closed', 'paper-bot', 'CLOSED', 12.5);
    addPosition('paper-open', 'paper-bot', 'OPEN', 99);
    addPosition('other-closed', 'another-account', 'CLOSED', 9999);
    addFill('paper-order', 'paper-bot', 0.1); addFill('other-order', 'another-account', 100);
    const r = await app.inject({ url: '/api/ditas', headers: headers() });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().actual).toEqual({ label: 'PAPER', orders: 1, fills: 1, closedPositions: 1, realizedPnl: 12.5, fees: 0.1 });
    expect(r.json().twins).toHaveLength(0);
  });
});
