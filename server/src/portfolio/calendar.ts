import type { DatabaseSync } from 'node:sqlite';
import { all, get, getDb, tx } from '../db/db.js';
import { PAPER_ACCOUNT } from './ledger.js';
import { getSetting, setSetting } from '../core/settings.js';
import { zonedDateFormatter } from '../core/time.js';

/** Part 27 profit calendar — a projection over closed positions; NOT a second PnL source of truth. */
export function tzOffsetMin() { return getSetting<number>('calendarTzOffsetMin', 0); }
const dayOf = (t: number, off: number) => new Date(t + off * 60_000).toISOString().slice(0, 10);

export function calendarTimeZone() { return getSetting<string | null>('calendarTimeZone', null); }

export function setCalendarTimeZone(preference: { timeZone: string } | { offsetMin: number }) {
  tx(() => {
    const zone = 'timeZone' in preference ? preference.timeZone : null;
    setSetting('calendarTimeZone', zone);
    if ('offsetMin' in preference) setSetting('calendarTzOffsetMin', preference.offsetMin);
  });
}

export function calendar(requestedMonth?: string, account = PAPER_ACCOUNT) {
  const off = tzOffsetMin();
  const timeZone = calendarTimeZone();
  const dayAt = timeZone ? zonedDateFormatter(timeZone) : (ts: number) => dayOf(ts, off);
  const month = requestedMonth ?? dayAt(Date.now()).slice(0, 7);
  const utcStart = Date.parse(`${month}-01T00:00:00Z`);
  const next = new Date(utcStart);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const utcEnd = next.getTime();
  // Every IANA offset lies within one day of UTC. Fetch a bounded superset and
  // classify with the offset at each fill, including DST transitions.
  const dayMs = 86_400_000;
  const start = timeZone ? utcStart - dayMs : utcStart - off * 60_000;
  const end = timeZone ? utcEnd + dayMs : utcEnd - off * 60_000;
  const rows = all<any>("SELECT id, instrument, strategy, realized_pnl, fees, closed_at, exit_reason, planned_risk FROM positions WHERE account=? AND status='CLOSED' AND closed_at>=? AND closed_at<? ORDER BY closed_at", account, start, end);
  const days = new Map<string, { date: string; net: number; fees: number; trades: number; wins: number; losses: number; items: any[] }>();
  for (const r of rows) {
    const d = dayAt(r.closed_at);
    if (!d.startsWith(month + '-')) continue;
    const x = days.get(d) ?? { date: d, net: 0, fees: 0, trades: 0, wins: 0, losses: 0, items: [] };
    x.net += r.realized_pnl; x.fees += r.fees; x.trades++; r.realized_pnl > 0 ? x.wins++ : x.losses++; x.items.push(r); days.set(d, x);
  }
  const list = [...days.values()];
  const nets = list.map((d) => d.net);
  let best = null as null | typeof list[0], worst = null as null | typeof list[0];
  for (const d of list) { if (!best || d.net > best.net) best = d; if (!worst || d.net < worst.net) worst = d; }
  return {
    month, tzOffsetMin: off, timeZone, definition: 'Net realized PnL = exit proceeds − entry cost − all fees, attributed to the day the position closed (configured timezone). Unrealized PnL excluded.',
    days: list, summary: { net: nets.reduce((a, b) => a + b, 0), fees: list.reduce((a, d) => a + d.fees, 0), trades: list.reduce((n, d) => n + d.trades, 0), greenDays: list.filter((d) => d.net > 0).length, redDays: list.filter((d) => d.net < 0).length, bestDay: best ? { date: best.date, net: best.net } : null, worstDay: worst ? { date: worst.date, net: worst.net } : null },
  };
}

/**
 * Independent reconciliation (used by the integrity check, release gate G05 and the portfolio badge):
 *  1. closed positions' realized PnL equals the ledger flows of their orders;
 *  2. every BUY/SELL/FEE posting references a FILLED order in the same account;
 *  3. every FILLED order has a fill, its trade posting, and its fee posting;
 *  4. the trade postings equal the cash implied by the fills themselves (price × qty ∓ fee).
 * Checks 2 and 3 were added after the 100-agent audit (E-01): an orphan or edited cash row used to reconcile as OK.
 */
export function reconcile(account = PAPER_ACCOUNT, db: DatabaseSync = getDb()) {
  // Capy #14: `db` lets backup verification reconcile a snapshot handle; the live default is unchanged.
  const one = <T>(sql: string, ...p: (string | number)[]) => db.prepare(sql).get(...p) as T;
  const closed = one<{ s: number; n: number }>("SELECT COALESCE(SUM(realized_pnl),0) s, COUNT(*) n FROM positions WHERE account=? AND status='CLOSED'", account);
  const flows = one<{ s: number }>(`SELECT COALESCE(SUM(l.amount),0) s FROM ledger_entries l JOIN orders o ON o.id=l.ref AND o.account=l.account
    JOIN positions p ON p.id=o.position_id AND p.account=o.account
    WHERE l.account=? AND p.status='CLOSED' AND l.kind IN ('BUY','SELL','FEE')`, account);
  const diff = Math.abs(closed.s - flows.s);
  const cash = one<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=?', account).s;
  const orphans = one<{ n: number }>(`SELECT COUNT(*) n FROM ledger_entries l WHERE l.account=? AND l.kind IN ('BUY','SELL','FEE')
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=l.ref AND o.account=l.account AND o.status='FILLED')`, account).n;
  const posted = one<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=? AND kind IN ('BUY','SELL','FEE')", account).s;
  const implied = one<{ s: number }>(`SELECT COALESCE(SUM(CASE o.side WHEN 'BUY' THEN -f.price*f.qty ELSE f.price*f.qty END - f.fee),0) s
    FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.account=? AND o.status='FILLED'`, account).s;
  const { unfilled, unposted } = one<{ unfilled: number; unposted: number }>(`SELECT
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM fills f WHERE f.order_id=o.id)) AS unfilled,
    COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.ref=o.id AND l.kind=o.side AND l.account=o.account)
      OR NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.ref=o.id AND l.kind='FEE' AND l.account=o.account)) AS unposted
    FROM orders o WHERE o.account=? AND o.status='FILLED'`, account);
  const cashDiff = Math.abs(posted - implied);
  const ok = diff < 1e-6 && orphans === 0 && cashDiff < 1e-6 && unfilled === 0 && unposted === 0;
  const detail = `${closed.n} closed positions: realized ${closed.s.toFixed(6)} vs ledger ${flows.s.toFixed(6)} (Δ ${diff.toExponential(2)}); `
    + `trade cash vs fills Δ ${cashDiff.toExponential(2)}; ${orphans} orphan posting(s); `
    + `${unfilled} filled order(s) missing fills; ${unposted} filled order(s) missing postings`;
  return { ok, positionsRealized: closed.s, ledgerFlows: flows.s, difference: diff, closedPositions: closed.n, cash, orphanPostings: orphans, filledOrdersMissingFills: unfilled, unpostedOrders: unposted, cashVsFillsDifference: cashDiff, detail };
}
