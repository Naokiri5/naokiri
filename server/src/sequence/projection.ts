import { all, get } from '../db/db.js';

/**
 * Read-only projection over canonical MIA records.
 *
 * This module is NOT a workflow engine. It cannot authorize trades, mutate
 * orders, synthesize fills, change execution mode, or replace DITAS memory.
 * A field absent from the authoritative database remains absent here.
 */
export type SequenceStage =
  | 'DECISION_ONLY'
  | 'AWAITING_APPROVAL'
  | 'ORDER_RECORDED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED'
  | 'POSITION_OPEN'
  | 'POSITION_CLOSED'
  | 'PROTECTION_UNVERIFIED'
  | 'REVIEW_REQUIRED';

interface DecisionRow {
  id: string;
  candidate_id: string;
  instrument: string;
  strategy: string;
  decision: string;
  risk_decision: string | null;
  consensus_id: string | null;
  created_at: number;
  report: string;
}

interface OrderRow {
  id: string;
  status: string;
  purpose: string;
  position_id: string | null;
  decision_id: string | null;
  created_at: number;
  filled_qty: number;
  qty: number;
  reject_reason: string | null;
}

interface FillRow {
  id: string;
  order_id: string;
  qty: number;
  ts: number;
}

interface PositionRow {
  id: string;
  status: string;
  qty: number;
  opened_at: number;
  closed_at: number | null;
}

interface IncidentRow {
  id: string;
  position_id: string;
  status: string;
  reason: string;
}

interface MemoryRow {
  id: string;
  kind: string;
  snapshot_id: string | null;
}

export interface SequenceProjection {
  readonly source: 'EXISTING_MIA_RECORDS';
  readonly advisoryOnly: true;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly traceId: string | null;
  readonly instrumentId: string;
  readonly strategyId: string;
  readonly decision: string;
  readonly riskDecision: string | null;
  readonly consensusId: string | null;
  readonly decidedAt: number;
  readonly observedAt: number;
  readonly stage: SequenceStage;
  readonly anomalies: readonly string[];
  readonly recordsTruncated: boolean;
  readonly orders: readonly Pick<OrderRow, 'id' | 'status' | 'purpose' | 'position_id' | 'reject_reason'>[];
  readonly fills: readonly Pick<FillRow, 'id' | 'order_id' | 'qty'>[];
  readonly positions: readonly Pick<PositionRow, 'id' | 'status' | 'qty' | 'opened_at' | 'closed_at'>[];
  readonly protectionIncidents: readonly IncidentRow[];
  readonly memory: readonly MemoryRow[];
}

function traceIdOf(rawReport: string): string | null {
  try {
    const value: unknown = JSON.parse(rawReport);
    if (typeof value !== 'object' || value === null || !('traceId' in value)) return null;
    const trace = value.traceId;
    return typeof trace === 'string' && trace.length <= 150 ? trace : null;
  } catch {
    return null;
  }
}

const LIMITS = {
  orders: 100,
  fills: 400,
  positions: 40,
  incidents: 80,
  memory: 40,
} as const;

/**
 * A synchronous, bounded, read-only SQLite observation: no network calls,
 * DB writes, mode changes, or retries. It is diagnostic, not an approval.
 */
