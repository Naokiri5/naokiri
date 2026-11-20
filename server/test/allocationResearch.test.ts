import { describe, expect, it } from 'vitest';
import { researchFractionalKelly, type KellyResearchInput } from '../src/risk/allocationResearch.js';

const base = (override: Partial<KellyResearchInput> = {}): KellyResearchInput => ({
  equityUsd: 10_000, entryPriceUsd: 100, perUnitLossUsd: 5,
  policyRiskBudgetUsd: 50, maxNotionalUsd: 2_000,
  remainingCorrelatedNotionalUsd: 1_500, stepSize: 0.01,
  lowerWinProbability: 0.6, netPayoffRatio: 2, settledOosTrades: 200,
  cohortProvenance: 'synthetic-oos-cohort:2026-11', fractionalKelly: 0.25,
  ...override,
});
describe('fractional Kelly research only; canonical risk gate stays authoritative', () => {
  it('uses conservative lower-bound probability, limits quantity to existing policy and notional caps', () => {
    const result = researchFractionalKelly(base());
    expect(result).toMatchObject({ status: 'ESTIMATE', quantity: 10, notionalUsd: 1_000,
      plannedRiskUsd: 50, authority: 'RESEARCH_ONLY', mustPassExistingRiskGate: true });
    expect(result.rawKelly).toBeCloseTo(0.4);
  });
  it('never converts learned replay confidence into a win probability', () => {
    const a = researchFractionalKelly(base({ replayConfidenceScore: 0.01 }));
    const b = researchFractionalKelly(base({ replayConfidenceScore: 0.99 }));
    expect(a).toEqual(b);
  });
  it('reports no positive conservative edge instead of forcing a minimum size', () => {
    expect(researchFractionalKelly(base({
      lowerWinProbability: 0.4, netPayoffRatio: 0.5,
    }))).toMatchObject({ status: 'NO_POSITIVE_EDGE', quantity: null });
  });
  it('requires a cohort with provenance and enough settled out-of-sample trades', () => {
    expect(researchFractionalKelly(base({ settledOosTrades: 99 })).reasonCode).toBe('OOS_COHORT_NOT_VALIDATED');
    expect(researchFractionalKelly(base({ cohortProvenance: null })).status).toBe('UNAVAILABLE');
  });
  it('does not substitute a point score for a missing win-probability lower bound', () => {
    expect(researchFractionalKelly(base({ lowerWinProbability: null, replayConfidenceScore: 0.98 }))
      .reasonCode).toBe('MISSING_VALIDATED_WIN_LOSS_STATISTICS');
  });
  it('does not estimate on negative, NaN, infinite or zero invalid risk inputs', () => {
    for (const x of [-1, Number.NaN, Infinity, 0]) {
      expect(researchFractionalKelly(base({ perUnitLossUsd: x })).status).toBe('UNAVAILABLE');
    }
  });
  it('honors tighter correlated capacity and rounds down to the venue step', () => {
    const result = researchFractionalKelly(base({ remainingCorrelatedNotionalUsd: 532, stepSize: 0.1 }));
    expect(result.quantity).toBeLessThanOrEqual(5.32);
    expect(result.notionalUsd!).toBeLessThanOrEqual(532 + 1e-8);
  });
  it('does not generate a trade when caps or step size leave no quantity', () => {
    expect(researchFractionalKelly(base({ policyRiskBudgetUsd: 0 })).status).toBe('UNAVAILABLE');
    expect(researchFractionalKelly(base({ stepSize: 20 })).reasonCode).toBe('SIZE_BELOW_STEP');
  });
});
