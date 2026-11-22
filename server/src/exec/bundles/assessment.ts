/**
 * MIA 5.0 — Bundle Order Coordinator: standalone, NON-EXECUTING design proposal.
 * NOT WIRED to the repository. Do NOT call this an OMS, signer, risk engine, or live adapter.
 * Existing authoritative owners are risk/gate.ts, exec/oms.ts, portfolio/ledger.ts,
 * core/mode.ts and qa/gates.ts. This module provides deterministic preflight
 * aggregation and a pure, audit-friendly projection of bundle events only.
 *
 * IMPORTANT: No imports, HTTP, RPC, exchange calls, database writes or signing.
 * Risk evidence MUST be built on the trusted backend from canonical risk evaluations,
 * actual account state and reconciled reservations, never user/AI supplied JSON.
 */

export type BundleEnvironment = 'PAPER' | 'TESTNET' | 'LIVE';
export type BundleMode =
  | 'BATCH_BEST_EFFORT'
  | 'SPLIT_ORDER'
  | 'MULTI_ASSET_BASKET'
  | 'COORDINATED_STRATEGY'
  | 'PAPER_ATOMIC'
  | 'SOLANA_JITO_ATOMIC';
export type BundleSide = 'BUY' | 'SELL';
export type CanonicalRiskDecision = 'ALLOW' | 'DENY' | 'NEEDS_REVIEW';
export type BundleState =
  | 'PLANNED' | 'RISK_APPROVED' | 'RESERVED' | 'SUBMITTING'
  | 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED'
  | 'FAILED' | 'UNKNOWN' | 'RECONCILED' | 'CANCELLED';

/** Strings encode integer atomic units; currency/precision are set by trusted adapters. */
export type AtomicAmount = string;

export interface BundleLeg {
  legId: string;
  decisionId: string;
  instrumentId: string;
  venueId: string;
  side: BundleSide;
  requestedUnits: AtomicAmount;
}

export interface BundleIntent {
  bundleId: string;
  environment: BundleEnvironment;
  accountId: string;
  strategyId: string;
  idempotencyKey: string;
  mode: BundleMode;
  expiresAt: number;
  legs: readonly BundleLeg[];
}

/**
 * Canonical single-order risk gate output translated to exact, trusted integer units.
 * Quote freshness, asset-safety and protection flags MUST come from MIA services.
 */
export interface LegRiskEvidence {
  legId: string;
  decisionId: string;
  instrumentId: string;
  venueId: string;
  side: BundleSide;
  requestedUnits: AtomicAmount;
  decision: CanonicalRiskDecision;
  policyVersion: number;
  validUntil: number;
  currency: string;
  debitAtomic: AtomicAmount;
  feeAtomic: AtomicAmount;
  networkFeeAtomic: AtomicAmount;
  plannedMaxLossAtomic: AtomicAmount;
  qualityPassed: boolean;
  assetSafetyPassed: boolean;
  entryProtectionAvailable: boolean;
}

/**
 * Account-scoped, normalized canonical evidence. Any cross-currency conversion must
 * happen upstream with independently validated rates and exact rounding.
 */
export interface BundleAccountEvidence {
  environment: BundleEnvironment;
  accountId: string;
  currency: string;
  policyVersion: number;
  validUntil: number;
  cashBalanceAtomic: AtomicAmount;
  reservedCashAtomic: AtomicAmount;
  existingOpenRiskAtomic: AtomicAmount;
  reservedRiskAtomic: AtomicAmount;
  maxTotalOpenRiskAtomic: AtomicAmount;
  openPositionCount: number;
  pendingPositionCount: number;
  maxConcurrentPositions: number;
  correlationPassed: boolean;
  concentrationPassed: boolean;
  venueExposurePassed: boolean;
  accountReconciled: boolean;
}

/** Capabilities are verified server-side; inclusion does not grant trade permission. */
export interface BundleVenueCapabilities {
  environment: BundleEnvironment;
  allowedVenues: readonly string[];
  supportedModes: readonly BundleMode[];
  maxLegs: number;
  expiresAt: number;
  // Consuming code must enforce native/protocol guarantees; never silently downgrade.
  paperTransactionalCommitAvailable: boolean;
  jitoAtomicExecutionCertified: boolean;
}

