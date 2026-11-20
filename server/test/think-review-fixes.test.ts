import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { market } from '../src/market/store.js';
import { decide } from '../src/decision/engine.js';
import { get, run } from '../src/db/db.js';
import { buildCertificate } from '../src/decision/certificate.js';
import { scenarioTable, expectancy } from '../src/decision/profitLab.js';
import { replayDecision } from '../src/ditas/replay.js';

/** Regression tests for the 2026-11-19 THINK review findings (P1-1, P1-2, P2-3/4/5/8/10/11). */
const candidate = (id: string, last: number): any => ({ id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr-fix', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
  signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: ['fixture'] }, regime: 'TREND_UP', createdAt: Date.now() });
async function stored(symbol: string, seed: number, mutateCtx?: (ctx: any) => void) {
  const { inst, last } = seedInstrument(symbol, { seed });
  const c = candidate(inst.id, last); const ctx = buildContext(c); mutateCtx?.(ctx);
  const rep = decide(c, ctx, await runConsensus(ctx), null, 0);
  const row = get<{ report: string; consensus_id: string }>('SELECT report, consensus_id FROM decisions WHERE id=?', rep.id)!;
  return { rep, report: JSON.parse(row.report), consensus: JSON.parse(get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', row.consensus_id)!.record) };
}

describe('THINK review fixes', () => {
  beforeEach(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('P1-1: a non-critical horizon note inside another CRITICAL contrarian finding is NOT reported as HORIZON_CONFLICT', async () => {
    const { report, consensus } = await stored('ETHUSDT', 11);
    report.decision = 'REJECTED'; report.finalDecision = 'REJECT'; report.consensus.state = 'VETOED';
    consensus.reason_codes = ['CRITICAL CONTRARIAN: price 3.2σ above mean; horizon conflict: 4h trend DOWN against a long (15m UP, 1h UP, 4h DOWN)'];
    const a = buildCertificate(JSON.stringify(report), JSON.stringify(consensus));
    expect(a.verdict.noTradeReasons).not.toContain('HORIZON_CONFLICT');
    consensus.reason_codes = ['CRITICAL CONTRARIAN: horizon conflict: long trend_pullback against a 1h AND 4h downtrend (15m UP, 1h DOWN, 4h DOWN)'];
    expect(buildCertificate(JSON.stringify(report), JSON.stringify(consensus)).verdict.noTradeReasons).toContain('HORIZON_CONFLICT');
  });

  it('P1-2: a decision waiting for owner approval is not shown as a taken trade', async () => {
    const { report, consensus } = await stored('ETHUSDT', 11);
    Object.assign(report, { decision: 'APPROVED_FOR_USER_CONFIRMATION', finalDecision: 'ENTER', risk: { decision: 'NEEDS_REVIEW', reasonCodes: ['DRAWDOWN_WARNING 5.2%'], evaluated: {}, sizing: null, policyVersion: 1, ts: report.createdAt, traceId: 't' } });
    const v = buildCertificate(JSON.stringify(report), JSON.stringify(consensus)).verdict;
    expect(v).toMatchObject({ tradeTaken: false, awaitingOwnerApproval: true });
    expect(v.noTradeReasons).toEqual(['NEEDS_OWNER_REVIEW', 'AWAITING_OWNER_APPROVAL']);
    report.decision = 'PAPER_TRADE'; report.risk.decision = 'ALLOW';
    expect(buildCertificate(JSON.stringify(report), JSON.stringify(consensus)).verdict).toMatchObject({ tradeTaken: true, awaitingOwnerApproval: false, noTradeReasons: [] });
  });

  it('P2-5: low score in OBSERVE mode reports BOTH reasons', async () => {
    const { report, consensus } = await stored('ETHUSDT', 11);
    report.decision = 'APPROVED_FOR_MONITORING'; report.finalDecision = 'MONITOR';
    for (const s of report.steps) if (s.name.startsWith('Opportunity score') || s.name.startsWith('Execution permission')) s.result = 'FAIL';
    expect(report.steps.some((s: any) => s.name === 'Opportunity score vs policy minimum')).toBe(true); // engine now records it
    expect(buildCertificate(JSON.stringify(report), JSON.stringify(consensus)).verdict.noTradeReasons).toEqual(expect.arrayContaining(['BELOW_OPPORTUNITY_THRESHOLD', 'OBSERVE_MODE']));
  });

  it('P2-3/4: costs are not double counted, and the stop scenario uses the conservative stop fill', () => {
    // spread 20 bps, impact from mid 5 bps: impact already includes half the spread, so charge max(10, 5) = 10 bps per fill.
    const t = scenarioTable({ entry: 100, stop: 97, stopFill: 96.5, targets: [{ price: 104.5, fraction: 1 }], qty: 1, feeRate: 0, spreadBps: 20, slippageBps: 5 });
    const flat = t.scenarios.find((s) => s.id === 'FLAT_EXIT')!;
    expect(flat.costsPerUnit).toBeCloseTo(0.2, 6); // 100 x 10 bps x 2 fills, not 100 x 15 bps x 2
    const stop = t.scenarios.find((s) => s.id === 'STOP_FILLED')!;
    expect(stop.exitPrice).toBe(96.5); expect(stop.description).toMatch(/conservative stop fill/);
  });

  it('P2-11: a NaN calibration sample is rejected', () => {
    expect(expectancy({ point: 0.6, lower: 0.5, upper: 0.7, source: 'cohort', sample: Number.NaN }, 2, 1, 0.1).status).toBe('NO_VALID_FORECAST');
    expect(expectancy({ point: 0.6, lower: 0.5, upper: 0.7, source: '', sample: 500 }, 2, 1, 0.1).reason).toMatch(/no named calibration source/);
  });

  it('P2-8: an altered decision EVENT (candidate) is refused even though the snapshot itself is intact', async () => {
    const { rep } = await stored('ETHUSDT', 11);
    run('DROP TRIGGER ditas_events_no_update');
    try { run("UPDATE ditas_events SET payload = replace(payload, '\"strategyId\":\"trend_pullback\"', '\"strategyId\":\"range_reversion\"') WHERE decision_id=?", rep.id); }
    finally { run("CREATE TRIGGER ditas_events_no_update BEFORE UPDATE ON ditas_events BEGIN SELECT RAISE(ABORT, 'DITAS records are immutable'); END"); }
    const r = replayDecision(rep.id);
    expect(r.status).toBe('NOT_REPLAYABLE'); expect(r.reasons.join()).toMatch(/event hash does not match/);
  });

  it('P2-10: replay uses the RECORDED clock, proven with a breadth worker that actually votes', async () => {
    const { rep } = await stored('ETHUSDT', 11, (ctx) => { ctx.breadth = { universe: 40, advancers: 30, decliners: 10, asOf: ctx.asOf - 1_000 }; });
    const a = replayDecision(rep.id);
    expect(a.status).toBe('REPRODUCED');
    const realNow = Date.now; Date.now = () => realNow() + 24 * 3600_000; // a day later: a wall-clock read would make breadth stale
    try { expect(replayDecision(rep.id)).toEqual(a); } finally { Date.now = realNow; }
  });
});
