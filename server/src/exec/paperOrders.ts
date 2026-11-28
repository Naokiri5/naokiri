/**
 * Shared identity of paper OMS orders. The OMS writes these values and recovery, session control and release gates
 * read them, so they live in one place: if they drifted, every open position's stop would look unreconciled, or an
 * approval with execution evidence could be closed by one path and not another.
 */
export const VENUE = 'binance-paper';
/** Order type of the protective stop the paper OMS creates and monitors itself. */
export const PAPER_STOP_TYPE = 'STOP_MARKET (OMS-monitored, paper)';
/**
 * The only approval rows that may be closed (rejected, cancelled, expired) without reconciliation: never filled, never
 * linked to a position, no fill recorded. An approval carrying execution evidence stays in the unresolved set that
 * recovery reports (exec/recovery.ts) instead of being hidden by a terminal status. Use in an UPDATE on `orders`.
 */
export const UNFILLED_APPROVAL = "status='PENDING_APPROVAL' AND filled_qty=0 AND position_id IS NULL AND NOT EXISTS (SELECT 1 FROM fills f WHERE f.order_id=orders.id)";