export interface BundleEvidence {
  account: BundleAccountEvidence;
  legs: readonly LegRiskEvidence[];
  venue: BundleVenueCapabilities;
  /** Externally recorded canonical control state. */
  control: { mode: 'OBSERVE' | 'PAPER' | 'APPROVAL' | 'BOUNDED_LIVE'; emergency: boolean; pausedNewOrders: boolean };
}

export interface BundlePreflight {
  bundleId: string;
  environment: BundleEnvironment;
  accountId: string;
  approved: boolean; // Risk/eligibility assessment only; NOT submission permission.
  canSubmit: false; // Deliberately impossible in this standalone proposal.
  policyVersion: number | null;
  reasonCodes: readonly string[];
  totals: {
    currency: string | null;
    newCashCommitmentAtomic: AtomicAmount;
    newPlannedMaxLossAtomic: AtomicAmount;
    projectedCashCommitmentAtomic: AtomicAmount;
    projectedOpenRiskAtomic: AtomicAmount;
  };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const AMOUNT = /^(?:0|[1-9][0-9]{0,38})$/;
const MAX_UNITS = (10n ** 39n) - 1n;
const MODES: readonly BundleMode[] = [
  'BATCH_BEST_EFFORT', 'SPLIT_ORDER', 'MULTI_ASSET_BASKET',
  'COORDINATED_STRATEGY', 'PAPER_ATOMIC', 'SOLANA_JITO_ATOMIC',
];
const ENVS: readonly BundleEnvironment[] = ['PAPER', 'TESTNET', 'LIVE'];

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
function validTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}
function amount(v: unknown): bigint {
  if (typeof v !== 'string' || !AMOUNT.test(v)) throw new Error('INVALID_ATOMIC_AMOUNT');
  const n = BigInt(v);
  if (n > MAX_UNITS) throw new Error('ATOMIC_AMOUNT_TOO_LARGE');
  return n;
}
function nonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}
function safeStateCopy<T>(v: Readonly<Record<string, T>>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, v);
}

/** Validate shape and fixed policy semantics; does NOT authorize or place orders. */
export function validateBundleIntent(intent: BundleIntent, now: number): readonly string[] {
  const reasons: string[] = [];
  if (![intent.bundleId, intent.accountId, intent.strategyId, intent.idempotencyKey].every(validId))
    reasons.push('INVALID_BUNDLE_IDENTITY');
  if (!ENVS.includes(intent.environment)) reasons.push('INVALID_ENVIRONMENT');
  if (!MODES.includes(intent.mode)) reasons.push('INVALID_BUNDLE_MODE');
  if (!validTime(now) || !validTime(intent.expiresAt) || intent.expiresAt <= now)
    reasons.push('BUNDLE_EXPIRED_OR_INVALID_TIME');
  if (!Array.isArray(intent.legs) || intent.legs.length === 0 || intent.legs.length > 25) {
    reasons.push('INVALID_BUNDLE_LEG_COUNT');
    return reasons;
  }
  const ids = new Set<string>();
  const uniqueEntries = new Set<string>();
  for (const leg of intent.legs) {
    if (![leg.legId, leg.decisionId, leg.instrumentId, leg.venueId].every(validId))
      reasons.push('INVALID_LEG_IDENTITY');
    if (ids.has(leg.legId)) reasons.push('DUPLICATE_LEG_ID');
    ids.add(leg.legId);
    if (leg.side !== 'BUY' && leg.side !== 'SELL') reasons.push('INVALID_SIDE');
    // Current MIA submitEntry() is long-only; exits are a different OMS path.
    if (leg.side !== 'BUY') reasons.push('SELL_NOT_SUPPORTED_IN_CURRENT_ENTRY_PATH');
    try { if (amount(leg.requestedUnits) <= 0n) reasons.push('ZERO_LEG_QUANTITY'); }
    catch { reasons.push('INVALID_LEG_QUANTITY'); }
    const key = JSON.stringify([leg.venueId, leg.instrumentId, leg.side]);
    if (uniqueEntries.has(key) && intent.mode !== 'SPLIT_ORDER') reasons.push('DUPLICATE_INSTRUMENT_LEG');
    uniqueEntries.add(key);
  }
  if (intent.mode === 'SPLIT_ORDER') {
    const first = intent.legs[0];
    if (intent.legs.some(l => l.instrumentId !== first.instrumentId || l.venueId !== first.venueId || l.side !== first.side))
      reasons.push('SPLIT_ORDER_SCOPE_MISMATCH');
  }
  if (intent.mode === 'PAPER_ATOMIC') {
    if (intent.environment !== 'PAPER') reasons.push('PAPER_ATOMIC_REQUIRES_PAPER');
    if (intent.legs.some(l => l.venueId !== 'binance-paper')) reasons.push('PAPER_ATOMIC_UNSUPPORTED_VENUE');
  }
  if (intent.mode === 'SOLANA_JITO_ATOMIC') {
    if (intent.environment !== 'LIVE') reasons.push('JITO_BUNDLE_REQUIRES_LIVE_ENVIRONMENT');
    if (intent.legs.length > 5) reasons.push('JITO_MAX_FIVE_TRANSACTIONS');
    if (intent.legs.some(l => l.venueId !== 'jito-solana')) reasons.push('JITO_VENUE_SCOPE_MISMATCH');
  }
  return [...new Set(reasons)];
}

