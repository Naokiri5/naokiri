/**
 * MIA PAPER bundle lifecycle projection.
 *
 * READ ONLY. The canonical orders, fills, positions, stops and ledger remain
 * authoritative. This module does not submit, close, reserve, or sign orders.
 * "FILLED" in bundle_executions refers to entry commit, not position closure.
 *
 * A simulated/OMS-monitored stop is NOT exchange-native protection. This
 * projection checks records, not fresh executable market depth.
 */
import { all, get } from '../../db/db.js';
import { PAPER_ACCOUNT } from '../../portfolio/ledger.js';

interface BundleRow {
  id: string;
  environment: string;
  account: string;
  mode: string;
  status: 'RESERVED' | 'FILLED';
  created_at: number;
  committed_at: number | null;
}
interface BundleLink {
  leg_index: number;
  decision_id: string;
  order_id: string;
}
interface EntryRow {
  id: string;
  client_order_id: string;
  account: string;
  venue: string;
  instrument: string;
  side: string;
  purpose: string;
  status: string;
  qty: number;
  filled_qty: number;
  avg_price: number | null;
  fees: number;
  position_id: string | null;
  updated_at: number;
}
interface PositionRow {
  id: string;
  account: string;
  status: string;
  qty: number;
  stop_price: number;
  realized_pnl: number;
  closed_at: number | null;
}
interface StopRow { qty: number; stop_price: number; status: string }

export type BundlePhase =
  | 'OPEN'
  | 'PARTIALLY_CLOSED'
  | 'CLOSED'
  | 'RECONCILIATION_REQUIRED';

export interface BundleLegStatus {
  index: number;
  decisionId: string;
  orderId: string;
  clientOrderId: string | null;
  instrumentId: string | null;
  entryStatus: string | null;
  entryFilledQuantity: number | null;
  entryPrice: number | null;
  entryFees: number | null;
  positionId: string | null;
  positionStatus: string | null;
  remainingQuantity: number | null;
  realizedPnl: number | null;
  protectiveStopRecorded: boolean;
  protection: 'OMS_MONITORED_NOT_EXCHANGE_NATIVE' | 'NOT_APPLICABLE' | 'MISSING_OR_MISMATCHED';
  issues: string[];
}

export interface BundleStatus {
  bundleId: string;
  environment: 'PAPER';
  accountId: string;
  mode: 'PAPER_ATOMIC';
  /** Persisted entry-commit state; it is NOT the position lifecycle. */
  entryState: BundleRow['status'];
  phase: BundlePhase;
  health: 'CONSISTENT' | 'NEEDS_ATTENTION';
  issues: string[];
  createdAt: number;
  committedAt: number | null;
  counts: {
    legs: number;
    entryFilled: number;
    positionsOpen: number;
    positionsClosed: number;
  };
  observedEntryNotional: number;
  observedEntryFees: number;
  observedRealizedPnl: number;
  legs: BundleLegStatus[];
  readOnly: true;
  canPlaceRealOrders: false;
}

const closeEnough = (a: number, b: number) =>
  Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-8);

function inspectLeg(link: BundleLink, account: string): BundleLegStatus {
  const issues: string[] = [];
  const o = get<EntryRow>(
    "SELECT id,client_order_id,account,venue,instrument,side,purpose,status,qty,filled_qty,avg_price,fees,position_id,updated_at FROM orders WHERE id=? AND account=?",
    link.order_id, account,
  );
  if (!o || o.purpose !== 'ENTRY' || o.side !== 'BUY' || o.venue !== 'binance-paper' ||
      o.status !== 'FILLED' || !Number.isFinite(o.filled_qty) || o.filled_qty <= 0 ||
      !Number.isFinite(o.avg_price) || !(o.avg_price! > 0)) {
    issues.push('CANONICAL_ENTRY_MISSING_OR_INVALID');
  }
  const fill = get<{ count: number; filledQty: number; fees: number }>(
    'SELECT COUNT(*) count, COALESCE(SUM(qty),0) filledQty, COALESCE(SUM(fee),0) fees FROM fills WHERE order_id=?',
    link.order_id,
  )!;
  if (o && (fill.count < 1 || !closeEnough(fill.filledQty, o.filled_qty) || !closeEnough(fill.fees, o.fees)))
    issues.push('ENTRY_FILL_RECONCILIATION_MISMATCH');
  const position = o?.position_id ? get<PositionRow>(
    'SELECT id,account,status,qty,stop_price,realized_pnl,closed_at FROM positions WHERE id=? AND account=?',
    o.position_id, account,
  ) : undefined;
  if (!position || !['OPEN','CLOSED'].includes(position.status))
    issues.push('POSITION_MISSING_OR_INVALID');
  const stop = position ? get<StopRow>(
    "SELECT qty,stop_price,status FROM orders WHERE position_id=? AND account=? AND purpose='PROTECTIVE_STOP' ORDER BY created_at DESC LIMIT 1",
    position.id, account,
  ) : undefined;
  const stopMatches = !!position && position.status === 'OPEN' && !!stop &&
    stop.status === 'ACTIVE' && closeEnough(stop.qty, position.qty) &&
    closeEnough(stop.stop_price, position.stop_price);
  const activeIncident = position && position.status === 'OPEN'
    ? get<{ id: string }>(
      "SELECT id FROM protection_incidents WHERE position_id=? AND status='OPEN' LIMIT 1",
      position.id,
    ) : undefined;
  if (position?.status === 'OPEN' && !stopMatches)
    issues.push('PAPER_PROTECTIVE_STOP_MISSING_OR_MISMATCHED');
  if (activeIncident) issues.push('PROTECTION_INCIDENT_OPEN');
  if (position?.status === 'CLOSED' && stop?.status === 'ACTIVE')
    issues.push('CLOSED_POSITION_HAS_ACTIVE_STOP');
  return {
    index: link.leg_index,
    decisionId: link.decision_id,
    orderId: link.order_id,
    clientOrderId: o?.client_order_id ?? null,
    instrumentId: o?.instrument ?? null,
    entryStatus: o?.status ?? null,
    entryFilledQuantity: o?.filled_qty ?? null,
    entryPrice: o?.avg_price ?? null,
    entryFees: o?.fees ?? null,
    positionId: position?.id ?? null,
    positionStatus: position?.status ?? null,
    remainingQuantity: position?.qty ?? null,
    realizedPnl: position?.realized_pnl ?? null,
    protectiveStopRecorded: stopMatches,
    protection: position?.status === 'CLOSED' ? 'NOT_APPLICABLE'
      : stopMatches ? 'OMS_MONITORED_NOT_EXCHANGE_NATIVE' : 'MISSING_OR_MISMATCHED',
    issues,
  };
}

