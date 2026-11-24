import { createHash } from 'node:crypto';
import { get, run, tx } from '../db/db.js';

/** DEEP thesis-lineage policy. This is an advisory bundle state machine, NOT a futures OMS. */
export type DeepCloseReason = 'TAKE_PROFIT' | 'TRAILING_STOP' | 'STOP_LOSS'
  | 'THESIS_INVALIDATED' | 'RISK_REDUCTION' | 'ABNORMAL_COST_OR_SLIPPAGE'
  | 'RECONCILIATION_MISMATCH' | 'MANUAL_CLOSE';
export type DeepLegState = 'PLANNED' | 'ELIGIBLE_FOR_EVAL' | 'RISK_APPROVED'
  | 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'EXITED' | 'CANCELLED' | 'REJECTED';
export type DeepPostCloseBehavior = 'CONTINUATION_REENTRY' | 'REVERSAL_REENTRY' | 'NO_TRADE_RECOVERY';
export type DeepPostCloseState = 'REENTRY_CANDIDATE' | 'NO_TRADE_RECOVERY' | 'CLOSED_ARCHIVED';

export interface DeepBundleLeg {
  legId: string;
  weight: number;
  maxNotionalUsd: number;
  maxRiskUsd: number;
  state: DeepLegState;
}
export interface DeepPositionBundle {
  bundleId: string;
  thesisLineageId: string;
  strategyId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  plannedNotionalUsd: number;
  aggregateRiskCapUsd: number;
  currentOpenRiskUsd: number;
  legs: DeepBundleLeg[];
}
export interface DeepPostCloseInput {
  closeReason: DeepCloseReason;
  ledgerReconciled: boolean;
  hasUnsettledOrders: boolean;
  freshContinuationTrigger: boolean;
  freshReversalTrigger: boolean;
  strategyStillEligible: boolean;
  forecastStillValid: boolean;
  now: number;
}
export interface DeepPostCloseDecision {
  decisionId: string;
  bundleId: string;
  thesisLineageId: string;
  behavior: DeepPostCloseBehavior;
  nextState: DeepPostCloseState;
  allowsUpsizedOrAutomaticRecovery: false;
  tradingAuthority: false;
  ledgerReconciled: boolean;
  evaluatedAt: number;
  closeReason: DeepCloseReason;
  reason: string;
}

/** Every planned leg has a finite capped allocation; an allocation never implies order authority. */
export function validateDeepBundle(bundle: DeepPositionBundle): string[] {
  const problems: string[] = [];
  if (!bundle.bundleId || !bundle.thesisLineageId || !bundle.strategyId || !bundle.symbol)
    problems.push('MISSING_BUNDLE_IDENTITY');
  if (!(Number.isFinite(bundle.plannedNotionalUsd) && bundle.plannedNotionalUsd > 0)
    || !(Number.isFinite(bundle.aggregateRiskCapUsd) && bundle.aggregateRiskCapUsd > 0)
    || !Number.isFinite(bundle.currentOpenRiskUsd) || bundle.currentOpenRiskUsd < 0
    || bundle.currentOpenRiskUsd > bundle.aggregateRiskCapUsd)
    problems.push('INVALID_AGGREGATE_RISK');
  if (!bundle.legs.length || bundle.legs.length > 5)
    problems.push('INVALID_LEG_COUNT');
  const ids = new Set<string>();
  let weights = 0, riskSum = 0, notionalSum = 0;
  for (const leg of bundle.legs) {
    if (!leg.legId || ids.has(leg.legId)) problems.push('DUPLICATE_OR_EMPTY_LEG_ID');
    ids.add(leg.legId);
    if (!(Number.isFinite(leg.weight) && leg.weight > 0 && leg.weight <= 1)
      || !(Number.isFinite(leg.maxRiskUsd) && leg.maxRiskUsd > 0)
      || !(Number.isFinite(leg.maxNotionalUsd) && leg.maxNotionalUsd > 0))
      problems.push('INVALID_LEG_CAP');
    weights += leg.weight; riskSum += leg.maxRiskUsd; notionalSum += leg.maxNotionalUsd;
  }
  if (Math.abs(weights - 1) > 1e-8) problems.push('LEG_WEIGHTS_NOT_ONE');
  if (riskSum > bundle.aggregateRiskCapUsd + 1e-8) problems.push('SUM_LEG_RISK_EXCEEDS_CAP');
  if (notionalSum > bundle.plannedNotionalUsd + 1e-8) problems.push('SUM_LEG_NOTIONAL_EXCEEDS_CAP');
  return [...new Set(problems)];
}
const adverse = new Set<DeepCloseReason>([
  'STOP_LOSS', 'THESIS_INVALIDATED', 'ABNORMAL_COST_OR_SLIPPAGE', 'RECONCILIATION_MISMATCH',
]);

