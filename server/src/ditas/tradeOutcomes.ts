/**
 * Closed-trade learning linker (roadmap A2, "outcome-linked memory").
 *
 * For every settled paper position, write one immutable record that links it to the decision that opened it, the
 * frozen DITAS decision event and snapshot, the orders and fills that executed it, and its settlement as verified
 * against the canonical ledger. The record answers factual post-trade questions (did price move favourably, did costs
 * remove the edge, was the loss within plan) without judging the strategy.
 *
 * Evidence only: a single trade never changes a strategy, policy, sizing or promotion state. Summaries count only
 * ledger-verified records and stay review-only below a minimum sample. Reads actual paper OMS records, never Twin or
 * other hypothetical fills.
 */
import { all, get, run, tx, J, P } from '../db/db.js';
import { sha256 } from '../core/util.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { assertWriteFence, type LeaseFence } from '../ops/lease.js';
import { entryReference, entrySlippage } from './execution.js';
import type { PositionRow } from '../portfolio/ledger.js';

export const TRADE_OUTCOME_SCHEMA = 'ditas.tradeOutcome.v1';
/** Verified trades per strategy version below which a summary is labelled insufficient evidence. */
export const MIN_OUTCOME_SAMPLE = 30;
export type SettlementStatus = 'VERIFIED' | 'MISMATCH';

interface OrderRow { id: string; side: string; purpose: string; status: string }
interface FillRow { qty: number; price: number; fee: number; ts: number }
interface LedgerRow { kind: string; amount: number }

export interface TradeOutcome {
  positionId: string; decisionId: string | null; strategy: string; strategyVersion: string | null; instrument: string;
  decisionEventId: string | null; openedAt: number; closedAt: number; linkedAt: number; settlement: SettlementStatus;
  netPnl: number; netR: number | null; payload: TradeOutcomePayload; hash: string;
}
export interface TradeOutcomePayload {
  schema: typeof TRADE_OUTCOME_SCHEMA;
  decision: null | { id: string; score: number | null; regime: string | null; consensus: { state: string; support: number; opposition: number } | null; entryRef: number | null; stopLoss: number | null };
  snapshotId: string | null;
  execution: { entryOrderIds: string[]; exitOrderIds: string[]; entryQty: number; exitQty: number; entryAvgPrice: number | null; exitAvgPrice: number | null;
    entryNotional: number; exitProceeds: number; fees: number; entrySlippageBps: number | null; exitReason: string | null; holdMs: number };
  settlement: { status: SettlementStatus; issues: string[]; ledgerNet: number; recordedPnl: number };
  attribution: { grossPnl: number; costs: number; netR: number | null; maxFavorableR: number; maxAdverseR: number;
    movedFavourably: boolean; costsRemovedEdge: boolean; reachedOneRBeforeStop: boolean; lossBeyondPlannedRisk: boolean };
  evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY';
  tradingAuthority: false;
}

const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const hashOf = (row: Omit<TradeOutcome, 'hash' | 'payload'> & { payload: string }) => sha256(J([row.positionId, row.decisionId, row.strategy,
  row.strategyVersion, row.instrument, row.decisionEventId, row.openedAt, row.closedAt, row.linkedAt, row.settlement, row.netPnl, row.netR, row.payload]));

