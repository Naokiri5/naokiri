/**
 * MIA Whale Intelligence Network — safe, standalone implementation sketch.
 * WIN-01 safe, pure evidence evaluator. Does not execute or authorize orders.
 *
 * Boundary: normalize and assess already verified evidence; return a CANDIDATE,
 * NEVER an executable order. No RPC, wallet, signing, trading, network or database IO.
 * QCI/decision/risk/OMS integration is a future audited phase; candidates have no authority.
 */

export type WhaleLane = 'FAST' | 'DEEP';
export type CandidateVerdict = 'CANDIDATE' | 'RESEARCH_ONLY' | 'REJECTED';
export type PublicAttribution = 'VERIFIED_WALLET' | 'INFERRED_ENTITY';
export type ChainFinality = 'PENDING' | 'CONFIRMED' | 'FINALIZED';
export type MarketClass =
  | 'SOLANA_MEMECOIN'
  | 'CRYPTO_PERPETUAL'
  | 'FOREX'
  | 'INDEX_FUTURE'
  | 'EQUITY'
  | 'ETF';

/** 
 * Upstream verification MUST establish swap vs transfer/airdrop/LP and wallet
 * ownership. Exact atomic string quantities prevent Number precision loss.
 */
export interface VerifiedWalletSwap {
  readonly kind: 'VERIFIED_WALLET_SWAP';
  readonly attribution: 'VERIFIED_WALLET';
  readonly chain: 'solana';
  readonly walletAddress: string;
  readonly signature: string;
  readonly instructionLeg: number;
  readonly mintAddress: string;
  readonly instrumentId: string;
  readonly side: 'BUY' | 'SELL';
  readonly tokenAmountAtomic: string;
  readonly tokenDecimals: number;
  readonly observedAt: number;
  readonly availableAt: number;
  readonly receivedAt: number;
  readonly sourceSnapshotId: string;
  readonly sourcePayloadHash: string;
  readonly finality: ChainFinality;
  readonly verifiedAsSwap: boolean;
  readonly effectiveWhalePriceUsd: number;
}

export interface InstitutionalFootprint {
  readonly kind: 'INFERRED_FOOTPRINT';
  readonly attribution: 'INFERRED_ENTITY';
  readonly market: Exclude<MarketClass, 'SOLANA_MEMECOIN'>;
  readonly instrumentId: string;
  readonly footprintId: string;
  readonly source: 'CEX_LARGE_PRINT' | 'FUTURES_POSITIONING' | 'INSTITUTIONAL_FILING' | 'ORDER_FLOW';
  readonly eventTime: number;
  readonly availableAt: number;
  readonly receivedAt: number;
  readonly sourceSnapshotId: string;
  readonly sourcePayloadHash: string;
  readonly inference: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
}
export type WhaleEvidence = VerifiedWalletSwap | InstitutionalFootprint;

export interface WhaleFastFollow {
  readonly walletAddress: string;
  readonly accountId: string;
  readonly selectedBy: 'USER' | 'MIA_PROPOSED_ACCEPTED';
  readonly observeOnly: boolean;
  readonly maxSignalAgeMs: number;
  readonly maxQuoteAgeMs: number;
  readonly maxEntryDriftBps: number;
  readonly maxPriceImpactBps: number;
  readonly minLiquidityUsd: number;
  readonly maxNotionalUsd: number;
  readonly requiredFinality: 'CONFIRMED' | 'FINALIZED';
}

export interface MintSecurityEvidence {
  readonly mintAddress: string;
  readonly verifiedAt: number;
  readonly expiresAt: number;
  readonly verdict: 'PASS' | 'DENY' | 'UNKNOWN';
  readonly vetoReasons: readonly string[];
  readonly verifiedSellRoute: boolean;
}

export interface ObtainablePriceEvidence {
  readonly mintAddress: string;
  readonly side: 'BUY' | 'SELL';
  readonly quoteReceivedAt: number;
  readonly quoteExpiresAt: number;
  readonly priceUsd: number;
  readonly priceImpactBps: number;
  readonly poolLiquidityUsd: number;
  readonly estimatedTotalFeesUsd: number;
  readonly quoteSourceId: string;
}

