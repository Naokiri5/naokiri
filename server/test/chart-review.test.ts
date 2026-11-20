import { describe, expect, it } from 'vitest';
import { analyzeChart } from '../src/chart/analysis.js';
import type { Candle } from '../src/market/types.js';

const HOUR = 3_600_000;
const history = (length = 40): Candle[] => Array.from({ length }, (_, i) => ({ t: i * HOUR, o: 100, h: 102, l: 98, c: 101, v: 10 }));
const analyze = (candles: Candle[]) => analyzeChart('test:review', '1h', candles, candles.length * HOUR);

describe('CodeRabbit chart evidence regressions', () => {
  it('orders swing bounds when newer low pivots exceed older high pivots', () => {
    const candles = history();
    candles[5].h = 105; candles[10].h = 108;
    for (let i = 16; i < candles.length; i++) candles[i] = { ...candles[i], o: 220 + i, h: 222 + i, l: 218 + i, c: 221 + i };
    candles[24].l = 200; candles[32].l = 210;
    const report = analyze(candles);
    expect(report.status).toBe('VALID');
    expect(report.detections.find(d => d.kind === 'SWING_STRUCTURE')?.boundaries).toEqual({ low: 105, high: 210 });
    for (const detection of report.detections) expect(detection.boundaries.low).toBeLessThanOrEqual(detection.boundaries.high);
  });

  it.each([
    [95, 'UPPER_LIQUIDITY_SWEEP_HYPOTHESIS', 'BREAKOUT_DOWN'],
    [105, 'LOWER_LIQUIDITY_SWEEP_HYPOTHESIS', 'BREAKOUT_UP'],
  ])('does not call a close at %s a sweep back inside the prior range', (close, forbidden, breakout) => {
    const candles = history(); candles[39] = { ...candles[39], o: 100, h: 106, l: 94, c: close as number };
    const kinds = analyze(candles).detections.map(d => d.kind);
    expect(kinds).not.toContain(forbidden);
    expect(kinds).toContain(breakout);
  });

  it.each([98, 102])('accepts sweep closes on the prior range boundary %s', close => {
    const candles = history(); candles[39] = { ...candles[39], o: 100, h: 106, l: 94, c: close };
    expect(analyze(candles).detections.map(d => d.kind)).toContain('UPPER_LIQUIDITY_SWEEP_HYPOTHESIS');
    expect(analyze(candles).detections.map(d => d.kind)).toContain('LOWER_LIQUIDITY_SWEEP_HYPOTHESIS');
  });
});
