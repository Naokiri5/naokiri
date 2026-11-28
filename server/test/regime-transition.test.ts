import { describe, expect, it } from 'vitest';
import { assessRegimeStability, REGIME_CONFIRM_BARS, REGIME_LOOKBACK_BARS } from '../src/regime/transition.js';
import { FeatureEngine, type FeatureSnapshot } from '../src/features/indicators.js';
import { synthCandles } from './helpers.js';

// Minimal snapshots that classifyRegime maps deterministically (see regime/regime.ts thresholds).
const base = { n: 200, close: 100, ema9: 100, ema200: 90, rsi14: 50, atr14: 1, atrPct: 0.01, bbWidth: 0.05 } as Partial<FeatureSnapshot>;
const up = (t: number) => ({ ...base, t, adx14: 30, ema20: 102, ema50: 100, ema50Slope10: 0.5, bbWidthPctile100: 0.5 }) as FeatureSnapshot;
const down = (t: number) => ({ ...base, t, adx14: 30, ema20: 98, ema50: 100, ema50Slope10: -0.5, bbWidthPctile100: 0.5 }) as FeatureSnapshot;
const range = (t: number) => ({ ...base, t, adx14: 15, ema20: 100, ema50: 100, ema50Slope10: 0, bbWidthPctile100: 0.5 }) as FeatureSnapshot;
const unknown = (t: number) => ({ ...base, t, n: 10, adx14: NaN, ema20: 100, ema50: NaN, ema50Slope10: 0, bbWidthPctile100: 0.5 }) as FeatureSnapshot;
const seq = (...fs: ((t: number) => FeatureSnapshot)[]) => fs.map((f, i) => f(1000 + i * 3_600_000));

describe('regime transition gate', () => {
  it('is STABLE only after the regime is confirmed for the required candles', () => {
    expect(assessRegimeStability(seq(range, range, range, up, up, up))).toMatchObject({ stability: 'STABLE', regime: 'TREND_UP', barsInRegime: 3 });
    const r = assessRegimeStability(seq(range, range, range, range, up, up));
    expect(r).toMatchObject({ stability: 'TRANSITIONING', regime: 'TREND_UP', barsInRegime: 2 });
  });
  it('treats a regime that keeps flipping as UNSTABLE even when the last candles agree', () => {
    const flips = seq(up, range, up, range, up, range, up, up, up);
    const r = assessRegimeStability(flips);
    expect(r.flips).toBeGreaterThanOrEqual(4);
    expect(r.stability).toBe('UNSTABLE');
  });
  it('forgets flips older than the lookback window', () => {
    const old = seq(up, range, up, range, up, range, ...Array(REGIME_LOOKBACK_BARS).fill(up));
    expect(assessRegimeStability(old).stability).toBe('STABLE');
  });
  it('fails closed on short history, an unknown regime, or out-of-order snapshots', () => {
    expect(assessRegimeStability([]).stability).toBe('UNKNOWN');
    expect(assessRegimeStability(seq(up, up).slice(0, REGIME_CONFIRM_BARS - 1)).stability).toBe('UNKNOWN');
    expect(assessRegimeStability(seq(up, up, up, unknown)).stability).toBe('UNKNOWN');
    const shuffled = seq(up, up, up, up); [shuffled[1], shuffled[2]] = [shuffled[2], shuffled[1]];
    expect(assessRegimeStability(shuffled).stability).toBe('UNKNOWN');
  });
  it('a reversal resets confirmation', () => {
    expect(assessRegimeStability(seq(up, up, up, up, down)).stability).toBe('TRANSITIONING');
  });
});

describe('feature engine snapshot history', () => {
  it('keeps the most recent closed-candle snapshots, bounded and in order', () => {
    const e = new FeatureEngine();
    e.ingest(synthCandles(100));
    expect(e.history).toHaveLength(FeatureEngine.HISTORY_KEEP);
    expect(e.history.at(-1)).toBe(e.last);
    expect(e.history.every((f, i) => i === 0 || f.t > e.history[i - 1].t)).toBe(true);
    e.ingest(synthCandles(100)); // duplicates are ignored, so history does not change
    expect(e.history.at(-1)).toBe(e.last);
    expect(e.history).toHaveLength(FeatureEngine.HISTORY_KEEP);
  });
});
