/**
 * Trader Joe Live — read-only lifecycle projection (M1).
 *
 * Builds Joe's story feed from rows MIA has ALREADY committed. It only runs SELECTs: it never writes, never imports
 * the OMS, risk gate, ledger writer, wallet or decision engine, and cannot place, change or approve anything.
 * Sources of truth: decisions (decision engine + risk verdict), orders/fills (paper OMS), ledger_entries (money),
 * positions (lifecycle), protection_incidents (protection monitor), journal AUTOPSY rows (post-trade review) and
 * the hash-chained audit_log (pause / emergency / resume).
 *
 * This is a projection of CURRENT state: a pending approval is shown while it is pending and replaced by the fill,
 * rejection or expiry once that is committed; a FILLED order can never appear as pending again. Durable, replayable
 * per-event history moves to the NEXUS fabric outbox in a later milestone (it needs OMS transaction changes and a
 * trading-risk review).
 */
import { all } from '../../db/db.js';
import { narrate } from './narrator.js';
import { JoeTradeEvent, type JoeEventDraft } from './events.js';

type Row = Record<string, any>;
interface Source { name: string; sql: string; map: (r: Row) => JoeEventDraft | null }
const parse = (s: unknown) => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch { return null; } };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const opt = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const links = (r: Row) => ({ decisionId: opt(r.decision_id), orderId: opt(r.order_id), positionId: opt(r.pos), instrumentId: opt(r.instrument) });

