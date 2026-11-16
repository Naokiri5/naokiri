import { describe, it, expect } from 'vitest';
import { stepExit, newExitState } from '../src/lab/exits.js';
import { backtest, monteCarlo } from '../src/lab/backtest.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { synthCandles } from './helpers.js';

describe('exit capsule', () => {
  it('stop wins when stop and target are hit in the same bar; gap fills at open', () => {
    const s = newExitState(100, 95, 1, [{ r: 1, fraction: 1 }], null, 10);
    const f = stepExit(s, { o: 100, h: 106, l: 94, c: 100 }, 0);
    expect(f[0].reason).toBe('STOP');
    const g = newExitState(100, 95, 1, [{ r: 1, fraction: 1 }], null, 10);
    expect(stepExit(g, { o: 90, h: 91, l: 89, c: 90 }, 0)[0].price).toBe(90);
  });
  it('trailing only tightens; time stop fires', () => {
    const s = newExitState(100, 95, 1, [{ r: 3, fraction: 1 }], 1, 3);
    stepExit(s, { o: 100, h: 106, l: 100, c: 105 }); expect(s.stop).toBe(100);
    stepExit(s, { o: 105, h: 105, l: 101, c: 102 }); expect(s.stop).toBe(100);
    const f = stepExit(s, { o: 102, h: 103, l: 101, c: 102 }); expect(f[0].reason).toBe('TIME');
  });
});
describe('backtester', () => {
  it('runs every strategy with costs, IS/OOS split, no look-ahead', () => {
    const cs = synthCandles(2000, { drift: 0.0008, vol: 0.01, seed: 21 });
    for (const s of STRATEGIES) {
      const r = backtest(s, 'x', cs);
      expect(r.all.trades).toBe(r.inSample.trades + r.outOfSample.trades);
      for (const t of r.trades) { const idx = cs.findIndex((c) => c.t === t.entryT); expect(idx).toBeGreaterThan(0); }
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
  it('Monte Carlo is deterministic per seed and bounded', () => {
    const a = monteCarlo([1, -1, 2, -1, 0.5, -1], { seed: 3 })!, b = monteCarlo([1, -1, 2, -1, 0.5, -1], { seed: 3 })!;
    expect(a).toEqual(b); expect(a.maxDdP95).toBeGreaterThanOrEqual(a.maxDdP50);
  });
});
