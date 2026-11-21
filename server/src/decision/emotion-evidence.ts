/**
 * MIA Emotional Intelligence evidence overlay — not a second AI, not a risk gate.
 *
 * Pure, deterministic interpretation of EXISTING QCI, regime, market-quality,
 * and news evidence. No network, wallet, OMS, signer, policy mutation or
 * financial position sizing. Emotion names describe MARKET OBSERVATIONS,
 * not artificial consciousness, predictive win probabilities or trade rights.
 *
 * When enabled through the pre-existing THINK ENFORCED setting, this overlay
 * can only ABSTAIN from an otherwise eligible trade. SHADOW cannot affect it.
 * Thresholds are illustrative research heuristics, NOT calibrated forecasts.
 */
import type { ThinkRoutingEvidence } from './think-router.js';
import type { Regime } from '../regime/regime.js';
import type { ConsensusState } from '../qci/schemas.js';

export type MarketEmotion = 'CALM' | 'HYPE_FOMO' | 'PANIC_SHOCK' | 'UNCERTAINTY' | 'RECOVERY';
export type EmotionAction = 'OBSERVE' | 'REQUEST_DEEP_REVIEW' | 'ABSTAIN';
export interface EmotionInput {
  routing: Readonly<ThinkRoutingEvidence>;
  regime: Regime;
  quality: 'OK' | 'WARN' | 'FAIL';
  qciState: ConsensusState;
  priceChange24hPct: number | null;
  /** Counts from the existing, timestamp-validated news pipeline; not a social sentiment oracle. */
  news: Readonly<{ relevant: number; positive: number; negative: number; highImpactMacro: number }> | null;
  /** Omit until actual account-specific, verified history is available. */
  consecutiveLosses?: number | null;
  /** Omit until existing incident owner supplies its state. */
  protectionIncidentOpen?: boolean | null;
}
export interface EmotionAssessment {
  readonly version: 'mia-market-emotion-overlay-v1';
  readonly state: MarketEmotion;
  readonly action: EmotionAction;
  readonly reasons: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly dataClassification: 'OBSERVED_HEURISTIC_NOT_CALIBRATED';
  readonly enforcement: 'RISK_REDUCING_ONLY';
  readonly wouldAbstain: boolean;
  readonly canAuthorizeTrade: false;
  readonly canIncreaseRisk: false;
}

function result(
  state: MarketEmotion, action: EmotionAction,
  reasons: string[], missingEvidence: string[],
): EmotionAssessment {
  return {
    version: 'mia-market-emotion-overlay-v1',
    state, action, reasons, missingEvidence,
    dataClassification: 'OBSERVED_HEURISTIC_NOT_CALIBRATED',
    enforcement: 'RISK_REDUCING_ONLY',
    // A request for deeper review is not a completed review; ENFORCED must
    // defer entry until canonical thinking can establish safe evidence.
    wouldAbstain: action !== 'OBSERVE',
    canAuthorizeTrade: false, canIncreaseRisk: false,
  };
}

const validCount = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/** Interpret an immutable snapshot; NO_TRADE on critical information gaps. */
export function assessMarketEmotion(input: Readonly<EmotionInput>): EmotionAssessment {
  const { routing, qciState, regime, quality, news } = input;
  const missingEvidence: string[] = [];
  if (!news) missingEvidence.push('NO_VERIFIED_SOCIAL_SENTIMENT_OR_NEWS_COUNTS');
  if (input.consecutiveLosses == null) missingEvidence.push('ACCOUNT_LOSS_STREAK_NOT_SUPPLIED');
  if (input.protectionIncidentOpen == null) missingEvidence.push('PROTECTION_INCIDENT_STATE_NOT_SUPPLIED');
  const change = input.priceChange24hPct;
  const newsValid = !news || [news.relevant, news.positive, news.negative, news.highImpactMacro].every(validCount);
  if (change != null && (!Number.isFinite(change) || Math.abs(change) > 1_000)) {
    return result('UNCERTAINTY', 'ABSTAIN', ['INVALID_MARKET_CHANGE'], missingEvidence);
  }
  if (input.consecutiveLosses != null && !validCount(input.consecutiveLosses)) {
    return result('UNCERTAINTY', 'ABSTAIN', ['INVALID_ACCOUNT_LOSS_EVIDENCE'], missingEvidence);
  }
  if (input.protectionIncidentOpen != null && typeof input.protectionIncidentOpen !== 'boolean') {
    return result('UNCERTAINTY', 'ABSTAIN', ['INVALID_PROTECTION_INCIDENT_EVIDENCE'], missingEvidence);
  }
  if (!newsValid) return result('UNCERTAINTY', 'ABSTAIN', ['INVALID_NEWS_EVIDENCE'], missingEvidence);
  if (!routing.marketDataValid || !routing.mandatoryCoverageComplete ||
      routing.hardVetoPresent || routing.consensusExpired ||
      quality === 'FAIL' || qciState === 'VETOED' || qciState === 'EXPIRED' ||
      qciState === 'NO_QUORUM') {
    return result('UNCERTAINTY', 'ABSTAIN',
      ['INCOMPLETE_OR_VETOED_CANONICAL_EVIDENCE'], missingEvidence);
  }
  if (input.protectionIncidentOpen === true || (input.consecutiveLosses ?? 0) >= 3) {
    return result('RECOVERY', 'ABSTAIN',
      ['VERIFIED_INCIDENT_OR_LOSS_STREAK_REQUIRES_RECOVERY'], missingEvidence);
  }
  if (regime === 'HIGH_VOLATILITY' &&
      (change != null && change <= -10 || (news?.highImpactMacro ?? 0) > 0)) {
    return result('PANIC_SHOCK', 'ABSTAIN',
      ['HIGH_VOLATILITY_WITH_DOWNSIDE_OR_MACRO_SHOCK'], missingEvidence);
  }
  if (routing.conflictingEvidence || routing.executionUncertain ||
      routing.portfolioExposureElevated || quality === 'WARN' ||
      qciState === 'MIXED_CONSENSUS' || regime === 'UNKNOWN' ||
      (regime === 'HIGH_VOLATILITY')) {
    return result('UNCERTAINTY', 'REQUEST_DEEP_REVIEW',
      ['CONFLICTING_OR_UNUSUAL_MARKET_EVIDENCE'], missingEvidence);
  }
  // A tentative hype regime requires both actual price change and relevant news
  // observations. A positive-news count is not proof of social sentiment.
  if (change != null && change >= 15 && news &&
      news.relevant >= 3 && news.positive >= 3 &&
      news.positive > news.negative) {
    return result('HYPE_FOMO', 'ABSTAIN',
      ['RAPID_PRICE_APPRECIATION_AND_NEWS_ATTENTION'], missingEvidence);
  }
  if (qciState !== 'STRONG_CONSENSUS') {
    return result('UNCERTAINTY', 'REQUEST_DEEP_REVIEW',
      ['CONSENSUS_NOT_STRONG'], missingEvidence);
  }
  return result('CALM', 'OBSERVE',
    ['NO_ADDITIONAL_EMOTION_RISK_FLAG_IN_AVAILABLE_EVIDENCE'], missingEvidence);
}
