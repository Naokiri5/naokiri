/**
 * Evidence chain reconstruction (closed-loop architecture, section 04; acceptance test 12).
 *
 * Rebuilds one paper trade end to end from records that already exist:
 *   session -> trace -> decision (+ frozen DITAS snapshot) -> orders -> fills -> ledger -> position -> settled outcome
 * and checks that every link is consistent. Nothing is inferred to fill a gap: a missing link is reported by name, and
 * the chain is complete only when every required link is present and consistent. Read-only.
 */
import { all, get, P } from '../db/db.js';
import { PAPER_ACCOUNT, type PositionRow } from '../portfolio/ledger.js';
import type { DecisionReport } from '../decision/engine.js';
import { reflectOnTrade, type Reflection } from './reflect.js';
import { tradeOutcome, type TradeOutcome } from './tradeOutcomes.js';

const FILL_EVENT = 'fill.recorded.v1';

interface FillEvent { eventId: string; traceId?: string; payload: { orderId: string; positionId: string; decisionId: string | null; side: string; sessionEvidence?: { sessionId: string; sessionVersion: number; fencingEpoch: number } } }

export interface EvidenceChain {
  positionId: string;
  complete: boolean;
  /** Required links that are absent or inconsistent, by name. */
  gaps: string[];
  session: { sessionId: string; sessionVersion: number; fencingEpoch: number } | null;
  traceId: string | null;
  decision: { id: string; createdAt: string; strategy: string; strategyVersion: string; regime: string; consensus: string; riskDecision: string | null } | null;
  snapshot: { eventId: string; snapshotId: string | null } | null;
  orders: { id: string; purpose: string; side: string; status: string; qty: number; avgPrice: number | null; fees: number }[];
  fills: { id: string; orderId: string; qty: number; price: number; fee: number; ts: number }[];
  ledger: { kind: string; amount: number; ref: string }[];
  position: { status: string; qty: number; entryPrice: number; exitPrice: number | null; realizedPnl: number; exitReason: string | null } | null;
  settledOutcome: { positionId: string; settlement: string; netPnl: number; netR: number | null; hash: string; hashVerified: boolean } | null;
  reflection: Reflection | null;
}