/** Each source exposes `ts` (event time), `eid` (stable event id) and `pos` (position id, for per-position views). */
const SOURCES: Source[] = [
  {
    name: 'decisions',
    sql: `SELECT 'decision:' || d.id AS eid, d.created_at AS ts, d.id AS rid, d.id AS decision_id, d.instrument, d.decision, d.risk_decision,
            json_extract(d.report, '$.risk.reasonCodes') AS reasons, (SELECT p.id FROM positions p WHERE p.decision_id = d.id LIMIT 1) AS pos
          FROM decisions d`,
    map: (r) => {
      const reasons = (parse(r.reasons) as string[] | null)?.slice(0, 3).join('; ') ?? null;
      const kind = r.risk_decision === 'DENY' ? 'RISK_DENIED'
        : r.decision === 'REJECTED' || r.decision === 'INSUFFICIENT_DATA' ? 'NO_TRADE'
        : r.decision === 'WAIT_FOR_CONFIRMATION' ? 'WAITING_FOR_CONFIRMATION' : 'DECISION_RECORDED';
      return { eventId: r.eid, kind, severity: 'INFO', occurredAt: r.ts, source: { service: 'decision engine + risk gate', table: 'decisions', recordId: r.rid },
        links: links(r), fields: { decision: r.decision, riskDecision: r.risk_decision ?? null, reasons: kind === 'RISK_DENIED' ? reasons : null } };
    },
  },
  {
    name: 'entry orders',
    sql: `SELECT CASE o.status WHEN 'PENDING_APPROVAL' THEN 'order.pending:' WHEN 'REJECTED' THEN 'order.rejected:' WHEN 'CANCELLED' THEN 'order.cancelled:' ELSE 'order.expired:' END || o.id AS eid,
            CASE o.status WHEN 'PENDING_APPROVAL' THEN o.created_at ELSE o.updated_at END AS ts, o.id AS rid, o.id AS order_id, o.status, o.qty, o.instrument,
            o.decision_id, o.position_id AS pos, o.reject_reason
          FROM orders o WHERE o.purpose = 'ENTRY' AND o.status IN ('PENDING_APPROVAL','REJECTED','CANCELLED','EXPIRED')`,
    map: (r) => {
      const KINDS = { PENDING_APPROVAL: 'APPROVAL_PENDING', REJECTED: 'ORDER_REJECTED', CANCELLED: 'ORDER_CANCELLED', EXPIRED: 'ORDER_EXPIRED' } as const;
      const kind = KINDS[r.status as keyof typeof KINDS];
      if (!kind) return null;
      return { eventId: r.eid, kind, severity: kind === 'APPROVAL_PENDING' ? 'WARNING' : 'INFO', occurredAt: r.ts, source: { service: 'paper OMS', table: 'orders', recordId: r.rid },
        links: links(r), fields: { status: r.status, qty: num(r.qty), reason: r.reject_reason ?? null } };
    },
  },
  {
    name: 'fills',
    sql: `SELECT 'fill:' || f.id AS eid, f.ts, f.id AS rid, f.qty, f.price, f.fee, o.id AS order_id, o.purpose, o.instrument, o.decision_id, o.position_id AS pos,
            (SELECT SUM(l.amount) FROM ledger_entries l WHERE l.ref = o.id) AS ledger_cash
          FROM fills f JOIN orders o ON o.id = f.order_id`,
    map: (r) => {
      const entry = r.purpose === 'ENTRY';
      if (!entry && !String(r.purpose).startsWith('EXIT_')) return null;
      return { eventId: r.eid, kind: entry ? 'PAPER_ENTRY_FILLED' : 'PAPER_EXIT_FILLED', severity: 'INFO', occurredAt: r.ts,
        source: { service: 'paper OMS + ledger', table: 'fills', recordId: r.rid }, links: links(r),
        fields: { qty: num(r.qty), price: num(r.price), fee: num(r.fee), ledgerCash: num(r.ledger_cash), reason: entry ? null : String(r.purpose).slice(5), simulated: true } };
    },
  },
  {
    name: 'protective stops',
    sql: `SELECT 'stop:' || o.id AS eid, o.created_at AS ts, o.id AS rid, o.id AS order_id, o.instrument, o.position_id AS pos, p.decision_id, p.initial_stop
          FROM orders o LEFT JOIN positions p ON p.id = o.position_id WHERE o.purpose = 'PROTECTIVE_STOP'`,
    map: (r) => ({ eventId: r.eid, kind: 'STOP_MONITORING_STARTED', severity: 'INFO', occurredAt: r.ts, source: { service: 'paper OMS position monitor', table: 'orders', recordId: r.rid },
      links: links(r), fields: { stopPrice: num(r.initial_stop), guaranteed: false } }),
  },
  {
    name: 'protection incidents (opened)',
    sql: `SELECT 'incident.open:' || i.id AS eid, i.opened_at AS ts, i.id AS rid, i.instrument, i.position_id AS pos, i.reason, i.status, i.occurrences FROM protection_incidents i`,
    map: (r) => ({ eventId: r.eid, kind: 'PROTECTION_ISSUE', severity: 'CRITICAL', occurredAt: r.ts, source: { service: 'protection monitor', table: 'protection_incidents', recordId: r.rid },
      links: links(r), fields: { reason: r.reason, currentStatus: r.status, occurrences: num(r.occurrences) } }),
  },
  {
    name: 'protection incidents (recovered)',
    sql: `SELECT 'incident.recovered:' || i.id AS eid, i.recovered_at AS ts, i.id AS rid, i.instrument, i.position_id AS pos FROM protection_incidents i WHERE i.recovered_at IS NOT NULL`,
    map: (r) => ({ eventId: r.eid, kind: 'PROTECTION_RECOVERED', severity: 'INFO', occurredAt: r.ts, source: { service: 'protection monitor', table: 'protection_incidents', recordId: r.rid },
      links: links(r), fields: {} }),
  },
  {
    name: 'closed positions',
    sql: `SELECT 'position.closed:' || p.id AS eid, p.closed_at AS ts, p.id AS rid, p.id AS pos, p.instrument, p.decision_id, p.exit_reason, p.exit_price, p.realized_pnl, p.fees,
            (SELECT SUM(l.amount) FROM ledger_entries l WHERE l.ref IN (SELECT o.id FROM orders o WHERE o.position_id = p.id)) AS net
          FROM positions p WHERE p.status = 'CLOSED' AND p.closed_at IS NOT NULL`,
    map: (r) => {
      const net = num(r.net), realized = num(r.realized_pnl);
      // Money comes from the ledger. The position's own running total is only a cross-check.
      const reconciled = net !== null && realized !== null && Math.abs(net - realized) <= 0.01;
      return { eventId: r.eid, kind: 'POSITION_CLOSED', severity: net !== null && net < 0 ? 'WARNING' : 'INFO', occurredAt: r.ts,
        source: { service: 'portfolio ledger + paper OMS', table: 'positions', recordId: r.rid }, links: links(r),
        fields: { netPnl: net, positionRealizedPnl: realized, reconciled, exitReason: r.exit_reason ?? null, exitPrice: num(r.exit_price), fees: num(r.fees), simulated: true } };
    },
  },
  {
    name: 'trade reviews',
    sql: `SELECT 'review:' || j.id AS eid, j.ts, j.id AS rid, j.ref AS pos, j.detail, (SELECT p.instrument FROM positions p WHERE p.id = j.ref) AS instrument
          FROM journal j WHERE j.kind = 'AUTOPSY'`,
    map: (r) => ({ eventId: r.eid, kind: 'TRADE_REVIEW_RECORDED', severity: 'INFO', occurredAt: r.ts, source: { service: 'paper OMS trade autopsy', table: 'journal', recordId: r.rid },
      links: links(r), fields: { r: num(parse(r.detail)?.r) } }),
  },
  {
    name: 'control changes',
    sql: `SELECT 'control:' || a.id AS eid, a.ts, CAST(a.id AS TEXT) AS rid, a.actor, NULL AS pos,
            json_extract(a.detail, '$.from.pausedNewOrders') AS fp, json_extract(a.detail, '$.to.pausedNewOrders') AS tp,
            json_extract(a.detail, '$.from.emergency') AS fe, json_extract(a.detail, '$.to.emergency') AS te
          FROM audit_log a WHERE a.action = 'control.update'
            AND (COALESCE(json_extract(a.detail, '$.from.pausedNewOrders'), 0) <> COALESCE(json_extract(a.detail, '$.to.pausedNewOrders'), 0)
              OR COALESCE(json_extract(a.detail, '$.from.emergency'), 0) <> COALESCE(json_extract(a.detail, '$.to.emergency'), 0))`,
    map: (r) => {
      const kind = !r.fe && r.te ? 'EMERGENCY_STOP' : !r.fp && r.tp ? 'NEW_ORDERS_PAUSED' : (r.fp || r.fe) && !r.tp && !r.te ? 'TRADING_RESUMED' : null;
      if (!kind) return null;
      return { eventId: r.eid, kind, severity: kind === 'TRADING_RESUMED' ? 'INFO' : 'CRITICAL', occurredAt: r.ts,
        source: { service: 'execution controls (audit log)', table: 'audit_log', recordId: r.rid }, links: {}, fields: { actor: String(r.actor).slice(0, 60) } };
    },
  },
];