export type WhaleCandidateAssessment = {
  readonly verdict: CandidateVerdict;
  readonly lane: WhaleLane;
  readonly evidenceId: string;
  readonly reasonCodes: readonly string[];
  readonly adversePriceDriftBps: number | null;
  readonly netExpectedEdgeBps: number | null;
  readonly canonicalInstrumentId: string;
};

const isTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validPositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const finiteNonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function parseAtomicQuantity(value: string, decimals: number): bigint | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,76}$/.test(value) ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  return BigInt(value);
}

export function makeWalletObservationKey(evidence: VerifiedWalletSwap): string {
  // Do not reuse for broker client order IDs until further namespaced hashing.
  return [evidence.chain, evidence.signature, evidence.instructionLeg,
    evidence.mintAddress, evidence.walletAddress].join(':');
}

function assessFastPolicy(policy: WhaleFastFollow): readonly string[] {
  const reasons: string[] = [];
  if (!BASE58_ADDRESS.test(policy.walletAddress)) reasons.push('INVALID_FOLLOW_WALLET');
  if (!policy.accountId) reasons.push('MISSING_ACCOUNT');
  for (const [key, value] of Object.entries({
    maxSignalAgeMs: policy.maxSignalAgeMs,
    maxQuoteAgeMs: policy.maxQuoteAgeMs,
    maxEntryDriftBps: policy.maxEntryDriftBps,
    maxPriceImpactBps: policy.maxPriceImpactBps,
    minLiquidityUsd: policy.minLiquidityUsd,
    maxNotionalUsd: policy.maxNotionalUsd
  })) {
    if (!validPositive(value)) reasons.push('INVALID_' + key.toUpperCase());
  }
  return reasons;
}

/**
 * Fail-closed evaluation for a SINGLE followed Solana whale's observed swap.
 * All returned CANDIDATE results must still go to the existing authenticated
 * QCI, deterministic risk, and canonical PAPER OMS. Never use this as permission.
 */
