import { all, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

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
  const rows = all<any>(`SELECT o.*, d.report FROM orders o LEFT JOIN decisions d ON d.id=o.decision_id
    WHERE o.account=? ORDER BY o.created_at DESC,o.id LIMIT ?`, PAPER_ACCOUNT, limit);
  return { label: 'PAPER', orders: rows.map(o => {
    const fills = all<any>('SELECT qty,price,fee,ts FROM fills WHERE order_id=? ORDER BY ts,id', o.id);
    const qty = fills.reduce((s, f) => s + f.qty, 0);
    const value = fills.reduce((s, f) => s + f.qty * f.price, 0);
    const averageFillPrice = qty > 0 ? value / qty : null;
    let report: any = null; try { report = P(o.report); } catch { /* Unknown legacy reference remains null. */ }
    const expectedPrice = o.purpose === 'ENTRY' && Number.isFinite(report?.entryRef) && report.entryRef > 0 ? report.entryRef : null;
    return { orderId: o.id, instrumentId: o.instrument, decisionId: o.decision_id, strategyId: report?.strategy?.id ?? null,
      side: o.side, purpose: o.purpose, status: o.status, requestedQty: o.qty, filledQty: qty,
      averageFillPrice, expectedPrice, adverseSlippageBps: expectedPrice && averageFillPrice != null && (o.side === 'BUY' || o.side === 'SELL') ? (averageFillPrice / expectedPrice - 1) * 10000 * (o.side === 'BUY' ? 1 : -1) : null,
      fees: fills.reduce((s, f) => s + f.fee, 0), fillCount: fills.length,
      firstFillDelayMs: fills.length ? fills[0].ts - o.created_at : null,
      lastRecordedFillDelayMs: fills.length ? fills[fills.length - 1].ts - o.created_at : null,
      rejectReason: o.reject_reason };
  }), limitations: ['Actual paper OMS records only; no live exchange executions.', 'Slippage compares entry fills with the recorded decision reference, not an independently measured market-impact estimate.', 'Local timestamps do not measure exchange acknowledgement latency. Last recorded fill does not imply order completion.', 'Exit orders without a frozen expected price retain null slippage. Results are a bounded recent-order window.'] };
}
