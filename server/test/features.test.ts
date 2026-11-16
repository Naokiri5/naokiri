import { describe, it, expect } from 'vitest';
import { FeatureEngine } from '../src/features/indicators.js';
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
