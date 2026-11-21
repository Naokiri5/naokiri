import { describe, expect, it } from 'vitest';
import { assessClosedBarChandelier, newExitState, stepExit } from '../src/lab/exits.js';

const closedBar = { o: 108, h: 110, l: 107, c: 109, closeTimeMs: 1000 };
const evidence = { highestClosedHigh: 110, atr: 2, atrMultiple: 2, closedAtMs: 1000 };

describe('M5-U08: closed-bar ATR Chandelier addition to canonical exit rules', () => {
  it('is disabled by default: existing stop/target/time behavior is unchanged', () => {
    const original = newExitState(100, 95, 1, [{ r: 1.5, fraction: 0.5 }], null, 5);
    expect(stepExit(original, { o: 101, h: 102, l: 100, c: 101 }, 0)).toEqual([]);
    expect(original.stop).toBe(95);
    expect(original.qtyLeft).toBe(1);
  });
  it('tightens only after the matching closed candle, never filling retrospectively', () => {
    const s = newExitState(100, 95, 1, [], null, 5);
    expect(stepExit(s, closedBar, 0, true, evidence)).toEqual([]);
    expect(s.stop).toBe(106); // 110 - 2*2
    expect(stepExit(s, { o: 105, h: 105, l: 103, c: 104 }, 0)).toEqual([{ reason: 'TRAIL_STOP', price: 105, qty: 1 }]);
  });
  it('never widens the prior stop, even as the highest-high lookback rolls down', () => {
    const s = newExitState(100, 106.5, 1, [], null, 5);
    expect(stepExit(s, closedBar, 0, true, evidence)).toEqual([]);
    expect(s.stop).toBe(106.5);
  });
  it('returns UNKNOWN rather than inventing missing, stale, unsafe or malformed evidence', () => {
    for (const bad of [
      { ...evidence, closedAtMs: 999 },
      { ...evidence, atr: Number.NaN },
      { ...evidence, atr: 0 },
      { ...evidence, highestClosedHigh: 105 },
      { ...evidence, atrMultiple: 0 },
      { ...evidence, atr: 0.1 }, // proposed stop above the closed candle's mark
    ]) {
      const verdict = assessClosedBarChandelier(closedBar, 95, bad);
      expect(verdict.status).toBe('UNKNOWN');
      const s = newExitState(100, 95, 1, [], null, 5);
      expect(stepExit(s, closedBar, 0, true, bad)).toEqual([]);
      expect(s.stop).toBe(95);
    }
  });
  it('prioritizes hard stop and partial take-profit over new trailing evidence', () => {
    const stop = newExitState(100, 95, 1, [], null, 5);
    const mixedBar = { ...closedBar, l: 90 };
    expect(stepExit(stop, mixedBar, 0, true, evidence)).toEqual([{ reason: 'STOP', price: 95, qty: 1 }]);
    expect(stop.stop).toBe(95);
    const tp = newExitState(100, 95, 1, [{ r: 1, fraction: 0.5 }], null, 5);
    expect(stepExit(tp, closedBar, 0, true, evidence)).toEqual([{ reason: 'TARGET', price: 108, qty: 0.5 }]);
    expect(tp.qtyLeft).toBe(0.5);
    expect(tp.stop).toBe(106);
  });
  it('does not raise a fully closed position stop after the time exit', () => {
    const s = newExitState(100, 95, 1, [], null, 1);
    expect(stepExit(s, closedBar, 0, true, evidence)).toEqual([{ reason: 'TIME', price: 109, qty: 1 }]);
    expect(s.stop).toBe(95);
  });
});