export function reconstructTradeChain(positionId: string): EvidenceChain | null {
  const p = get<PositionRow>('SELECT * FROM positions WHERE id=? AND account=?', positionId, PAPER_ACCOUNT);
  if (!p) return null;
  const gaps: string[] = [];
  // Orders created in the same millisecond (entry and its protective stop) are ordered by lifecycle stage, not by id.
  const stage = (purpose: string) => purpose === 'ENTRY' ? 0 : purpose === 'PROTECTIVE_STOP' ? 1 : 2;
  const orders = all<any>('SELECT * FROM orders WHERE position_id=? AND account=? ORDER BY created_at, id', positionId, PAPER_ACCOUNT)
    .sort((a, b) => a.created_at - b.created_at || stage(a.purpose) - stage(b.purpose));
  const fills = orders.flatMap((o) => all<any>('SELECT * FROM fills WHERE order_id=? ORDER BY ts, id', o.id));
  const ledger = orders.flatMap((o) => all<any>('SELECT kind, amount, ref FROM ledger_entries WHERE ref=? AND account=? ORDER BY ts, id', o.id, PAPER_ACCOUNT));
  const events = all<{ detail: string }>("SELECT detail FROM audit_log WHERE action=? AND json_extract(detail,'$.payload.positionId')=? ORDER BY id", FILL_EVENT, positionId)
    .map((r) => P<FillEvent>(r.detail));

  // Decision, trace and frozen snapshot.
  const decisionRow = p.decision_id ? get<any>('SELECT * FROM decisions WHERE id=?', p.decision_id) : undefined;
  let report: DecisionReport | null = null; try { report = decisionRow ? P<DecisionReport>(decisionRow.report) : null; } catch { report = null; }
  if (!p.decision_id) gaps.push('POSITION_HAS_NO_DECISION');
  else if (!report) gaps.push('DECISION_RECORD_MISSING');
  const ditas = p.decision_id ? get<{ id: string; snapshot_id: string | null }>("SELECT id, snapshot_id FROM ditas_events WHERE decision_id=? AND kind='DECISION' ORDER BY seq LIMIT 1", p.decision_id) : undefined;
  if (!ditas) gaps.push('DITAS_DECISION_EVENT_MISSING');

  // Orders and fills: one filled entry, every fill belongs to one of this position's orders, one fill event per fill.
  const entries = orders.filter((o) => o.purpose === 'ENTRY' && o.status === 'FILLED');
  if (entries.length !== 1) gaps.push(`ENTRY_ORDER_COUNT_${entries.length}`);
  if (entries.some((o) => o.decision_id !== p.decision_id)) gaps.push('ENTRY_ORDER_DECISION_MISMATCH');
  if (!fills.length) gaps.push('NO_FILLS');
  const eventFillIds = new Set(events.map((e) => e.eventId));
  if (fills.some((f) => !eventFillIds.has(f.id)) || events.length !== fills.length) gaps.push('FILL_EVENTS_INCOMPLETE');
  if (events.some((e) => e.payload.decisionId !== p.decision_id)) gaps.push('FILL_EVENT_DECISION_MISMATCH');

  // Session and trace come from the entry fill event, which records the authorizing session version.
  const entryEvent = events.find((e) => e.payload.side === 'BUY');
  const session = entryEvent?.payload.sessionEvidence ?? null;
  if (!session) gaps.push('AUTHORIZING_SESSION_NOT_RECORDED');
  const traceId = entryEvent?.traceId ?? null;
  if (!traceId || (report?.traceId && traceId !== report.traceId)) gaps.push('TRACE_MISMATCH');

  // Settlement: only a closed position with a verified, untampered outcome record closes the chain.
  let outcome: TradeOutcome | undefined, hashVerified = false;
  if (p.status !== 'CLOSED') gaps.push('POSITION_NOT_CLOSED');
  else {
    const linked = tradeOutcome(positionId);
    outcome = linked?.outcome; hashVerified = linked?.intact ?? false;
    if (!outcome) gaps.push('SETTLED_OUTCOME_NOT_LINKED');
    else if (outcome.settlement !== 'VERIFIED') gaps.push('SETTLEMENT_NOT_VERIFIED');
    if (outcome && !hashVerified) gaps.push('OUTCOME_RECORD_ALTERED');
  }

  const firstTargetR = Number.isFinite(report?.takeProfit?.[0]?.r) ? report!.takeProfit[0].r : null;
  return {
    positionId, complete: gaps.length === 0, gaps, session, traceId,
    decision: report && decisionRow ? { id: decisionRow.id, createdAt: report.createdAt, strategy: report.strategy.id, strategyVersion: report.strategy.version,
      regime: report.regime, consensus: report.consensus?.state ?? 'UNKNOWN', riskDecision: decisionRow.risk_decision ?? null } : null,
    snapshot: ditas ? { eventId: ditas.id, snapshotId: ditas.snapshot_id } : null,
    orders: orders.map((o) => ({ id: o.id, purpose: o.purpose, side: o.side, status: o.status, qty: o.qty, avgPrice: o.avg_price, fees: o.fees })),
    fills: fills.map((f) => ({ id: f.id, orderId: f.order_id, qty: f.qty, price: f.price, fee: f.fee, ts: f.ts })),
    ledger,
    position: { status: p.status, qty: p.qty, entryPrice: p.entry_price, exitPrice: p.exit_price, realizedPnl: p.realized_pnl, exitReason: p.exit_reason },
    settledOutcome: outcome ? { positionId, settlement: outcome.settlement, netPnl: outcome.netPnl, netR: outcome.netR, hash: outcome.hash, hashVerified } : null,
    reflection: outcome && outcome.settlement === 'VERIFIED' && hashVerified
      ? reflectOnTrade({ strategy: outcome.strategy, netPnl: outcome.netPnl, netR: outcome.netR, payload: outcome.payload, firstTargetR }) : null,
  };
}
