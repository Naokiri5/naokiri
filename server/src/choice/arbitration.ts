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
  | 'POLICY_CHANGED_DURING_SCAN'
  | 'NON_PAPER_MODE';

/** Keep only decision-time fields needed by the comparison and its replay. */
export function freezeChoiceEvidence(report: DecisionReport, snapshotId?: string) {
  return Object.freeze({
    id: report.id, candidateId: report.candidateId, traceId: report.traceId, instrumentId: report.instrumentId,
    strategyId: report.strategy.id, strategyVersion: report.strategy.version, policyVersion: report.risk?.policyVersion ?? null,
    snapshotId: snapshotId ?? null, decisionAt: report.createdAt, expiresAt: report.consensus?.expiresAt ?? null,
    consensusState: report.consensus?.state, decision: report.decision, riskDecision: report.risk?.decision ?? null,
    score: report.opportunity?.score, costR: report.expectedCosts?.costR, quality: report.dataFreshness?.status,
  });
}

type ChoiceEvidence = ReturnType<typeof freezeChoiceEvidence>;

export interface ChoiceShadowCandidate {
  decisionId: string;
  candidateId: string;
  instrumentId: string;
  strategyId: string;
  strategyVersion?: string;
  policyVersion?: number | null;
  traceId?: string;
  snapshotId?: string | null;
  decisionAt?: string;
  expiresAt?: string | null;
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
  result?: 'NO_TRADE' | 'SHADOW_SELECTION';
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
  policyChanged?: boolean;
  totalReportsObserved: number;
}

/**
 * Candidate sorting is stable and independent of input ordering except the
 * explicitly reported sequential baseline. A costR tie-break compares like
 * units; it is NOT subtracted from a 0..100 evidence score.
 */
export function evaluateShadowChoices(reports: readonly ChoiceEvidence[], input: ChoiceRoundInput): ChoiceShadowRound {
  if (!input.roundId || !Number.isFinite(input.startedAt) || !Number.isFinite(input.completedAt)
      || input.completedAt < input.startedAt || !Number.isInteger(input.totalReportsObserved)
      || input.totalReportsObserved < reports.length) throw new Error('invalid shadow arbitration round');
  const incomplete = input.totalReportsObserved > reports.length || reports.length > MAX_SHADOW_CANDIDATES;
  const seen = new Set<string>();
  const candidates: ChoiceShadowCandidate[] = reports.slice(0, MAX_SHADOW_CANDIDATES).map((r, index) => {
    const cost = r.costR;
    const costR = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
    const rawScore = r.score;
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 100 ? rawScore : null;
    const expires = Date.parse(r.expiresAt ?? '');
    const decisionAt = Date.parse(r.decisionAt);
    const qualityValid = r.quality === 'OK' || r.quality === 'WARN';
    const hasEvidence = r.snapshotId !== null && /^snap_[a-f0-9]{64}$/.test(r.snapshotId) &&
      Number.isFinite(decisionAt) && decisionAt <= input.completedAt && decisionAt >= input.startedAt &&
      r.policyVersion !== null && Number.isSafeInteger(r.policyVersion);
    const duplicate = seen.has(r.id);
    seen.add(r.id);
    const eligible = !duplicate && input.mode === 'PAPER' && !input.modeChanged && !input.policyChanged
      && r.decision === 'PAPER_TRADE' && r.riskDecision === 'ALLOW'
      && r.consensusState === 'STRONG_CONSENSUS'
      && Number.isFinite(expires) && expires > input.completedAt
      && score !== null && costR !== null
      && qualityValid && hasEvidence;
    let reason = 'risk-approved paper candidate (shadow only)';
    if (duplicate) reason = 'duplicate decision id';
    else if (input.mode !== 'PAPER') reason = 'not in paper execution mode';
    else if (input.modeChanged) reason = 'mode changed during scan';
    else if (input.policyChanged) reason = 'policy changed during scan';
    else if (r.decision !== 'PAPER_TRADE' || r.riskDecision !== 'ALLOW') reason = 'not an authorized paper entry';
    else if (r.consensusState !== 'STRONG_CONSENSUS' || !Number.isFinite(expires) || expires <= input.completedAt) reason = 'consensus not strong or expired';
    else if (score === null || costR === null) reason = 'missing valid score or cost evidence';
    else if (!qualityValid || !hasEvidence) reason = 'market data or decision provenance unavailable';
    return {
      decisionId: r.id, candidateId: r.candidateId, instrumentId: r.instrumentId,
      strategyId: r.strategyId, strategyVersion: r.strategyVersion, policyVersion: r.policyVersion,
      traceId: r.traceId, snapshotId: r.snapshotId, decisionAt: r.decisionAt, expiresAt: r.expiresAt, observedOrder: index,
      opportunityScore: score, estimatedCostR: costR,
      decision: r.decision, riskDecision: r.riskDecision,
      disposition: eligible ? 'ELIGIBLE' : 'INELIGIBLE', reason,
    };
  });
  const first = candidates.find((c) => c.disposition === 'ELIGIBLE') ?? null;
  const ranked = candidates.filter((c) => c.disposition === 'ELIGIBLE').sort((a, b) =>
    (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)
    || (a.estimatedCostR ?? Infinity) - (b.estimatedCostR ?? Infinity)
    || compareId(a.instrumentId, b.instrumentId)
    || compareId(a.strategyId, b.strategyId)
    || compareId(a.decisionId, b.decisionId)
  );
  const selected = !incomplete ? ranked[0] ?? null : null;
  if (selected) selected.disposition = 'SELECTED_SHADOW';
  const noTradeReason: ChoiceNoTradeReason | null = selected ? null
    : incomplete ? 'CANDIDATE_SET_TRUNCATED'
    : input.modeChanged ? 'MODE_CHANGED_DURING_SCAN'
    : input.policyChanged ? 'POLICY_CHANGED_DURING_SCAN'
    : input.mode !== 'PAPER' ? 'NON_PAPER_MODE'
    : !reports.length ? 'NO_CANDIDATES'
    : 'NO_RISK_AUTHORIZED_PAPER_CANDIDATES';
  return {
    schemaVersion: CHOICE_SHADOW_VERSION, roundId: input.roundId,
    startedAt: input.startedAt, completedAt: input.completedAt, mode: input.mode,
    rolloutMode: 'SHADOW_ONLY', result: selected ? 'SHADOW_SELECTION' : 'NO_TRADE', totalReportsObserved: input.totalReportsObserved, incomplete,
    selectionMetric: 'UNCALIBRATED_OPPORTUNITY_SCORE_NOT_EXPECTED_RETURN',
    selectedDecisionId: selected?.decisionId ?? null,
    firstEligibleDecisionId: first?.decisionId ?? null,
    noTradeReason,
    changedFromFirstEligible: !!selected && !!first && selected.decisionId !== first.decisionId,
    candidates,
    warning: 'Research-only observational comparison after sequential decisions. Not a causal counterfactual, calibrated win rate, or live authorization.',
  };
}

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
