import type { WorkerContext } from '../workers/types.js';
import type { ConsensusRecord } from '../qci/schemas.js';
import { horizonAlignment } from '../qci/challenge.js';
import { isExpired } from '../qci/coordinator.js';
import { scenarioTable, type ScenarioReport } from './profitLab.js';
import {
  routeThinking, thinkSettings, type ThinkPreference, type ThinkEnforcement,
  type ThinkRoute, type ThinkRoutingEvidence,
} from './think-router.js';

/**
 * PDF modules 2, 4 and 5 — adapted to canonical WorkerContext/QCI and existing
 * Profit Lab. This module has NO OMS or wallet access. Deep = additional
 * deterministic review; it cannot create an approval or change existing vetoes.
 */
export interface ThinkingAnalysis {
  version: 'mia-think-observer-v1';
  authority: 'EXPLANATION_ONLY';
  canAuthorizeTrade: false;
  preference: ThinkPreference;
  enforcement: ThinkEnforcement;
  route: ThinkRoute;
  routeReasons: readonly string[];
  /** Only a risk-reducing veto is possible when opt-in ENFORCED. */
  wouldAbstain: boolean;
  dataQuality: WorkerContext['quality']['status'];
  evidence: Readonly<ThinkRoutingEvidence>;
  /**
   * Deep analysis is bounded to existing deterministic evidence. No LLM,
   * no network calls, no second QCI, and no parallel risk/OMS implementation.
   */
  deep: {
    horizonTrends: ReturnType<typeof horizonAlignment>['trends'];
    horizonConflict: boolean;
    criticalChallengeCount: number;
    unresolvedFindings: readonly string[];
    hypotheticalScenarios: ScenarioReport;
    calibration: 'NO_VALID_FORECAST';
  } | null;
  dataTransport: 'CANONICAL_MIA_MARKET_FABRIC';
}

export interface ThinkInput {
  ctx: WorkerContext;
  qci: ConsensusRecord;
  correlatedOpen: number;
  preference?: ThinkPreference;
  enforcement?: ThinkEnforcement;
  nowMs?: number;
}

export function deriveThinkRoutingEvidence(input: {
  ctx: WorkerContext; qci: ConsensusRecord; correlatedOpen: number;
  preference: ThinkPreference; nowMs: number;
}): ThinkRoutingEvidence {
  const { ctx, qci, correlatedOpen, preference, nowMs } = input;
  const missingRequired = qci.domains.filter(d => d.required && d.support + d.oppose === 0);
  const remainingMs = Date.parse(qci.expires_at) - nowMs;
  const finiteAge = (n: number | null) => n != null && Number.isFinite(n) && n >= 0;
  return {
    preference,
    marketDataValid: ctx.quality.status !== 'FAIL' &&
      ctx.ticker !== null && Number.isFinite(ctx.ticker.last) && ctx.ticker.last > 0 &&
      finiteAge(ctx.quality.quoteAgeMs) &&
      finiteAge(ctx.quality.bookAgeMs),
    mandatoryCoverageComplete: qci.state !== 'NO_QUORUM' &&
      missingRequired.length === 0 && qci.domains.length > 0,
    hardVetoPresent: qci.state === 'VETOED' || !ctx.safety.eligibleForAutomation,
    consensusExpired: isExpired(qci, nowMs),
    conflictingEvidence: qci.state === 'MIXED_CONSENSUS' ||
      qci.challenge.some(c => c.reviewer === 'CONTRARIAN' && c.stance === 'OPPOSE'),
    unusualRegime: ctx.candidate.regime === 'HIGH_VOLATILITY' ||
      ctx.candidate.regime === 'UNKNOWN',
    executionUncertain: ctx.impact == null || !ctx.impact.filledFully ||
      !Number.isFinite(ctx.impact.impactBps) || ctx.impact.spreadBps > 25,
    portfolioExposureElevated: correlatedOpen > 0,
    // Advisory budget: the canonical QCI TTL is the outer limit.
    // Never extend it, and never run deep analysis on expired evidence.
    deepReviewBudgetAvailable: Number.isFinite(remainingMs) && remainingMs >= 500,
  };
}

