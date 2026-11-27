import { FeatureEngine } from '../features/indicators.js';
import { validateCandles } from '../chart/analysis.js';
import { classifyRegime } from '../regime/regime.js';
import type { StrategyDef } from './strategies.js';
import { INTERVAL_MS, type Candle } from '../market/types.js';
import { newExitState, stepExit } from './exits.js';
import { quantile } from '../core/util.js';

/**
 * Part 18.2 / 32.5 backtester: point-in-time features (incremental engine, no look-ahead),
 * next-bar-open entries, fees + spread + slippage, conservative intrabar ordering, chronological
 * in-sample / out-of-sample split. Results are in R multiples so they are size-independent.
 */
export interface BtCosts { feeRate: number; slippageBps: number; spreadBps: number }
export interface BtTrade { entryT: number; exitT: number; entry: number; exit: number; r: number; reason: string; regime: string; segment: 'IS' | 'OOS'; bars: number; mfe: number; mae: number;
  /** Total modeled execution cost of this trade in R (fees, spread, slippage both sides); set from model version 3. */
  costR?: number }
export interface BtStats { trades: number; winRate: number; avgR: number; expectancyR: number; profitFactor: number; maxDrawdownR: number; totalR: number; avgBars: number }
export const BACKTEST_MODEL_VERSION = 2;
// Stored results produced before model versioning omit modelVersion.
export interface BtResult { strategyId: string; strategyVersion: string; modelVersion?: number; instrument: string; interval: string; bars: number; from: number; to: number; costs: BtCosts; splitAt: number; inSample: BtStats; outOfSample: BtStats; all: BtStats; trades: BtTrade[]; equityR: number[]; warnings: string[] }

/** Reject strategy history that is not complete, ordered, closed candles of the strategy's interval. */
export function assertStrategyHistory(interval: StrategyDef['interval'], candles: readonly Candle[]) {
  // Evaluate the data at the last bar's closing boundary so older historical windows stay valid.
  const duration = INTERVAL_MS[interval];
  const asOf = (candles.at(-1)?.t ?? NaN) + duration;
  const issues = validateCandles(candles, interval, asOf);
  if (candles.some(({ t, closeTime }) => closeTime != null && (closeTime < t + duration - 1 || closeTime >= t + duration))) {
    issues.push('inconsistent candle close timestamp');
  }
  if (issues.length) throw new Error(`invalid backtest history: ${issues.join(', ')}`);
}

