/**
 * BrainOS 7 cognitive contracts. These describe research and capability coordination ONLY.
 * The existing market, QCI, Risk, OMS, DITAS and portfolio owners remain authoritative.
 */
export type BrainRoleId = string;
export type BrainSkillId = string;
export type ReadinessStatus = 'READY' | 'DEGRADED' | 'BLOCKED' | 'UNAVAILABLE';
export type ComputationalLane = 'HOT' | 'WARM' | 'COLD';
export type MarketVenueClass = 'FUTURES' | 'SPOT' | 'MEMECOIN';
export type SkillExecutionClass = 'DETERMINISTIC' | 'RESEARCH_LLM';
export type ClaimValidationStatus = 'UNVERIFIED' | 'REVIEWED' | 'TESTED';
export type GenomeLifecycleState =
  | 'HYPOTHESIS' | 'BACKTESTING' | 'REJECTED' | 'OUT_OF_SAMPLE_VERIFIED'
  | 'SHADOW' | 'PAPER' | 'RELEASE_REVIEW';
export type RejectionReasonCode =
  | 'UNSUPPORTED_TIMEFRAME' | 'UNSUPPORTED_VENUE_MECHANICS' | 'MISSING_REQUIRED_CAPABILITY'
  | 'DUPLICATE_GENOME_SIGNATURE' | 'COST_OR_FILL_MISMATCH' | 'REGIME_DEPENDENCY'
  | 'PROBABILITY_MISCALIBRATION' | 'STRUCTURAL_INVALIDATION_OR_VOL_MODEL'
  | 'CORRELATED_EXPOSURE_CREEP' | 'MODEL_OR_REGIME_DRIFT'
  | 'INSUFFICIENT_HOLDOUT_EVIDENCE' | 'EVALUATOR_UNAVAILABLE' | 'INVALID_EVIDENCE';

export type CognitiveEvidenceClass =
  | 'MATHEMATICAL_DEFINITION' | 'EMPIRICAL_FINDING' | 'AUTHOR_INTERPRETATION'
  | 'TRADING_HEURISTIC' | 'MIA_EXPERIMENT' | 'UNVERIFIED_HYPOTHESIS';

export interface CapabilityObservation {
  sourceId: string;
  available: boolean;
  observedAtMs: number;
  maxAgeMs: number;
  verified?: boolean;
  notes?: string;
}
export interface BrainSkillContract {
  id: BrainSkillId;
  name: string;
  version: string;
  ownerModule: string;
  lane: ComputationalLane;
  requiredSources: readonly string[];
  optionalSources?: readonly string[];
  requiredTimeframes?: readonly string[];
  supportedMarkets?: readonly MarketVenueClass[];
  maxEvidenceAgeMs: number;
  executionClass: SkillExecutionClass;
  status: ReadinessStatus;
  financialAuthority: false;
}
export interface BrainAgentContract {
  id: BrainRoleId;
  workerId: string;
  division: string;
  domain: string;
  dependencyGroup: string;
  skills: readonly BrainSkillId[];
  requiredEvidence: readonly string[];
  canAbstain: true;
  canRequestFinancialAction: false;
}
export interface BrainKnowledgeClaim {
  claimId: string;
  sourceDocumentId: string;
  sourcePage: number;
  sourceHash: string;
  conceptId: string;
  claim: string;
  evidenceClass: CognitiveEvidenceClass;
  contradictions: readonly string[];
  validationStatus: ClaimValidationStatus;
  /** Retrieval/review priority only; never a calibrated trading probability. */
  effectiveWeight: number;
}
export interface BrainDecisionContext {
  traceId: string;
  mind: 'FAST' | 'DEEP';
  marketSnapshotId: string;
  fencingEpoch: number;
  agentRoleIds: readonly BrainRoleId[];
  skillIds: readonly BrainSkillId[];
  sourceClaimIds: readonly string[];
  strategyGenomeId?: string;
  evidenceAsOf: number;
  expiresAt: number;
  result: 'HYPOTHESIS' | 'NO_TRADE' | 'RISK_REVIEW';
  financialAuthority: false;
}
export interface MiaStrategyGenome {
  genomeId: string;
  lineageId: string;
  version: string;
  market: MarketVenueClass;
  signalFamily: string;
  eligibleRegimes: readonly string[];
  timeframes: readonly string[];
  hypothesis: string;
  knowledgeSources: readonly string[];
  requiredSkills: readonly BrainSkillId[];
  requiredAgentRoles: readonly BrainRoleId[];
  entryRuleId: string;
  invalidationRuleId: string;
  exitPolicyId: string;
  costModelVersion: string;
  datasetHash: string;
  experimentId?: string;
  state: GenomeLifecycleState;
  rejectionReason?: RejectionReasonCode;
  executionAuthority: false;
}
