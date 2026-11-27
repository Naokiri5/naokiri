import { all, get, readSnapshot } from '../db/db.js';
import { PAPER_ACCOUNT } from './ledger.js';
import { MONEY_TOLERANCE, checkedUnits, fromUnits } from './money.js';
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

/** Independent reconciliation: positions' realized PnL vs ledger cash flows for the same orders. */
/** One verdict from one database snapshot: every aggregate below reads the same committed state. */
export function reconcile(account = PAPER_ACCOUNT) { return readSnapshot(() => reconcileSnapshot(account)); }
function reconcileSnapshot(account: string) {
  const closed = get<{ s: number; n: number }>("SELECT COALESCE(SUM(realized_pnl),0) s, COUNT(*) n FROM positions WHERE account=? AND status='CLOSED'", account)!;
  const flows = get<{ s: number }>(`SELECT COALESCE(SUM(l.amount),0) s FROM ledger_entries l JOIN orders o ON o.id=l.ref JOIN positions p ON p.id=o.position_id
    WHERE l.account=? AND p.status='CLOSED' AND l.kind IN ('BUY','SELL','FEE')`, account)!;
  const diff = Math.abs(closed.s - flows.s);
  // Cash is the exact integer-unit sum. Rows lacking units, or whose REAL amount drifts from units by more than 1 unit, break the dual-write.
  const cashRow = get<{ s: unknown; missing: unknown; diverged: unknown }>(`SELECT COALESCE(SUM(amount_units),0) s, COUNT(*)-COUNT(amount_units) missing,
    COALESCE(SUM(CASE WHEN amount_units IS NOT NULL AND ABS(amount*100000000 - amount_units) > 1 THEN 1 ELSE 0 END),0) diverged FROM ledger_entries WHERE account=?`, account)!;
  const unitsMissing = checkedUnits(cashRow.missing); const unitsDivergence = checkedUnits(cashRow.diverged);
  const cash = fromUnits(checkedUnits(cashRow.s));
  // Aggregate agreement is necessary but insufficient: opposite errors can cancel.
  // Compare every closed position against its own linked cash flows, and detect
  // unlinked principal movements rather than silently excluding them from the join.
  const mismatched = get<{ n: number }>(`SELECT COUNT(*) n FROM (
    SELECT p.id FROM positions p
    LEFT JOIN orders o ON o.position_id=p.id AND o.account=p.account
    LEFT JOIN ledger_entries l ON l.ref=o.id AND l.account=p.account AND l.kind IN ('BUY','SELL','FEE')
    WHERE p.account=? AND p.status='CLOSED'
    GROUP BY p.id,p.realized_pnl
    HAVING ABS(p.realized_pnl-COALESCE(SUM(l.amount),0)) >= ${MONEY_TOLERANCE}
      OR COUNT(CASE WHEN l.kind='BUY' THEN 1 END)=0
      OR COUNT(CASE WHEN l.kind='SELL' THEN 1 END)=0
  )`, account)!.n;
  const orphanPrincipal = get<{ n: number }>(`SELECT COUNT(*) n FROM ledger_entries l
    LEFT JOIN orders o ON o.id=l.ref AND o.account=l.account
    LEFT JOIN positions p ON p.id=o.position_id AND p.account=l.account
    WHERE l.account=? AND l.kind IN ('BUY','SELL','FEE') AND (o.id IS NULL OR p.id IS NULL)`, account)!.n; // trade fees are always order-linked; deposits and withdrawals need no link
  const ok = Number.isFinite(cash) && Number.isFinite(diff) && diff < MONEY_TOLERANCE && mismatched === 0 && orphanPrincipal === 0 && unitsMissing === 0 && unitsDivergence === 0;
  return { ok, positionsRealized: closed.s, ledgerFlows: flows.s, difference: diff, closedPositions: closed.n, cash,
    mismatchedClosedPositions: mismatched, orphanPrincipalEntries: orphanPrincipal, unitsMissing, unitsDivergence,
    detail: `${closed.n} closed positions: realized ${closed.s.toFixed(6)} vs ledger ${flows.s.toFixed(6)} (diff ${diff.toExponential(2)}); ${mismatched} mismatched positions, ${orphanPrincipal} unlinked principal or fee entries; ${unitsMissing} ledger rows without units, ${unitsDivergence} rows where REAL amount and integer units diverge` };
}

/**
 * Release gate G05 fill evidence: every FILLED paper order must have fill rows whose quantity equals the order's filled
 * quantity and whose fees equal both the order's recorded fees and its FEE ledger debits; an order in any other status
 * must have no fill row, filled quantity or fee debit. Ledger agreement alone cannot
 * show this: a lost fill row leaves order and ledger in step.
 */
export function fillEvidenceMismatches(account = PAPER_ACCOUNT): number {
  return get<{ n: number }>(`SELECT COUNT(*) n FROM orders o
    LEFT JOIN (SELECT order_id, SUM(qty) q, SUM(fee) f, COUNT(*) c FROM fills GROUP BY order_id) fl ON fl.order_id=o.id
    LEFT JOIN (SELECT ref, SUM(amount) a FROM ledger_entries WHERE account=? AND kind='FEE' GROUP BY ref) le ON le.ref=o.id
    WHERE o.account=? AND (
      (o.status='FILLED' AND (
        fl.c IS NULL
        OR ABS(fl.q - o.filled_qty) > 0.000000001 * MAX(1, o.filled_qty)
        OR ABS(fl.f - COALESCE(o.fees, 0)) > ${MONEY_TOLERANCE}
        OR ABS(COALESCE(le.a, 0) + fl.f) > ${MONEY_TOLERANCE}))
      -- Any other status must carry no execution evidence at all: no fill row, no filled quantity, no fee debit.
      OR (o.status<>'FILLED' AND (fl.c IS NOT NULL OR o.filled_qty<>0 OR le.a IS NOT NULL)))`, account, account)!.n;
}

