import { describe, it, expect } from 'vitest';
import { FeatureEngine, MIA5_SWARM_FEATURE_SLOTS, projectMia5SwarmResearchFeatures } from '../src/features/indicators.js';
import { classifyRegime } from '../src/regime/regime.js';
import { synthCandles } from './helpers.js';

describe('FeatureEngine (incremental, Part 33.5)', () => {
  it('incremental ingestion equals batch ingestion', () => {
    const cs = synthCandles(300);
    const a = new FeatureEngine(); a.ingest(cs);
    const b = new FeatureEngine(); for (let i = 0; i < cs.length; i += 7) b.ingest(cs.slice(0, i + 7)); // overlapping chunks
    expect(b.last).toEqual(a.last);
    expect(b.candles.length).toBe(a.candles.length);
  });
  it('ignores duplicates and out-of-order older candles', () => {
    const cs = synthCandles(100); const e = new FeatureEngine();
    expect(e.ingest(cs)).toBe(100);
    expect(e.ingest(cs.slice(10, 50))).toBe(0);
  });
  it('EMA matches closed-form on constant series; RSI bounded', () => {
    const cs = synthCandles(250).map((c) => ({ ...c, o: 50, h: 50, l: 50, c: 50 }));
    const e = new FeatureEngine(); e.ingest(cs);
    expect(e.last!.ema20).toBeCloseTo(50, 10); expect(e.last!.ema200).toBeCloseTo(50, 10);
    const up = synthCandles(250, { drift: 0.01, vol: 0.001 }); const u = new FeatureEngine(); u.ingest(up);
    expect(u.last!.rsi14).toBeGreaterThan(90); expect(u.last!.rsi14).toBeLessThanOrEqual(100);
  });
  it('Wilder RSI on a known sequence', () => {
    // classic Wilder example closes
    const closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
    const e = new FeatureEngine(); e.ingest(closes.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 })));
    expect(e.last!.rsi14).toBeCloseTo(70.46, 1);
  });
  it('regime: uptrend detected, insufficient history is UNKNOWN', () => {
    const up = new FeatureEngine(); up.ingest(synthCandles(300, { drift: 0.004, vol: 0.004 }));
    expect(classifyRegime(up.last).regime).toBe('TREND_UP');
    const short = new FeatureEngine(); short.ingest(synthCandles(30));
    expect(classifyRegime(short.last).regime).toBe('UNKNOWN');
  });
});

describe('advanced indicators on closed candles', () => {
  const linear = Array.from({ length: 52 }, (_, t) => {
    const c = 100 + t;
    return { t, o: c, h: c + 2, l: c - 2, c, v: 1 };
  });

  it('warms up WMA, Keltner, and Hull before reporting their reference values', () => {
    const e = new FeatureEngine();
    expect(e.research).toBeNull();
    e.ingest(linear.slice(0, 19));
    expect(e.research).toMatchObject({ wma20: null, hma20: null, keltner: null });
    e.ingest(linear.slice(19, 20));
    expect(e.research!.wma20).toBeCloseTo(112 + 2 / 3, 10);
    expect(e.research).toMatchObject({
      hma20: null,
      keltner: { middle: 109.5, lower: 101.5, upper: 117.5 },
    });
    e.ingest(linear.slice(20, 23));
    expect(e.research!.hma20).toBeCloseTo(122 - 2 / 3, 10);
  });

  it('reports Ichimoku lines with plotting offsets and independent warm-up', () => {
    const e = new FeatureEngine();
    e.ingest(linear.slice(0, 26));
    expect(e.research!.ichimoku).toMatchObject({
      conversion9: 121, base26: 112.5, leadingB52: null,
    });
    e.ingest(linear.slice(26));
    expect(e.research!.ichimoku).toEqual({
      conversion9: 147, base26: 138.5, leadingA: 142.75, leadingB52: 125.5,
      laggingClose: 151, displacementBars: 26,
    });
  });

  it('clamps Parabolic SAR to the preceding bars and resets acceleration on reversal', () => {
    const e = new FeatureEngine();
    const prices = [[11, 9, 10], [12, 10, 11], [13, 11, 12], [14, 12, 13], [13, 8, 9], [10, 7, 8], [10, 6, 7]];
    const bars = prices.map(([h, l, c], t) => ({ t, o: c, h, l, c, v: 1 }));
    e.ingest(bars.slice(0, 1));
    expect(e.research!.parabolicSar).toBeNull();
    e.ingest(bars.slice(1, 3));
    expect(e.research!.parabolicSar).toEqual({ value: 9, trend: 'UP' });
    e.ingest(bars.slice(3, 4));
    expect(e.research!.parabolicSar!.value).toBeCloseTo(9.16, 10);
    e.ingest(bars.slice(4, 5));
    expect(e.research!.parabolicSar).toEqual({ value: 14, trend: 'DOWN' });
    e.ingest(bars.slice(5));
    expect(e.research!.parabolicSar!.value).toBeCloseTo(13.72, 10);
  });

  it('reports unannualized 20-bar volatility from OHLC without requiring trade data', () => {
    const e = new FeatureEngine();
    const bars = Array.from({ length: 20 }, (_, t) => ({ t, o: 100, h: 110, l: 90, c: 105, v: 0 }));
    e.ingest(bars.slice(0, 19));
    expect(e.research).toMatchObject({ parkinson20: null, garmanKlass20: null });
    e.ingest(bars.slice(19));
    expect(e.research!.parkinson20).toBeCloseTo(0.120515034553, 10);
    expect(e.research!.garmanKlass20).toBeCloseTo(0.138617451865, 10);
  });

  it('keeps advanced readings stable across overlapping ingestion and cache rotation', () => {
    const bars = synthCandles(450);
    const batch = new FeatureEngine();
    batch.ingest(bars);
    const incremental = new FeatureEngine();
    for (let i = 0; i < bars.length; i += 7) incremental.ingest(bars.slice(Math.max(0, i - 1), i + 7));
    expect(incremental.research).toEqual(batch.research);
    expect(batch.candles.length).toBe(400);
    expect(batch.last).not.toHaveProperty('wma20');
  });
});


