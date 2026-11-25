import type { BrainKnowledgeClaim, ClaimValidationStatus, CognitiveEvidenceClass } from './contracts.js';

export interface ClaimDriftSignal {
  claimId: string;
  observedDriftScore: number;
  contradictingClaimIds: readonly string[];
  revalidatedAtMs?: number;
}
const BASE_WEIGHT: Record<CognitiveEvidenceClass, number> = {
  MATHEMATICAL_DEFINITION: 0.95,
  EMPIRICAL_FINDING: 0.85,
  MIA_EXPERIMENT: 0.85,
  AUTHOR_INTERPRETATION: 0.65,
  TRADING_HEURISTIC: 0.55,
  UNVERIFIED_HYPOTHESIS: 0.25,
};
const VALIDATION: Record<ClaimValidationStatus, number> = {
  UNVERIFIED: 0.5, REVIEWED: 0.8, TESTED: 1,
};

/**
 * Rank an indexed claim for research retrieval; weight is NOT a forecast win rate.
 * A drift score is ONLY accepted when it refers to the exact same claim, and invalid
 * drift data fails closed rather than silently restoring the original score.
 */
export function resolveClaimWeight(
  claim: BrainKnowledgeClaim, drift?: ClaimDriftSignal,
): BrainKnowledgeClaim {
  if (!claim.claimId || !claim.sourceDocumentId || !claim.sourceHash
      || !Number.isSafeInteger(claim.sourcePage) || claim.sourcePage < 1
      || !Object.hasOwn(BASE_WEIGHT, claim.evidenceClass)
      || !Object.hasOwn(VALIDATION, claim.validationStatus))
    throw new Error('INVALID_KNOWLEDGE_PROVENANCE');
  if (drift && (drift.claimId !== claim.claimId
      || !Number.isFinite(drift.observedDriftScore)
      || drift.observedDriftScore < 0 || drift.observedDriftScore > 1))
    throw new Error('INVALID_CLAIM_DRIFT_EVIDENCE');
  const contradictions = [...new Set([
    ...claim.contradictions, ...(drift?.contradictingClaimIds ?? []),
  ].filter(id => id !== claim.claimId))].sort();
  const driftScore = drift?.observedDriftScore ?? 0;
  const contradictionFactor = Math.max(0.2, 1 - contradictions.length * 0.2);
  const driftFactor = Math.max(0.1, 1 - (driftScore > 0.5
    ? (driftScore - 0.5) * 1.4 : driftScore * 0.25));
  const validationStatus = claim.validationStatus === 'TESTED'
    && (driftScore > 0.65 || contradictions.length >= 2) ? 'REVIEWED' : claim.validationStatus;
  // Downgrade confidence before computing priority; stale TESTED evidence cannot
  // retain its higher original priority.
  const effectiveWeight = Number((
    BASE_WEIGHT[claim.evidenceClass] * VALIDATION[validationStatus]
      * contradictionFactor * driftFactor
  ).toFixed(6));
  return { ...claim, contradictions, validationStatus, effectiveWeight };
}