export function evaluateFastWhaleCandidate(params: {
  observation: VerifiedWalletSwap;
  follow: WhaleFastFollow;
  mintSafety: MintSecurityEvidence | null;
  obtainableQuote: ObtainablePriceEvidence | null;
  now: number;
  estimatedExpectedMoveBps?: number | null;
}): WhaleCandidateAssessment {
  const { observation: o, follow: f, mintSafety: s, obtainableQuote: q, now } = params;
  const reasons: string[] = [...assessFastPolicy(f)];
  const id = makeWalletObservationKey(o);
  const result = (verdict: CandidateVerdict, drift: number | null = null,
    edge: number | null = null): WhaleCandidateAssessment => ({
      verdict, lane: 'FAST', evidenceId: id, reasonCodes: reasons,
      adversePriceDriftBps: drift, netExpectedEdgeBps: edge,
      canonicalInstrumentId: o.instrumentId
    });
  if (o.attribution !== 'VERIFIED_WALLET' || !o.verifiedAsSwap ||
      !BASE58_ADDRESS.test(o.walletAddress) || !BASE58_ADDRESS.test(o.mintAddress) ||
      o.walletAddress !== f.walletAddress ||
      !o.signature || !o.sourceSnapshotId || !o.sourcePayloadHash ||
      !Number.isSafeInteger(o.instructionLeg) || o.instructionLeg < 0 ||
      parseAtomicQuantity(o.tokenAmountAtomic, o.tokenDecimals) === null) {
    reasons.push('INVALID_DIRECT_SWAP_PROOF');
  }
  if (![now, o.observedAt, o.availableAt, o.receivedAt].every(isTimestamp) ||
      o.observedAt > o.availableAt || o.availableAt > o.receivedAt ||
      o.receivedAt > now) reasons.push('INVALID_EVENT_TIMESTAMPS');
  if (!isTimestamp(now) || !isTimestamp(o.observedAt) ||
      now - o.observedAt > f.maxSignalAgeMs) reasons.push('STALE_SWAP');
  if (o.finality === 'PENDING' ||
      (f.requiredFinality === 'FINALIZED' && o.finality !== 'FINALIZED')) {
    reasons.push('INSUFFICIENT_CHAIN_FINALITY');
  }
  if (!validPositive(o.effectiveWhalePriceUsd)) reasons.push('BAD_WHALE_FILL_PRICE');
  if (o.side !== 'BUY') reasons.push('SELL_IS_EXIT_EVIDENCE_NOT_NEW_ENTRY');
  if (!s || s.mintAddress !== o.mintAddress || s.verdict !== 'PASS' ||
      s.vetoReasons.length > 0 || !s.verifiedSellRoute ||
      !isTimestamp(s.verifiedAt) || !isTimestamp(s.expiresAt) ||
      s.verifiedAt > now || s.expiresAt < now) reasons.push('MINT_SAFETY_UNVERIFIED');
  if (!q || q.mintAddress !== o.mintAddress || q.side !== 'BUY' ||
      !validPositive(q.priceUsd) ||
      !finiteNonnegative(q.priceImpactBps) ||
      !finiteNonnegative(q.estimatedTotalFeesUsd) ||
      !finiteNonnegative(q.poolLiquidityUsd) ||
      !isTimestamp(q.quoteReceivedAt) || !isTimestamp(q.quoteExpiresAt) ||
      q.quoteReceivedAt > now || q.quoteExpiresAt < now ||
      now - q.quoteReceivedAt > f.maxQuoteAgeMs ||
      q.poolLiquidityUsd < f.minLiquidityUsd ||
      q.priceImpactBps > f.maxPriceImpactBps) reasons.push('OBTAINABLE_QUOTE_UNSAFE');
  if (reasons.length) return result('REJECTED');

  const quote = q!;
  const adverseDriftBps = Math.max(0,
    (quote.priceUsd - o.effectiveWhalePriceUsd) /
    o.effectiveWhalePriceUsd * 10_000);
  if (!finiteNonnegative(adverseDriftBps) ||
      adverseDriftBps > f.maxEntryDriftBps) {
    reasons.push('FOLLOWER_ENTRY_DRIFT_EXCEEDED');
    return result('REJECTED', adverseDriftBps);
  }
  const expectedMove = params.estimatedExpectedMoveBps;
  if (expectedMove == null || !Number.isFinite(expectedMove)) {
    reasons.push('NO_CALIBRATED_AFTER_COST_EDGE');
    return result('RESEARCH_ONLY', adverseDriftBps);
  }
  // Estimated outcome is indicative only: onchain priority fees, rent and
  // actual fill can change. No execution is authorized by this calculation.
  const feesBps = quote.estimatedTotalFeesUsd / f.maxNotionalUsd * 10_000;
  const edgeBps = expectedMove - adverseDriftBps - quote.priceImpactBps - feesBps;
  if (!Number.isFinite(edgeBps) || edgeBps <= 0) {
    reasons.push('NONPOSITIVE_EXPECTED_EDGE_AFTER_COSTS');
    return result('REJECTED', adverseDriftBps, edgeBps);
  }
  if (f.observeOnly) {
    reasons.push('OBSERVE_ONLY_CONFIG');
    return result('RESEARCH_ONLY', adverseDriftBps, edgeBps);
  }
  return result('CANDIDATE', adverseDriftBps, edgeBps);
}

export interface DeepStrategyEvidence {
  readonly id: string;
  readonly instrumentId: string;
  readonly market: Exclude<MarketClass, 'SOLANA_MEMECOIN'>;
  readonly direction: 'LONG' | 'SHORT';
  readonly decisionTime: number;
  readonly triggerAt: number;
  readonly sourceRecords: readonly InstitutionalFootprint[];
  readonly strategyVersion: string;
  readonly entryZone: { readonly low: number; readonly high: number };
  readonly invalidationPrice: number;
  readonly expectedNetReturnBps: number | null;
  readonly holdoutSampleSize: number;
  readonly brierScore: number | null;
  readonly baselineBrierScore: number | null;
  readonly modelValidated: boolean;
  readonly sessionEligible: boolean;
  readonly signalExpiryAt: number;
}

/**
 * Checks point-in-time evidence and a research-level calibration benchmark.
 * It cannot trade, cannot claim a direct whale identity, and never promotes
 * a model without a separately reviewed strategy and risk decision.
 */
