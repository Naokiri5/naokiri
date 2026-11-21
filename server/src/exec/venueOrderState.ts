/**
 * MIA 5.0 — PURE exchange-order observation reducer (non-executing).
 *
 * Extends the future asynchronous execution contract WITHOUT creating a
 * second OMS or financial ledger. A future venue adapter must atomically
 * persist intent and state events and independently reconcile REST + trades.
 *
 * No fetch, exchange credential, signer, ORDER POST or authorization exists
 * here. In-memory state is NOT durable: consumers must write an append-only
 * journal before any external side effect. Amounts are integer atomic units
 * (decimal strings), never JS floating-point money.
 *
 * Inspired conceptually by NautilusTrader venue reconciliation and Hummingbot
 * in-flight order tracking; no external source code is copied.
 */
import type { TradingEnvironment } from './environment.js';

export type TrackedEnvironment = Exclude<TradingEnvironment, 'PAPER'>;
export type OrderPhase =
  | 'INTENT_RECORDED'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNKNOWN';
export type VenueTerminalStatus = 'CANCELED' | 'REJECTED' | 'EXPIRED';
export type VenueObservedStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | VenueTerminalStatus;

export interface VenueOrderScope {
  environment: TrackedEnvironment;
  accountId: string;
  venueId: string;
  clientOrderId: string;
}
export interface VenueOrderIntent {
  scope: VenueOrderScope;
  instrumentId: string;
  side: 'BUY' | 'SELL';
  requestedUnits: string;
  recordedAt: number;
}
interface EventBase {
  scope: VenueOrderScope;
  eventId: string;
  at: number;
}
export type VenueOrderEvent =
  | (EventBase & { kind: 'ACK'; venueOrderId: string })
  | (EventBase & { kind: 'FILL'; venueTradeId: string; quantityUnits: string })
  | (EventBase & { kind: 'UNCERTAIN'; reason: 'TIMEOUT' | 'CONNECTION_LOST' | 'VENUE_5XX' })
  | (EventBase & {
    kind: 'STATUS';
    source: 'STREAM' | 'REST_AND_TRADES';
    venueStatus: VenueObservedStatus;
    cumulativeUnits: string;
    venueOrderId: string;
  });
export interface VenueOrderProjection {
  scope: VenueOrderScope;
  instrumentId: string;
  side: 'BUY' | 'SELL';
  phase: OrderPhase;
  requestedUnits: string;
  confirmedFillUnits: string;
  venueOrderId: string | null;
  fillsByTradeId: Readonly<Record<string, string>>;
  /** eventId -> canonical event JSON, used for collision-aware deduplication */
  processedEvents: Readonly<Record<string, string>>;
  recordedAt: number;
  lastEventAt: number;
  version: number;
  reconciliationRequired: boolean;
  /** A consumer may never reuse an uncertain network outcome as retry permission. */
  canRetryOriginalOrder: false;
  canAuthorizeTrade: false;
}

const ID = /^[A-Za-z0-9:_-]{1,80}$/;
const UINT = /^(?:0|[1-9][0-9]{0,39})$/;
const FINAL = new Set<OrderPhase>(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
const asUnits = (v: string, allowZero: boolean): bigint => {
  if (typeof v !== 'string' || !UINT.test(v)) throw new Error('INVALID_ATOMIC_UNITS');
  const n = BigInt(v);
  if (!allowZero && n === 0n) throw new Error('ZERO_ORDER_QUANTITY');
  return n;
};
function safeId(value: string, name: string) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('INVALID_' + name);
}
function validateScope(scope: VenueOrderScope) {
  if (scope.environment !== 'TESTNET' && scope.environment !== 'LIVE')
    throw new Error('PAPER_OMS_MUST_NOT_USE_VENUE_TRACKER');
  safeId(scope.accountId, 'ACCOUNT');
  safeId(scope.venueId, 'VENUE');
  safeId(scope.clientOrderId, 'CLIENT_ORDER_ID');
}
function scopeMatches(a: VenueOrderScope, b: VenueOrderScope) {
  return a.environment === b.environment &&
    a.accountId === b.accountId && a.venueId === b.venueId &&
    a.clientOrderId === b.clientOrderId;
}

export function newVenueOrderProjection(intent: VenueOrderIntent): VenueOrderProjection {
  validateScope(intent.scope);
  safeId(intent.instrumentId, 'INSTRUMENT');
  asUnits(intent.requestedUnits, false);
  if (!Number.isSafeInteger(intent.recordedAt) || intent.recordedAt <= 0)
    throw new Error('INVALID_INTENT_TIME');
  return {
    scope: { ...intent.scope }, instrumentId: intent.instrumentId, side: intent.side,
    phase: 'INTENT_RECORDED', requestedUnits: intent.requestedUnits,
    confirmedFillUnits: '0', venueOrderId: null,
    fillsByTradeId: {}, processedEvents: {}, recordedAt: intent.recordedAt,
    lastEventAt: intent.recordedAt, version: 0, reconciliationRequired: false,
    canRetryOriginalOrder: false, canAuthorizeTrade: false,
  };
}

/**
 * Converts one observed event into a new immutable projection.
 * A venue status with cumulative quantity ahead of confirmed trade receipts
 * is UNKNOWN; it NEVER synthesizes a fill or invents ledger entries.
 * Only REST_AND_TRADES evidence may clear an UNKNOWN outcome.
 */