/**
 * Pure, fail-closed aggregate assessment. One risk gate remains authoritative:
 * per-leg decisions MUST already come from risk/gate.ts or its reviewed extension.
 * Bundle-wide checks ONLY prohibit cumulative over-exposure; they cannot uplift DENY.
 */
export function assessBundle(intent: BundleIntent, proof: BundleEvidence, now: number): BundlePreflight {
  const reasons = [...validateBundleIntent(intent, now)];
  const account = proof.account;
  const cap = proof.venue;
  const output: BundlePreflight = {
    bundleId: intent.bundleId,
    environment: intent.environment,
    accountId: intent.accountId,
    approved: false,
    canSubmit: false,
    policyVersion: nonNegativeInt(account.policyVersion) ? account.policyVersion : null,
    reasonCodes: [],
    totals: { currency: null, newCashCommitmentAtomic: '0', newPlannedMaxLossAtomic: '0', projectedCashCommitmentAtomic: '0', projectedOpenRiskAtomic: '0' },
  };
  const fail = (code: string) => reasons.push(code);
  if (account.environment !== intent.environment || account.accountId !== intent.accountId)
    fail('ACCOUNT_ENVIRONMENT_SCOPE_MISMATCH');
  if (cap.environment !== intent.environment) fail('CAPABILITY_ENVIRONMENT_MISMATCH');
  if (!validId(account.currency)) fail('INVALID_ACCOUNT_CURRENCY');
  else output.totals.currency = account.currency;
  if (!validTime(account.validUntil) || account.validUntil <= now) fail('ACCOUNT_RISK_EVIDENCE_STALE');
  if (!validTime(cap.expiresAt) || cap.expiresAt <= now) fail('VENUE_CAPABILITIES_STALE');
  if (!nonNegativeInt(account.policyVersion) || account.policyVersion === 0) fail('POLICY_VERSION_INVALID');
  if (!cap.supportedModes.includes(intent.mode)) fail('BUNDLE_MODE_UNSUPPORTED_BY_VENUE');
  if (!nonNegativeInt(cap.maxLegs) || cap.maxLegs < 1 || intent.legs.length > cap.maxLegs)
    fail('VENUE_BUNDLE_CAPACITY_EXCEEDED');
  if (intent.legs.some(l => !cap.allowedVenues.includes(l.venueId))) fail('VENUE_NOT_APPROVED');
  if (!account.accountReconciled) fail('ACCOUNT_UNRECONCILED');
  if (!account.correlationPassed) fail('CORRELATION_POLICY_FAILED');
  if (!account.concentrationPassed) fail('CONCENTRATION_POLICY_FAILED');
  if (!account.venueExposurePassed) fail('VENUE_EXPOSURE_POLICY_FAILED');
  if (proof.control.emergency || proof.control.pausedNewOrders) fail('EMERGENCY_OR_PAUSE_ACTIVE');
  if (intent.environment === 'PAPER' && proof.control.mode !== 'PAPER') fail('PAPER_MODE_NOT_ACTIVE');
  // No TESTNET execution or live activation is supplied by this source file.
  if (intent.environment === 'TESTNET') fail('TESTNET_ORDER_PLACEMENT_NOT_IMPLEMENTED');
  if (intent.environment === 'LIVE') fail('LIVE_BUNDLE_SUBMISSION_NOT_CERTIFIED');
  if (intent.mode === 'PAPER_ATOMIC' && !cap.paperTransactionalCommitAvailable)
    fail('PAPER_OMS_ATOMIC_COMMIT_NOT_INSTALLED');
  if (intent.mode === 'SOLANA_JITO_ATOMIC' && !cap.jitoAtomicExecutionCertified)
    fail('JITO_EXECUTION_ADAPTER_NOT_CERTIFIED');

  if (proof.legs.length !== intent.legs.length) fail('MISSING_OR_EXTRA_LEG_RISK_EVIDENCE');
  const byId = new Map<string, LegRiskEvidence>();
  for (const ev of proof.legs) {
    if (byId.has(ev.legId)) fail('DUPLICATED_RISK_EVIDENCE');
    byId.set(ev.legId, ev);
  }
  let newCash = 0n, newRisk = 0n;
  for (const leg of intent.legs) {
    const ev = byId.get(leg.legId);
    if (!ev) { fail('MISSING_LEG_RISK_EVIDENCE'); continue; }
    if (ev.decisionId !== leg.decisionId || ev.instrumentId !== leg.instrumentId ||
        ev.venueId !== leg.venueId || ev.side !== leg.side || ev.requestedUnits !== leg.requestedUnits) {
      fail('RISK_EVIDENCE_LEG_IDENTITY_MISMATCH'); continue;
    }
    if (ev.currency !== account.currency) fail('UNNORMALIZED_RISK_CURRENCY');
    if (ev.policyVersion !== account.policyVersion) fail('MIXED_POLICY_VERSIONS');
    if (!validTime(ev.validUntil) || ev.validUntil <= now) fail('STALE_LEG_RISK_EVIDENCE');
    if (ev.decision !== 'ALLOW') fail('CANONICAL_RISK_NOT_ALLOW');
    if (!ev.qualityPassed) fail('MARKET_QUALITY_NOT_VERIFIED');
    if (!ev.assetSafetyPassed) fail('TOKEN_SAFETY_NOT_VERIFIED');
    if (ev.side === 'BUY' && !ev.entryProtectionAvailable) fail('ENTRY_PROTECTION_UNAVAILABLE');
    try {
      newCash += amount(ev.debitAtomic) + amount(ev.feeAtomic) + amount(ev.networkFeeAtomic);
      newRisk += amount(ev.plannedMaxLossAtomic);
    } catch { fail('INVALID_LEG_RISK_AMOUNT'); }
  }
  let projectedCash = 0n, projectedRisk = 0n;
  try {
    projectedCash = newCash + amount(account.reservedCashAtomic);
    projectedRisk = newRisk + amount(account.existingOpenRiskAtomic) + amount(account.reservedRiskAtomic);
    if (projectedCash > amount(account.cashBalanceAtomic)) fail('BUNDLE_INSUFFICIENT_AVAILABLE_CASH');
    if (projectedRisk > amount(account.maxTotalOpenRiskAtomic)) fail('BUNDLE_AGGREGATE_RISK_LIMIT');
  } catch { fail('INVALID_ACCOUNT_RISK_AMOUNT'); }
  output.totals.newCashCommitmentAtomic = newCash.toString();
  output.totals.newPlannedMaxLossAtomic = newRisk.toString();
  output.totals.projectedCashCommitmentAtomic = projectedCash.toString();
  output.totals.projectedOpenRiskAtomic = projectedRisk.toString();
  if (![account.openPositionCount, account.pendingPositionCount, account.maxConcurrentPositions].every(nonNegativeInt))
    fail('INVALID_POSITION_COUNTS');
  else {
    const proposedSlots = intent.mode === 'SPLIT_ORDER' ? 1 : intent.legs.length;
    if (account.openPositionCount + account.pendingPositionCount + proposedSlots > account.maxConcurrentPositions)
      fail('BUNDLE_POSITION_CAPACITY_EXCEEDED');
  }
  output.reasonCodes = [...new Set(reasons)];
  output.approved = output.reasonCodes.length === 0;
  return output;
}