export function backtest(strat: StrategyDef, instrument: string, candles: Candle[], costs: BtCosts = { feeRate: 0.001, slippageBps: 3, spreadBps: 2 }, isFraction = 0.6): BtResult {
  assertStrategyHistory(strat.interval, candles);
  const eng = new FeatureEngine(); const trades: BtTrade[] = [];
  const splitAt = candles[Math.floor(candles.length * isFraction)]?.t ?? Infinity;
  let pos: { st: ReturnType<typeof newExitState>; entryT: number; regime: string; cost: number; proceeds: number; fees: number } | null = null;
  const slip = (costs.slippageBps + costs.spreadBps / 2) / 1e4;
  for (let i = 0; i < candles.length - 1; i++) {
    eng.ingest([candles[i]]);
    const next = candles[i + 1];
    const entering = pos === null;
    if (!pos) {
      const f = eng.last;
      if (!f || f.n < 210) continue;
      const { regime } = classifyRegime(f);
      if (!strat.suitableRegimes.includes(regime)) continue;
      const sig = strat.generate(f);
      if (!sig) continue;
      const entry = next.o * (1 + slip);
      if (sig.stop >= entry) continue;
      const st = newExitState(entry, sig.stop, 1, sig.targets, sig.trailAfterR, sig.maxHoldBars);
      pos = { st, entryT: next.t, regime, cost: entry, proceeds: 0, fees: entry * costs.feeRate };
    }
    // Stops and targets can execute on the entry candle without counting a held bar.
    const fills = stepExit(pos.st, next, slip, !entering);
    for (const fill of fills) {
      // The exit capsule already adjusts stop prices. Targets and time exits arrive as raw prices.
      const price = fill.reason === 'TARGET' || fill.reason === 'TIME' ? fill.price * (1 - slip) : fill.price;
      pos.proceeds += price * fill.qty;
      pos.fees += price * fill.qty * costs.feeRate;
    }
    if (pos.st.qtyLeft <= 1e-12) {
      const risk = pos.st.entry - pos.st.initialStop;
      trades.push({
        entryT: pos.entryT, exitT: next.t, entry: pos.st.entry, exit: pos.proceeds,
        r: (pos.proceeds - pos.cost - pos.fees) / risk,
        reason: fills[fills.length - 1].reason, regime: pos.regime,
        segment: pos.entryT < splitAt ? 'IS' : 'OOS',
        bars: pos.st.barsHeld, mfe: pos.st.mfe, mae: pos.st.mae,
      });
      pos = null;
    }
  }
  const warnings: string[] = [];
  if (pos) warnings.push('History ends with an open position. Closed-trade statistics exclude its unrealized PnL and entry costs.');
  const oos = trades.filter((t) => t.segment === 'OOS');
  if (oos.length < 30) warnings.push(`only ${oos.length} out-of-sample trades — not statistically meaningful`);
  if (candles.length < 1000) warnings.push('short history; single market regime likely');
  warnings.push('parameters are fixed research defaults (not optimized); survivorship bias: universe is today\'s liquid listings');
  let eq = 0; const equityR = trades.map((t) => (eq += t.r));
  return { strategyId: strat.id, strategyVersion: strat.version, modelVersion: BACKTEST_MODEL_VERSION, instrument, interval: strat.interval, bars: candles.length, from: candles[0]?.t ?? 0, to: candles[candles.length - 1]?.t ?? 0, costs, splitAt,
    inSample: stats(trades.filter((t) => t.segment === 'IS')), outOfSample: stats(oos), all: stats(trades), trades, equityR, warnings };
}
export function stats(ts: BtTrade[]): BtStats {
  const rs = ts.map((t) => t.r); const wins = rs.filter((r) => r > 0); const losses = rs.filter((r) => r <= 0);
  let eq = 0, peak = 0, mdd = 0; for (const r of rs) { eq += r; peak = Math.max(peak, eq); mdd = Math.max(mdd, peak - eq); }
  const gl = -losses.reduce((a, b) => a + b, 0);
  return { trades: rs.length, winRate: rs.length ? wins.length / rs.length : 0, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0, expectancyR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    profitFactor: gl ? wins.reduce((a, b) => a + b, 0) / gl : wins.length ? Infinity : 0, maxDrawdownR: mdd, totalR: eq, avgBars: ts.length ? ts.reduce((a, t) => a + t.bars, 0) / ts.length : 0 };
}

/** Part 11.10 Monte Carlo: bootstrap R outcomes at a given risk fraction. */
export function monteCarlo(rs: number[], opts: { runs?: number; tradesPerRun?: number; riskPct?: number; seed?: number } = {}) {
  const runs = opts.runs ?? 2000, n = opts.tradesPerRun ?? 100, risk = (opts.riskPct ?? 0.5) / 100;
  if (rs.length < 5) return null;
  let s = opts.seed ?? 7; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const finals: number[] = [], dds: number[] = []; let ruin = 0;
  for (let k = 0; k < runs; k++) {
    let eq = 1, peak = 1, mdd = 0;
    for (let i = 0; i < n; i++) { eq *= 1 + risk * rs[Math.floor(rnd() * rs.length)]; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak); }
    finals.push(eq - 1); dds.push(mdd); if (mdd >= 0.2) ruin++;
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  return { runs, tradesPerRun: n, riskPct: risk * 100, returnP5: quantile(finals, 0.05), returnP50: quantile(finals, 0.5), returnP95: quantile(finals, 0.95), maxDdP50: quantile(dds, 0.5), maxDdP95: quantile(dds, 0.95), probDd20: ruin / runs, note: 'Bootstrap assumes i.i.d. trades; real sequences cluster. Not a forecast.' };
}