export function reduceVenueOrder(
  current: Readonly<VenueOrderProjection>, event: Readonly<VenueOrderEvent>,
): VenueOrderProjection {
  if (!scopeMatches(current.scope, event.scope)) throw new Error('ORDER_SCOPE_MISMATCH');
  safeId(event.eventId, 'EVENT_ID');
  if (!Number.isSafeInteger(event.at) || event.at < current.recordedAt)
    throw new Error('INVALID_EVENT_TIME');
  const fingerprint = JSON.stringify(event);
  const previous = current.processedEvents[event.eventId];
  if (previous !== undefined) {
    if (previous !== fingerprint) throw new Error('EVENT_ID_COLLISION');
    return current as VenueOrderProjection;
  }
  if (event.at < current.lastEventAt) throw new Error('OUT_OF_ORDER_EVENT_RECONCILIATION_REQUIRED');
  if (FINAL.has(current.phase) && event.kind !== 'STATUS')
    throw new Error('TERMINAL_ORDER_REQUIRES_EXPLICIT_RECONCILIATION');

  const next: VenueOrderProjection = {
    ...current, scope: { ...current.scope },
    fillsByTradeId: { ...current.fillsByTradeId },
    processedEvents: { ...current.processedEvents, [event.eventId]: fingerprint },
    version: current.version + 1, lastEventAt: event.at,
    // Any new evidence cannot itself confer trading permission or retry safety.
    canRetryOriginalOrder: false, canAuthorizeTrade: false,
  };

  if (event.kind === 'ACK') {
    safeId(event.venueOrderId, 'VENUE_ORDER_ID');
    if (next.venueOrderId && next.venueOrderId !== event.venueOrderId)
      throw new Error('VENUE_ORDER_ID_CONFLICT');
    next.venueOrderId = event.venueOrderId;
    if (current.phase !== 'UNKNOWN') {
      next.phase = asUnits(next.confirmedFillUnits, true) > 0n
        ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED';
    } else {
      next.reconciliationRequired = true;
    }
  } else if (event.kind === 'UNCERTAIN') {
    if (FINAL.has(current.phase)) throw new Error('CANNOT_UNCERTAIN_TERMINAL_ORDER');
    next.phase = 'UNKNOWN';
    next.reconciliationRequired = true;
  } else if (event.kind === 'FILL') {
    safeId(event.venueTradeId, 'VENUE_TRADE_ID');
    const prior = next.fillsByTradeId[event.venueTradeId];
    if (prior !== undefined) {
      if (prior !== event.quantityUnits) throw new Error('TRADE_ID_CONFLICT');
      return { ...next, reconciliationRequired: current.reconciliationRequired };
    }
    const addition = asUnits(event.quantityUnits, false);
    const filled = asUnits(next.confirmedFillUnits, true) + addition;
    if (filled > asUnits(next.requestedUnits, false)) throw new Error('OVERFILL_DETECTED');
    (next.fillsByTradeId as Record<string, string>)[event.venueTradeId] = event.quantityUnits;
    next.confirmedFillUnits = filled.toString();
    next.phase = filled === asUnits(next.requestedUnits, false) ? 'FILLED' :
      current.phase === 'UNKNOWN' ? 'UNKNOWN' : 'PARTIALLY_FILLED';
    next.reconciliationRequired = current.reconciliationRequired || !next.venueOrderId;
  } else if (event.kind === 'STATUS') {
    safeId(event.venueOrderId, 'VENUE_ORDER_ID');
    if (next.venueOrderId && next.venueOrderId !== event.venueOrderId)
      throw new Error('VENUE_ORDER_ID_CONFLICT');
    next.venueOrderId = event.venueOrderId;
    const observed = asUnits(event.cumulativeUnits, true);
    const known = asUnits(next.confirmedFillUnits, true);
    const requested = asUnits(next.requestedUnits, false);
    if (observed > requested || observed < known) throw new Error('VENUE_QUANTITY_CONFLICT');
    // Missing per-trade execution IDs make even a FILLED status insufficient
    // to post financial ledger entries; reconcile the missing venue trades.
    if (observed !== known) {
      next.phase = 'UNKNOWN';
      next.reconciliationRequired = true;
    } else if (event.source === 'STREAM' && current.phase === 'UNKNOWN') {
      next.phase = 'UNKNOWN';
      next.reconciliationRequired = true;
    } else if (event.venueStatus === 'FILLED') {
      if (known !== requested) {
        next.phase = 'UNKNOWN'; next.reconciliationRequired = true;
      } else {
        next.phase = 'FILLED'; next.reconciliationRequired = false;
      }
    } else if (event.venueStatus === 'PARTIALLY_FILLED') {
      next.phase = 'PARTIALLY_FILLED';
      next.reconciliationRequired = false;
    } else if (event.venueStatus === 'NEW') {
      next.phase = known ? 'PARTIALLY_FILLED' : 'ACKNOWLEDGED';
      next.reconciliationRequired = false;
    } else {
      // CANCELED/EXPIRED may have already filled partially; never erase fills.
      if (event.venueStatus === 'REJECTED' && known > 0n)
        throw new Error('REJECTED_ORDER_HAS_CONFIRMED_FILLS');
      next.phase = event.venueStatus;
      next.reconciliationRequired = false;
    }
  }
  return next;
}