/** Deterministic, bounded review of existing evidence only; no network, no writes. */
export function analyzeThinking(input: Readonly<ThinkInput>): ThinkingAnalysis {
  const settings = thinkSettings();
  const preference = input.preference ?? settings.preference;
  const enforcement = input.enforcement ?? settings.enforcement;
  const evidence = deriveThinkRoutingEvidence({
    ctx: input.ctx, qci: input.qci, correlatedOpen: input.correlatedOpen,
    preference, nowMs: input.nowMs ?? Date.now(),
  });
  const routing = routeThinking(evidence);
  const result: ThinkingAnalysis = {
    version: 'mia-think-observer-v1',
    authority: 'EXPLANATION_ONLY',
    canAuthorizeTrade: false,
    preference, enforcement, route: routing.route, routeReasons: routing.reasons,
    wouldAbstain: routing.route === 'NO_TRADE',
    dataQuality: input.ctx.quality.status,
    evidence, deep: null, dataTransport: 'CANONICAL_MIA_MARKET_FABRIC',
  };
  if (enforcement === 'DISABLED' || routing.route !== 'DEEP') return result;

  // Reuse the existing PR #36 horizon analysis and PR #33 Profit Lab.
  // Those modules are already evaluated/owned by QCI and decision respectively.
  const h = horizonAlignment(input.ctx);
  const s = input.ctx.candidate.signal;
  const critical = input.qci.challenge.filter(c => c.critical);
  const findings = input.qci.challenge
    .filter(c => c.stance === 'OPPOSE')
    .flatMap(c => c.findings)
    .slice(0, 24);
  const scenarios = scenarioTable({
    entry: s.entryRef, stop: s.stop,
    targets: s.targets.map(t => ({
      price: s.entryRef + (s.entryRef - s.stop) * t.r,
      fraction: t.fraction,
    })),
    qty: null, // The existing risk gate is the ONLY sizing authority.
    feeRate: input.ctx.feeRate,
    spreadBps: input.ctx.impact?.spreadBps ?? null,
    slippageBps: input.ctx.impact?.impactBps ?? null,
  });
  return {
    ...result,
    deep: {
      horizonTrends: h.trends,
      horizonConflict: h.critical,
      criticalChallengeCount: critical.length,
      unresolvedFindings: [...h.findings, ...findings].slice(0, 30),
      hypotheticalScenarios: scenarios,
      calibration: 'NO_VALID_FORECAST',
    },
    wouldAbstain: result.wouldAbstain || h.critical || critical.length > 0 || !scenarios.valid,
  };
}

/**
 * On invalid/adversarial inputs, analysis may never grant execution rights.
 * An exception is represented as an abstention, and is a no-op in SHADOW mode.
 */
export function failedThinkingAnalysis(
  error: unknown,
  enforcement: ThinkEnforcement,
  preference: ThinkPreference,
): ThinkingAnalysis {
  const code = error instanceof Error ? error.name : 'UNKNOWN';
  return {
    version: 'mia-think-observer-v1', authority: 'EXPLANATION_ONLY', canAuthorizeTrade: false,
    preference, enforcement, route: 'NO_TRADE',
    routeReasons: ['ADAPTIVE_THINKING_UNAVAILABLE', code.slice(0, 50)],
    wouldAbstain: true, deep: null, dataTransport: 'CANONICAL_MIA_MARKET_FABRIC',
    dataQuality: 'FAIL',
    evidence: {
      preference, marketDataValid: false, mandatoryCoverageComplete: false,
      hardVetoPresent: false, consensusExpired: true, conflictingEvidence: false,
      unusualRegime: false, executionUncertain: true, portfolioExposureElevated: false,
      deepReviewBudgetAvailable: false,
    },
  };
}
