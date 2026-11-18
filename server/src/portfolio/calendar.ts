import { all, get } from '../db/db.js';
import { PAPER_ACCOUNT } from './ledger.js';
import { getSetting } from '../core/settings.js';

/** Part 27 profit calendar — a projection over closed positions; NOT a second PnL source of truth. */
export function tzOffsetMin() { return getSetting<number>('calendarTzOffsetMin', 0); }
const dayOf = (t: number, off: number) => new Date(t + off * 60_000).toISOString().slice(0, 10);

export function calendar(month: string /* YYYY-MM */, account = PAPER_ACCOUNT) {
  const off = tzOffsetMin();
  const start = Date.parse(`${month}-01T00:00:00Z`) - off * 60_000;
  const [y, m] = month.split('-').map(Number); const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - off * 60_000;
  const rows = all<any>("SELECT id, instrument, strategy, realized_pnl, fees, closed_at, exit_reason, planned_risk FROM positions WHERE account=? AND status='CLOSED' AND closed_at>=? AND closed_at<? ORDER BY closed_at", account, start, end);
  const days = new Map<string, { date: string; net: number; fees: number; trades: number; wins: number; losses: number; items: any[] }>();
  for (const r of rows) {
    const d = dayOf(r.closed_at, off); const x = days.get(d) ?? { date: d, net: 0, fees: 0, trades: 0, wins: 0, losses: 0, items: [] };
    x.net += r.realized_pnl; x.fees += r.fees; x.trades++; r.realized_pnl > 0 ? x.wins++ : x.losses++; x.items.push(r); days.set(d, x);
  }
  const list = [...days.values()];
  const nets = list.map((d) => d.net);
  let best = null as null | typeof list[0], worst = null as null | typeof list[0];
  for (const d of list) { if (!best || d.net > best.net) best = d; if (!worst || d.net < worst.net) worst = d; }
  return {
    month, tzOffsetMin: off, definition: 'Net realized PnL = exit proceeds − entry cost − all fees, attributed to the day the position closed (configured timezone). Unrealized PnL excluded.',
    days: list, summary: { net: nets.reduce((a, b) => a + b, 0), fees: list.reduce((a, d) => a + d.fees, 0), trades: rows.length, greenDays: list.filter((d) => d.net > 0).length, redDays: list.filter((d) => d.net < 0).length, bestDay: best ? { date: best.date, net: best.net } : null, worstDay: worst ? { date: worst.date, net: worst.net } : null },
  };
}

/**
 * Independent reconciliation (used by the integrity check, release gate G05 and the portfolio badge):
 *  1. closed positions' realized PnL equals the ledger flows of their orders;
 *  2. every BUY/SELL/FEE posting references a FILLED order (no orphan cash);
 *  3. the trade postings equal the cash implied by the fills themselves (price × qty ∓ fee).
 * Checks 2 and 3 were added after the 100-agent audit (E-01): an orphan or edited cash row used to reconcile as OK.
 */
export function reconcile(account = PAPER_ACCOUNT) {
  const closed = get<{ s: number; n: number }>("SELECT COALESCE(SUM(realized_pnl),0) s, COUNT(*) n FROM positions WHERE account=? AND status='CLOSED'", account)!;
  const flows = get<{ s: number }>(`SELECT COALESCE(SUM(l.amount),0) s FROM ledger_entries l JOIN orders o ON o.id=l.ref JOIN positions p ON p.id=o.position_id
    WHERE l.account=? AND p.status='CLOSED' AND l.kind IN ('BUY','SELL','FEE')`, account)!;
  const diff = Math.abs(closed.s - flows.s);
  const cash = get<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=?', account)!.s;
  const orphans = get<{ n: number }>(`SELECT COUNT(*) n FROM ledger_entries WHERE account=? AND kind IN ('BUY','SELL','FEE')
    AND (ref IS NULL OR ref NOT IN (SELECT id FROM orders WHERE status='FILLED'))`, account)!.n;
  const posted = get<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=? AND kind IN ('BUY','SELL','FEE')", account)!.s;
  // R-01 (independent review): implied cash over EVERY filled order, and every filled order must carry both its trade and
  // its fee posting — deleting an order's postings used to go unnoticed.
  const implied = get<{ s: number }>(`SELECT COALESCE(SUM(CASE o.side WHEN 'BUY' THEN -f.price*f.qty ELSE f.price*f.qty END - f.fee),0) s
    FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.status='FILLED'`)!.s;
  const unposted = get<{ n: number }>(`SELECT COUNT(*) n FROM orders o WHERE o.status='FILLED' AND EXISTS (SELECT 1 FROM fills f WHERE f.order_id=o.id)
    AND (NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.ref=o.id AND l.kind IN ('BUY','SELL') AND l.account=?)
      OR NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.ref=o.id AND l.kind='FEE' AND l.account=?))`, account, account)!.n;
  const cashDiff = Math.abs(posted - implied);
  const ok = diff < 1e-6 && orphans === 0 && cashDiff < 1e-6 && unposted === 0;
  const detail = `${closed.n} closed positions: realized ${closed.s.toFixed(6)} vs ledger ${flows.s.toFixed(6)} (Δ ${diff.toExponential(2)}); `
    + `trade cash vs fills Δ ${cashDiff.toExponential(2)}; ${orphans} orphan posting(s); ${unposted} filled order(s) missing postings`;
  return { ok, positionsRealized: closed.s, ledgerFlows: flows.s, difference: diff, closedPositions: closed.n, cash, orphanPostings: orphans, unpostedOrders: unposted, cashVsFillsDifference: cashDiff, detail };
}