describe('MIA 5 PDF 97-slot compatibility (research only, no duplicate swarm)', () => {
  it('keeps all 97 original slot indices stable and records missing inputs as null', () => {
    expect(MIA5_SWARM_FEATURE_SLOTS).toHaveLength(97);
    expect(MIA5_SWARM_FEATURE_SLOTS[0]).toBe('EMA_9');
    expect(MIA5_SWARM_FEATURE_SLOTS[1]).toBe('EMA_21');
    expect(MIA5_SWARM_FEATURE_SLOTS[2]).toBe('EMA_55');
    expect(MIA5_SWARM_FEATURE_SLOTS[69]).toBe('LP_LOCKED_PCT');
    expect(MIA5_SWARM_FEATURE_SLOTS[96]).toBe('ORACLE_DISAGREEMENT_BPS');

    const engine = new FeatureEngine();
    engine.ingest(synthCandles(300));
    const actual = projectMia5SwarmResearchFeatures(engine.last, engine.research, true);
    expect(actual).toMatchObject({
      totalSlots: 97, sourceTimeframeValid: true, tradeEligible: false, status: 'PARTIAL',
    });
    expect(actual.values).toHaveLength(97);
    expect(actual.values[0]).toBeCloseTo(engine.last!.ema9, 10);
    expect(actual.values[1]).toBeCloseTo(engine.last!.ema21!, 10);
    expect(actual.values[2]).toBeCloseTo(engine.last!.ema55!, 10);
    expect(actual.values[7]).toBeCloseTo(engine.last!.macdHistSlope!, 10);
    expect(actual.values[16]).toBeCloseTo(engine.research!.ichimoku.conversion9!, 10);
    expect(actual.values[69]).toBeNull(); // no verified Solana LP lock source
    expect(actual.values[96]).toBeNull(); // no verified cross-venue oracle source
    expect(actual.values[3]).toBeNull(); // PDF Donchian window includes the current bar
    expect(actual.missingCount + actual.availableCount).toBe(97);
  });
  it('never returns apparent evidence when the existing timeframe quality gate says invalid', () => {
    const engine = new FeatureEngine();
    engine.ingest(synthCandles(300));
    const rejected = projectMia5SwarmResearchFeatures(engine.last, engine.research, false);
    expect(rejected).toMatchObject({
      status: 'UNVERIFIED', sourceTimeframeValid: false,
      availableCount: 0, missingCount: 97, tradeEligible: false,
    });
    expect(rejected.values.every(v => v === null)).toBe(true);
    expect(projectMia5SwarmResearchFeatures(null, null, true).availableCount).toBe(0);
    const cold = new FeatureEngine(); cold.ingest(synthCandles(1));
    expect(projectMia5SwarmResearchFeatures(cold.last, cold.research, true)).toMatchObject({
      availableCount: 0, missingCount: 97, status: 'UNVERIFIED', tradeEligible: false,
    });
  });
  it('stays deterministic after duplicate/overlapping market data and never uses mismatched research', () => {
    const bars = synthCandles(300);
    const batch = new FeatureEngine(); batch.ingest(bars);
    const incremental = new FeatureEngine();
    for (let i = 0; i < bars.length; i += 9) incremental.ingest(bars.slice(Math.max(0, i - 2), i + 9));
    expect(projectMia5SwarmResearchFeatures(batch.last, batch.research, true))
      .toEqual(projectMia5SwarmResearchFeatures(incremental.last, incremental.research, true));
    const mismatch = projectMia5SwarmResearchFeatures(batch.last, { ...batch.research!, candleOpenAt: -1 }, true);
    expect(mismatch.values[16]).toBeNull();
    expect(mismatch.values[17]).toBeNull();
  });
});
