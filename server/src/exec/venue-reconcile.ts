/**
 * Pure venue evidence assessment; research only.
 * Not an OMS, venue client, release gate, signer or ledger.
 * No imports from exec/oms, risk/mode, wallets or network.
 */
export type VenueId = 'BINANCE_FUTURES' | 'BINANCE_SPOT' | 'BYBIT_LINEAR' | 'BYBIT_SPOT';
export type VenueOrderState = 'ACK' | 'PARTIAL_FILL' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';

export interface TrackedOrderEvidence {
  venue: VenueId;
  accountId: string;
  instrumentId: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  state: VenueOrderState;
  requestedQty: string;
  cumulativeFilledQty: string;
}
export interface VenueOrderEvidence extends TrackedOrderEvidence {
  source: 'PRIVATE_WS' | 'REST_RECOVERY';
  eventId: string;
  exchangeEventAtMs: number;
  receivedAtMs: number;
}
export interface ReconciliationOptions {
  nowMs: number;
  maxEvidenceAgeMs: number;
  quantityDecimalsByInstrument: Readonly<Record<string, number>>;
  coverage: 'PARTIAL' | 'OPEN_ORDERS_ONLY' | 'COMPLETE_ORDERS_AND_FILLS';
}
export type ReconciliationReasonCode =
  | 'INCOMPLETE_COVERAGE' | 'INVALID_CONFIGURATION' | 'INVALID_ORDER_IDENTITY'
  | 'INVALID_QUANTITY' | 'INVALID_STATE' | 'EVIDENCE_STALE_OR_FUTURE'
  | 'DUPLICATE_EVENT_CONFLICT' | 'DUPLICATE_LOCAL_ORDER' | 'UNKNOWN_VENUE_ORDER'
  | 'MISSING_VENUE_ORDER' | 'EXCHANGE_ID_CONFLICT' | 'REQUESTED_QTY_MISMATCH'
  | 'CUMULATIVE_FILL_MISMATCH' | 'VENUE_STATE_MISMATCH';
export interface ReconciliationFinding {
  code: ReconciliationReasonCode;
  orderKey?: string;
  detail: string;
}
export interface ReconciliationAssessment {
  status: 'CONSISTENT' | 'ATTENTION_REQUIRED';
  readonly findings: readonly ReconciliationFinding[];
  readonly observedOrders: number;
  readonly localOrders: number;
  readonly canSendOrders: false;
}
const STATES = new Set<VenueOrderState>([
  'ACK', 'PARTIAL_FILL', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED',
]);
const ID = /^[A-Za-z0-9_.:/-]{1,128}$/;
const instrumentKey = (o: TrackedOrderEvidence) =>
  o.venue + ':' + o.accountId + ':' + o.instrumentId;
const orderKey = (o: TrackedOrderEvidence) =>
  instrumentKey(o) + ':' + o.clientOrderId;
/** Exact decimal conversion: no JS floating point for quantity comparison. */
export function exactQuantityUnits(value: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,35})(?:\.\d{1,18})?$/.test(value))
    return null;
  const parts = value.split('.');
  const frac = parts[1] ?? '';
  if (frac.length > decimals) return null;
  return BigInt(parts[0]) * 10n ** BigInt(decimals) +
    BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
function equivalent(a: VenueOrderEvidence, b: VenueOrderEvidence) {
  return a.venue === b.venue && a.accountId === b.accountId &&
    a.instrumentId === b.instrumentId && a.clientOrderId === b.clientOrderId &&
    a.exchangeOrderId === b.exchangeOrderId && a.state === b.state &&
    a.requestedQty === b.requestedQty &&
    a.cumulativeFilledQty === b.cumulativeFilledQty &&
    a.exchangeEventAtMs === b.exchangeEventAtMs;
}
/**
 * Checks evidence only. No state mutation, synthetic rejection, order retry or
 * live unlock. COMPLETE_ORDERS_AND_FILLS must itself be independently proven.
 */
