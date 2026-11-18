import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { market } from '../src/market/store.js';
import { decide } from '../src/decision/engine.js';
import { get } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { scenarioTable, expectancy } from '../src/decision/profitLab.js';
import { buildCertificate, CERTIFICATE_VERSION } from '../src/decision/certificate.js';
import type { Candidate } from '../src/workers/types.js';

/** THINK slice 1: Profit Laboratory arithmetic + Reason-to-Trade Certificate built from the REAL decision pipeline. */
function candidate(id: string, last: number): Candidate {
  return { id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr-think', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
    signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: ['fixture'] }, regime: 'TREND_UP', createdAt: Date.now() };
}
const stored = (id: string) => get<{ report: string; consensus_id: string }>('SELECT report, consensus_id FROM decisions WHERE id=?', id)!;
const storedConsensus = (id: string) => get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', id)?.record ?? null;

describe('Profit Laboratory (hypothetical arithmetic)', () => {
  it('blueprint example: $200 spot at $1.00, stop $0.96, target $1.08, 10 bps fees per side', () => {
    const t = scenarioTable({ entry: 1, stop: 0.96, targets: [{ price: 1.08, fraction: 1 }], qty: 200, feeRate: 0.001, spreadBps: 0, slippageBps: 0 });
    const s = Object.fromEntries(t.scenarios.map((x) => [x.id, x]));
    expect(t.kind).toBe('HYPOTHETICAL');
    expect(s.TARGETS_FILLED.netUsd).toBe(15.58);   // 16 gross - 0.2 - 0.216 fees
    expect(s.STOP_FILLED.netUsd).toBe(-8.39);      // -8 gross - 0.2 - 0.192 fees: more than the naive $8
    expect(t.maxPlannedLossUsd).toBe(8.39);
    expect(s.STOP_GAP_2X.netUsd!).toBeLessThan(s.STOP_FILLED.netUsd!); // a gap loses more than the stop (MIA-THINK-045)
    expect(s.LIQUIDITY_PULL.netUsd!).toBeLessThan(s.STOP_GAP_2X.netUsd!);
    expect(t.worstStressUsd).toBe(-s.LIQUIDITY_PULL.netUsd!);
    expect(s.FLAT_EXIT.netUsd!).toBeLessThan(0);                      // costs alone lose money
    expect(t.breakEvenExit!).toBeGreaterThan(1);
  });
  it('costs can turn a gross winner into a net loser (MIA-THINK-042)', () => {
    const t = scenarioTable({ entry: 100, stop: 99, targets: [{ price: 100.1, fraction: 1 }], qty: 1, feeRate: 0.001, spreadBps: 10, slippageBps: 10 });
    const win = t.scenarios.find((x) => x.id === 'TARGETS_FILLED')!;
    expect(win.grossPerUnit).toBeGreaterThan(0); expect(win.netPerUnit).toBeLessThan(0);
  });
  it('unknown costs use conservative defaults and say so; no qty means no USD', () => {
    const t = scenarioTable({ entry: 10, stop: 9, targets: [], qty: null, feeRate: 0.001, spreadBps: null, slippageBps: null });
    expect(t.costAssumptions).toMatchObject({ spreadBps: 20, slippageBps: 20 });
    expect(t.caveats.join(' ')).toMatch(/conservative 20 bps/);
    expect(t.scenarios.every((x) => x.netUsd === null)).toBe(true);
    expect(t.maxPlannedLossUsd).toBeNull();
  });
  it('refuses nonsensical plans instead of inventing numbers', () => {
    expect(scenarioTable({ entry: 10, stop: 11, targets: [], qty: 1, feeRate: 0.001, spreadBps: 1, slippageBps: 1 })).toMatchObject({ valid: false, scenarios: [] });
    expect(scenarioTable({ entry: Number.NaN, stop: 1, targets: [], qty: 1, feeRate: 0.001, spreadBps: 1, slippageBps: 1 }).valid).toBe(false);
  });
});

describe('Expectancy (only from a calibrated cohort)', () => {
  it('no calibrated probability -> NO_VALID_FORECAST, never a guess', () => {
    expect(expectancy(null, 2, 1, 0.1)).toMatchObject({ status: 'NO_VALID_FORECAST', expectedR: null });
    expect(expectancy({ point: 0.6, lower: 0.5, upper: 0.7, source: 'cohort', sample: 12 }, 2, 1, 0.1).status).toBe('NO_VALID_FORECAST');
    expect(expectancy({ point: 0.6, lower: 0.7, upper: 0.8, source: 'cohort', sample: 500 }, 2, 1, 0.1).status).toBe('NO_VALID_FORECAST');
  });
  it('a 60% hit rate with loss-skewed payoffs is net negative (MIA-THINK-043)', () => {
    const e = expectancy({ point: 0.6, lower: 0.55, upper: 0.65, source: 'cohort', sample: 400 }, 0.5, 1, 0.05);
    expect(e.expectedR).toBeLessThan(0); expect(e.verdict).toBe('NEGATIVE');
  });
  it('a lower bound at or below zero is UNCERTAIN_EDGE, positive lower bound is required (MIA-THINK-050)', () => {
    expect(expectancy({ point: 0.45, lower: 0.3, upper: 0.6, source: 'cohort', sample: 400 }, 2, 1, 0.1).verdict).toBe('UNCERTAIN_EDGE');
    expect(expectancy({ point: 0.55, lower: 0.5, upper: 0.6, source: 'cohort', sample: 400 }, 2, 1, 0.1).verdict).toBe('POSITIVE_LOWER_BOUND');
  });
});

