import { all, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

function entryReference(json: string | null) {
  try {
    const price = P<{ entryRef?: number } | null>(json)?.entryRef;
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  } catch { return null; }
}
const entrySlippage = (fill: number | null, reference: number | null, side = 'BUY') =>
  fill !== null && reference !== null ? (fill / reference - 1) * 10_000 * (side === 'BUY' ? 1 : -1) : null;

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
    const expectedPrice = o.purpose === 'ENTRY' ? entryReference(o.report) : null;
    return { orderId: o.id, instrumentId: o.instrument, decisionId: o.decision_id, strategyId: report?.strategy?.id ?? null,
      side: o.side, purpose: o.purpose, status: o.status, requestedQty: o.qty, filledQty: qty,
      averageFillPrice, expectedPrice, adverseSlippageBps: entrySlippage(averageFillPrice, expectedPrice, o.side),
      fees: fills.reduce((s, f) => s + f.fee, 0), fillCount: fills.length,
      firstFillDelayMs: fills.length ? fills[0].ts - o.created_at : null,
      lastRecordedFillDelayMs: fills.length ? fills[fills.length - 1].ts - o.created_at : null,
      rejectReason: o.reject_reason };
  }), limitations: ['Actual paper OMS records only; no live exchange executions.', 'Slippage compares entry fills with the recorded decision reference, not an independently measured market-impact estimate.', 'Local timestamps do not measure exchange acknowledgement latency. Last recorded fill does not imply order completion.', 'Exit orders without a frozen expected price retain null slippage. Results are a bounded recent-order window.'] };
}

/** Actual paper outcomes for the two decisions compared in each shadow round. Missing execution stays unknown. */
export function paperChoiceOutcomes(decisionIds: readonly string[]) {
  const ids = [...new Set(decisionIds)];
  if (!ids.length) return [];
  const rows = all<{
    decision_id: string; position_id: string; status: string; realized_pnl: number; fees: number;
    planned_risk: number; entry_price: number; report: string | null;
  }>(`SELECT p.decision_id,p.id position_id,p.status,p.realized_pnl,p.fees,p.planned_risk,p.entry_price,d.report
      FROM positions p LEFT JOIN decisions d ON d.id=p.decision_id
      WHERE p.account=? AND p.decision_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.opened_at,p.id`, PAPER_ACCOUNT, ...ids);
  return rows.map((row) => ({
    decisionId: row.decision_id, positionId: row.position_id, status: row.status, fees: row.fees,
    netPnl: row.status === 'CLOSED' ? row.realized_pnl : null,
    netR: row.status === 'CLOSED' && row.planned_risk > 0 ? row.realized_pnl / row.planned_risk : null,
    entrySlippageBps: entrySlippage(row.entry_price, entryReference(row.report)),
  }));
}
