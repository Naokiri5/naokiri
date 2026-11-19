import { describe, expect, it } from 'vitest';
import { analyzeChart } from '../src/chart/analysis.js';
import { replayChart } from '../src/chart/replay.js';
import type { Candle } from '../src/market/types.js';

const H = 3_600_000;
const history = (n = 30): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * H, o: 100, h: 102, l: 98, c: 101, v: 10 }));
const analyze = (cs: Candle[]) => analyzeChart('test:fixture', '1h', cs, cs.length * H);

describe('deterministic chart intelligence', () => {
  it('abstains with insufficient data and does not invent a trend', () => {
    expect(analyze(history(10))).toMatchObject({ status: 'INSUFFICIENT_DATA', decision: 'NO TRADE', detections: [] });
    expect(analyze(history()).trend).toBe('UNKNOWN');
  });
  it.each(['gap', 'duplicate', 'negative', 'nan', 'badRange', 'forming', 'badCloseTime'])('rejects %s data', fault => {
    const cs = history();
    if (fault === 'gap') cs.splice(5, 1);
    if (fault === 'duplicate') cs[5].t = cs[4].t;
    if (fault === 'negative') cs[5].v = -1;
    if (fault === 'nan') cs[5].c = NaN;
    if (fault === 'badRange') cs[5].l = 110;
    if (fault === 'forming') cs[29].t += H;
    if (fault === 'badCloseTime') cs[5].closeTime = Infinity;
    expect(analyze(cs)).toMatchObject({ status: 'INVALID', detections: [], decision: 'NO TRADE' });
  });
  it('rejects stale histories', () => {
    expect(analyzeChart('test', '1h', history(), 40 * H).issues).toContain('stale candle history');
  });
  it('detects body engulfing with auditable metadata', () => {
    const cs = history(); cs[28] = { ...cs[28], o: 101, c: 99 }; cs[29] = { ...cs[29], o: 98, c: 102 };
    const d = analyze(cs).detections.find(d => d.kind === 'BULLISH_ENGULFING')!;
    expect(d).toMatchObject({ instrument: 'test:fixture', timeframe: '1h', detectedAt: 30 * H, expiresAt: 31 * H, boundaries: { low: 98, high: 102 }, calibration: 'NOT_CALIBRATED' });
    expect(d.evidence.length).toBeGreaterThan(0); expect(d.invalidation).toContain('98');
  });
  it('compares breakouts against prior bars, excluding the signal candle', () => {
    const cs = history(); cs[29] = { ...cs[29], h: 106, c: 105 };
    expect(analyze(cs).detections.map(d => d.kind)).toContain('BREAKOUT_UP');
    cs[29].c = 101;
    const r = analyze(cs);
    expect(r.detections.map(d => d.kind)).not.toContain('BREAKOUT_UP');
    expect(r.detections.map(d => d.kind)).toContain('UPPER_LIQUIDITY_SWEEP_HYPOTHESIS');
  });
  it('requires right-side confirmation before exposing a swing pivot', () => {
    const cs = history();
    for (const [i, px] of [[5, 105], [15, 108], [28, 112]]) cs[i].h = px;
    cs[10].l = 95; cs[20].l = 96;
    const r = analyze(cs);
    expect(r.trend).toBe('BULLISH');
    expect(r.detections.find(d => d.kind === 'SWING_STRUCTURE')!.evidence.join(' ')).not.toContain('112');
  });
  it('detects the first continuation close through a confirmed swing', () => {
    const cs = history();
    cs[5].h = 105; cs[15].h = 108;
    cs[10].l = 95; cs[20].l = 96;
    cs[29] = { ...cs[29], h: 110, c: 109 };
    expect(analyze(cs).detections.map(d => d.kind)).toContain('STRUCTURE_BREAK_UP');
    cs[28] = { ...cs[28], h: 110, c: 109 };
    expect(analyze(cs).detections.map(d => d.kind)).not.toContain('STRUCTURE_BREAK_UP');
  });
  it('classifies the first break against the prior trend as a change of character', () => {
    const cs = history();
    cs[5].h = 105; cs[15].h = 108;
    cs[10].l = 95; cs[20].l = 96;
    cs[29] = { ...cs[29], l: 94, c: 95 };
    expect(analyze(cs).detections.map(d => d.kind)).toContain('CHANGE_OF_CHARACTER_DOWN');
    cs[29].c = 96;
    expect(analyze(cs).detections.map(d => d.kind)).not.toContain('CHANGE_OF_CHARACTER_DOWN');
  });
  it('requires a close beyond the original breakout level after touching it', () => {
    const cs = history();
    cs[28] = { ...cs[28], h: 106, c: 105 };
    cs[29] = { ...cs[29], o: 104, l: 102, h: 105, c: 104 };
    expect(analyze(cs).detections.map(d => d.kind)).toContain('BREAKOUT_RETEST_UP');
    cs[29].c = 102;
    expect(analyze(cs).detections.map(d => d.kind)).not.toContain('BREAKOUT_RETEST_UP');
  });
  it('weights complete UTC anchors by volume and omits prices for missing anchor history', () => {
    const cs = history(26);
    cs[24] = { t: 24 * H, o: 100, h: 100, l: 100, c: 100, v: 1 };
    cs[25] = { t: 25 * H, o: 120, h: 120, l: 120, c: 120, v: 3 };
    const run = (bars: Candle[]) => analyzeChart('crypto:binance:TEST', '1h', bars, 26 * H).anchoredVwap;
    expect(run(cs)).toEqual([
      { anchor: 'UTC_DAY', anchorAt: 24 * H, price: 115, deviationPct: expect.closeTo(100 / 23) },
      { anchor: 'UTC_WEEK', anchorAt: -72 * H, price: null, deviationPct: null },
      { anchor: 'UTC_MONTH', anchorAt: 0, price: expect.any(Number), deviationPct: expect.any(Number) },
    ]);
    cs[24].v = 0; cs[25].v = 0;
    expect(run(cs)[0].price).toBeNull();
  });
  it('is pure and deterministic', () => {
    const cs = history(); const original = structuredClone(cs);
    expect(analyze(cs)).toEqual(analyze(cs)); expect(cs).toEqual(original);
  });
});

describe('blind historical replay', () => {
  it('does not inspect or expose hidden future OHLCV', () => {
    const cs = history(50); const first = replayChart('test', '1h', cs, 25);
    cs[30] = { t: NaN, o: NaN, h: NaN, l: NaN, c: NaN, v: NaN };
    expect(replayChart('test', '1h', cs, 25)).toEqual(first);
    expect(first.candles).toHaveLength(25); expect(first.asOf).toBe(25 * H);
    expect(() => replayChart('test', '1h', cs, 31)).toThrow();
  });
  it('matches direct prefix analysis at each step', () => {
    const cs = history(50);
    for (let n = 1; n <= cs.length; n++) expect(replayChart('test', '1h', cs, n).report).toEqual(analyzeChart('test', '1h', cs.slice(0, n), n * H));
  });
  it.each([0, -1, 1.5, 51])('rejects invalid cursor %s', n => {
    expect(() => replayChart('test', '1h', history(50), n)).toThrow();
  });
});
