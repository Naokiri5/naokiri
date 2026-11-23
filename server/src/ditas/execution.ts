import { all, get, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';


/**
 * Read-only proof for one canonical PAPER position. A CLOSED row alone is not a fill.
 * Reconciles entry and all exit orders against their actual simulated fills; never
 * changes an OMS/ledger record, infers a live venue ACK or authorizes an order.
 */
export function verifyPaperClosure(positionId: string, account = PAPER_ACCOUNT) {
  if (!positionId || positionId.length > 150) throw new Error('invalid position id');
  const p = get<{ id: string; status: string; qty: number; opened_at: number; closed_at: number | null }>(
    'SELECT id,status,qty,opened_at,closed_at FROM positions WHERE id=? AND account=?',
    positionId, account,
  );
  const empty = { positionId, account, source: 'PAPER_OMS_SIMULATED_FILLS',
    entryFilledQty: 0, exitFilledQty: 0, entryFillCount: 0, exitFillCount: 0 };
  if (!p) return { ...empty, status: 'NOT_FOUND' as const, verified: false, reasonCodes: ['POSITION_NOT_FOUND'] };
  if (p.status !== 'CLOSED')
    return { ...empty, status: 'OPEN' as const, verified: false, reasonCodes: ['POSITION_NOT_CLOSED'] };

  const reasons: string[] = [];
  if (account !== PAPER_ACCOUNT) reasons.push('NOT_CANONICAL_PAPER_ACCOUNT');
  if (!Number.isFinite(p.qty) || Math.abs(p.qty) > 1e-9) reasons.push('CLOSED_POSITION_HAS_REMAINING_QTY');
  if (p.closed_at == null || !Number.isSafeInteger(p.closed_at) ||
      !Number.isSafeInteger(p.opened_at) || p.closed_at < p.opened_at)
    reasons.push('INVALID_CLOSE_TIMESTAMP');

  const orders = all<{ id: string; account: string; instrument: string; venue: string; purpose: string;
    side: string; status: string; qty: number; filled_qty: number;
    fill_qty: number; fill_count: number; invalid_fills: number }>(`
    SELECT o.id,o.account,o.instrument,o.venue,o.purpose,o.side,o.status,o.qty,o.filled_qty,
      COALESCE(SUM(f.qty),0) AS fill_qty,COUNT(f.id) AS fill_count,
      COALESCE(SUM(CASE WHEN f.id IS NOT NULL AND
        (f.qty IS NULL OR f.qty<=0 OR f.price IS NULL OR f.price<=0 OR f.fee IS NULL OR f.fee<0)
        THEN 1 ELSE 0 END),0) AS invalid_fills
    FROM orders o LEFT JOIN fills f ON f.order_id=o.id
    WHERE o.position_id=? GROUP BY o.id ORDER BY o.created_at,o.id`, positionId);
  const related = orders.filter(o => o.purpose === 'ENTRY' || o.purpose.startsWith('EXIT_'));
  const entries = related.filter(o => o.purpose === 'ENTRY');
  const exits = related.filter(o => o.purpose.startsWith('EXIT_'));
  if (entries.length !== 1) reasons.push('ENTRY_ORDER_COUNT_MISMATCH');
  if (!exits.length) reasons.push('EXIT_ORDER_MISSING');

  const instrument = get<{ instrument: string }>('SELECT instrument FROM positions WHERE id=?', positionId)?.instrument;
  const matches = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-8);
  for (const o of related) {
    if (o.account !== account || o.instrument !== instrument || o.venue !== 'binance-paper')
      reasons.push('ORDER_SCOPE_MISMATCH');
    if (o.status !== 'FILLED' || o.side !== (o.purpose === 'ENTRY' ? 'BUY' : 'SELL'))
      reasons.push('ORDER_STATUS_OR_SIDE_MISMATCH');
    if (!Number.isFinite(o.fill_qty) || o.fill_qty <= 0 || o.fill_count <= 0 || o.invalid_fills)
      reasons.push('FILL_MISSING_OR_INVALID');
    if (!matches(o.qty, o.fill_qty) || !matches(o.filled_qty, o.fill_qty))
      reasons.push('ORDER_FILL_QTY_MISMATCH');
  }
  const entryFilledQty = entries.reduce((n, o) => n + o.fill_qty, 0);
  const exitFilledQty = exits.reduce((n, o) => n + o.fill_qty, 0);
  if (!(entryFilledQty > 0) || !(exitFilledQty > 0) || !matches(entryFilledQty, exitFilledQty))
    reasons.push('ENTRY_EXIT_QTY_MISMATCH');
  const reasonCodes = [...new Set(reasons)];
  const verified = reasonCodes.length === 0;
  return { ...empty, entryFilledQty, exitFilledQty,
    entryFillCount: entries.reduce((n, o) => n + o.fill_count, 0),
    exitFillCount: exits.reduce((n, o) => n + o.fill_count, 0),
    status: verified ? 'VERIFIED_CLOSED' as const : 'NEEDS_REVIEW' as const, verified, reasonCodes };
}

/** Projection of actual paper OMS records, never hypothetical Twin fills. */
export function executionQuality(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be an integer from 1 to 500');
  const rows = all<any>(`SELECT o.*, d.report FROM orders o LEFT JOIN decisions d ON d.id=o.decision_id
    WHERE o.account=? ORDER BY o.created_at DESC,o.id LIMIT ?`, PAPER_ACCOUNT, limit);
  const positions = all<{ id: string }>(
    'SELECT id FROM positions WHERE account=? ORDER BY COALESCE(closed_at,opened_at) DESC,id DESC LIMIT ?',
    PAPER_ACCOUNT, limit,
  );
  return { label: 'PAPER', closures: positions.map(p => verifyPaperClosure(p.id)), orders: rows.map(o => {
    const fills = all<any>('SELECT qty,price,fee,ts FROM fills WHERE order_id=? ORDER BY ts,id', o.id);
    const qty = fills.reduce((s, f) => s + f.qty, 0);
    const value = fills.reduce((s, f) => s + f.qty * f.price, 0);
    const averageFillPrice = qty > 0 ? value / qty : null;
    let report: any = null; try { report = P(o.report); } catch { /* Unknown legacy reference remains null. */ }
    const expectedPrice = o.purpose === 'ENTRY' && Number.isFinite(report?.entryRef) && report.entryRef > 0 ? report.entryRef : null;
    return { orderId: o.id, instrumentId: o.instrument, decisionId: o.decision_id, strategyId: report?.strategy?.id ?? null,
      side: o.side, purpose: o.purpose, status: o.status, requestedQty: o.qty, filledQty: qty,
      averageFillPrice, expectedPrice, adverseSlippageBps: expectedPrice && averageFillPrice != null ? (averageFillPrice / expectedPrice - 1) * 10000 * (o.side === 'BUY' ? 1 : -1) : null,
      fees: fills.reduce((s, f) => s + f.fee, 0), fillCount: fills.length,
      firstFillDelayMs: fills.length ? fills[0].ts - o.created_at : null,
      lastRecordedFillDelayMs: fills.length ? fills[fills.length - 1].ts - o.created_at : null,
      rejectReason: o.reject_reason };
  }), limitations: ['Position closure is verified only from fully matched simulated paper fills, not a live venue.' , 'Actual paper OMS records only; no live exchange executions.', 'Slippage compares entry fills with the recorded decision reference, not an independently measured market-impact estimate.', 'Local timestamps do not measure exchange acknowledgement latency. Last recorded fill does not imply order completion.', 'Exit orders without a frozen expected price retain null slippage. Results are a bounded recent-order window.'] };
}
