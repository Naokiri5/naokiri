import { STRATEGIES, strategyById } from './strategies.js';
import { backtest, stats, monteCarlo, type BtResult, type BtTrade } from './backtest.js';
import { fetchProvider } from '../providers/http.js';
import { all, get, run, J, P } from '../db/db.js';
import { uid } from '../core/util.js';
import { audit } from '../core/audit.js';
import { market } from '../market/store.js';
import { getSetting, setSetting } from '../core/settings.js';
import type { Candle } from '../market/types.js';
import { PAPER_ACCOUNT } from '../core/accounts.js';

/** Part 18 lifecycle: RESEARCH → BACKTESTED → PAPER → (LIVE_CANDIDATE, gated) | SUSPENDED | RETIRED */
export type StrategyStatus = 'RESEARCH' | 'BACKTESTED' | 'PAPER' | 'LIVE_CANDIDATE' | 'SUSPENDED' | 'RETIRED';
export function seedStrategies() {
  for (const s of STRATEGIES) if (!get('SELECT 1 FROM strategies WHERE id=?', s.id)) run('INSERT INTO strategies(id,name,version,status,params,updated_at,note) VALUES (?,?,?,?,?,?,?)', s.id, s.name, s.version, 'RESEARCH', J({ interval: s.interval, regimes: s.suitableRegimes }), Date.now(), s.description);
}
export function listStrategies() {
  return all<any>('SELECT * FROM strategies ORDER BY id').map((r) => ({ ...r, params: P(r.params), stats: strategyStats(r.id), live: paperStats(r.id) }));
}
/** Minimum out-of-sample evidence for PAPER promotion without an explicit owner override (F-01). */
export const MIN_PROMOTION_OOS_TRADES = 30;
export function setStrategyStatus(actor: string, id: string, status: StrategyStatus, note?: string) {
  if (!strategyById(id)) throw new Error('unknown strategy');
  if (status === 'LIVE_CANDIDATE') throw new Error('LIVE_CANDIDATE requires release-gate certification (Part 12.7) — not available in this build');
  if (actor !== 'owner' && status !== 'SUSPENDED' && status !== 'RETIRED') throw new Error('only the owner may promote or re-enable a strategy');
  if (status === 'PAPER') {
    const st = strategyStats(id);
    if (!st?.trades) throw new Error('promotion to PAPER requires at least one stored backtest');
    // F-01 (100-agent audit): one losing out-of-sample trade used to be enough. Require a minimum OOS sample with a
    // positive expectancy, or an explicit owner override reason that is recorded in the audit log.
    const weak = st.trades < MIN_PROMOTION_OOS_TRADES || !(st.expectancyR > 0);
    const override = typeof note === 'string' && /^OVERRIDE:\s*\S/.test(note) && note.length >= 20;
    if (weak && !override) throw new Error(`promotion to PAPER requires ≥ ${MIN_PROMOTION_OOS_TRADES} out-of-sample trades with positive expectancy (have ${st.trades}, expectancy ${st.expectancyR.toFixed(3)}R); to promote anyway, give a note starting "OVERRIDE:" with your reason`);
    if (weak) audit(actor, 'strategy.promotion.override', { id, trades: st.trades, expectancyR: st.expectancyR, note });
  }
  run('UPDATE strategies SET status=?, updated_at=?, note=COALESCE(?, note) WHERE id=?', status, Date.now(), note ?? null, id);
  const susp = new Set(getSetting<string[]>('suspendedStrategies', []));
  status === 'SUSPENDED' || status === 'RETIRED' ? susp.add(id) : susp.delete(id);
  setSetting('suspendedStrategies', [...susp]);
  audit(actor, 'strategy.status', { id, status, note });
}
export async function fetchHistory(symbol: string, interval: string, bars = 3000): Promise<Candle[]> {
  const out: Candle[] = []; let end: number | undefined;
  while (out.length < bars) {
    const lim = Math.min(1000, bars - out.length);
    const batch = await klinesBefore(symbol, interval, lim, end);
    if (!batch.length) break;
    out.unshift(...batch); end = batch[0].t - 1;
    if (batch.length < lim) break;
  }
  return out.filter((c) => (c.closeTime ?? 0) < Date.now());
}
async function klinesBefore(symbol: string, interval: string, limit: number, endTime?: number) {
  const raw: any[] = await fetchProvider('binance', `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${endTime ? `&endTime=${endTime}` : ''}`);
  return raw.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbv: +k[9], closeTime: k[6] }));
}
export async function runBacktest(actor: string, strategyId: string, symbol: string, bars = 3000) {
  const s = strategyById(strategyId); if (!s) throw new Error('unknown strategy');
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error('invalid symbol');
  const candles = await fetchHistory(symbol, s.interval, Math.min(Math.max(bars, 500), 8000));
  if (candles.length < 400) throw new Error('insufficient history');
  const res = backtest(s, `crypto:binance:${symbol}`, candles);
  const id = uid('bt');
  run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)', id, strategyId, Date.now(), res.instrument, s.interval, J(res));
  const st = get<any>('SELECT status FROM strategies WHERE id=?', strategyId);
  if (st?.status === 'RESEARCH') run("UPDATE strategies SET status='BACKTESTED', updated_at=? WHERE id=?", Date.now(), strategyId);
  audit(actor, 'lab.backtest', { id, strategyId, symbol, bars: candles.length, oos: res.outOfSample });
  return { id, ...summary(res) };
}
const summary = (r: BtResult) => ({ strategyId: r.strategyId, instrument: r.instrument, bars: r.bars, from: r.from, to: r.to, inSample: r.inSample, outOfSample: r.outOfSample, all: r.all, warnings: r.warnings, equityR: r.equityR, costs: r.costs, trades: r.trades.slice(-200) });
export function listBacktests(limit = 50) { return all<any>('SELECT id, strategy_id, created_at, instrument, interval, result FROM backtests ORDER BY created_at DESC LIMIT ?', limit).map((r) => ({ id: r.id, created_at: r.created_at, ...summary(P(r.result)) })); }
/** Aggregate current-version OUT-OF-SAMPLE stats across the most recent backtest per instrument. */
export function strategyStats(strategyId: string) {
  const definition = strategyById(strategyId); if (!definition) return null;
  const rows = all<any>('SELECT instrument, result FROM backtests WHERE strategy_id=? ORDER BY created_at DESC', strategyId);
  const seen = new Set<string>(); const trades: BtTrade[] = [];
  for (const r of rows) { const result = P<BtResult>(r.result); if (result.strategyVersion !== definition.version || seen.has(r.instrument)) continue; seen.add(r.instrument); trades.push(...result.trades.filter((t) => t.segment === 'OOS')); }
  if (!trades.length) return null;
  const s = stats(trades); return { ...s, instruments: seen.size, monteCarlo: monteCarlo(trades.map((t) => t.r)) };
}
/** Realized paper performance per strategy (Part 18.5 decay detection input). */
export function paperStats(strategyId: string) {
  // One PAPER account is authoritative. Closed positions from any other account must never
  // affect the paper decay detector or the existing strategies dashboard.
  const rows = all<{ realized_pnl: number; planned_risk: number }>(
    "SELECT realized_pnl, planned_risk FROM positions WHERE account=? AND strategy=? AND status='CLOSED'",
    PAPER_ACCOUNT, strategyId,
  );
  if (!rows.length) return null;
  const rs = rows.map((r) => (r.planned_risk > 0 ? r.realized_pnl / r.planned_risk : 0));
  return { trades: rs.length, expectancyR: rs.reduce((a, b) => a + b, 0) / rs.length, winRate: rs.filter((r) => r > 0).length / rs.length };
}
/** Strategy health (Part 18.5): suspend when paper expectancy decays well below backtest after enough trades. */
export function checkStrategyHealth() {
  const flagged: string[] = [];
  for (const s of STRATEGIES) {
    const p = paperStats(s.id); const b = strategyStats(s.id);
    if (p && p.trades >= 15 && p.expectancyR < -0.3 && (!b || b.expectancyR > p.expectancyR + 0.3)) {
      const cur = get<any>('SELECT status FROM strategies WHERE id=?', s.id);
      if (cur?.status !== 'SUSPENDED') { setStrategyStatus('strategy-health-monitor', s.id, 'SUSPENDED', `auto-suspended: paper expectancy ${p.expectancyR.toFixed(2)}R over ${p.trades} trades`); flagged.push(s.id); }
    }
  }
  return flagged;
}
export function _universeSymbols() { return market.universe.map((id) => market.instruments.get(id)?.symbol).filter(Boolean) as string[]; }