export type BundleEvent =
  | { eventId: string; at: number; kind: 'RISK_APPROVED' }
  | { eventId: string; at: number; kind: 'RESERVATION_COMMITTED' }
  | { eventId: string; at: number; kind: 'SUBMISSION_STARTED' }
  | { eventId: string; at: number; kind: 'LEG_ACK'; legId: string; venueOrderId: string }
  | { eventId: string; at: number; kind: 'LEG_FILL'; legId: string; venueTradeId: string; quantityUnits: AtomicAmount }
  | { eventId: string; at: number; kind: 'LEG_UNCERTAIN'; legId: string; reason: string }
  | { eventId: string; at: number; kind: 'LEG_REJECTED'; legId: string; reason: string }
  | { eventId: string; at: number; kind: 'PAPER_ATOMIC_COMMITTED'; committedOrderIds: readonly string[] }
  | { eventId: string; at: number; kind: 'VERIFIED_RECONCILIATION'; verifiedLegs: readonly { legId: string; finalStatus: 'FILLED' | 'REJECTED' | 'CANCELLED'; confirmedUnits: AtomicAmount }[] }
  | { eventId: string; at: number; kind: 'CANCEL_BEFORE_RESERVATION' };

export interface BundleLegProjection {
  requestedUnits: AtomicAmount;
  confirmedUnits: AtomicAmount;
  venueOrderId: string | null;
  venueTradeIds: Readonly<Record<string, AtomicAmount>>;
  status: 'PLANNED' | 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED' | 'UNKNOWN' | 'REJECTED' | 'CANCELLED';
}
export interface BundleProjection {
  bundleId: string;
  environment: BundleEnvironment;
  accountId: string;
  mode: BundleMode;
  state: BundleState;
  version: number;
  createdAt: number;
  lastEventAt: number;
  requiresReconciliation: boolean;
  canSubmit: false;
  canBlindRetry: false;
  legs: Readonly<Record<string, BundleLegProjection>>;
  processedEvents: Readonly<Record<string, string>>;
}

