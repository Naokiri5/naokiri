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
  /** Venue time of the observation. A fresh receipt alone does not refresh old evidence. */
  exchangeEventAtMs: number;
  receivedAtMs: number;
}
type VenueInstrumentScope = Pick<TrackedOrderEvidence, 'venue' | 'accountId' | 'instrumentId'>;
export interface VenueQuantityPrecision extends VenueInstrumentScope {
  decimals: number;
}
export interface ReconciliationOptions {
  nowMs: number;
  maxEvidenceAgeMs: number;
  /** Explicit precision for each venue, account and instrument. Takes precedence over legacy keys. */
  quantityPrecisions?: readonly VenueQuantityPrecision[];
  /** Legacy `venue:accountId:instrumentId` keys require one scope across configuration and evidence. */
  quantityDecimalsByInstrument?: Readonly<Record<string, number>>;
  coverage: 'PARTIAL' | 'OPEN_ORDERS_ONLY' | 'COMPLETE_ORDERS_AND_FILLS';
}
export type ReconciliationReasonCode =
  | 'INCOMPLETE_COVERAGE' | 'INVALID_CONFIGURATION' | 'INVALID_ORDER_IDENTITY'
  | 'INVALID_QUANTITY' | 'INVALID_STATE' | 'EVIDENCE_STALE_OR_FUTURE'
  | 'DUPLICATE_EVENT_CONFLICT' | 'CONFLICTING_ORDER_OBSERVATIONS'
  | 'DUPLICATE_LOCAL_ORDER' | 'UNKNOWN_VENUE_ORDER'
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
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const isPrecision = (decimals: number) => Number.isInteger(decimals) && decimals >= 0 && decimals <= 18;
const scopeFields = (scope: VenueInstrumentScope) => [scope.venue, scope.accountId, scope.instrumentId];
function orderKey(o: TrackedOrderEvidence): string | undefined {
  const fields = [...scopeFields(o), o.clientOrderId];
  if (fields.every(isId)) return JSON.stringify(fields);
}
function createPrecisionLookup(
  options: ReconciliationOptions,
  local: readonly TrackedOrderEvidence[],
  remote: readonly VenueOrderEvidence[],
  flagInvalid: (detail: string) => void,
): (scope: VenueInstrumentScope) => number | null | undefined {
  const explicit = new Map<string, number | null>();
  const legacy = options.quantityDecimalsByInstrument ?? {};
  const legacyClaims = new Map<string, string | null>();
  const claim = (fields: readonly string[], key: string) => {
    const legacyKey = fields.join(':');
    if (!Object.hasOwn(legacy, legacyKey)) return;
    const previous = legacyClaims.get(legacyKey);
    legacyClaims.set(legacyKey, previous === undefined || previous === key ? key : null);
  };
  for (const precision of options.quantityPrecisions ?? []) {
    const fields = scopeFields(precision);
    if (!fields.every(isId)) {
      flagInvalid('Quantity precision has an invalid venue, account or instrument identifier');
      continue;
    }
    const key = JSON.stringify(fields);
    claim(fields, key);
    if (explicit.has(key) || !isPrecision(precision.decimals)) {
      explicit.set(key, null);
      flagInvalid('Each venue, account and instrument requires one quantity precision within 0–18 decimals');
    } else {
      explicit.set(key, precision.decimals);
    }
  }
  // Collect all claims before validating evidence so order cannot decide which scope borrows a key.
  for (const orders of [local, remote]) {
    for (const order of orders) {
      const fields = scopeFields(order);
      if (fields.every(isId)) claim(fields, JSON.stringify(fields));
    }
  }
  return scope => {
    const fields = scopeFields(scope);
    const key = JSON.stringify(fields);
    const precision = explicit.get(key);
    if (precision !== undefined) return precision;
    const legacyKey = fields.join(':');
    const legacyClaim = legacyClaims.get(legacyKey);
    if (legacyClaim === null) return null;
    return legacyClaim === key ? legacy[legacyKey] : undefined;
  };
}
/** Exact decimal conversion: no JS floating point for quantity comparison. */
export function exactQuantityUnits(value: string, decimals: number): bigint | null {
  if (!isPrecision(decimals)) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,35})(?:\.\d{1,18})?$/.test(value))
    return null;
  const parts = value.split('.');
  const frac = parts[1] ?? '';
  if (frac.length > decimals) return null;
  return BigInt(parts[0]) * 10n ** BigInt(decimals) +
    BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
