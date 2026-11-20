/**
 * Fractional Kelly / confidence-aware sizing *research* for the existing PAPER gate.
 * This function never approves orders, changes policy, resizes live trades or interprets
 * ReplayEvolution/worker scores as calibrated win probabilities.
 */
import { floorToStep } from '../core/util.js';

export interface KellyResearchInput {
  equityUsd: number;
  entryPriceUsd: number;
  /** Existing risk gate's conservative stop-fill loss PER UNIT including entry/exit fees. */
  perUnitLossUsd: number;
  /** The owner-accepted gate's remaining monetary risk cap for this intent. */
  policyRiskBudgetUsd: number;
  /** Maximum allowable position notional AFTER cash and existing notional constraints. */
  maxNotionalUsd: number;
  /** Remaining correlated *notional* capacity, computed using the existing correlation gate. */
  remainingCorrelatedNotionalUsd: number;
  stepSize: number;
  /** Lower OOS confidence bound from a verified independent binary outcome cohort. */
  lowerWinProbability: number | null;
  /** Net realized average win divided by absolute realized average loss in the same cohort. */
  netPayoffRatio: number | null;
  settledOosTrades: number;
  cohortProvenance: string | null;
  /** Advisory only; confidenceScore from a genome is NOT a win probability. */
  replayConfidenceScore?: number | null;
  fractionalKelly?: number;
}
export interface KellyResearchReport {
  status: 'ESTIMATE' | 'UNAVAILABLE' | 'NO_POSITIVE_EDGE';
  reasonCode: string;
  quantity: number | null;
  notionalUsd: number | null;
  plannedRiskUsd: number | null;
  rawKelly: number | null;
  appliedFraction: number | null;
  authority: 'RESEARCH_ONLY';
  mustPassExistingRiskGate: true;
  note: string;
}
const NOTE = 'Hypothetical sizing benchmark; not trade approval or profitability evidence. Risk gate, owner policy, existing cash/position limits and execution protections remain authoritative. Loss can exceed modeled stop risk.';
const fail = (reasonCode: string, status: KellyResearchReport['status'] = 'UNAVAILABLE'): KellyResearchReport =>
  ({ status, reasonCode, quantity: null, notionalUsd: null, plannedRiskUsd: null,
     rawKelly: null, appliedFraction: null, authority: 'RESEARCH_ONLY',
     mustPassExistingRiskGate: true, note: NOTE });

/** Pure. Do not call from a live order adapter or use in place of evaluateRisk(). */
export function researchFractionalKelly(input: KellyResearchInput): KellyResearchReport {
  const fraction = input.fractionalKelly ?? 0.25;
  const numbers = [input.equityUsd, input.entryPriceUsd, input.perUnitLossUsd,
    input.policyRiskBudgetUsd, input.maxNotionalUsd,
    input.remainingCorrelatedNotionalUsd, input.stepSize, fraction];
  if (!numbers.every(n => Number.isFinite(n)) || input.equityUsd <= 0 ||
      input.entryPriceUsd <= 0 || input.perUnitLossUsd <= 0 ||
      input.policyRiskBudgetUsd < 0 || input.maxNotionalUsd < 0 ||
      input.remainingCorrelatedNotionalUsd < 0 || input.stepSize <= 0 ||
      fraction <= 0 || fraction > 0.5 || input.perUnitLossUsd > input.entryPriceUsd * 4)
    return fail('INVALID_FINANCIAL_OR_POLICY_INPUT');
  if (!input.cohortProvenance?.trim() || !Number.isInteger(input.settledOosTrades) ||
      input.settledOosTrades < 100)
    return fail('OOS_COHORT_NOT_VALIDATED');
  const p = input.lowerWinProbability, b = input.netPayoffRatio;
  if (p == null || b == null || !Number.isFinite(p) || !Number.isFinite(b) ||
      p <= 0 || p >= 1 || b <= 0)
    return fail('MISSING_VALIDATED_WIN_LOSS_STATISTICS');
  // Use the lower probability bound, not a point estimate or an LLM confidence score.
  const rawKelly = p - (1 - p) / b;
  if (!Number.isFinite(rawKelly)) return fail('KELLY_NOT_FINITE');
  if (rawKelly <= 0) return fail('NO_POSITIVE_CONSERVATIVE_EDGE', 'NO_POSITIVE_EDGE');
  const targetRiskUsd = Math.min(input.policyRiskBudgetUsd, input.equityUsd * rawKelly * fraction);
  const capQty = Math.min(targetRiskUsd / input.perUnitLossUsd,
    input.maxNotionalUsd / input.entryPriceUsd,
    input.remainingCorrelatedNotionalUsd / input.entryPriceUsd);
  if (!Number.isFinite(capQty) || capQty <= 0) return fail('NO_POLICY_OR_CORRELATED_CAPACITY');
  const quantity = floorToStep(capQty, input.stepSize);
  if (!Number.isFinite(quantity) || quantity <= 0) return fail('SIZE_BELOW_STEP');
  const notionalUsd = quantity * input.entryPriceUsd;
  const plannedRiskUsd = quantity * input.perUnitLossUsd;
  if (!Number.isFinite(notionalUsd) || !Number.isFinite(plannedRiskUsd) ||
      plannedRiskUsd > input.policyRiskBudgetUsd + 1e-8 ||
      notionalUsd > input.maxNotionalUsd + 1e-8 ||
      notionalUsd > input.remainingCorrelatedNotionalUsd + 1e-8)
    return fail('ESTIMATE_BREAKS_EXISTING_CAPS');
  return { status: 'ESTIMATE', reasonCode: 'RESEARCH_ESTIMATE_ONLY',
    quantity, notionalUsd, plannedRiskUsd, rawKelly,
    appliedFraction: fraction, authority: 'RESEARCH_ONLY',
    mustPassExistingRiskGate: true, note: NOTE };
}
