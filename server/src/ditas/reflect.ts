/**
 * REFLECT: evidence-backed error attribution for one settled trade (closed-loop architecture, section 10).
 *
 * Five categories, each decided by a fixed, testable rule over the immutable outcome record and the original
 * decision. A category is reported only when its evidence is present; missing evidence is reported as such rather than
 * guessed. Attribution describes what happened; it never changes a strategy, policy or sizing, and a single trade is
 * never treated as proof that a strategy is unprofitable.
 */
import { strategyById } from '../lab/strategies.js';
import type { TradeOutcomePayload } from './tradeOutcomes.js';

export type ErrorCategory = 'FORECAST' | 'STRATEGY' | 'ENTRY' | 'EXIT' | 'EXECUTION';

/** Entry cost beyond the decision reference, in units of planned risk, above which entry counts as an error. */
export const ENTRY_ERROR_R = 0.1;

export interface Reflection {
  outcome: 'WIN' | 'LOSS_OR_FLAT';
  errors: { category: ErrorCategory; evidence: string }[];
  /** Categories that could not be assessed because their evidence is missing. */
  unassessed: { category: ErrorCategory; missing: string }[];
  /** A loss with no attributable error: consistent with normal variance of a valid decision. */
  unattributedLoss: boolean;
  evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY';
}

export interface ReflectInput {
  strategy: string;
  netPnl: number;
  netR: number | null;
  payload: TradeOutcomePayload;
  /** R multiple of the decision's first take-profit target, when the decision recorded one. */
  firstTargetR: number | null;
}

export function reflectOnTrade(t: ReflectInput): Reflection {
  const a = t.payload.attribution, x = t.payload.execution;
  const errors: Reflection['errors'] = [], unassessed: Reflection['unassessed'] = [];

  // FORECAST: the predicted move (first target) never happened.
  if (t.firstTargetR === null) unassessed.push({ category: 'FORECAST', missing: 'decision target' });
  else if (a.maxFavorableR < t.firstTargetR) errors.push({ category: 'FORECAST', evidence: `price reached ${a.maxFavorableR.toFixed(2)}R of the ${t.firstTargetR.toFixed(2)}R first target` });

  // STRATEGY: the strategy was used in a regime it is not validated for.
  const regime = t.payload.decision?.regime ?? null, def = strategyById(t.strategy);
  if (!regime || !def) unassessed.push({ category: 'STRATEGY', missing: !regime ? 'decision regime' : 'strategy definition' });
  else if (!(def.suitableRegimes as readonly string[]).includes(regime)) errors.push({ category: 'STRATEGY', evidence: `${t.strategy} is validated for ${def.suitableRegimes.join(', ')}, decision regime was ${regime}` });

  // ENTRY: the fill cost materially more than the decision reference.
  const plannedRisk = t.netR !== null && t.netR !== 0 ? t.netPnl / t.netR : null;
  const ref = t.payload.decision?.entryRef ?? null;
  if (ref === null || x.entryAvgPrice === null || plannedRisk === null || !(plannedRisk > 0)) unassessed.push({ category: 'ENTRY', missing: 'decision reference price or planned risk' });
  else {
    const entryCostR = ((x.entryAvgPrice - ref) * x.entryQty) / plannedRisk;
    if (entryCostR > ENTRY_ERROR_R) errors.push({ category: 'ENTRY', evidence: `entry cost ${entryCostR.toFixed(2)}R above the decision reference` });
  }

  // EXIT: a favourable move was available and given back.
  if (t.netPnl <= 0 && (a.reachedOneRBeforeStop || (t.firstTargetR !== null && a.maxFavorableR >= t.firstTargetR))) {
    errors.push({ category: 'EXIT', evidence: `reached ${a.maxFavorableR.toFixed(2)}R but closed at ${t.netR === null ? 'unknown' : t.netR.toFixed(2)}R (${x.exitReason ?? 'unknown exit'})` });
  }

  // EXECUTION: costs removed a gross edge, or the realized loss exceeded the planned risk (stop slippage or gap).
  if (a.costsRemovedEdge) errors.push({ category: 'EXECUTION', evidence: `gross ${a.grossPnl.toFixed(2)} turned into a net loss after ${a.costs.toFixed(2)} costs` });
  else if (a.lossBeyondPlannedRisk) errors.push({ category: 'EXECUTION', evidence: `loss of ${t.netR!.toFixed(2)}R exceeded the planned 1R` });

  const loss = t.netPnl <= 0;
  return { outcome: loss ? 'LOSS_OR_FLAT' : 'WIN', errors, unassessed, unattributedLoss: loss && errors.length === 0, evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY' };
}