function equivalent(a: VenueOrderEvidence, b: VenueOrderEvidence, scale: number) {
  return a.venue === b.venue && a.accountId === b.accountId &&
    a.instrumentId === b.instrumentId && a.clientOrderId === b.clientOrderId &&
    a.exchangeOrderId === b.exchangeOrderId && a.state === b.state &&
    exactQuantityUnits(a.requestedQty, scale) === exactQuantityUnits(b.requestedQty, scale) &&
    exactQuantityUnits(a.cumulativeFilledQty, scale) === exactQuantityUnits(b.cumulativeFilledQty, scale) &&
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
  const precisionFor = createPrecisionLookup(options, local, remote, detail => flag('INVALID_CONFIGURATION', detail));
  const locals = new Map<string, TrackedOrderEvidence>();
  const events = new Map<string, VenueOrderEvidence>();
  const newest = new Map<string, { observation: VenueOrderEvidence; scale: number; conflicting: boolean }>();
  const validate = (o: TrackedOrderEvidence, kind: string, key: string | undefined) => {
    if (key === undefined) {
      flag('INVALID_ORDER_IDENTITY', kind + ' has invalid identity');
      return;
    }
    if (!STATES.has(o.state)) flag('INVALID_STATE', kind + ' has unknown status', key);
    const precision = precisionFor(o);
    if (precision === null) {
      flag('INVALID_CONFIGURATION', kind + ' has ambiguous or invalid quantity precision for this scope', key);
      return;
    }
    const scale = precision ?? Number.NaN;
    const qty = exactQuantityUnits(o.requestedQty, scale);
    const fill = exactQuantityUnits(o.cumulativeFilledQty, scale);
    if (qty === null || qty <= 0n || fill === null || fill < 0n || fill > qty) {
      flag('INVALID_QUANTITY', kind + ' has invalid quantity', key);
      return;
    }
    if ((o.state === 'FILLED' && fill !== qty) ||
        (o.state === 'PARTIAL_FILL' && (fill === 0n || fill === qty))) {
      flag('INVALID_STATE', kind + ' status conflicts with its cumulative filled quantity', key);
      return;
    }
    if (STATES.has(o.state)) return { key, scale };
  };
  for (const o of local) {
    const validated = validate(o, 'LOCAL', orderKey(o));
    if (!validated) continue;
    const { key } = validated;
    if (locals.has(key)) flag('DUPLICATE_LOCAL_ORDER', 'Duplicate client order', key);
    else locals.set(key, o);
  }
  for (const o of remote) {
    const candidateKey = orderKey(o);
    const validated = validate(o, 'REMOTE', candidateKey);
    const validEventId = isId(o.eventId);
    if (!validEventId)
      flag('INVALID_ORDER_IDENTITY', 'Missing/invalid remote event ID', candidateKey);
    if (!Number.isSafeInteger(o.receivedAtMs) ||
        !Number.isSafeInteger(o.exchangeEventAtMs) ||
        o.exchangeEventAtMs < 0 ||
        o.exchangeEventAtMs > o.receivedAtMs ||
        o.receivedAtMs > options.nowMs ||
        options.nowMs - o.exchangeEventAtMs > options.maxEvidenceAgeMs)
      flag('EVIDENCE_STALE_OR_FUTURE', 'Bad remote evidence timestamp', candidateKey);
    if (!validated || !validEventId) continue;
    const { key, scale } = validated;
    const eid = JSON.stringify([o.venue, o.accountId, o.eventId]);
    const previous = events.get(eid);
    if (previous && !equivalent(previous, o, scale))
      flag('DUPLICATE_EVENT_CONFLICT', 'Event ID has conflicting values', key);
    else events.set(eid, o);
    const prev = newest.get(key);
    if (!prev || o.exchangeEventAtMs > prev.observation.exchangeEventAtMs) {
      newest.set(key, { observation: o, scale, conflicting: false });
    } else if (o.exchangeEventAtMs === prev.observation.exchangeEventAtMs && !equivalent(prev.observation, o, scale)) {
      // A later receipt cannot settle conflicting evidence with the same venue timestamp.
      prev.conflicting = true;
    }
  }
  for (const [key, { observation, scale, conflicting }] of newest) {
    if (conflicting)
      flag('CONFLICTING_ORDER_OBSERVATIONS', 'Latest venue observations share a timestamp but report different order values', key);
    const tracked = locals.get(key);
    if (!tracked) {
      flag('UNKNOWN_VENUE_ORDER', 'Exchange order is not tracked locally', key);
      continue;
    }
    if (conflicting) continue;
    if (tracked.exchangeOrderId !== null && tracked.exchangeOrderId !== observation.exchangeOrderId)
      flag('EXCHANGE_ID_CONFLICT', 'Exchange evidence does not confirm the known order identifier', key);
    if (exactQuantityUnits(tracked.requestedQty, scale) !==
        exactQuantityUnits(observation.requestedQty, scale))
      flag('REQUESTED_QTY_MISMATCH', 'Requested quantities differ', key);
    if (exactQuantityUnits(tracked.cumulativeFilledQty, scale) !==
        exactQuantityUnits(observation.cumulativeFilledQty, scale))
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