/**
 * A closed trade may create a NEW research candidate, never an order or automatic reentry.
 * Full external reconciliation and a fresh Choice/Risk/OMS decision are still required.
 */
export function evaluateDeepPostClose(
  bundle: DeepPositionBundle, input: DeepPostCloseInput,
): DeepPostCloseDecision {
  const issues = validateDeepBundle(bundle);
  if (issues.length) throw new Error('INVALID_DEEP_BUNDLE:' + issues.join(','));
  if (!Number.isSafeInteger(input.now) || input.now <= 0) throw new Error('INVALID_POSTCLOSE_TIME');
  const decisionId = createHash('sha256').update(JSON.stringify([
    'dpbm-v1', bundle.bundleId, bundle.thesisLineageId,
    input.closeReason, input.ledgerReconciled, input.hasUnsettledOrders,
    input.freshContinuationTrigger, input.freshReversalTrigger,
    input.strategyStillEligible, input.forecastStillValid, input.now,
  ])).digest('hex');
  const common = {
    decisionId, bundleId: bundle.bundleId, thesisLineageId: bundle.thesisLineageId,
    allowsUpsizedOrAutomaticRecovery: false as const, tradingAuthority: false as const,
    ledgerReconciled: input.ledgerReconciled, evaluatedAt: input.now, closeReason: input.closeReason,
  };
  const no = (reason: string): DeepPostCloseDecision => ({
    ...common, behavior: 'NO_TRADE_RECOVERY', nextState: 'NO_TRADE_RECOVERY', reason,
  });
  if (!input.ledgerReconciled || input.hasUnsettledOrders)
    return no('UNRECONCILED_LEDGER_OR_ORDERS');
  if (bundle.legs.some(leg => !['EXITED','CANCELLED','REJECTED'].includes(leg.state)))
    return no('OPEN_OR_PARTIAL_BUNDLE_LEGS_REMAIN');
  if (bundle.currentOpenRiskUsd !== 0) return no('OPEN_BUNDLE_RISK_REMAINS');
  if (adverse.has(input.closeReason)) return no('ADVERSE_CLOSE_REQUIRES_COOLDOWN_AND_FRESH_REVIEW');
  if (!input.strategyStillEligible || !input.forecastStillValid)
    return no('THESIS_OR_FORECAST_NOT_ELIGIBLE');
  if (input.freshContinuationTrigger && input.freshReversalTrigger)
    return no('CONFLICTING_POSTCLOSE_TRIGGERS');
  if (input.freshReversalTrigger)
    return { ...common, behavior: 'REVERSAL_REENTRY', nextState: 'REENTRY_CANDIDATE',
      reason: 'NEW_OPPOSITE_DIRECTION_CANDIDATE_REQUIRES_RISK_AND_OMS' };
  if (input.freshContinuationTrigger)
    return { ...common, behavior: 'CONTINUATION_REENTRY', nextState: 'REENTRY_CANDIDATE',
      reason: 'NEW_CONTINUATION_CANDIDATE_REQUIRES_RISK_AND_OMS' };
  return { ...common, behavior: 'NO_TRADE_RECOVERY', nextState: 'CLOSED_ARCHIVED',
    reason: 'NO_FRESH_VALIDATED_SIGNAL' };
}

/**
 * Persist idempotent post-close evidence in the operational DB; no modification of financial
 * ledger, OMS orders, the DITAS immutable record tables, or position protection.
 */
export function recordDeepPostClose(decision: DeepPostCloseDecision): void {
  if (decision.tradingAuthority !== false || decision.allowsUpsizedOrAutomaticRecovery !== false)
    throw new Error('POSTCLOSE_MUST_HAVE_NO_EXECUTION_AUTHORITY');
  tx(() => {
    const existing = get<{ bundle_id: string; close_reason: string; decision: string; reason: string }>(
      'SELECT bundle_id,close_reason,decision,reason FROM deep_postclose_decisions WHERE decision_id=?',
      decision.decisionId,
    );
    if (existing) {
      if (existing.bundle_id !== decision.bundleId || existing.close_reason !== decision.closeReason
        || existing.decision !== decision.behavior || existing.reason !== decision.reason)
        throw new Error('POSTCLOSE_IDEMPOTENCY_COLLISION');
      return;
    }
    run(`INSERT INTO deep_postclose_decisions(
      decision_id,bundle_id,thesis_lineage_id,close_reason,decision,next_state,
      evaluated_at,ledger_reconciled,reason
    ) VALUES (?,?,?,?,?,?,?,?,?)`,
    decision.decisionId, decision.bundleId, decision.thesisLineageId,
    decision.closeReason, decision.behavior, decision.nextState,
    decision.evaluatedAt, decision.ledgerReconciled ? 1 : 0, decision.reason);
  });
}
