import { all, get, tx } from '../db/db.js';
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

/** Independent reconciliation: positions' realized PnL vs ledger cash flows for the same orders. */
export function reconcile(account = PAPER_ACCOUNT) {
  const closed = get<{ s: number; n: number }>("SELECT COALESCE(SUM(realized_pnl),0) s, COUNT(*) n FROM positions WHERE account=? AND status='CLOSED'", account)!;
  const flows = get<{ s: number }>(`SELECT COALESCE(SUM(l.amount),0) s FROM ledger_entries l JOIN orders o ON o.id=l.ref JOIN positions p ON p.id=o.position_id
    WHERE l.account=? AND p.status='CLOSED' AND l.kind IN ('BUY','SELL','FEE')`, account)!;
  const diff = Math.abs(closed.s - flows.s);
  const cash = get<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=?', account)!.s;
  return { ok: diff < 1e-6, positionsRealized: closed.s, ledgerFlows: flows.s, difference: diff, closedPositions: closed.n, cash, detail: `${closed.n} closed positions: realized ${closed.s.toFixed(6)} vs ledger ${flows.s.toFixed(6)} (Δ ${diff.toExponential(2)})` };
}