/** Build the outcome record for one closed position from the canonical OMS, decision, DITAS and ledger rows. */
export function buildTradeOutcome(p: PositionRow, linkedAt: number): Omit<TradeOutcome, 'hash'> {
  const orders = all<OrderRow>("SELECT id, side, purpose, status FROM orders WHERE position_id=? AND account=? AND status='FILLED' ORDER BY created_at, id", p.id, PAPER_ACCOUNT);
  const entries = orders.filter((o) => o.purpose === 'ENTRY' && o.side === 'BUY');
  const exits = orders.filter((o) => o.purpose.startsWith('EXIT_') && o.side === 'SELL');
  const fillsOf = (os: OrderRow[]) => os.flatMap((o) => all<FillRow>('SELECT qty, price, fee, ts FROM fills WHERE order_id=? ORDER BY ts, id', o.id));
  const entryFills = fillsOf(entries), exitFills = fillsOf(exits);
  const ledger = orders.flatMap((o) => all<LedgerRow>('SELECT kind, amount FROM ledger_entries WHERE ref=? AND account=?', o.id, PAPER_ACCOUNT));

  const entryQty = sum(entryFills, (f) => f.qty), exitQty = sum(exitFills, (f) => f.qty);
  const entryNotional = sum(entryFills, (f) => f.qty * f.price), exitProceeds = sum(exitFills, (f) => f.qty * f.price);
  const fees = sum([...entryFills, ...exitFills], (f) => f.fee);
  const ledgerNet = sum(ledger, (l) => l.amount);
  const kindTotal = (kind: string) => sum(ledger.filter((l) => l.kind === kind), (l) => l.amount);

  // Settlement is verified only when fills, ledger and the position's recorded PnL all agree.
  const tolerance = 1e-6 * Math.max(1, entryNotional);
  const issues: string[] = [];
  if (!entries.length || !entryFills.length) issues.push('NO_ENTRY_FILL');
  if (!exits.length || !exitFills.length) issues.push('NO_EXIT_FILL');
  if (Math.abs(entryQty - exitQty) > 1e-9 * Math.max(1, entryQty)) issues.push(`QTY_UNBALANCED entry ${entryQty} exit ${exitQty}`);
  if (Math.abs(kindTotal('BUY') + entryNotional) > tolerance) issues.push('LEDGER_BUY_MISMATCH');
  if (Math.abs(kindTotal('SELL') - exitProceeds) > tolerance) issues.push('LEDGER_SELL_MISMATCH');
  if (Math.abs(kindTotal('FEE') + fees) > tolerance) issues.push('LEDGER_FEE_MISMATCH');
  if (Math.abs(ledgerNet - p.realized_pnl) > tolerance) issues.push('RECORDED_PNL_MISMATCH');
  if (![ledgerNet, entryNotional, exitProceeds, fees, p.realized_pnl].every(Number.isFinite)) issues.push('NON_FINITE_VALUE');
  const settlement: SettlementStatus = issues.length ? 'MISMATCH' : 'VERIFIED';

  const decisionRow = p.decision_id ? get<{ report: string }>('SELECT report FROM decisions WHERE id=?', p.decision_id) : undefined;
  let report: any = null; try { report = P(decisionRow?.report); } catch { report = null; }
  const event = p.decision_id ? get<{ id: string; snapshot_id: string | null }>("SELECT id, snapshot_id FROM ditas_events WHERE decision_id=? AND kind='DECISION' ORDER BY seq LIMIT 1", p.decision_id) : undefined;
  const entryRef = decisionRow ? entryReference(decisionRow.report) : null;
  const entryAvgPrice = entryQty > 0 ? entryNotional / entryQty : null;

  // The ledger is authoritative for net PnL; R uses the risk planned at entry.
  const netPnl = ledgerNet;
  const netR = p.planned_risk > 0 ? netPnl / p.planned_risk : null;
  const grossPnl = exitProceeds - entryNotional;
  const payload: TradeOutcomePayload = {
    schema: TRADE_OUTCOME_SCHEMA,
    decision: report ? { id: String(report.id ?? p.decision_id), score: Number.isFinite(report.opportunity?.score) ? report.opportunity.score : null,
      regime: typeof report.regime === 'string' ? report.regime : null,
      consensus: report.consensus ? { state: String(report.consensus.state), support: Number(report.consensus.support), opposition: Number(report.consensus.opposition) } : null,
      entryRef, stopLoss: Number.isFinite(report.stopLoss) ? report.stopLoss : null } : null,
    snapshotId: event?.snapshot_id ?? null,
    execution: { entryOrderIds: entries.map((o) => o.id), exitOrderIds: exits.map((o) => o.id), entryQty, exitQty, entryAvgPrice,
      exitAvgPrice: exitQty > 0 ? exitProceeds / exitQty : null, entryNotional, exitProceeds, fees,
      entrySlippageBps: entrySlippage(entryAvgPrice, entryRef), exitReason: p.exit_reason, holdMs: (p.closed_at ?? linkedAt) - p.opened_at },
    settlement: { status: settlement, issues, ledgerNet, recordedPnl: p.realized_pnl },
    attribution: { grossPnl, costs: fees, netR, maxFavorableR: p.mfe, maxAdverseR: p.mae, movedFavourably: p.mfe > 0,
      costsRemovedEdge: grossPnl > 0 && netPnl <= 0, reachedOneRBeforeStop: p.exit_reason === 'STOP' && p.mfe >= 1,
      lossBeyondPlannedRisk: netR !== null && netR < -1 },
    evidence: 'SINGLE_TRADE_DOES_NOT_CHANGE_STRATEGY',
    tradingAuthority: false,
  };
  return { positionId: p.id, decisionId: p.decision_id, strategy: p.strategy, strategyVersion: typeof report?.strategy?.version === 'string' ? report.strategy.version : null,
    instrument: p.instrument, decisionEventId: event?.id ?? null, openedAt: p.opened_at, closedAt: p.closed_at!, linkedAt, settlement, netPnl, netR, payload };
}

