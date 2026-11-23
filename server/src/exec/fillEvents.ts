import { audit } from '../core/audit.js';
import { iso } from '../core/util.js';
import { all, get, inTransaction, P } from '../db/db.js';
import { buildEvent, validateEvent } from '../fabric/contracts.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import type { DecisionReport } from '../decision/engine.js';

const TOPIC = 'fill.recorded.v1';
const eventId = /^[A-Za-z0-9:_.-]{1,128}$/;

/** Append an envelope to the existing audit log in the transaction that owns the fill. */
export function recordPaperFill(input: {
  fillId: string; orderId: string; positionId: string; instrumentId: string; decisionId: string | null; side: 'BUY' | 'SELL';
  qty: number; price: number; fee: number; impactBps: number; at: number;
  closed: boolean; strategy: string; netPnlAfterFill: number; policyVersion?: number | null; report?: DecisionReport;
}) {
  if (!inTransaction()) throw new Error('paper fill event requires the OMS transaction');
  let report = input.report;
  if (!report && input.decisionId) {
    const json = get<{ report: string }>('SELECT report FROM decisions WHERE id=?', input.decisionId)?.report;
    try { report = P<DecisionReport | undefined>(json, undefined); } catch { /* Old reports may be unreadable. */ }
  }
  const traceId = report?.traceId && eventId.test(report.traceId) ? report.traceId : input.positionId;
  const stored = input.decisionId ? get<{ snapshot_id: string | null }>(
    "SELECT snapshot_id FROM ditas_events WHERE dedupe_key=? AND kind='DECISION'", `decision:${input.decisionId}`,
  )?.snapshot_id : null;
  const snapshotId = stored && /^snap_[0-9a-f]{64}$/.test(stored) ? stored : undefined;
  const version = typeof report?.strategy?.version === 'string' ? report.strategy.version : undefined;
  const expiry = Date.parse(report?.consensus?.expiresAt ?? '');
  const event = buildEvent({
    eventId: input.fillId, eventType: TOPIC, source: 'exec:oms', sourceClass: 'OMS',
    instrumentId: eventId.test(input.instrumentId) ? input.instrumentId : undefined,
    traceId, correlationId: input.positionId, causationId: input.orderId, occurredAt: iso(input.at),
    producerVersion: 'paper-oms/1', dataStatus: 'VERIFIED', accessClass: 'OWNER_PRIVATE',
    accountId: PAPER_ACCOUNT, environment: 'PAPER', snapshotId,
    strategyVersion: version && version.length <= 40 ? version : undefined,
    policyVersion: input.policyVersion ?? undefined,
    expiresAt: Number.isFinite(expiry) ? iso(expiry) : undefined,
    payload: {
      orderId: input.orderId, positionId: input.positionId, decisionId: input.decisionId, strategy: input.strategy,
      side: input.side, qty: input.qty, price: input.price, fee: input.fee, impactBps: input.impactBps,
      closed: input.closed, netPnlAfterFill: input.netPnlAfterFill,
    },
  }, input.at);
  audit('oms', TOPIC, event);
}

/** Cursor replay returns stable event IDs so clients can deduplicate their own reads. */
export function paperFillEvents(after: number, limit: number) {
  const rows = all<{ id: number; detail: string }>(
    'SELECT id,detail FROM audit_log WHERE id>? AND action=? ORDER BY id LIMIT ?', after, TOPIC, limit,
  );
  const events = rows.map((row) => {
    const decoded = validateEvent(P(row.detail));
    if (!decoded.ok || decoded.event.eventType !== TOPIC || decoded.event.accountId !== PAPER_ACCOUNT) {
      throw new Error(`invalid stored fill event at audit row ${row.id}`);
    }
    return decoded.event;
  });
  return { events, nextAfter: rows.at(-1)?.id ?? after };
}
