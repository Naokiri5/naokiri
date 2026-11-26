import { STRATEGIES, strategyById } from './strategies.js';
import { BACKTEST_MODEL_VERSION, backtest, stats, monteCarlo, type BtResult, type BtTrade } from './backtest.js';
import { qualifyEvidence } from './qualification.js';
import { fetchProvider } from '../providers/http.js';
import { all, get, run, tx, J, P } from '../db/db.js';
import { uid } from '../core/util.js';
import { audit } from '../core/audit.js';
import { market } from '../market/store.js';
import { getSetting, setSetting } from '../core/settings.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { assertWriteFence, type LeaseFence } from '../ops/lease.js';

/** Part 18 lifecycle: RESEARCH → BACKTESTED → PAPER → (LIVE_CANDIDATE, gated) | SUSPENDED | RETIRED */
export type StrategyStatus = 'RESEARCH' | 'BACKTESTED' | 'PAPER' | 'LIVE_CANDIDATE' | 'SUSPENDED' | 'RETIRED';
export function seedStrategies() {
  for (const s of STRATEGIES) run(
    'INSERT INTO strategies(id,name,version,status,params,updated_at,note) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    s.id, s.name, s.version, 'RESEARCH', J({ interval: s.interval, regimes: s.suitableRegimes }), Date.now(), s.description,
  );
}
export function listStrategies() {
  return all<any>('SELECT * FROM strategies ORDER BY id').map((r) => ({ ...r, params: P(r.params), stats: strategyStats(r.id), live: paperStats(r.id), qualification: strategyQualification(r.id) }));
}
export function setStrategyStatus(actor: string, id: string, status: StrategyStatus, note?: string) {
  if (!strategyById(id)) throw new Error('unknown strategy');
  if (status === 'LIVE_CANDIDATE') throw new Error('LIVE_CANDIDATE requires release-gate certification (Part 12.7) — not available in this build');
  if (actor !== 'owner' && status !== 'SUSPENDED' && status !== 'RETIRED') throw new Error('only the owner may promote or re-enable a strategy');
  // Lifecycle row, suspension index and audit record must commit together. The
  // existing OMS checks both status and suspension inside its entry transaction.
  tx(() => {
    // PAPER is prospective evaluation with real paper capital, so it needs out-of-sample evidence that survives the
    // number of trials (deflated Sharpe) and a significant post-cost expectancy. The owner still decides.
    if (status === 'PAPER') {
      const q = strategyQualification(id);
      if (q.reasons.includes('NO_BACKTEST')) throw new Error('promotion to PAPER requires at least one stored backtest');
      if (q.verdict !== 'QUALIFIED') throw new Error(`promotion to PAPER requires strategy qualification: ${q.reasons.join(', ')}`);
    }
    run('UPDATE strategies SET status=?, updated_at=?, note=COALESCE(?, note) WHERE id=?', status, Date.now(), note ?? null, id);
    const susp = new Set(getSetting<string[]>('suspendedStrategies', []));
    status === 'SUSPENDED' || status === 'RETIRED' ? susp.add(id) : susp.delete(id);
    setSetting('suspendedStrategies', [...susp]);
    audit(actor, 'strategy.status', { id, status, note });
  });
}
export async function fetchHistory(symbol: string, interval: Interval, bars = 3000, cutoff = Date.now()): Promise<Candle[]> {
  const duration = INTERVAL_MS[interval];
  // Freeze the last closed interval before the first request. Pagination can cross a candle boundary.
  const closedThrough = Math.floor(cutoff / duration) * duration;
  const out: Candle[] = []; let end = closedThrough - 1;
  while (out.length < bars) {
    const lim = Math.min(1000, bars - out.length);
    const batch = await klinesBefore(symbol, interval, lim, end);
    if (!batch.length) break;
    out.unshift(...batch); end = batch[0].t - 1;
    if (batch.length < lim) break;
  }
  return out.filter((c) => c.t + duration <= closedThrough && (c.closeTime ?? 0) < closedThrough);
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
const summary = (r: BtResult) => ({
  strategyId: r.strategyId, modelVersion: r.modelVersion ?? 1, instrument: r.instrument, bars: r.bars, from: r.from, to: r.to,
  inSample: r.inSample, outOfSample: r.outOfSample, all: r.all,
  warnings: r.modelVersion == null ? ['This backtest used the earlier fill model. Rerun it to include the current cost and gap handling.', ...r.warnings] : r.warnings,
  equityR: r.equityR, costs: r.costs, trades: r.trades.slice(-200),
});
export function listBacktests(limit = 50) { return all<any>('SELECT id, strategy_id, created_at, instrument, interval, result FROM backtests ORDER BY created_at DESC LIMIT ?', limit).map((r) => ({ id: r.id, created_at: r.created_at, ...summary(P(r.result)) })); }
/** Aggregate the latest out-of-sample evidence per instrument within one strategy and fill-model version. */
/**
 * Out-of-sample evidence for the strategy's current version: OOS trades from the newest backtest per instrument,
 * preferring the current fill model. `backtestRuns` counts every stored run of this version (all trials, kept or not).
 */
export function oosCohort(strategyId: string) {
  const definition = strategyById(strategyId); if (!definition) return null;
  const rows = all<{ instrument: string; result: string }>('SELECT instrument, result FROM backtests WHERE strategy_id=? ORDER BY created_at DESC', strategyId);
  const legacy = { modelVersion: 1, instruments: new Set<string>(), trades: [] as BtTrade[] };
  const current = { modelVersion: BACKTEST_MODEL_VERSION, instruments: new Set<string>(), trades: [] as BtTrade[] };
  for (const row of rows) {
    const result = P<BtResult>(row.result);
    if (result.strategyVersion !== definition.version) continue;
    const modelVersion = result.modelVersion ?? legacy.modelVersion;
    if (modelVersion !== current.modelVersion && modelVersion !== legacy.modelVersion) continue;
    const cohort = modelVersion === current.modelVersion ? current : legacy;
    if (cohort.instruments.has(row.instrument)) continue;
    cohort.instruments.add(row.instrument);
    cohort.trades.push(...result.trades.filter((trade) => trade.segment === 'OOS'));
  }
  // Keep existing evidence usable until a run with the current fill model is available for this strategy.
  const { modelVersion, instruments, trades } = current.instruments.size ? current : legacy;
  // Every stored run of this version is a trial for multiple-testing purposes, including runs superseded above.
  const runOosR = rows.map((row) => P<BtResult>(row.result)).filter((r) => r.strategyVersion === definition.version)
    .map((r) => r.trades.filter((trade) => trade.segment === 'OOS').map((trade) => trade.r));
  return { strategyVersion: definition.version, modelVersion, instruments: instruments.size, trades, backtestRuns: runOosR.length, runOosR };
}

/** Qualification verdict for the strategy's current version from its stored out-of-sample evidence. */
export function strategyQualification(strategyId: string) { return qualifyEvidence(oosCohort(strategyId)); }

export function strategyStats(strategyId: string) {
  const cohort = oosCohort(strategyId);
  if (!cohort?.trades.length) return null;
  const { modelVersion, instruments, trades } = cohort;
  return { ...stats(trades), modelVersion, instruments, monteCarlo: monteCarlo(trades.map((trade) => trade.r)) };
}
const PAPER_OUTCOME_WINDOW = 50;

/** Share the same closed paper cohort between the Strategy Lab, DITAS, and the health monitor. */
export function recentPaperOutcomes(strategyId: string, nowTs = Date.now()) {
  const currentVersion = strategyById(strategyId)?.version;
  const recent = currentVersion ? all<{ realized_pnl: number; planned_risk: number; report: string | null }>(`
    SELECT p.realized_pnl, p.planned_risk, d.report FROM positions p
    LEFT JOIN decisions d ON d.id=p.decision_id AND d.strategy=p.strategy AND d.instrument=p.instrument AND d.market=p.market
    WHERE p.account=? AND p.strategy=? AND p.status='CLOSED'
      AND typeof(p.opened_at)='integer' AND p.opened_at>0
      AND typeof(p.closed_at)='integer' AND p.closed_at>=p.opened_at AND p.closed_at<=?
    ORDER BY p.closed_at DESC, p.id DESC LIMIT ?`, PAPER_ACCOUNT, strategyId, nowTs, PAPER_OUTCOME_WINDOW) : [];
  const returns: number[] = [];
  let unknownVersion = 0, otherVersion = 0, invalidRisk = 0;
  for (const row of recent.reverse()) {
    let version: unknown;
    try { version = P<{ strategy?: { version?: unknown } }>(row.report)?.strategy?.version; } catch { /* Unparseable legacy evidence is unknown. */ }
    if (typeof version !== 'string' || version.length === 0) { unknownVersion++; continue; }
    if (version !== currentVersion) { otherVersion++; continue; }
    const result = row.realized_pnl / row.planned_risk;
    if (!Number.isFinite(row.planned_risk) || row.planned_risk <= 0 || !Number.isFinite(row.realized_pnl) || !Number.isFinite(result)) { invalidRisk++; continue; }
    returns.push(result);
  }
  return { returns, windowClosedPositions: PAPER_OUTCOME_WINDOW, observedClosedPositions: recent.length,
    excludedUnknownVersion: unknownVersion, excludedOtherVersion: otherVersion, excludedInvalidRisk: invalidRisk };
}

/** Realized performance for eligible paper outcomes (Part 18.5 decay detection input). */
export function paperStats(strategyId: string, nowTs = Date.now()) {
  const { returns } = recentPaperOutcomes(strategyId, nowTs);
  const trades = returns.length;
  if (!trades) return null;
  const scale = Math.max(...returns.map(Math.abs));
  const expectancyR = scale === 0 ? 0 : (returns.reduce((total, result) => total + result / scale, 0) / trades) * scale;
  return { trades, expectancyR, winRate: returns.filter(result => result > 0).length / trades };
}
/** Strategy health (Part 18.5): suspend when paper expectancy decays well below backtest after enough trades. */
export function checkStrategyHealth(fence?: LeaseFence) {
  const flagged: string[] = [];
  const nowTs = Date.now();
  const hasPaperStatus = (id: string) => !!get("SELECT 1 FROM strategies WHERE id=? AND status='PAPER'", id);
  for (const s of STRATEGIES) {
    if (!hasPaperStatus(s.id)) continue;
    const p = paperStats(s.id, nowTs);
    if (!p || p.trades < 15 || p.expectancyR >= -0.3) continue;
    const b = strategyStats(s.id);
    if (b && b.expectancyR <= p.expectancyR + 0.3) continue;
    const suspended = tx(() => {
      assertWriteFence(fence);
      if (!hasPaperStatus(s.id)) return false;
      setStrategyStatus('strategy-health-monitor', s.id, 'SUSPENDED', `auto-suspended: paper expectancy ${p.expectancyR.toFixed(2)}R over ${p.trades} trades`);
      return true;
    });
    if (suspended) flagged.push(s.id);
  }
  return flagged;
}
export function _universeSymbols() { return market.universe.map((id) => market.instruments.get(id)?.symbol).filter(Boolean) as string[]; }
