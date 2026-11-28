import { describe, it, expect } from 'vitest';
import { deflatedSharpe, expectedMaxSharpe, normalCdf, normalQuantile, probabilisticSharpe, probabilityOfBacktestOverfitting, returnMoments } from '../src/lab/overfitting.js';

/** Deterministic pseudo-random normal draws (mulberry32 + Box-Muller). */
function normals(seed: number, n: number) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u()));
}

describe('normal distribution helpers', () => {
  it('matches reference values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655254, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 7);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326347874, 7);
    expect(normalQuantile(0.5)).toBe(0);
    for (const p of [0.001, 0.2, 0.7, 0.999]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
  });
});

describe('probabilistic and deflated Sharpe ratio', () => {
  it('gives 0.5 when the observed Sharpe equals the benchmark and rises with sample length', () => {
    expect(probabilisticSharpe(0.1, 0.1, 100)).toBeCloseTo(0.5, 7);
    expect(probabilisticSharpe(0.1, 0, 400)).toBeGreaterThan(probabilisticSharpe(0.1, 0, 50));
  });

  it('penalizes negative skew and fat tails', () => {
    const normal = probabilisticSharpe(0.15, 0, 250, 0, 3);
    expect(probabilisticSharpe(0.15, 0, 250, -2, 3)).toBeLessThan(normal);
    expect(probabilisticSharpe(0.15, 0, 250, 0, 12)).toBeLessThan(normal);
  });

  it('reproduces the worked example in Bailey and Lopez de Prado (2014)', () => {
    // Annualized SR 2.5 over 1,250 daily observations, skew -3, kurtosis 10, 100 trials, annualized SR variance 0.5.
    const days = 250;
    const benchmark = expectedMaxSharpe(100, 0.5 / days) * Math.sqrt(days);
    expect(benchmark).toBeCloseTo(1.79, 1);
    const { dsr } = deflatedSharpe({ sharpe: 2.5 / Math.sqrt(days), n: 1250, skewness: -3, kurtosis: 10, trials: 100, sharpeVariance: 0.5 / days });
    expect(dsr).toBeCloseTo(0.90, 2); // paper: 0.9004
  });

  it('needs more evidence as the number of trials grows', () => {
    const base = { sharpe: 0.2, n: 120, skewness: 0, kurtosis: 3, sharpeVariance: 0.01 };
    expect(deflatedSharpe({ ...base, trials: 1 }).dsr).toBeCloseTo(probabilisticSharpe(0.2, 0, 120), 12);
    expect(deflatedSharpe({ ...base, trials: 10 }).dsr).toBeLessThan(deflatedSharpe({ ...base, trials: 1 }).dsr);
    expect(deflatedSharpe({ ...base, trials: 1000 }).dsr).toBeLessThan(deflatedSharpe({ ...base, trials: 10 }).dsr);
  });

  it('computes return moments with raw kurtosis', () => {
    const m = returnMoments(normals(7, 20_000));
    expect(m.mean).toBeCloseTo(0, 1);
    expect(m.skewness).toBeCloseTo(0, 1);
    expect(m.kurtosis).toBeCloseTo(3, 0);
    expect(returnMoments([1, 1, 1])).toMatchObject({ sd: 0, sharpe: 0 });
    // Closed form: raw (not excess) kurtosis of 1,2,3,4 is 2.5625 / 1.25^2 = 1.64.
    const small = returnMoments([1, 2, 3, 4]);
    expect(small.kurtosis).toBeCloseTo(1.64, 12);
    expect(small.skewness).toBeCloseTo(0, 12);
  });

  it('rejects invalid inputs', () => {
    expect(() => returnMoments([1])).toThrow(/RETURNS_INVALID/);
    expect(() => returnMoments([1, Number.NaN])).toThrow(/RETURNS_INVALID/);
    expect(() => probabilisticSharpe(0.1, 0, 1)).toThrow(/PSR_INPUT_INVALID/);
    expect(() => expectedMaxSharpe(0, 0.1)).toThrow();
    expect(() => expectedMaxSharpe(5, -1)).toThrow();
  });
});

describe('probability of backtest overfitting (CSCV)', () => {
  it('averages near 0.5 when every trial is noise', () => {
    // A single noise sample is highly variable (its 70 splits are correlated), so assert on the mean over seeds.
    const trials = 20, periods = 320;
    const pbos = Array.from({ length: 20 }, (_, k) => {
      const series = Array.from({ length: trials }, (_, j) => normals(1000 * k + j, periods));
      const result = probabilityOfBacktestOverfitting(Array.from({ length: periods }, (_, t) => series.map((s) => s[t])), 8);
      expect(result.splits).toBe(70);
      return result.pbo;
    });
    const mean = pbos.reduce((s, v) => s + v, 0) / pbos.length;
    expect(mean).toBeGreaterThan(0.38);
    expect(mean).toBeLessThan(0.6);
  });

  it('is near 0 when one trial has a persistent edge', () => {
    const trials = 10, periods = 320;
    const series = Array.from({ length: trials }, (_, j) => normals(200 + j, periods).map((r) => (j === 3 ? r + 0.8 : r)));
    const matrix = Array.from({ length: periods }, (_, t) => series.map((s) => s[t]));
    expect(probabilityOfBacktestOverfitting(matrix, 8).pbo).toBeLessThan(0.05);
  });

  it('is deterministic and validates its inputs', () => {
    const matrix = Array.from({ length: 40 }, (_, t) => [Math.sin(t), Math.cos(t), (t % 5) - 2]);
    expect(probabilityOfBacktestOverfitting(matrix, 4)).toEqual(probabilityOfBacktestOverfitting(matrix, 4));
    expect(() => probabilityOfBacktestOverfitting(matrix, 3)).toThrow(/GROUPS_INVALID/);
    expect(() => probabilityOfBacktestOverfitting(matrix.map((r) => [r[0]]), 4)).toThrow(/two trials/);
    expect(() => probabilityOfBacktestOverfitting(matrix.slice(0, 7), 4)).toThrow(/two periods per group/);
    expect(() => probabilityOfBacktestOverfitting([[1, 2], [1]], 2)).toThrow();
  });
});
