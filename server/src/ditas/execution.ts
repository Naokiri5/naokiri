import { all, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

interface ExecutionRow {
  id: string;
  instrument: string;
  decision_id: string | null;
  report: string | null;
  side: string;
  purpose: string;
  status: string;
  qty: number;
  created_at: number;
  reject_reason: string | null;
  fill_count: number | null;
  filled_qty: number | null;
  executed_value: number | null;
  fees: number | null;
  maker_count: number | null;
  taker_count: number | null;
  first_fill_at: number | null;
  last_fill_at: number | null;
}

interface DecisionReference {
  entryRef?: number;
  strategy?: { id?: string };
}

function basisPoints(amount: number, notional: number): number | null {
  const bps = amount / notional * 10_000;
  return notional > 0 && Number.isFinite(notional) && Number.isFinite(bps) ? bps : null;
}

/** Research-only, execution-ID-based T+5s markout evidence for DITAS. No new authority or event bus. */
export interface PostFillMarkoutEvidence {
  executionId: string;
  accountId: string;
  executionVenueId: string;
  marketDataVenueId: string;
  instrumentId: string;
  side: 'BUY' | 'SELL';
  fillPrice: number;
  fillAtMs: number;
  quote: {
    venueId: string;
    instrumentId: string;
    bid: number;
    ask: number;
    eventAtMs: number;
    receivedAtMs: number;
  } | null;
}
export type MarkoutEvidenceReport =
  | { status: 'MEASURED'; executionId: string; favorableMarkoutBps: number; horizonMs: 5000; quoteAgeFromFillMs: number }
  | { status: 'UNKNOWN'; executionId: string; favorableMarkoutBps: null; reasonCode: string };

/**
 * T+5s diagnostic, never a prediction/accuracy score. Requires an immutable execution ID and a
 * quote measured within +/-250ms of five seconds after that execution, with independently identified
 * venue/instrument and non-crossed bid/ask. No latest-price fallback. Source-specific buffering,
 * retries and durable scheduling belong to the existing DITAS/market-data owner in a later PR.
 */
export function assessPostFillMarkout(evidence: PostFillMarkoutEvidence): MarkoutEvidenceReport {
  const unknown = (reasonCode: string): MarkoutEvidenceReport => ({
    status: 'UNKNOWN', executionId: evidence.executionId, favorableMarkoutBps: null, reasonCode,
  });
  if (![evidence.executionId, evidence.accountId, evidence.executionVenueId, evidence.marketDataVenueId, evidence.instrumentId].every(v => typeof v === 'string' && v.trim().length > 0)) {
    return unknown('EXECUTION_IDENTITY_MISSING');
  }
  const q = evidence.quote;
  if (!q) return unknown('NO_MATCHED_QUOTE');
  if (q.venueId !== evidence.marketDataVenueId || q.instrumentId !== evidence.instrumentId) return unknown('QUOTE_SOURCE_MISMATCH');
  if (evidence.side !== 'BUY' && evidence.side !== 'SELL') return unknown('TRADE_SIDE_INVALID');
  if (![evidence.fillPrice, q.bid, q.ask].every(Number.isFinite) ||
      !(evidence.fillPrice > 0 && q.bid > 0 && q.ask > q.bid)) return unknown('QUOTE_OR_FILL_INVALID');
  if (![evidence.fillAtMs, q.eventAtMs, q.receivedAtMs].every(Number.isSafeInteger) ||
      !(evidence.fillAtMs > 0 && q.eventAtMs > 0 && q.receivedAtMs >= q.eventAtMs)) return unknown('TIMESTAMP_INVALID');
  const horizon = q.eventAtMs - evidence.fillAtMs;
  if (Math.abs(horizon - 5000) > 250) return unknown('T5_QUOTE_TIME_MISMATCH');
  if (q.receivedAtMs - q.eventAtMs > 2000) return unknown('QUOTE_RECEIPT_TOO_LATE');
  const mid = q.bid / 2 + q.ask / 2;
  const direction = evidence.side === 'BUY' ? 1 : -1;
  const favorableMarkoutBps = (mid / evidence.fillPrice - 1) * 10000 * direction;
  if (!Number.isFinite(favorableMarkoutBps)) return unknown('MARKOUT_NOT_FINITE');
  return { status: 'MEASURED', executionId: evidence.executionId, favorableMarkoutBps,
    horizonMs: 5000, quoteAgeFromFillMs: horizon };
}

/** Projection of actual paper OMS records, never hypothetical Twin fills. */
export function executionQuality(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be an integer from 1 to 500');
  const rows = all<ExecutionRow>(`
    WITH recent_orders AS (
      SELECT id, instrument, decision_id, side, purpose, status, qty, created_at, reject_reason
      FROM orders WHERE account=? ORDER BY created_at DESC, id LIMIT ?
    ), fill_stats AS (
      SELECT order_id, COUNT(*) AS fill_count, SUM(qty) AS filled_qty,
        SUM(qty * price) AS executed_value, SUM(fee) AS fees,
        SUM(CASE WHEN liquidity='MAKER' THEN 1 ELSE 0 END) AS maker_count,
        SUM(CASE WHEN liquidity='TAKER' THEN 1 ELSE 0 END) AS taker_count,
        MIN(ts) AS first_fill_at, MAX(ts) AS last_fill_at
      FROM fills WHERE order_id IN (SELECT id FROM recent_orders)
      GROUP BY order_id
    )
    SELECT o.*, d.report, f.fill_count, f.filled_qty, f.executed_value, f.fees,
      f.maker_count, f.taker_count, f.first_fill_at, f.last_fill_at
    FROM recent_orders o
    LEFT JOIN decisions d ON d.id=o.decision_id
    LEFT JOIN fill_stats f ON f.order_id=o.id
    ORDER BY o.created_at DESC, o.id
  `, PAPER_ACCOUNT, limit);

  const orders = rows.map(row => {
    let report: DecisionReference | null = null;
    try {
      report = P<DecisionReference | null>(row.report);
    } catch { /* Legacy reports can lack a readable reference. */ }
    const entryRef = report?.entryRef;
    const expectedPrice = row.purpose === 'ENTRY' && typeof entryRef === 'number'
      && Number.isFinite(entryRef) && entryRef > 0 ? entryRef : null;
    const filledQty = row.filled_qty ?? 0;
    const averageFillPrice = filledQty > 0 && row.executed_value !== null ? row.executed_value / filledQty : null;
    const direction = row.side === 'BUY' ? 1 : row.side === 'SELL' ? -1 : null;
    const adverseSlippageBps = expectedPrice !== null && averageFillPrice !== null && direction !== null
      ? basisPoints(direction * (averageFillPrice - expectedPrice), expectedPrice) : null;
    const feeBps = row.fees !== null && row.executed_value !== null
      ? basisPoints(row.fees, row.executed_value) : null;
    const feeBpsOfBenchmark = expectedPrice !== null && row.fees !== null
      ? basisPoints(row.fees, expectedPrice * filledQty) : null;
    const totalCostBps = adverseSlippageBps !== null && feeBps !== null && feeBpsOfBenchmark !== null
      ? adverseSlippageBps + feeBpsOfBenchmark : null;
    const costIncludingFeesBps = Number.isFinite(totalCostBps) ? totalCostBps : null;
    const fillCount = row.fill_count ?? 0;
    const maker = row.maker_count ?? 0;
    const taker = row.taker_count ?? 0;
    return {
      orderId: row.id,
      instrumentId: row.instrument,
      decisionId: row.decision_id,
      strategyId: report?.strategy?.id ?? null,
      side: row.side,
      purpose: row.purpose,
      status: row.status,
      requestedQty: row.qty,
      filledQty,
      averageFillPrice,
      expectedPrice,
      adverseSlippageBps,
      fees: row.fees ?? 0,
      feeBps,
      costIncludingFeesBps,
      fillCount,
      liquidity: { maker, taker, unknown: fillCount - maker - taker },
      firstFillDelayMs: row.first_fill_at === null ? null : row.first_fill_at - row.created_at,
      lastRecordedFillDelayMs: row.last_fill_at === null ? null : row.last_fill_at - row.created_at,
      rejectReason: row.reject_reason,
    };
  });

  const comparableCosts = orders.flatMap(order => order.costIncludingFeesBps === null ? [] : [order.costIncludingFeesBps]);
  const comparableOrderCount = comparableCosts.length;
  return {
    label: 'PAPER',
    orders,
    summary: {
      orderCount: orders.length,
      filledOrderCount: orders.filter(order => order.fillCount > 0).length,
      comparableOrderCount,
      meanCostIncludingFeesBps: comparableOrderCount > 0
        ? comparableCosts.reduce((average, cost) => average + cost / comparableOrderCount, 0) : null,
    },
    limitations: [
      'Actual paper OMS records only; no live exchange executions.',
      'Slippage compares entry fills with the recorded decision reference, not an independently measured market-impact estimate.',
      'Local timestamps do not measure exchange acknowledgement latency. Last recorded fill does not imply order completion.',
      'Exit orders without a frozen expected price retain null slippage. Results are a bounded recent-order window.',
      'Fee basis points use executed notional. Fee-inclusive cost uses filled quantity at the decision reference and gives every comparable order equal weight in the mean.',
      'Liquidity counts reflect the maker or taker labels recorded on paper fills.',
    ],
  };
}
