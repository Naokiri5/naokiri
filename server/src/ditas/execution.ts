import { all, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

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
