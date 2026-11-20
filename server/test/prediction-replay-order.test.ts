import { describe, expect, it } from 'vitest';
import { replay, type ReplayStrategy } from '../src/prediction/backtest.js';

const snapshot = (t: number) => ({ t, bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 100 }] });
const strategy: ReplayStrategy = { type: 'threshold_taker', fair: [0.7, 0.3], edge: 0.05, size: 10, maxInventory: 20 };

describe('prediction replay point-in-time alignment', () => {
  it('rejects reversed snapshots instead of silently attaching fair values to other timestamps', () => {
    const input = { snapshots: [snapshot(2), snapshot(1)], strategy: { ...strategy, fair: [0.3, 0.7] } };
    expect(() => replay(input)).toThrow(/strictly increasing/);
  });

  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid snapshot timestamp %s', t => {
    expect(() => replay({ snapshots: [snapshot(t), snapshot(2)], strategy })).toThrow(/snapshot timestamps/);
  });

  it('rejects duplicate timestamps so a quote cannot fill against another observation at the same instant', () => {
    expect(() => replay({ snapshots: [snapshot(1), snapshot(1)], strategy: {
      type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 20,
    } })).toThrow(/strictly increasing/);
  });

  it('preserves ordered fair-value alignment and does not mutate supplied evidence', () => {
    const input = { snapshots: [snapshot(0), snapshot(2)], strategy };
    const original = structuredClone(input);
    const result = replay(input);
    expect(result.fills).toEqual([
      { t: 0, side: 'BUY', price: 0.52, shares: 10, fee: 0, liquidity: 'TAKER' },
      { t: 2, side: 'SELL', price: 0.48, shares: 10, fee: 0, liquidity: 'TAKER' },
    ]);
    expect(result.pnl).toBe(-0.4);
    expect(result.tradeEligible).toBe(false);
    expect(input).toEqual(original);
  });
});
