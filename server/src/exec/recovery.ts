import { get } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { PAPER_STOP_TYPE, VENUE } from './paperOrders.js';

/**
 * PAPER fills settle atomically. Any surviving transitional or unknown state is
 * quarantined, including PENDING_RESERVE, SUBMITTED and PARTIALLY_FILLED.
 * Do not resolve or refund on missing venue evidence. The only nonterminal
 * exceptions are an unfilled approval request and a genuine active protective stop.
 * Read-only: used by the risk gate, OMS, readiness and release reporting.
 */
export function unreconciledPaperOrders(): number {
  const count = get<{ count: number }>(`
    SELECT COUNT(*) AS count FROM orders o
    WHERE o.account=? AND (
      o.status NOT IN ('FILLED','CANCELLED','CANCELED','REJECTED','EXPIRED','PENDING_APPROVAL','ACTIVE')
      OR (o.status='PENDING_APPROVAL' AND (
        o.purpose<>'ENTRY' OR o.side<>'BUY' OR o.filled_qty<>0 OR o.position_id IS NOT NULL
      ))
      OR (o.status='ACTIVE' AND (
        o.purpose<>'PROTECTIVE_STOP' OR o.side<>'SELL' OR o.filled_qty<>0
        -- Only the stop the paper OMS itself creates: its venue and monitored stop type.
        OR o.venue<>? OR o.type<>?
        OR NOT EXISTS (
          SELECT 1 FROM positions p WHERE p.id=o.position_id AND p.account=o.account
            AND p.instrument=o.instrument AND p.status='OPEN'
            AND p.qty>0 AND o.qty>0
            AND ABS(o.qty-p.qty)<0.000000001 AND o.stop_price=p.stop_price
        )
      ))
    )`, PAPER_ACCOUNT, VENUE, PAPER_STOP_TYPE)?.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    throw new Error('PAPER_ORDER_RECOVERY_UNAVAILABLE');
  return count;
}
