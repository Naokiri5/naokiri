import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { horizonAlignment, challengePanel } from '../src/qci/challenge.js';
import { market } from '../src/market/store.js';
import { decide } from '../src/decision/engine.js';
import { get } from '../src/db/db.js';
import { buildCertificate } from '../src/decision/certificate.js';
import { replayDecision } from '../src/ditas/replay.js';

/**
 * THINK slice 5 (MIA-THINK-037): explicit 15m/1h/4h trend alignment in the CONTRARIAN challenge reviewer.
 * Conservative by construction: it can only add opposing evidence or a veto, never support.
 */
const candidate = (id: string, last: number, strategyId = 'trend_pullback'): any => ({ id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr-hz', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId, strategyVersion: '1.0.0', interval: '1h',
  signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: ['fixture'] }, regime: strategyId === 'range_reversion' ? 'RANGE' : 'TREND_UP', createdAt: Date.now() });

/** Minimal context with hand-set horizon features. */
const up = { close: 110, ema20: 105, ema50: 100 }, down = { close: 90, ema20: 95, ema50: 100 }, flat = { close: 101, ema20: 99, ema50: 100 };
const ctxWith = (f: Record<string, object | null>, strategyId = 'trend_pullback', direction = 'long'): any =>
  ({ f, candidate: { strategyId, signal: { direction } } });

describe('horizonAlignment (pure)', () => {
  it('classifies each horizon; missing features are UNKNOWN, never guessed', () => {
    const h = horizonAlignment(ctxWith({ '15m': up, '1h': flat, '4h': null }));
    expect(h.trends).toEqual({ '15m': 'UP', '1h': 'FLAT', '4h': 'UNKNOWN' });
    expect(h).toMatchObject({ findings: [], critical: false });
    expect(horizonAlignment(ctxWith({ '15m': { close: Number.NaN, ema20: 1, ema50: 1 } })).trends['15m']).toBe('UNKNOWN');
  });
  it('trend-following long against 1h AND 4h downtrends is critical', () => {
    const h = horizonAlignment(ctxWith({ '15m': up, '1h': down, '4h': down }));
    expect(h.critical).toBe(true); expect(h.findings[0]).toMatch(/horizon conflict: long trend_pullback against a 1h AND 4h downtrend/);
    expect(horizonAlignment(ctxWith({ '15m': up, '1h': down, '4h': down }, 'donchian_breakout')).critical).toBe(true);
  });
  it('a single contradicting horizon is listed as opposing evidence but does not veto', () => {
    for (const f of [{ '15m': down, '1h': up, '4h': up }, { '15m': up, '1h': up, '4h': down }, { '15m': up, '1h': down, '4h': up }]) {
      const h = horizonAlignment(ctxWith(f));
      expect(h.critical).toBe(false); expect(h.findings).toHaveLength(1); expect(h.findings[0]).toMatch(/horizon conflict/);
    }
  });
  it('range-reversion (dip buying by design) is never vetoed by horizons, only informed', () => {
    const h = horizonAlignment(ctxWith({ '15m': down, '1h': down, '4h': down }, 'range_reversion'));
    expect(h.critical).toBe(false); expect(h.findings[0]).toMatch(/not trend-following, listed only/);
  });
  it('aligned uptrend produces no conflict; non-long candidates are not judged', () => {
    expect(horizonAlignment(ctxWith({ '15m': up, '1h': up, '4h': up }))).toMatchObject({ findings: [], critical: false });
    expect(horizonAlignment(ctxWith({ '15m': down, '1h': down, '4h': down }, 'trend_pullback', 'short'))).toMatchObject({ findings: [], critical: false });
  });
});

describe('horizon conflict through the real pipeline', () => {
  beforeEach(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('a trend-pullback long on a market falling on every horizon is VETOED, rejected, and explained', async () => {
    const { inst, last } = seedInstrument('DOWNUSDT', { seed: 12, drift: -0.003 });
    const c = candidate(inst.id, last); const ctx = buildContext(c);
    expect(horizonAlignment(ctx).trends).toMatchObject({ '1h': 'DOWN', '4h': 'DOWN' });
    const rec = await runConsensus(ctx);
    expect(rec.state).toBe('VETOED');
    expect(rec.reason_codes.join(' ')).toMatch(/CRITICAL CONTRARIAN: .*horizon conflict/);
    const rep = decide(c, ctx, rec, null, 0);
    expect(rep.finalDecision).toBe('REJECT');
    const row = get<{ report: string; consensus_id: string }>('SELECT report, consensus_id FROM decisions WHERE id=?', rep.id)!;
    const cert = buildCertificate(row.report, get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', row.consensus_id)!.record);
    expect(cert.verdict.noTradeReasons).toEqual(expect.arrayContaining(['QCI_VETO', 'HORIZON_CONFLICT']));
    expect(replayDecision(rep.id).status).toBe('REPRODUCED'); // worker evidence is unaffected by the challenge addition
  });

  it('the same falling market does not trigger a horizon veto for range-reversion', async () => {
    const { inst, last } = seedInstrument('DOWNUSDT', { seed: 12, drift: -0.003 });
    const ctx = buildContext(candidate(inst.id, last, 'range_reversion'));
    const contrarian = challengePanel(ctx, []).find((x) => x.reviewer === 'CONTRARIAN')!;
    expect(contrarian.findings.join(' ')).toMatch(/not trend-following, listed only/);
    const rec = await runConsensus(ctx);
    expect(rec.reason_codes.join(' ')).not.toMatch(/CRITICAL CONTRARIAN: [^|]*horizon conflict: long/);
  });

  it('an aligned uptrend is unaffected (no horizon finding)', async () => {
    const { inst, last } = seedInstrument('UPUSDT', { seed: 11 });
    const ctx = buildContext(candidate(inst.id, last));
    expect(horizonAlignment(ctx)).toMatchObject({ findings: [], critical: false });
    const rec = await runConsensus(ctx);
    expect(rec.reason_codes.join(' ')).not.toMatch(/horizon conflict/);
  });
});
