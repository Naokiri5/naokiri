/**
 * FAST/DEEP exit risk assessment — research-only, side-effect-free.
 * Not an OMS, venue adapter, signer, or execution authorization.
 * The canonical risk gate and OMS remain solely responsible for orders.
 */
export type ExitLane = 'FAST_MEMECOIN' | 'DEEP_LEVERAGED';
export type ExitAction = 'HOLD' | 'REVIEW' | 'REDUCE' | 'EXIT_IF_EXECUTABLE' | 'PROTECTION_UNVERIFIED';
export type ExitSeverity = 'NORMAL' | 'WARNING' | 'CRITICAL';
export interface ExitEvidence {
  positionId: string;
  lane: ExitLane;
  observedAtMs: number;
  nowMs: number;
  positionQty: number;
  /** A venue/DEX verified executable sell route, never a chart mark. */
  executableQty: number | null;
  quoteAgeMs: number | null;
  /** All thresholds supplied by approved policy, never hardcoded trading targets. */
  maxQuoteAgeMs: number;
  /** FAST evidence: null means unavailable, not safe. */
  sellable?: boolean | null;
  verifiedLiquidityWithdrawal?: boolean | null;
  verifiedInsiderDistribution?: boolean | null;
  executableImpactBps?: number | null;
  maxExecutableImpactBps?: number;
  /** DEEP evidence: use venue mark and venue-calculated liquidation price. */
  markPrice?: number | null;
  liquidationPrice?: number | null;
  side?: 'LONG' | 'SHORT';
  stressMovePct?: number | null;
  reservePct?: number | null;
  /** Account-level margin model must separately validate cross-margin. */
  accountMarginSafe?: boolean | null;
  marginDataFresh?: boolean | null;
}
export interface ExitAssessment {
  positionId: string;
  lane: ExitLane;
  action: ExitAction;
  severity: ExitSeverity;
  reasonCodes: string[];
  /** Advisory upper bound, not an order quantity. */
  executableQty: number;
  liquidationBufferPct: number | null;
  requiredBufferPct: number | null;
  orderAuthorized: false;
}

const finiteNonnegative = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function assessExitProtection(e: ExitEvidence): ExitAssessment {
  const reasons: string[] = [];
  const result = (action: ExitAction, severity: ExitSeverity, buffer: number | null = null, required: number | null = null): ExitAssessment => ({
    positionId: e.positionId, lane: e.lane, action, severity, reasonCodes: reasons,
    executableQty: finiteNonnegative(e.executableQty) && finiteNonnegative(e.positionQty)
      ? Math.min(e.executableQty, e.positionQty) : 0,
    liquidationBufferPct: buffer, requiredBufferPct: required, orderAuthorized: false,
  });
  if (!e.positionId || !finiteNonnegative(e.positionQty) || e.positionQty === 0 ||
      !Number.isFinite(e.nowMs) || !Number.isFinite(e.observedAtMs) ||
      e.observedAtMs > e.nowMs || !finiteNonnegative(e.maxQuoteAgeMs) ||
      !finiteNonnegative(e.quoteAgeMs) || e.quoteAgeMs > e.maxQuoteAgeMs ||
      e.nowMs - e.observedAtMs > e.maxQuoteAgeMs) {
    reasons.push('EXIT_EVIDENCE_INVALID_OR_STALE');
    return result('PROTECTION_UNVERIFIED', 'CRITICAL');
  }
  if (!finiteNonnegative(e.executableQty) || e.executableQty === 0) {
    reasons.push('NO_VERIFIED_EXECUTABLE_EXIT');
    return result('PROTECTION_UNVERIFIED', 'CRITICAL');
  }
  if (e.lane === 'FAST_MEMECOIN') {
    if (e.sellable !== true) {
      reasons.push(e.sellable === false ? 'SELL_RESTRICTION_DETECTED' : 'SELLABILITY_UNVERIFIED');
      return result('PROTECTION_UNVERIFIED', 'CRITICAL');
    }
    if (!finiteNonnegative(e.executableImpactBps) ||
        !finiteNonnegative(e.maxExecutableImpactBps)) {
      reasons.push('EXECUTION_IMPACT_UNVERIFIED');
      return result('PROTECTION_UNVERIFIED', 'CRITICAL');
    }
    if (e.executableImpactBps > e.maxExecutableImpactBps) {
      reasons.push('EXECUTION_IMPACT_OVER_POLICY');
      return result('REVIEW', 'CRITICAL');
    }
    if (e.verifiedLiquidityWithdrawal === true || e.verifiedInsiderDistribution === true) {
      if (e.verifiedLiquidityWithdrawal) reasons.push('VERIFIED_LIQUIDITY_WITHDRAWAL');
      if (e.verifiedInsiderDistribution) reasons.push('VERIFIED_INSIDER_DISTRIBUTION');
      return result('EXIT_IF_EXECUTABLE', 'CRITICAL');
    }
    if (e.verifiedLiquidityWithdrawal == null || e.verifiedInsiderDistribution == null) {
      reasons.push('RUG_EVIDENCE_INCOMPLETE');
      return result('REVIEW', 'WARNING');
    }
    if (e.executableQty < e.positionQty) {
      reasons.push('EXIT_DEPTH_INSUFFICIENT_FOR_FULL_POSITION');
      return result('REDUCE', 'WARNING');
    }
    return result('HOLD', 'NORMAL');
  }
  if (e.lane !== 'DEEP_LEVERAGED') {
    reasons.push('UNKNOWN_EXIT_LANE');
    return result('PROTECTION_UNVERIFIED', 'CRITICAL');
  }
  if (e.marginDataFresh !== true || e.accountMarginSafe == null ||
      !finiteNonnegative(e.markPrice) || e.markPrice === 0 ||
      !finiteNonnegative(e.liquidationPrice) || e.liquidationPrice === 0 ||
      !finiteNonnegative(e.stressMovePct) || !finiteNonnegative(e.reservePct) ||
      (e.side !== 'LONG' && e.side !== 'SHORT')) {
    reasons.push('MARGIN_OR_LIQUIDATION_EVIDENCE_UNVERIFIED');
    return result('PROTECTION_UNVERIFIED', 'CRITICAL');
  }
  const buffer = e.side === 'LONG'
    ? (e.markPrice - e.liquidationPrice) / e.markPrice * 100
    : (e.liquidationPrice - e.markPrice) / e.markPrice * 100;
  const required = e.stressMovePct + e.reservePct;
  if (e.accountMarginSafe === false) {
    reasons.push('ACCOUNT_MARGIN_UNSAFE');
    return result('EXIT_IF_EXECUTABLE', 'CRITICAL', buffer, required);
  }
  if (buffer <= required) {
    reasons.push('LIQUIDATION_BUFFER_EXHAUSTED');
    return result('EXIT_IF_EXECUTABLE', 'CRITICAL', buffer, required);
  }
  if (buffer <= required * 1.5) {
    reasons.push('LIQUIDATION_BUFFER_WARNING');
    return result('REDUCE', 'WARNING', buffer, required);
  }
  if (e.executableQty < e.positionQty) {
    reasons.push('EXIT_DEPTH_INSUFFICIENT_FOR_FULL_POSITION');
    return result('REDUCE', 'WARNING', buffer, required);
  }
  return result('HOLD', 'NORMAL', buffer, required);
}