export function sequenceForDecision(decisionId: string): SequenceProjection | null {
  const decision = get<DecisionRow>(
    'SELECT id,candidate_id,instrument,strategy,decision,risk_decision,consensus_id,created_at,report FROM decisions WHERE id=?',
    decisionId,
  );
  if (!decision) return null;

  const positionsRaw = all<PositionRow>(
    'SELECT id,status,qty,opened_at,closed_at FROM positions WHERE decision_id=? ORDER BY opened_at,id LIMIT ?',
    decisionId, LIMITS.positions + 1,
  );
  const ordersRaw = all<OrderRow>(
    `SELECT id,status,purpose,position_id,decision_id,created_at,filled_qty,qty,reject_reason
       FROM orders WHERE decision_id=? OR position_id IN
       (SELECT id FROM positions WHERE decision_id=?)
       ORDER BY created_at,id LIMIT ?`,
    decisionId, decisionId, LIMITS.orders + 1,
  );
  const fillsRaw = all<FillRow>(
    `SELECT f.id,f.order_id,f.qty,f.ts FROM fills f
       JOIN orders o ON o.id=f.order_id
       WHERE o.decision_id=? OR o.position_id IN
       (SELECT id FROM positions WHERE decision_id=?)
       ORDER BY f.ts,f.id LIMIT ?`,
    decisionId, decisionId, LIMITS.fills + 1,
  );
  const incidentsRaw = all<IncidentRow>(
    `SELECT id,position_id,status,reason FROM protection_incidents
       WHERE position_id IN (SELECT id FROM positions WHERE decision_id=?)
       ORDER BY opened_at,id LIMIT ?`,
    decisionId, LIMITS.incidents + 1,
  );
  const memoryRaw = all<MemoryRow>(
    'SELECT id,kind,snapshot_id FROM ditas_events WHERE decision_id=? ORDER BY seq DESC LIMIT ?',
    decisionId, LIMITS.memory + 1,
  );

  const recordsTruncated =
    positionsRaw.length > LIMITS.positions ||
    ordersRaw.length > LIMITS.orders ||
    fillsRaw.length > LIMITS.fills ||
    incidentsRaw.length > LIMITS.incidents ||
    memoryRaw.length > LIMITS.memory;

  const positions = positionsRaw.slice(0, LIMITS.positions);
  const orders = ordersRaw.slice(0, LIMITS.orders);
  const fills = fillsRaw.slice(0, LIMITS.fills);
  const protectionIncidents = incidentsRaw.slice(0, LIMITS.incidents);
  const memory = memoryRaw.slice(0, LIMITS.memory);

  const anomalies: string[] = [];
  if (recordsTruncated) anomalies.push('INCOMPLETE_OBSERVATION_LIMIT_REACHED');

  // Only committed fills in the existing fills table count as fill evidence.
  const fillOrderIds = new Set(fills.map(f => f.order_id));
  for (const order of orders) {
    if (order.status === 'FILLED' && !fillOrderIds.has(order.id)) {
      anomalies.push(`FILLED_ORDER_WITHOUT_RECORDED_FILL:${order.id}`);
    }
  }

  const entryOrders = orders.filter(o => o.purpose === 'ENTRY');
  const entryIds = new Set(entryOrders.map(o => o.id));
  const hasEntryFill = fills.some(f => entryIds.has(f.order_id));
  if (positions.length && !hasEntryFill) anomalies.push('POSITION_WITHOUT_RECORDED_ENTRY_FILL');

  for (const position of positions) {
    if (position.status !== 'OPEN') continue;
    const hasStop = orders.some(o =>
      o.position_id === position.id &&
      o.purpose === 'PROTECTIVE_STOP' &&
      o.status === 'ACTIVE'
    );
    if (!hasStop) anomalies.push(`OPEN_POSITION_WITHOUT_ACTIVE_PROTECTIVE_STOP:${position.id}`);
  }

  const incidentOpen = protectionIncidents.some(i => i.status === 'OPEN');
  let stage: SequenceStage = 'DECISION_ONLY';

  if (recordsTruncated || anomalies.length) stage = 'REVIEW_REQUIRED';
  else if (incidentOpen) stage = 'PROTECTION_UNVERIFIED';
  else if (positions.some(p => p.status === 'OPEN')) stage = 'POSITION_OPEN';
  else if (positions.some(p => p.status === 'CLOSED')) stage = 'POSITION_CLOSED';
  else if (entryOrders.some(o => o.status === 'PENDING_APPROVAL')) stage = 'AWAITING_APPROVAL';
  else if (entryOrders.some(o => o.status === 'REJECTED')) stage = 'ORDER_REJECTED';
  else if (entryOrders.some(o => o.status === 'CANCELLED' || o.status === 'EXPIRED')) stage = 'ORDER_CANCELLED';
  else if (orders.length) stage = 'ORDER_RECORDED';

  // An incident is reported even when other inconsistencies are also present.
  if (incidentOpen) anomalies.push('OPEN_PROTECTION_INCIDENT');

  return {
    source: 'EXISTING_MIA_RECORDS',
    advisoryOnly: true,
    decisionId: decision.id,
    candidateId: decision.candidate_id,
    traceId: traceIdOf(decision.report),
    instrumentId: decision.instrument,
    strategyId: decision.strategy,
    decision: decision.decision,
    riskDecision: decision.risk_decision,
    consensusId: decision.consensus_id,
    decidedAt: decision.created_at,
    observedAt: Date.now(),
    stage,
    anomalies,
    recordsTruncated,
    orders: orders.map(o => ({
      id: o.id, status: o.status, purpose: o.purpose,
      position_id: o.position_id, reject_reason: o.reject_reason,
    })),
    fills: fills.map(f => ({ id: f.id, order_id: f.order_id, qty: f.qty })),
    positions: positions.map(p => ({
      id: p.id, status: p.status, qty: p.qty,
      opened_at: p.opened_at, closed_at: p.closed_at,
    })),
    protectionIncidents,
    memory,
  };
}

export function recentSequences(limit = 25): SequenceProjection[] {
  const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
  const ids = all<{ id: string }>('SELECT id FROM decisions ORDER BY created_at DESC,id DESC LIMIT ?', bounded);
  return ids.flatMap(row => {
    const projection = sequenceForDecision(row.id);
    return projection ? [projection] : [];
  });
}
