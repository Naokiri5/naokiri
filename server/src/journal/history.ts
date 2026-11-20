import { all } from '../db/db.js';
import { PAPER_ACCOUNT } from '../core/accounts.js';

/** Trading history (orders, fills, closed positions) with filters and CSV export. */
export interface HistoryFilter { from?: number; to?: number; instrument?: string; status?: string; purpose?: string }
export function tradingHistory(f: HistoryFilter = {}) {
  const w = ['o.account = ?']; const p: Array<string | number> = [PAPER_ACCOUNT];
  if (f.from) { w.push('o.created_at >= ?'); p.push(f.from); }
  if (f.to) { w.push('o.created_at <= ?'); p.push(f.to); }
  if (f.instrument) { w.push('o.instrument LIKE ?'); p.push(`%${f.instrument.toUpperCase()}%`); }
  if (f.status) { w.push('o.status = ?'); p.push(f.status); }
  if (f.purpose) { w.push('o.purpose LIKE ?'); p.push(`${f.purpose}%`); }
  const orders = all<any>(`SELECT o.*, (SELECT COUNT(*) FROM fills fl WHERE fl.order_id=o.id) fill_count FROM orders o WHERE ${w.join(' AND ')} ORDER BY o.created_at DESC LIMIT 2000`, ...p);
  const pw = ["status='CLOSED'", "account=?"]; const pp: Array<string | number> = [PAPER_ACCOUNT];
  if (f.from) { pw.push('closed_at >= ?'); pp.push(f.from); }
  if (f.to) { pw.push('closed_at <= ?'); pp.push(f.to); }
  if (f.instrument) { pw.push('instrument LIKE ?'); pp.push(`%${f.instrument.toUpperCase()}%`); }
  const trades = all<any>(`SELECT id, instrument, strategy, opened_at, closed_at, entry_price, exit_price, realized_pnl, fees, exit_reason, planned_risk FROM positions WHERE ${pw.join(' AND ')} ORDER BY closed_at DESC LIMIT 2000`, ...pp);
  const fees = orders.reduce((s, o) => s + (o.fees ?? 0), 0);
  return { orders, trades, summary: { orders: orders.length, filled: orders.filter((o) => o.status === 'FILLED').length, rejected: orders.filter((o) => o.status === 'REJECTED').length, fees, closedTrades: trades.length, netPnl: trades.reduce((s, t) => s + t.realized_pnl, 0) } };
}
const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV with formula-injection protection (cells starting with = + - @ are prefixed with '). */
export function toCsv(rows: Record<string, unknown>[], cols: string[]) {
  const safe = (v: unknown) => esc(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => safe(r[c])).join(','))].join('\n');
}
