import { get } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

/** The paper OMS fills atomically. Transitional orders surviving a restart require reconciliation. */
export function unreconciledPaperOrders() {
  return get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM orders WHERE account=? AND status NOT IN ('FILLED','CANCELLED','CANCELED','REJECTED','EXPIRED','PENDING_APPROVAL','ACTIVE') OR account=? AND status='ACTIVE' AND purpose<>'PROTECTIVE_STOP'", PAPER_ACCOUNT, PAPER_ACCOUNT,
  )!.count;
}
