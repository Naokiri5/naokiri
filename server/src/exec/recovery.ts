import { get } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

/** The paper OMS fills atomically. Transitional orders surviving a restart require reconciliation. */
export function unreconciledPaperOrders() {
  return get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM orders WHERE account=? AND status IN ('NEW','PARTIALLY_FILLED')", PAPER_ACCOUNT,
  )!.count;
}