const MAX_LIMIT = 200;
const TIE_SLACK = 50; // extra rows per source so events sharing a timestamp are not cut at the page boundary

export type Cursor = { ts: number; id: string };
export const encodeCursor = (e: { occurredAt: number; eventId: string }) => `${e.occurredAt}~${e.eventId}`;
export function decodeCursor(s: string): Cursor | null {
  const m = /^(\d{1,15})~([a-z.]+:[A-Za-z0-9_:\-]+)$/.exec(s);
  return m ? { ts: Number(m[1]), id: m[2] } : null;
}
const cmp = (a: JoeTradeEvent, b: JoeTradeEvent) => a.occurredAt - b.occurredAt || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

function load(where: string, order: 'ASC' | 'DESC', params: (string | number)[], limit: number): JoeTradeEvent[] {
  const out: JoeTradeEvent[] = [];
  for (const s of SOURCES) {
    for (const r of all<Row>(`SELECT * FROM (${s.sql}) WHERE ts IS NOT NULL ${where} ORDER BY ts ${order}, eid ${order} LIMIT ?`, ...params, limit)) {
      const draft = s.map(r);
      if (!draft) continue;
      // Fail closed: an event that does not satisfy the contract is dropped, never shown half-formed.
      const parsed = JoeTradeEvent.safeParse(narrate(draft));
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out;
}

/**
 * Newest events (no cursor) or events strictly after `cursor`, oldest first. Paging forward with `nextCursor` never
 * repeats an event and keeps a stable order; ties within one millisecond are ordered by event id.
 */
export function joeEvents(opts: { after?: Cursor | null; limit?: number } = {}) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? 50)));
  let events: JoeTradeEvent[];
  if (opts.after) {
    const c = opts.after;
    events = load('AND ts >= ?', 'ASC', [c.ts], limit + TIE_SLACK).filter((e) => e.occurredAt > c.ts || (e.occurredAt === c.ts && e.eventId > c.id)).sort(cmp).slice(0, limit);
  } else {
    events = load('', 'DESC', [], limit).sort(cmp).slice(-limit);
  }
  const last = events.at(-1);
  return { events, nextCursor: last ? encodeCursor(last) : opts.after ? `${opts.after.ts}~${opts.after.id}` : null, projection: 'CURRENT_STATE' as const, mode: 'PAPER' as const };
}

/** Every event that belongs to one paper position (its decision, fills, stop, incidents, close and review), oldest first. */
export function joeEventsForPosition(positionId: string) {
  return { positionId, events: load('AND pos = ?', 'ASC', [positionId], MAX_LIMIT).sort(cmp), projection: 'CURRENT_STATE' as const, mode: 'PAPER' as const };
}
