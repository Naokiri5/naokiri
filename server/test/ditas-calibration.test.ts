import { describe, expect, it } from 'vitest';
import { calibrationReport, type CalibrationOptions, type CalibrationRow } from '../src/ditas/calibration.js';

describe('DITAS independent forecast calibration', () => {
  it('leaves empty cohorts uncalibrated without fabricated zero-error metrics', () => {
    const r = calibrationReport([]);
    expect(r).toMatchObject({ status: 'UNCALIBRATED', sample: 0, brierScore: null, logLoss: null, ece: null, minSamples: 100, minBinSamples: 20 });
    expect(r.bins).toHaveLength(10);
    expect(r.bins.every(b => b.count === 0 && b.status === 'EMPTY' && b.prediction === null && b.observed === null && b.wilson95 === null)).toBe(true);
  });

  it('matches hand-calculated Brier, logarithmic loss and reliability errors', () => {
    const rows: CalibrationRow[] = [{ probability: 0.1, outcome: 0 }, { probability: 0.4, outcome: 0 }, { probability: 0.6, outcome: 1 }, { probability: 0.9, outcome: 1 }];
    const r = calibrationReport(rows, { bins: 2 });
    expect(r.brierScore).toBeCloseTo(0.085, 12);
    expect(r.logLoss).toBeCloseTo(0.30809306971190853, 12);
    expect(r.ece).toBeCloseTo(0.25, 12);
    expect(r.bins[0]).toMatchObject({ count: 2, prediction: 0.25, observed: 0, status: 'INSUFFICIENT' });
    expect(r.bins[1]).toMatchObject({ count: 2, prediction: 0.75, observed: 1, status: 'INSUFFICIENT' });
    expect(r.status).toBe('UNCALIBRATED');
  });

  it('weights ECE by observation counts rather than treating bins equally', () => {
    const r = calibrationReport([{ probability: 0.1, outcome: 0 }, { probability: 0.2, outcome: 0 }, { probability: 0.3, outcome: 1 }, { probability: 0.9, outcome: 1 }], { bins: 2 });
    expect(r.ece).toBeCloseTo(0.125, 12);
  });

  it('places probability one in the final bin and handles boundary probabilities finitely', () => {
    const r = calibrationReport([{ probability: 0, outcome: 1 }, { probability: 1, outcome: 0 }]);
    expect(r.brierScore).toBe(1); expect(Number.isFinite(r.logLoss)).toBe(true);
    expect(r.logLoss).toBeGreaterThan(34);
    expect(r.bins[0].count).toBe(1); expect(r.bins[9].count).toBe(1);
    const perfect = calibrationReport([{ probability: 0, outcome: 0 }, { probability: 1, outcome: 1 }]);
    expect(perfect.brierScore).toBe(0); expect(perfect.ece).toBe(0); expect(perfect.logLoss).toBeLessThan(1e-12);
  });

  it('returns independent Wilson reference intervals and flags sparse bins', () => {
    const rows: CalibrationRow[] = Array.from({ length: 100 }, (_, i) => ({ probability: 0.5, outcome: i < 50 ? 1 : 0 }));
    const r = calibrationReport(rows);
    expect(r.status).toBe('EVALUATED');
    expect(r.bins[5].wilson95![0]).toBeCloseTo(0.4038315303659956, 12);
    expect(r.bins[5].wilson95![1]).toBeCloseTo(0.5961684696340044, 12);
    expect(r.bins[5].status).toBe('EVALUATED');
    expect(r.note).toContain('not proof');
    const sparse = calibrationReport([{ probability: 0.2, outcome: 1 }], { minSamples: 1 });
    expect(sparse.status).toBe('EVALUATED'); expect(sparse.bins[2].status).toBe('INSUFFICIENT');
    expect(sparse.uncertainty.some(s => s.includes('fewer than 20'))).toBe(true);
  });

  it('does not claim that a large but inaccurate sample is calibrated', () => {
    const r = calibrationReport(Array.from({ length: 100 }, () => ({ probability: 1, outcome: 0 as const })));
    expect(r.status).toBe('EVALUATED'); expect(r.brierScore).toBe(1); expect(r.ece).toBe(1);
    expect(JSON.stringify(r)).not.toContain('"CALIBRATED"');
  });

  it.each([-0.01, 1.01, NaN, Infinity, -Infinity])('rejects invalid forecast probability %s', probability => {
    expect(() => calibrationReport([{ probability, outcome: 0 }])).toThrow(/probability/);
  });
  it.each([-1, 0.5, 2, NaN, '1', null])('rejects non-binary outcome %s', outcome => {
    expect(() => calibrationReport([{ probability: 0.5, outcome } as CalibrationRow])).toThrow(/binary outcome/);
  });
  it.each([
    { minSamples: 0 }, { minSamples: 1.2 }, { minSamples: Infinity }, { minBinSamples: -1 },
    { bins: 0 }, { bins: 101 }, { bins: 1.5 }, { epsilon: 0 }, { epsilon: 1e-100 }, { epsilon: 0.5 }, { epsilon: NaN },
  ])('rejects invalid configuration %j', options => {
    expect(() => calibrationReport([], options as CalibrationOptions)).toThrow();
  });
  it('is deterministic and does not mutate forecast records or options', () => {
    const rows = Object.freeze([Object.freeze({ probability: 0.5, outcome: 1 as const })]);
    const options = Object.freeze({ bins: 5 });
    expect(calibrationReport(rows, options)).toEqual(calibrationReport(rows, options));
    expect(rows[0]).toEqual({ probability: 0.5, outcome: 1 });
  });
});
