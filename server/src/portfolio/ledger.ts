import { all, get, run } from '../db/db.js';
import { uid } from '../core/util.js';
import { market } from '../market/store.js';
import { quoteAgeOk } from '../market/quality.js';
import { getSetting, setSetting } from '../core/settings.js';
import { exitPolicy } from '../risk/policy.js';

export const PAPER_ACCOUNT = 'paper-bot';
export type LedgerKind = 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL' | 'FEE';
export function ledger(account: string, kind: LedgerKind, amount: number, ref?: string, note?: string, ts = Date.now()) {
  run('INSERT INTO ledger_entries(id,account,ts,kind,amount,ref,note) VALUES (?,?,?,?,?,?,?)', uid('led'), account, ts, kind, amount, ref ?? null, note ?? null);
}
export const cashBalance = (account = PAPER_ACCOUNT) => get<{ s: number }>('SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=?', account)!.s;
export const totalDeposits = (account = PAPER_ACCOUNT) => get<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE account=? AND kind IN ('DEPOSIT','WITHDRAW')", account)!.s;

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
  const pol = exitPolicy(); // open-risk accounting of EXISTING positions: always a validated policy
  for (const p of pos) {
    // MIA-RISK-001: a mark must be fresh, not just present. A frozen feed (delisted/halted symbol) used to keep its last
    // price forever, so equity, loss breakers and open risk were computed from stale data and the gate failed open.
    // A stale, future-dated or non-positive mark now counts as missing: the gate denies (POSITION_MARKS_MISSING).
    const px = market.price(p.instrument); const m = px && Number.isFinite(px.price) && px.price > 0 && quoteAgeOk(px.ts, nowTs) ? px.price : null;
    if (m == null) { missing.push(p.instrument); value += p.qty * p.entry_price; continue; }
    value += p.qty * m; unreal += p.qty * (m - p.entry_price);
    // MIA-RISK-007: measured like new-trade sizing — to the conservative stop FILL (stop minus the slippage buffer) plus
    // the exit fee — so open risk is not understated relative to maxOpenRiskPct. (The entry fee is already paid.)
    const stopFill = p.stop_price * (1 - pol.stopFillBufferPct / 100);
    openRisk += Math.max(0, p.qty * (Math.min(m, p.entry_price) - stopFill + pol.feeRate * stopFill));
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