export function newBundleProjection(intent: BundleIntent, now: number): BundleProjection {
  const errors = validateBundleIntent(intent, now);
  if (errors.length) throw new Error(errors.join('|'));
  const legs = Object.create(null) as Record<string, BundleLegProjection>;
  for (const leg of intent.legs) {
    legs[leg.legId] = { requestedUnits: leg.requestedUnits, confirmedUnits: '0',
      venueOrderId: null, venueTradeIds: Object.create(null) as Record<string, AtomicAmount>, status: 'PLANNED' };
  }
  return { bundleId: intent.bundleId, environment: intent.environment, accountId: intent.accountId,
    mode: intent.mode, state: 'PLANNED', version: 0, createdAt: now,
    lastEventAt: now, requiresReconciliation: false, canSubmit: false, canBlindRetry: false,
    legs, processedEvents: Object.create(null) as Record<string, string> };
}

/**
 * Read-only reducer. The persistence layer must append source-authenticated events
 * in the SAME database transaction as their canonical financial evidence.
 * Do not feed browser events to this function as execution authority.
 */
export function reduceBundle(current: Readonly<BundleProjection>, event: Readonly<BundleEvent>): BundleProjection {
  if (!validId(event.eventId) || !validTime(event.at) || event.at < current.createdAt)
    throw new Error('INVALID_EVENT_ID_OR_TIME');
  const fingerprint = JSON.stringify(event);
  const old = current.processedEvents[event.eventId];
  if (old !== undefined) {
    if (old !== fingerprint) throw new Error('EVENT_ID_CONFLICT');
    return current as BundleProjection;
  }
  if (event.at < current.lastEventAt) throw new Error('OUT_OF_ORDER_EVENT');
  const next: BundleProjection = {
    ...current, version: current.version + 1, lastEventAt: event.at,
    processedEvents: safeStateCopy(current.processedEvents),
    legs: safeStateCopy(current.legs), canSubmit: false, canBlindRetry: false,
  };
  (next.processedEvents as Record<string, string>)[event.eventId] = fingerprint;
  const onlyFrom = (...states: BundleState[]) => {
    if (!states.includes(current.state)) throw new Error('INVALID_BUNDLE_STATE_TRANSITION');
  };
  const cloneLeg = (legId: string): BundleLegProjection => {
    const found = next.legs[legId];
    if (!found) throw new Error('UNKNOWN_LEG_ID');
    const clone = { ...found, venueTradeIds: safeStateCopy(found.venueTradeIds) };
    (next.legs as Record<string, BundleLegProjection>)[legId] = clone;
    return clone;
  };
  switch (event.kind) {
    case 'RISK_APPROVED':
      onlyFrom('PLANNED'); next.state = 'RISK_APPROVED'; break;
    case 'RESERVATION_COMMITTED':
      onlyFrom('RISK_APPROVED'); next.state = 'RESERVED'; break;
    case 'SUBMISSION_STARTED':
      onlyFrom('RESERVED'); next.state = 'SUBMITTING'; break;
    case 'CANCEL_BEFORE_RESERVATION':
      onlyFrom('PLANNED', 'RISK_APPROVED'); next.state = 'CANCELLED'; break;
    case 'PAPER_ATOMIC_COMMITTED': {
      onlyFrom('SUBMITTING');
      if (next.mode !== 'PAPER_ATOMIC' || next.environment !== 'PAPER') throw new Error('NOT_PAPER_ATOMIC');
      if (event.committedOrderIds.length !== Object.keys(next.legs).length ||
          new Set(event.committedOrderIds).size !== event.committedOrderIds.length ||
          event.committedOrderIds.some(id => !validId(id))) throw new Error('INVALID_CANONICAL_ORDER_IDS');
      for (const [legId, leg] of Object.entries(next.legs)) {
        (next.legs as Record<string, BundleLegProjection>)[legId] = {
          ...leg, confirmedUnits: leg.requestedUnits, status: 'FILLED',
        };
      }
      // This event is only legal AFTER actual single-transaction OMS commit.
      next.state = 'FILLED'; break;
    }
    case 'LEG_ACK': {
      onlyFrom('SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED');
      if (next.mode === 'PAPER_ATOMIC') throw new Error('PAPER_ATOMIC_REQUIRES_SINGLE_COMMIT');
      if (!validId(event.venueOrderId)) throw new Error('INVALID_VENUE_ORDER_ID');
      const leg = cloneLeg(event.legId);
      if (leg.status === 'REJECTED' || leg.status === 'CANCELLED') throw new Error('TERMINAL_LEG');
      if (leg.venueOrderId && leg.venueOrderId !== event.venueOrderId) throw new Error('VENUE_ORDER_CONFLICT');
      leg.venueOrderId = event.venueOrderId;
      if (leg.status !== 'FILLED') leg.status = amount(leg.confirmedUnits) > 0n ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED';
      next.state = Object.values(next.legs).some(l => amount(l.confirmedUnits) > 0n)
        ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED';
      break;
    }
    case 'LEG_FILL': {
      onlyFrom('SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED');
      if (next.mode === 'PAPER_ATOMIC') throw new Error('PAPER_ATOMIC_REQUIRES_SINGLE_COMMIT');
      if (!validId(event.venueTradeId)) throw new Error('INVALID_VENUE_TRADE_ID');
      const leg = cloneLeg(event.legId);
      if (leg.status === 'REJECTED' || leg.status === 'CANCELLED') throw new Error('TERMINAL_LEG');
      const n = amount(event.quantityUnits);
      if (n <= 0n) throw new Error('INVALID_FILL_QUANTITY');
      if (leg.venueTradeIds[event.venueTradeId] !== undefined) {
        if (leg.venueTradeIds[event.venueTradeId] !== event.quantityUnits) throw new Error('TRADE_ID_CONFLICT');
        // Repeated venue fill under a different transport ID remains deduplicated.
        break;
      }
      const total = amount(leg.confirmedUnits) + n;
      if (total > amount(leg.requestedUnits)) throw new Error('OVERFILL_REQUIRES_RECONCILIATION');
      (leg.venueTradeIds as Record<string, string>)[event.venueTradeId] = event.quantityUnits;
      leg.confirmedUnits = total.toString();
      leg.status = total === amount(leg.requestedUnits) ? 'FILLED' : 'PARTIALLY_FILLED';
      next.state = Object.values(next.legs).every(l => l.status === 'FILLED') ? 'FILLED' : 'PARTIALLY_FILLED';
      break;
    }
    case 'LEG_UNCERTAIN': {
      onlyFrom('SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED');
      if (!event.reason.trim()) throw new Error('UNCERTAIN_REASON_REQUIRED');
      const leg = cloneLeg(event.legId);
      leg.status = 'UNKNOWN'; next.requiresReconciliation = true; next.state = 'UNKNOWN'; break;
    }
    case 'LEG_REJECTED': {
      onlyFrom('SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED');
      if (!event.reason.trim()) throw new Error('REJECTION_REASON_REQUIRED');
      const leg = cloneLeg(event.legId);
      if (amount(leg.confirmedUnits) > 0n) throw new Error('PARTIALLY_FILLED_LEG_CANNOT_BE_REJECTED_AS_EMPTY');
      leg.status = 'REJECTED'; next.requiresReconciliation = true; next.state = 'FAILED'; break;
    }
    case 'VERIFIED_RECONCILIATION': {
      onlyFrom('SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'UNKNOWN', 'FAILED', 'FILLED');
      if (event.verifiedLegs.length !== Object.keys(current.legs).length) throw new Error('RECONCILIATION_INCOMPLETE');
      const seen = new Set<string>();
      for (const verified of event.verifiedLegs) {
        if (seen.has(verified.legId)) throw new Error('RECONCILIATION_DUPLICATE_LEG');
        seen.add(verified.legId);
        const leg = cloneLeg(verified.legId);
        // Never synthesize an unrecorded fill from an order-status snapshot.
        if (amount(verified.confirmedUnits) !== amount(leg.confirmedUnits))
          throw new Error('VENUE_AND_LOCAL_FILL_MISMATCH');
        if (verified.finalStatus === 'FILLED' && amount(leg.confirmedUnits) !== amount(leg.requestedUnits))
          throw new Error('FILLED_STATUS_WITHOUT_ALL_TRADES');
        leg.status = verified.finalStatus === 'CANCELLED' ? 'CANCELLED'
          : verified.finalStatus === 'REJECTED' ? 'REJECTED' : 'FILLED';
      }
      next.requiresReconciliation = false; next.state = 'RECONCILED'; break;
    }
    default: {
      const unreachable: never = event;
      throw new Error('UNSUPPORTED_EVENT: ' + JSON.stringify(unreachable));
    }
  }
  return next;
}

/**
 * Future integration boundaries (INTERFACES ONLY). Do not implement these here.
 * Reservation uniqueness and version checks MUST be enforced transactionally in DB.
 */
export interface CanonicalBundlePorts {
  authoritativePreflight(intent: BundleIntent): Promise<BundleEvidence>;
  /** UNIQUE(environment,account,idempotencyKey) plus stable child client order IDs. */
  durableReserve(intent: BundleIntent, preflight: BundlePreflight): Promise<{ created: boolean; reservationId: string }>;
  /** Must be part of canonical db.ts transaction; rollback every leg and fee on failure. */
  paperAtomicCommit?(intent: BundleIntent, reservationId: string): Promise<readonly string[]>;
  /** TESTNET/LIVE adapters must be separately certified; no default implementation. */
  readOrderStatus?(intent: BundleIntent): Promise<unknown>;
}