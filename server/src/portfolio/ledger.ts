import { all, get, run } from '../db/db.js';
import { uid } from '../core/util.js';
import { market } from '../market/store.js';
import { toUnits, fromUnits, checkedUnits } from './money.js';
import { getSetting, setSetting } from '../core/settings.js';

export const PAPER_ACCOUNT = 'paper-bot';
export type LedgerKind = 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL' | 'FEE';
/** Single money write path. Dual-writes the REAL amount as passed and exact integer units; a bad amount throws (rolls back the caller's tx). */
export function ledger(account: string, kind: LedgerKind, amount: number, ref?: string, note?: string, ts = Date.now()) {
  const units = toUnits(amount);
  run('INSERT INTO ledger_entries(id,account,ts,kind,amount,amount_units,ref,note) VALUES (?,?,?,?,?,?,?,?)', uid('led'), account, ts, kind, amount, units, ref ?? null, note ?? null);
}
/** Exact SUM of units; fails closed on a row without units or an unsafe total. */
function sumUnits(where: string, account: string): number {
  const r = get<{ s: unknown; missing: unknown }>(`SELECT COALESCE(SUM(amount_units),0) s, COUNT(*)-COUNT(amount_units) missing FROM ledger_entries WHERE account=?${where}`, account)!;
  if (checkedUnits(r.missing) !== 0) throw new Error('LEDGER_UNITS_MISSING: ledger rows without amount_units');
  return checkedUnits(r.s);
}
export const cashBalance = (account = PAPER_ACCOUNT) => fromUnits(sumUnits('', account));
export const totalDeposits = (account = PAPER_ACCOUNT) => fromUnits(sumUnits(" AND kind IN ('DEPOSIT','WITHDRAW')", account));

export interface PositionRow { id: string; account: string; instrument: string; market: string; direction: string; strategy: string; qty: number; entry_price: number; stop_price: number; initial_stop: number; targets: string; status: string; opened_at: number; closed_at: number | null; exit_price: number | null; realized_pnl: number; fees: number; max_hold_ms: number | null; decision_id: string | null; exit_reason: string | null; planned_risk: number; mfe: number; mae: number }
export const openPositions = (account = PAPER_ACCOUNT) => all<PositionRow>("SELECT * FROM positions WHERE account=? AND status='OPEN' ORDER BY opened_at", account);

export function markPrice(instrumentId: string) { return market.price(instrumentId)?.price ?? null; }

export interface AccountState {
  account: string; cash: number; positionsValue: number; equity: number; unrealizedPnl: number; deposits: number;
  startOfDayEquity: number; startOfWeekEquity: number; highWaterMark: number; dailyPnlPct: number; weeklyPnlPct: number; drawdownPct: number;
  consecutiveLosses: number; openRiskUsd: number; openRiskPct: number; openCount: number; marksMissing: string[]; realizedToday: number;
}
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const weekKey = (t: number) => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };

export function accountState(account = PAPER_ACCOUNT, nowTs = Date.now()): AccountState {
  const cash = cashBalance(account); const pos = openPositions(account);
  let value = 0, unreal = 0, openRisk = 0; const missing: string[] = [];
  for (const p of pos) {
    const m = markPrice(p.instrument);
    if (m == null) { missing.push(p.instrument); value += p.qty * p.entry_price; continue; }
    value += p.qty * m; unreal += p.qty * (m - p.entry_price);
    openRisk += Math.max(0, p.qty * (Math.min(m, p.entry_price) - p.stop_price));
  }
  const equity = cash + value;
  const deposits = totalDeposits(account);
  // Deposit-invariant marks: track cumulative performance (equity − net deposits) so funding
  // changes never look like profit/loss and never disable a breaker (Part 17.7).
  const perf = equity - deposits;
  const marks = getSetting<{ day: string; sodPerf: number; week: string; sowPerf: number; hwmPerf: number }>(`marks2:${account}`, { day: '', sodPerf: perf, week: '', sowPerf: perf, hwmPerf: perf });
  let changed = false;
  if (marks.day !== dayKey(nowTs)) { marks.day = dayKey(nowTs); marks.sodPerf = perf; changed = true; }
  if (marks.week !== weekKey(nowTs)) { marks.week = weekKey(nowTs); marks.sowPerf = perf; changed = true; }
  if (perf > marks.hwmPerf) { marks.hwmPerf = perf; changed = true; }
  if (changed && !missing.length) setSetting(`marks2:${account}`, marks);
  const sod = deposits + marks.sodPerf, sow = deposits + marks.sowPerf, hwm = deposits + marks.hwmPerf;
  const closed = all<{ realized_pnl: number }>("SELECT realized_pnl FROM positions WHERE account=? AND status='CLOSED' ORDER BY closed_at DESC LIMIT 20", account);
  let streak = 0; for (const c of closed) { if (c.realized_pnl < 0) streak++; else break; }
  const dayStart = Date.parse(`${dayKey(nowTs)}T00:00:00Z`);
  const realizedToday = get<{ s: number }>("SELECT COALESCE(SUM(realized_pnl),0) s FROM positions WHERE account=? AND status='CLOSED' AND closed_at>=?", account, dayStart)!.s;
  return {
    account, cash, positionsValue: value, equity, unrealizedPnl: unreal, deposits,
    startOfDayEquity: sod, startOfWeekEquity: sow, highWaterMark: hwm,
    dailyPnlPct: sod > 0 ? ((perf - marks.sodPerf) / sod) * 100 : 0, weeklyPnlPct: sow > 0 ? ((perf - marks.sowPerf) / sow) * 100 : 0,
    drawdownPct: hwm > 0 ? ((marks.hwmPerf - perf) / hwm) * 100 : 0, consecutiveLosses: streak,
    openRiskUsd: openRisk, openRiskPct: equity ? (openRisk / equity) * 100 : 0, openCount: pos.length, marksMissing: missing, realizedToday,
  };
}
