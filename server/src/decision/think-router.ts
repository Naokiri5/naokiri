/**
 * MIA adaptive reasoning — PDF module 1, adapted to the canonical decision pipeline.
 *
 * This module only routes extra analysis. It has NO execution, risk, wallet or OMS
 * imports and must never confer authority to submit a trade.
 */
export type ThinkPreference = 'AUTO' | 'FAST' | 'DEEP';
export type ThinkRoute = 'FAST' | 'DEEP' | 'NO_TRADE';
export type ThinkEnforcement = 'DISABLED' | 'SHADOW' | 'ENFORCED';

export interface ThinkRoutingEvidence {
  preference: ThinkPreference;
  marketDataValid: boolean;
  mandatoryCoverageComplete: boolean;
  hardVetoPresent: boolean;
  consensusExpired: boolean;
  conflictingEvidence: boolean;
  unusualRegime: boolean;
  executionUncertain: boolean;
  portfolioExposureElevated: boolean;
  deepReviewBudgetAvailable: boolean;
}

export interface ThinkRoutingResult {
  readonly version: 'think-router-v1';
  readonly route: ThinkRoute;
  readonly reasons: readonly string[];
  readonly canAuthorizeTrade: false;
}

/** A no-trade outcome is an abstention, NOT an order cancel or exit. */
export function routeThinking(e: Readonly<ThinkRoutingEvidence>): ThinkRoutingResult {
  const reasons: string[] = [];
  if (!e.marketDataValid) reasons.push('INVALID_MARKET_DATA');
  if (!e.mandatoryCoverageComplete) reasons.push('MISSING_REQUIRED_EVIDENCE');
  if (e.hardVetoPresent) reasons.push('EXISTING_VETO');
  if (e.consensusExpired) reasons.push('EXPIRED_CONSENSUS');
  if (reasons.length) return { version: 'think-router-v1', route: 'NO_TRADE', reasons, canAuthorizeTrade: false };

  const needsDeepReview = e.preference === 'DEEP' || (e.preference === 'AUTO' &&
    (e.conflictingEvidence || e.unusualRegime || e.executionUncertain || e.portfolioExposureElevated));

  if (needsDeepReview && !e.deepReviewBudgetAvailable) {
    return { version: 'think-router-v1', route: 'NO_TRADE',
      reasons: ['DEEP_REVIEW_UNAVAILABLE'], canAuthorizeTrade: false };
  }
  if (needsDeepReview) return { version: 'think-router-v1', route: 'DEEP',
    reasons: ['EXTENDED_EVIDENCE_REVIEW_REQUIRED'], canAuthorizeTrade: false };
  return { version: 'think-router-v1', route: 'FAST',
    reasons: ['STANDARD_EVIDENCE_REVIEW'], canAuthorizeTrade: false };
}

/**
 * Environment-independent governance: paper and any future certified live
 * adapter must share the same routing/risk rules. LIVE remains locked by
 * the existing release gates; neither configuration value unlocks it.
 */
export function thinkSettings(env: Readonly<Record<string, string | undefined>> = process.env):
{ enforcement: ThinkEnforcement; preference: ThinkPreference } {
  const enforcement = env.MIA_THINK_MODE ?? 'SHADOW';
  const preference = env.MIA_THINK_PREFERENCE ?? 'AUTO';
  if (!(['DISABLED', 'SHADOW', 'ENFORCED'] as const).includes(enforcement as ThinkEnforcement))
    throw new Error('MIA_THINK_MODE must be DISABLED, SHADOW or ENFORCED');
  if (!(['AUTO', 'FAST', 'DEEP'] as const).includes(preference as ThinkPreference))
    throw new Error('MIA_THINK_PREFERENCE must be AUTO, FAST or DEEP');
  return { enforcement: enforcement as ThinkEnforcement, preference: preference as ThinkPreference };
}