/**
 * Link settled positions that have no outcome record yet, oldest first, in bounded batches. Each record is written in
 * its own transaction under the leader fence. Idempotent: a position is linked once and its record is immutable.
 */
export function linkClosedTrades(nowTs = Date.now(), options: { batch?: number; fence?: LeaseFence } = {}) {
  const batch = options.batch ?? 50;
  if (!Number.isSafeInteger(nowTs) || nowTs <= 0) throw new Error('INVALID_LINK_TIME');
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 500) throw new Error('INVALID_LINK_BATCH');
  const pending = all<PositionRow>(`SELECT p.* FROM positions p LEFT JOIN ditas_trade_outcomes t ON t.position_id=p.id
    WHERE p.account=? AND p.status='CLOSED' AND p.closed_at IS NOT NULL AND p.closed_at<=? AND t.position_id IS NULL
    ORDER BY p.closed_at, p.id LIMIT ?`, PAPER_ACCOUNT, nowTs, batch);
  const result = { linked: 0, verified: 0, mismatched: 0 };
  for (const position of pending) {
    const written = tx(() => {
      assertWriteFence(options.fence);
      if (get('SELECT 1 FROM ditas_trade_outcomes WHERE position_id=?', position.id)) return null;
      const outcome = buildTradeOutcome(position, nowTs);
      const payload = J(outcome.payload);
      const hash = hashOf({ ...outcome, payload });
      run(`INSERT INTO ditas_trade_outcomes(position_id, decision_id, strategy, strategy_version, instrument, decision_event_id, opened_at,
        closed_at, linked_at, settlement, net_pnl, net_r, payload, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        outcome.positionId, outcome.decisionId, outcome.strategy, outcome.strategyVersion, outcome.instrument, outcome.decisionEventId,
        outcome.openedAt, outcome.closedAt, outcome.linkedAt, outcome.settlement, outcome.netPnl, outcome.netR, payload, hash);
      return outcome.settlement;
    });
    if (!written) continue;
    result.linked++;
    if (written === 'VERIFIED') result.verified++; else result.mismatched++;
  }
  return result;
}

function outcomeRow(r: any): TradeOutcome {
  return { positionId: r.position_id, decisionId: r.decision_id, strategy: r.strategy, strategyVersion: r.strategy_version, instrument: r.instrument,
    decisionEventId: r.decision_event_id, openedAt: r.opened_at, closedAt: r.closed_at, linkedAt: r.linked_at, settlement: r.settlement,
    netPnl: r.net_pnl, netR: r.net_r, payload: P(r.payload), hash: r.hash };
}

export function tradeOutcomes(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be an integer from 1 to 500');
  return all<any>('SELECT * FROM ditas_trade_outcomes ORDER BY closed_at DESC, position_id LIMIT ?', limit).map(outcomeRow);
}

/** One outcome record by position, with whether its stored hash still matches its content. */
export function tradeOutcome(positionId: string): { outcome: TradeOutcome; intact: boolean } | null {
  const r = get<any>('SELECT * FROM ditas_trade_outcomes WHERE position_id=?', positionId);
  if (!r) return null;
  return { outcome: outcomeRow(r), intact: hashOf({ ...outcomeRow(r), payload: r.payload }) === r.hash };
}

/**
 * Net R of the most recent ledger-verified, untampered trades of one strategy version, oldest first. Records whose
 * hash no longer matches are excluded, so an altered record can never count as evidence for or against a strategy.
 */
export function verifiedStrategyReturns(strategy: string, version: string, limit = 100): number[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000');
  return all<any>(`SELECT * FROM ditas_trade_outcomes WHERE settlement='VERIFIED' AND strategy=? AND strategy_version=? AND net_r IS NOT NULL
    ORDER BY closed_at DESC, position_id DESC LIMIT ?`, strategy, version, limit)
    .filter((r) => hashOf({ ...outcomeRow(r), payload: r.payload }) === r.hash && Number.isFinite(r.net_r))
    .map((r) => r.net_r as number).reverse();
}

/** Recompute every record hash; any difference means a record no longer matches what was linked. */
export function verifyTradeOutcomes() {
  const rows = all<any>('SELECT * FROM ditas_trade_outcomes ORDER BY closed_at, position_id');
  const tampered = rows.filter((r) => hashOf({ ...outcomeRow(r), payload: r.payload }) !== r.hash).map((r) => r.position_id);
  return { ok: tampered.length === 0, checked: rows.length, tampered };
}

/**
 * Per strategy version, from ledger-verified records only. Review evidence, not a verdict: below MIN_OUTCOME_SAMPLE the
 * status says so, and nothing here promotes, suspends or resizes a strategy.
 */
export function strategyOutcomeSummary() {
  const rows = all<{ strategy: string; strategy_version: string | null; net_pnl: number; net_r: number | null; payload: string }>(
    "SELECT strategy, strategy_version, net_pnl, net_r, payload FROM ditas_trade_outcomes WHERE settlement='VERIFIED' ORDER BY closed_at, position_id");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = J([r.strategy, r.strategy_version]); groups.set(k, [...(groups.get(k) ?? []), r]); }
  const strategies = [...groups.values()].map((g) => {
    const rs = g.map((r) => r.net_r).filter((v): v is number => v !== null && Number.isFinite(v));
    const attribution = g.map((r) => (P<TradeOutcomePayload>(r.payload)).attribution);
    const n = g.length;
    return {
      strategy: g[0].strategy, strategyVersion: g[0].strategy_version, verifiedTrades: n,
      wins: g.filter((r) => r.net_pnl > 0).length, netPnl: sum(g, (r) => r.net_pnl),
      meanNetR: rs.length ? sum(rs, (v) => v) / rs.length : null,
      costsRemovedEdge: attribution.filter((a) => a.costsRemovedEdge).length,
      lossBeyondPlannedRisk: attribution.filter((a) => a.lossBeyondPlannedRisk).length,
      reachedOneRBeforeStop: attribution.filter((a) => a.reachedOneRBeforeStop).length,
      status: n >= MIN_OUTCOME_SAMPLE ? 'REVIEW_EVIDENCE' as const : 'INSUFFICIENT_SAMPLE' as const,
    };
  });
  const mismatched = get<{ n: number }>("SELECT COUNT(*) n FROM ditas_trade_outcomes WHERE settlement='MISMATCH'")!.n;
  return { minimumSample: MIN_OUTCOME_SAMPLE, strategies, mismatchedSettlements: mismatched,
    automaticPromotion: false as const, tradingAuthority: false as const,
    limitations: ['Paper OMS records only.', 'Per-trade attribution is factual; it does not separate a good decision that lost from a poor one.',
      'Summaries are not calibrated probabilities and do not change strategy state.'] };
}