export function assessVenueReconciliation(
  local: readonly TrackedOrderEvidence[],
  remote: readonly VenueOrderEvidence[],
  options: ReconciliationOptions,
): ReconciliationAssessment {
  const findings: ReconciliationFinding[] = [];
  const flag = (code: ReconciliationReasonCode, detail: string, key?: string) =>
    findings.push({ code, detail, ...(key ? { orderKey: key } : {}) });
  if (options.coverage !== 'COMPLETE_ORDERS_AND_FILLS')
    flag('INCOMPLETE_COVERAGE', 'Partial/open-orders snapshots do not establish final order state');
  if (!Number.isSafeInteger(options.nowMs) || options.nowMs < 0 ||
      !Number.isSafeInteger(options.maxEvidenceAgeMs) || options.maxEvidenceAgeMs <= 0)
    flag('INVALID_CONFIGURATION', 'Invalid clock or evidence age limit');
  const locals = new Map<string, TrackedOrderEvidence>();
  const events = new Map<string, VenueOrderEvidence>();
  const newest = new Map<string, VenueOrderEvidence>();
  const valid = (o: TrackedOrderEvidence, kind: string) => {
    const key = orderKey(o);
    if (![o.venue, o.accountId, o.instrumentId, o.clientOrderId].every(
      s => typeof s === 'string' && ID.test(s)
    )) { flag('INVALID_ORDER_IDENTITY', kind + ' has invalid identity'); return false; }
    if (!STATES.has(o.state)) flag('INVALID_STATE', kind + ' has unknown status', key);
    const scale = options.quantityDecimalsByInstrument[instrumentKey(o)];
    const qty = exactQuantityUnits(o.requestedQty, scale);
    const fill = exactQuantityUnits(o.cumulativeFilledQty, scale);
    if (qty === null || qty <= 0n || fill === null || fill < 0n || fill > qty)
      flag('INVALID_QUANTITY', kind + ' has invalid quantity', key);
    return STATES.has(o.state) && qty !== null && qty > 0n && fill !== null && fill <= qty;
  };
  for (const o of local) {
    if (!valid(o, 'LOCAL')) continue;
    const key = orderKey(o);
    if (locals.has(key)) flag('DUPLICATE_LOCAL_ORDER', 'Duplicate client order', key);
    else locals.set(key, o);
  }
  for (const o of remote) {
    const good = valid(o, 'REMOTE');
    const key = orderKey(o);
    if (typeof o.eventId !== 'string' || !ID.test(o.eventId))
      flag('INVALID_ORDER_IDENTITY', 'Missing/invalid remote event ID', key);
    if (!Number.isSafeInteger(o.receivedAtMs) ||
        !Number.isSafeInteger(o.exchangeEventAtMs) ||
        o.exchangeEventAtMs > o.receivedAtMs ||
        o.receivedAtMs > options.nowMs ||
        options.nowMs - o.receivedAtMs > options.maxEvidenceAgeMs)
      flag('EVIDENCE_STALE_OR_FUTURE', 'Bad remote evidence timestamp', key);
    if (!good || typeof o.eventId !== 'string' || !ID.test(o.eventId)) continue;
    const eid = o.venue + ':' + o.accountId + ':' + o.eventId;
    const previous = events.get(eid);
    if (previous && !equivalent(previous, o))
      flag('DUPLICATE_EVENT_CONFLICT', 'Event ID has conflicting values', key);
    else events.set(eid, o);
    const prev = newest.get(key);
    if (!prev || o.exchangeEventAtMs > prev.exchangeEventAtMs ||
        (o.exchangeEventAtMs === prev.exchangeEventAtMs &&
         o.receivedAtMs > prev.receivedAtMs)) newest.set(key, o);
  }
  for (const [key, observation] of newest) {
    const tracked = locals.get(key);
    if (!tracked) {
      flag('UNKNOWN_VENUE_ORDER', 'Exchange order is not tracked locally', key);
      continue;
    }
    if (tracked.exchangeOrderId && observation.exchangeOrderId &&
        tracked.exchangeOrderId !== observation.exchangeOrderId)
      flag('EXCHANGE_ID_CONFLICT', 'Exchange order identifiers differ', key);
    const decimals = options.quantityDecimalsByInstrument[instrumentKey(observation)];
    if (exactQuantityUnits(tracked.requestedQty, decimals) !==
        exactQuantityUnits(observation.requestedQty, decimals))
      flag('REQUESTED_QTY_MISMATCH', 'Requested quantities differ', key);
    if (exactQuantityUnits(tracked.cumulativeFilledQty, decimals) !==
        exactQuantityUnits(observation.cumulativeFilledQty, decimals))
      flag('CUMULATIVE_FILL_MISMATCH', 'Cumulative fills differ', key);
    if (tracked.state !== observation.state)
      flag('VENUE_STATE_MISMATCH', 'Order statuses differ', key);
  }
  for (const key of locals.keys())
    if (!newest.has(key)) flag('MISSING_VENUE_ORDER', 'Exchange evidence missing', key);
  return {
    status: findings.length ? 'ATTENTION_REQUIRED' : 'CONSISTENT',
    findings, observedOrders: newest.size, localOrders: locals.size, canSendOrders: false,
  };
}
