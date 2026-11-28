import { describe, expect, it } from 'vitest';
import { BACKTEST_MODEL_VERSION, backtest } from '../src/lab/backtest.js';
import { FeatureEngine } from '../src/features/indicators.js';
import { assessRegimeStability } from '../src/regime/transition.js';
import type { StrategyDef } from '../src/lab/strategies.js';
import { synthCandles } from './helpers.js';

const HOUR = 3_600_000;
const CANDLES = synthCandles(700, { step: HOUR, t0: Date.UTC(2026, 0, 1), start: 100, drift: 0, vol: 0.004, seed: 7 });

/** Signals on every evaluated bar; records the candle open time of each evaluation. */
function probe(seen: number[]): StrategyDef {
  return {
    id: 'stability-probe', name: 'Probe', version: 'test-only', interval: '1h',
    suitableRegimes: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOLATILITY', 'COMPRESSION', 'UNKNOWN'],
    description: 'Test-only capsule', generate: (f) => { seen.push(f.t); return {
      direction: 'long', entryRef: f.close, stop: f.close * 0.97, targets: [{ r: 1, fraction: 1 }], maxHoldBars: 3,
      trailAfterR: null, trigger: 'probe', invalidation: 'probe', reasons: [] }; },
  };
}

/** Independent replay: stability per candle open time, using only candles up to and including that one. */
function stabilityByCandle() {
  const eng = new FeatureEngine(); const out = new Map<number, string>();
  for (const c of CANDLES) { eng.ingest([c]); out.set(c.t, assessRegimeStability(eng.history).stability); }
  return out;
}

describe('backtest regime-stability entry gate', () => {
  it('uses model version 3', () => expect(BACKTEST_MODEL_VERSION).toBe(3));

  it('never evaluates or enters on a candle whose regime is not STABLE, and the fixture does contain such candles', () => {
    const seen: number[] = []; const stability = stabilityByCandle();
    const result = backtest(probe(seen), 'fixture', CANDLES);
    const unstableAfterWarmup = CANDLES.slice(210, -1).filter((c) => stability.get(c.t) !== 'STABLE');
    expect(unstableAfterWarmup.length).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) expect(stability.get(t)).toBe('STABLE');
    for (const t of unstableAfterWarmup) expect(seen).not.toContain(t);
    // Entry is at the next bar open, so the signal candle is the one before entryT.
    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) expect(stability.get(trade.entryT - HOUR)).toBe('STABLE');
  });

  it('costR matches the analytic fee + spread + slippage cost of a flat-price TIME exit', () => {
    const flat = Array.from({ length: 300 }, (_, i) => ({ t: i * HOUR, o: 100, h: 101, l: 99, c: 100, v: 1000, closeTime: (i + 1) * HOUR - 1 }));
    const strat: StrategyDef = { ...probe([]), generate: () => ({ direction: 'long', entryRef: 100, stop: 50, targets: [], maxHoldBars: 1,
      trailAfterR: null, trigger: 'probe', invalidation: 'probe', reasons: [] }) };
    const costs = { feeRate: 0.001, slippageBps: 3, spreadBps: 2 };
    const trade = backtest(strat, 'fixture', flat, costs).trades[0];
    const slip = (3 + 1) / 1e4; const entry = 100 * (1 + slip); const exit = 100 * (1 - slip);
    const expected = (entry * 0.001 + exit * 0.001 + 100 * slip + 100 * slip) / (entry - 50);
    expect(trade.costR).toBeCloseTo(expected, 12);
    expect(trade.r).toBeCloseTo((exit - entry - entry * 0.001 - exit * 0.001) / (entry - 50), 12);
  });

  it('records a finite, non-negative costR for every trade and keeps r net of those costs', () => {
    const result = backtest(probe([]), 'fixture', CANDLES);
    expect(result.modelVersion).toBe(3);
    const costs = result.costs;
    for (const t of result.trades) {
      expect(Number.isFinite(t.costR)).toBe(true);
      expect(t.costR!).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(t.r)).toBe(true);
    }
    // With zero costs the modeled cost is exactly zero; costs only ever add to it.
    const free = backtest(probe([]), 'fixture', CANDLES, { feeRate: 0, slippageBps: 0, spreadBps: 0 });
    expect(free.trades.length).toBeGreaterThan(0);
    for (const t of free.trades) expect(t.costR).toBeCloseTo(0, 12);
    expect(costs.feeRate).toBeGreaterThan(0);
    const paired = Math.min(free.trades.length, result.trades.length);
    expect(paired).toBeGreaterThan(0);
    // Same entry/exit path on the first trade: net R falls by about the modeled cost.
    expect(free.trades[0].entryT).toBe(result.trades[0].entryT);
    if (free.trades[0].exitT === result.trades[0].exitT) expect(free.trades[0].r - result.trades[0].r).toBeGreaterThan(0);
  });
});