describe('Reason-to-Trade Certificate from real decisions', () => {
  beforeAll(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('a vetoed decision is explained with NO_TRADE codes, provenance hashes and no probability', async () => {
    const { inst, last } = seedInstrument('JUNKUSDT', { seed: 3, quoteVolume: 100_000 });
    const c = candidate(inst.id, last); const ctx = buildContext(c); const rec = await runConsensus(ctx);
    const rep = decide(c, ctx, rec, null, 0);
    const row = stored(rep.id); const cons = storedConsensus(row.consensus_id);
    const cert = buildCertificate(row.report, cons);
    expect(cert.version).toBe(CERTIFICATE_VERSION);
    expect(cert.verdict).toMatchObject({ finalDecision: 'REJECT', tradeTaken: false });
    expect(cert.verdict.noTradeReasons).toEqual(expect.arrayContaining(['QCI_VETO', 'ASSET_NOT_ELIGIBLE']));
    expect(cert.provenance.reportSha256).toBe(createHash('sha256').update(row.report).digest('hex'));
    expect(cert.provenance.consensusSha256).toBe(createHash('sha256').update(cons!).digest('hex'));
    expect(cert.calibration).toMatchObject({ consensus: 'NOT_CALIBRATED', winProbability: null, opportunityScore: { meaning: 'HEURISTIC_SCORE_NOT_A_PROBABILITY' }, expectancy: { status: 'NO_VALID_FORECAST' } });
    expect(cert.authority).toEqual({ canAuthorizeTrade: false, finalApproval: 'INDEPENDENT_RISK_GATE', execution: 'PAPER_OMS_ONLY', liveTrading: 'LOCKED' });
    expect(cert.dissent.vetoes.length).toBeGreaterThan(0); expect(cert.bearCase.length).toBeGreaterThan(0);
    expect(cert.scenarios.valid).toBe(true);
  });
  it('stale data is explained as stale, and the certificate is deterministic for the same stored inputs', async () => {
    const { inst, last } = seedInstrument('ADAUSDT', { seed: 4 });
    market.tickers.get(inst.id)!.receivedAt = Date.now() - 10 * 60_000;
    const c = candidate(inst.id, last); const ctx = buildContext(c); const rec = await runConsensus(ctx);
    const rep = decide(c, ctx, rec, null, 0);
    const row = stored(rep.id); const cons = storedConsensus(row.consensus_id);
    const a = buildCertificate(row.report, cons), b = buildCertificate(row.report, cons);
    expect(a).toEqual(b);
    expect(a.verdict.noTradeReasons).toEqual(expect.arrayContaining(['STALE_OR_MISSING_MARKET_DATA', 'INSUFFICIENT_DATA']));
    expect(a.uncertainty.join(' ')).toMatch(/Market data quality was FAIL/);
  });
  it('a missing consensus record is reported as unverifiable, not silently assumed', async () => {
    const { inst, last } = seedInstrument('SOLUSDT', { seed: 5 });
    const c = candidate(inst.id, last); const ctx = buildContext(c); const rep = decide(c, ctx, await runConsensus(ctx), null, 0);
    const cert = buildCertificate(stored(rep.id).report, null);
    expect(cert.coverage.workers).toBeNull(); expect(cert.provenance.consensusSha256).toBeNull();
    expect(cert.uncertainty.join(' ')).toMatch(/Consensus record not found/);
  });
  it('product-truth guard: no guaranteed-profit or accuracy language (MIA-THINK-099)', async () => {
    const { inst, last } = seedInstrument('DOGEUSDT', { seed: 8 });
    const c = candidate(inst.id, last); const ctx = buildContext(c); const rep = decide(c, ctx, await runConsensus(ctx), null, 0);
    const text = JSON.stringify(buildCertificate(stored(rep.id).report, storedConsensus(stored(rep.id).consensus_id))).toLowerCase();
    expect(text).not.toMatch(/guarantee[ds]? (profit|win|return)|100% accura|sure win|risk[- ]free|win chance|chance of winning/);
  });
  it('static guard: THINK modules import no OMS, portfolio, wallet, signer or provider code (MIA-THINK-029/091)', () => {
    const src = ['certificate.ts', 'profitLab.ts'].map((f) => readFileSync(new URL(`../src/decision/${f}`, import.meta.url), 'utf8')).join('\n');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => /exec\/|portfolio\/|wallet|sign|providers\/|oms/.test(i))).toEqual([]);
  });
});

describe('GET /api/decisions/:id/certificate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let decisionId = '';
  beforeAll(async () => {
    freshDb(); market.reset(); failureGate.reset(); seedInstrument('BTCUSDT');
    const { inst, last } = seedInstrument('JUNKUSDT', { seed: 3, quoteVolume: 100_000 });
    const c = candidate(inst.id, last); const ctx = buildContext(c); decisionId = decide(c, ctx, await runConsensus(ctx), null, 0).id;
    app = await buildApp();
    cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: { password: 'think route owner' } })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); });
  it('owner session required; 404 for unknown; serves the certificate read-only', async () => {
    expect((await app.inject({ url: `/api/decisions/${decisionId}/certificate` })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/decisions/dec_nope/certificate', headers: { cookie } })).statusCode).toBe(404);
    const r = await app.inject({ url: `/api/decisions/${decisionId}/certificate`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ kind: 'EXPLANATION_ONLY', decisionId, authority: { canAuthorizeTrade: false } });
    expect((await app.inject({ method: 'POST', url: `/api/decisions/${decisionId}/certificate`, headers: { cookie, 'x-mia-csrf': '1', 'content-type': 'application/json' }, payload: {} })).statusCode).toBe(404);
  });
});
