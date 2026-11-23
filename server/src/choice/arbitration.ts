import type { DecisionReport } from '../decision/engine.js';
import type { Mode } from '../core/mode.js';

/**
 * MIA-CM-006/007 — bounded, deterministic, SHADOW-ONLY candidate comparison.
 *
 * The canonical scanner/decision/risk/OMS path remains unchanged. MIA's
 * OpportunityScore is explicitly UNCALIBRATED: this function never treats
 * it as P(win), expected R, an execution instruction, or a release gate.
 */
export const CHOICE_SHADOW_VERSION = 'choice-shadow-v1';
export const MAX_SHADOW_CANDIDATES = 500;

export type ChoiceNoTradeReason =
  | 'NO_CANDIDATES'
  | 'NO_RISK_AUTHORIZED_PAPER_CANDIDATES'
  | 'CANDIDATE_SET_TRUNCATED'
  | 'MODE_CHANGED_DURING_SCAN'
  | 'NON_PAPER_MODE';

export interface ChoiceShadowCandidate {
  decisionId: string;
  candidateId: string;
  instrumentId: string;
  strategyId: string;
  observedOrder: number;
  opportunityScore: number | null;
  estimatedCostR: number | null;
  decision: string;
  riskDecision: string | null;
  disposition: 'ELIGIBLE' | 'INELIGIBLE' | 'SELECTED_SHADOW';
  reason: string;
}

export interface ChoiceShadowRound {
  schemaVersion: typeof CHOICE_SHADOW_VERSION;
  roundId: string;
  startedAt: number;
  completedAt: number;
  mode: Mode;
  rolloutMode: 'SHADOW_ONLY';
  totalReportsObserved: number;
  incomplete: boolean;
  selectionMetric: 'UNCALIBRATED_OPPORTUNITY_SCORE_NOT_EXPECTED_RETURN';
  selectedDecisionId: string | null;
  firstEligibleDecisionId: string | null;
  noTradeReason: ChoiceNoTradeReason | null;
  changedFromFirstEligible: boolean;
  candidates: ChoiceShadowCandidate[];
  warning: string;
}

export interface ChoiceRoundInput {
  roundId: string;
  startedAt: number;
  completedAt: number;
  mode: Mode;
  modeChanged?: boolean;
  totalReportsObserved: number;
}

/**
 * Candidate sorting is stable and independent of input ordering except the
 * explicitly reported sequential baseline. A costR tie-break compares like
 * units; it is NOT subtracted from a 0..100 evidence score.
 */
export function evaluateShadowChoices(reports: readonly DecisionReport[], input: ChoiceRoundInput): ChoiceShadowRound {
  if (!input.roundId || !Number.isFinite(input.startedAt) || !Number.isFinite(input.completedAt)
      || input.completedAt < input.startedAt || !Number.isInteger(input.totalReportsObserved)
      || input.totalReportsObserved < reports.length) throw new Error('invalid shadow arbitration round');
  const incomplete = input.totalReportsObserved > reports.length || reports.length > MAX_SHADOW_CANDIDATES;
  const seen = new Set<string>();
  const candidates: ChoiceShadowCandidate[] = reports.slice(0, MAX_SHADOW_CANDIDATES).map((r, index) => {
    const cost = r.expectedCosts?.costR;
    const costR = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
    const rawScore = r.opportunity?.score;
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100 ? rawScore : null;
    const expires = Date.parse(r.consensus?.expiresAt ?? '');
    const duplicate = seen.has(r.id);
    seen.add(r.id);
    const eligible = !duplicate && input.mode === 'PAPER' && !input.modeChanged
      && r.decision === 'PAPER_TRADE' && r.risk?.decision === 'ALLOW'
      && r.consensus?.state === 'STRONG_CONSENSUS'
      && Number.isFinite(expires) && expires > input.completedAt
      && score !== null && costR !== null
      && r.dataFreshness?.status !== 'FAIL';
    let reason = 'risk-approved paper candidate (shadow only)';
    if (duplicate) reason = 'duplicate decision id';
    else if (input.mode !== 'PAPER') reason = 'not in paper execution mode';
    else if (input.modeChanged) reason = 'mode changed during scan';
    else if (r.decision !== 'PAPER_TRADE' || r.risk?.decision !== 'ALLOW') reason = 'not an authorized paper entry';
    else if (r.consensus?.state !== 'STRONG_CONSENSUS' || !Number.isFinite(expires) || expires <= input.completedAt) reason = 'consensus not strong or expired';
    else if (score === null || costR === null) reason = 'missing valid score or cost evidence';
    else if (r.dataFreshness?.status === 'FAIL') reason = 'failed market data quality';
    return {
      decisionId: r.id, candidateId: r.candidateId, instrumentId: r.instrumentId,
      strategyId: r.strategy.id, observedOrder: index,
      opportunityScore: score, estimatedCostR: costR,
      decision: r.decision, riskDecision: r.risk?.decision ?? null,
      disposition: eligible ? 'ELIGIBLE' : 'INELIGIBLE', reason,
    };
  });
  const first = candidates.find((c) => c.disposition === 'ELIGIBLE') ?? null;
  const ranked = candidates.filter((c) => c.disposition === 'ELIGIBLE').sort((a, b) =>
    (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
    || (a.estimatedCostR ?? Infinity) - (b.estimatedCostR ?? Infinity)
    || a.instrumentId.localeCompare(b.instrumentId)
    || a.strategyId.localeCompare(b.strategyId)
    || a.decisionId.localeCompare(b.decisionId)
  );
  const selected = !incomplete ? ranked[0] ?? null : null;
  if (selected) selected.disposition = 'SELECTED_SHADOW';
  const noTradeReason: ChoiceNoTradeReason | null = selected ? null
    : incomplete ? 'CANDIDATE_SET_TRUNCATED'
    : input.modeChanged ? 'MODE_CHANGED_DURING_SCAN'
    : input.mode !== 'PAPER' ? 'NON_PAPER_MODE'
    : !reports.length ? 'NO_CANDIDATES'
    : 'NO_RISK_AUTHORIZED_PAPER_CANDIDATES';
  return {
    schemaVersion: CHOICE_SHADOW_VERSION, roundId: input.roundId,
    startedAt: input.startedAt, completedAt: input.completedAt, mode: input.mode,
    rolloutMode: 'SHADOW_ONLY', totalReportsObserved: input.totalReportsObserved, incomplete,
    selectionMetric: 'UNCALIBRATED_OPPORTUNITY_SCORE_NOT_EXPECTED_RETURN',
    selectedDecisionId: selected?.decisionId ?? null,
    firstEligibleDecisionId: first?.decisionId ?? null,
    noTradeReason,
    changedFromFirstEligible: !!selected && !!first && selected.decisionId !== first.decisionId,
    candidates,
    warning: 'Research-only observational comparison after sequential decisions. Not a causal counterfactual, calibrated win rate, or live authorization.',
  };
}