export function evaluateDeepWhaleCandidate(
  input: DeepStrategyEvidence,
  now: number,
  minHoldoutSamples = 30
): WhaleCandidateAssessment {
  const reasons: string[] = [];
  const badTimes = ![now, input.decisionTime, input.triggerAt, input.signalExpiryAt]
    .every(isTimestamp) || input.decisionTime > input.triggerAt ||
    input.triggerAt > now || now > input.signalExpiryAt;
  if (badTimes) reasons.push('INVALID_OR_EXPIRED_DEEP_TIMELINE');
  if (!input.modelValidated || input.holdoutSampleSize < minHoldoutSamples)
    reasons.push('UNCALIBRATED_STRATEGY');
  if (!Number.isInteger(minHoldoutSamples) || minHoldoutSamples < 1)
    reasons.push('INVALID_VALIDATION_POLICY');
  if (!input.sessionEligible) reasons.push('MARKET_SESSION_NOT_ELIGIBLE');
  if (!input.strategyVersion || !input.sourceRecords.length) reasons.push('MISSING_STRATEGY_OR_EVIDENCE');
  if (!validPositive(input.entryZone.low) || !validPositive(input.entryZone.high) ||
      input.entryZone.low > input.entryZone.high ||
      !validPositive(input.invalidationPrice)) reasons.push('INVALID_ENTRY_ZONE');
  if (input.direction === 'LONG' && input.invalidationPrice >= input.entryZone.low)
    reasons.push('INVALID_LONG_STOP');
  if (input.direction === 'SHORT' && input.invalidationPrice <= input.entryZone.high)
    reasons.push('INVALID_SHORT_STOP');
  const probabilityValid =
    input.brierScore != null && Number.isFinite(input.brierScore) &&
    input.baselineBrierScore != null && Number.isFinite(input.baselineBrierScore) &&
    input.brierScore >= 0 && input.baselineBrierScore >= 0 &&
    input.brierScore < input.baselineBrierScore;
  if (!probabilityValid) reasons.push('MODEL_DOES_NOT_BEAT_BASELINE');
  if (input.expectedNetReturnBps == null ||
      !Number.isFinite(input.expectedNetReturnBps) ||
      input.expectedNetReturnBps <= 0) reasons.push('NO_POSITIVE_AFTER_COST_EDGE');
  for (const record of input.sourceRecords) {
    if (record.attribution !== 'INFERRED_ENTITY' ||
        record.instrumentId !== input.instrumentId ||
        !isTimestamp(record.availableAt) ||
        !isTimestamp(record.receivedAt) ||
        record.availableAt > input.decisionTime ||
        record.receivedAt > input.decisionTime) {
      reasons.push('FUTURE_OR_MISMATCHED_SOURCE_EVIDENCE');
      break;
    }
  }
  return {
    verdict: reasons.length ? 'RESEARCH_ONLY' : 'CANDIDATE',
    lane: 'DEEP', evidenceId: input.id, reasonCodes: reasons,
    adversePriceDriftBps: null,
    netExpectedEdgeBps: input.expectedNetReturnBps,
    canonicalInstrumentId: input.instrumentId
  };
}

/** A terminal gate example: always deny LIVE, independent of candidate result. */
export function previewWinExecutionEligibility(params: {
  readonly candidate: WhaleCandidateAssessment;
  readonly environment: 'OBSERVE' | 'PAPER' | 'LIVE';
  readonly canonicalRiskDecision: 'ALLOW' | 'DENY' | 'NEEDS_REVIEW';
  readonly canonicalDecisionId: string | null;
}): { readonly eligibleForPaperOmsReview: boolean; readonly reason: string } {
  if (params.environment === 'LIVE')
    return { eligibleForPaperOmsReview: false, reason: 'LIVE_LOCKED_PENDING_G01_G14' };
  if (params.environment !== 'PAPER')
    return { eligibleForPaperOmsReview: false, reason: 'OBSERVE_ONLY' };
  if (params.candidate.verdict !== 'CANDIDATE')
    return { eligibleForPaperOmsReview: false, reason: 'NOT_A_CANDIDATE' };
  if (!params.canonicalDecisionId || params.canonicalRiskDecision !== 'ALLOW')
    return { eligibleForPaperOmsReview: false, reason: 'CANONICAL_RISK_NOT_APPROVED' };
  return { eligibleForPaperOmsReview: true, reason: 'PAPER_OMS_ADAPTER_REVIEW_REQUIRED' };
}