/** Read a single previously committed PAPER bundle, scoped to MIA's canonical PAPER account. */
export function getBundleStatus(bundleId: string): BundleStatus | null {
  const row = get<BundleRow>(
    "SELECT id,environment,account,mode,status,created_at,committed_at FROM bundle_executions WHERE id=? AND account=? AND environment='PAPER' AND mode='PAPER_ATOMIC'",
    bundleId, PAPER_ACCOUNT,
  );
  if (!row) return null;
  const links = all<BundleLink>(
    'SELECT leg_index,decision_id,order_id FROM bundle_entry_links WHERE bundle_id=? ORDER BY leg_index',
    row.id,
  );
  const legs = links.map(l => inspectLeg(l, row.account));
  const issues = legs.flatMap(l => l.issues.map(code => 'LEG_' + l.index + ':' + code));
  if (row.status !== 'FILLED' || !row.committed_at)
    issues.push('BUNDLE_ENTRY_NOT_COMMITTED');
  if (legs.length < 2 || legs.length > 5 || links.some((l, i) => l.leg_index !== i))
    issues.push('BUNDLE_LINKS_INCOMPLETE');
  const entryFilled = legs.filter(l => l.entryStatus === 'FILLED').length;
  const positionsOpen = legs.filter(l => l.positionStatus === 'OPEN').length;
  const positionsClosed = legs.filter(l => l.positionStatus === 'CLOSED').length;
  let phase: BundlePhase;
  if (issues.length > 0) phase = 'RECONCILIATION_REQUIRED';
  else if (positionsClosed === legs.length) phase = 'CLOSED';
  else if (positionsClosed > 0) phase = 'PARTIALLY_CLOSED';
  else phase = 'OPEN';
  const safeSum = (values: (number | null)[]) => values.reduce<number>(
    (sum, value) => sum + (value != null && Number.isFinite(value) ? value : 0), 0,
  );
  return {
    bundleId: row.id,
    environment: 'PAPER',
    accountId: row.account,
    mode: 'PAPER_ATOMIC',
    entryState: row.status,
    phase,
    health: issues.length ? 'NEEDS_ATTENTION' : 'CONSISTENT',
    issues,
    createdAt: row.created_at,
    committedAt: row.committed_at,
    counts: { legs: legs.length, entryFilled, positionsOpen, positionsClosed },
    observedEntryNotional: safeSum(legs.map(l =>
      l.entryPrice != null && l.entryFilledQuantity != null
        ? l.entryPrice * l.entryFilledQuantity : null)),
    observedEntryFees: safeSum(legs.map(l => l.entryFees)),
    observedRealizedPnl: safeSum(legs.map(l => l.realizedPnl)),
    legs,
    readOnly: true,
    canPlaceRealOrders: false,
  };
}

/** Read-only collection. Each result derives from current canonical rows; nothing is copied. */
export function listBundleStatuses(limit = 30): BundleStatus[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('INVALID_BUNDLE_LIST_LIMIT');
  const rows = all<{ id: string }>(
    "SELECT id FROM bundle_executions WHERE account=? AND environment='PAPER' AND mode='PAPER_ATOMIC' ORDER BY created_at DESC,id DESC LIMIT ?",
    PAPER_ACCOUNT, limit,
  );
  return rows.map(r => getBundleStatus(r.id)!).filter((x): x is BundleStatus => x != null);
}
