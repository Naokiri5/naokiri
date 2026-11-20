/**
 * MIA 5.0 B-MIND (M5-U03a): contracts for behavioral market evidence. Read-only foundation.
 *
 * "Emotion" here is a hypothesis about how market participants behave, inferred from observable data. It is not a
 * feeling inside MIA, not a diagnosis of any person, and not a forecast. Nothing in `server/src/bmind/` may place,
 * size, approve or sign an order, change risk policy, or read secrets. The most a future, validated strategy overlay
 * may ever do is WAIT; a hard block stays with the existing safety and risk gates (JDR-001 K-03, K-10).
 *
 * Source: the B-MIND 3.0 master (EM-01…EM-32) and MIA 5.0 Part I section 5. Status of this slice: types, the construct
 * atlas, input coverage and observation checks only. It is not wired into workers, QCI, decisions or the OMS.
 */
import type { Domain } from '../workers/types.js';

/** State of one observation. Unknown is never turned into neutral or favorable. */
export type EvidenceStatus = 'OBSERVED' | 'WEAK' | 'UNKNOWN' | 'STALE';

/** What an observation may do to a decision. There is deliberately no ALLOW or BUY. */
export type BehavioralEffect = 'NONE' | 'EXPLAIN' | 'WAIT' | 'BLOCK';

/** Probability-like numbers are shown only with a calibrated out-of-sample cohort; otherwise NOT_CALIBRATED. */
export type BehavioralCalibration = 'NOT_CALIBRATED' | { cohortId: string; horizonMs: number; brier: number };

/**
 * Observable inputs the 32 constructs are built from. Each maps to evidence MIA can (or cannot yet) read.
 * PRICE_VOLUME and CROSS_ASSET are both price-derived: a construct that needs nothing else is at most WEAK, because
 * individual emotions cannot be inferred from price alone (MIA 5.0 Part I section 5, Plane A).
 */
export const BEHAVIORAL_INPUTS = [
  'PRICE_VOLUME', 'ORDER_BOOK', 'TRADE_FLOW', 'NEWS', 'MACRO_EVENTS', 'CROSS_ASSET', 'SOURCE_HEALTH', 'MIA_ACTIVITY',
  'SOCIAL', 'SEARCH_INTEREST', 'OPTIONS_IV', 'WALLET_HOLDERS', 'DEX_ACTIVITY', 'SUPPLY', 'COST_BASIS',
] as const;
export type BehavioralInput = typeof BEHAVIORAL_INPUTS[number];
export const PRICE_DERIVED_INPUTS: readonly BehavioralInput[] = ['PRICE_VOLUME', 'CROSS_ASSET'];

/** AVAILABLE: MIA reads it today. DEGRADED: partial or unverified (e.g. counts that are not unique wallets). */
export type InputCapability = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
export type InputCapabilities = Partial<Record<BehavioralInput, InputCapability>>;

/** B-MIND reports into these existing QCI domains only; it never adds a 12th domain or vote (JDR-001 K-01). */
export const BMIND_DOMAINS = ['flow', 'liquidity', 'news', 'onchain', 'regime', 'risk'] as const satisfies readonly Domain[];
export type BmindDomain = typeof BMIND_DOMAINS[number];

/** EM-01…EM-24 market-emotion hypotheses, EM-25…EM-30 collective/bias hypotheses, EM-31…EM-32 MIA discipline states. */
export type ConstructFamily = 'MARKET_EMOTION' | 'COLLECTIVE_BIAS' | 'DISCIPLINE';
/** MARKET observes participants; MACHINE audits MIA's own behavior (it gives MIA no feelings and changes no limit). */
export type ConstructPlane = 'MARKET' | 'MACHINE';

export interface ConstructDefinition {
  id: `EM-${string}`;
  name: string;
  family: ConstructFamily;
  plane: ConstructPlane;
  /** Every one must be readable, or the construct is UNKNOWN. */
  required: readonly BehavioralInput[];
  /** Strengthen an observation when present; never required. */
  optional: readonly BehavioralInput[];
  domains: readonly BmindDomain[];
  /** The most a future validated overlay may do with this construct. Never above WAIT in this foundation. */
  effectCeiling: Exclude<BehavioralEffect, 'BLOCK'>;
  /** What the construct is for in MIA (from the source atlas). */
  role: string;
  /** The source's own warning about what the construct cannot show. */
  caveat: string;
}

/** Five separate dimensions plus overlays. Null means not measured, never zero. */
export interface BehaviorVector {
  valence: number | null; arousal: number | null; authenticity: number | null; fragility: number | null; evidenceReliability: number | null;
  fearIndex: number | null; speculationIndex: number | null; crowdContagion: number | null; liquidityFlight: number | null;
  narrativeShock: number | null; reversalCandidate: number | null; behaviorShift: number | null;
}

/** One time-stamped observation of one construct for one instrument and strategy (MIA 5.0 Part I section 5). */
export interface BehavioralObservation {
  constructId: `EM-${string}`;
  state: EvidenceStatus;
  instrumentId: string;
  strategyId: string;
  eventTimeMs: number;
  receivedTimeMs: number;
  expiresAtMs: number;
  originIds: readonly string[];
  dependencyGroups: readonly string[];
  modelVersion: string;
  features: Readonly<Record<string, number | null>>;
  contraryEvidenceIds: readonly string[];
  effect: BehavioralEffect;
  calibration: BehavioralCalibration;
}

/** Output of a future strategy overlay (M5-U06). This object is deliberately not an order authorization. */
export interface BehavioralOverlay {
  decision: 'CONTINUE' | 'WAIT' | 'BLOCK';
  reasons: readonly string[];
  evidenceHash: string;
  policyVersion: string;
}
