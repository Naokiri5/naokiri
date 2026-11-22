import { STRATEGIES } from '../lab/strategies.js';
import { strategyStats } from '../lab/lab.js';
import { all, get, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../core/accounts.js';

const RULES: Record<string, { entry: string[]; stop: string; exit: string; dependencies: string[]; weaknesses: string[] }> = {
  trend_pullback: {
    entry: ['EMA20 > EMA50 > EMA200; ADX14 >= 20', '|close - EMA20| <= 0.6 ATR14; close >= EMA50; RSI14 in [40,62]', '0 < (close - stop) / close <= 0.08'],
    stop: 'min(close - 2 ATR14, prior swing low)', exit: '50% at 1.5R; 50% at 3R; breakeven trail after 1R; maximum 48 bars',
    dependencies: ['closed 1h OHLCV', 'EMA20/50/200', 'ADX14', 'ATR14', 'RSI14', 'swingLow'], weaknesses: ['Whipsaws during trend transitions', 'Gaps may exceed stop risk'],
  },
  donchian_breakout: {
    entry: ['close > previous 20-bar high; relative volume >= 1.5; EMA50 > EMA200', 'close - previous 20-bar high <= ATR14'],
    stop: 'close - 2.5 ATR14', exit: '50% at 2R; 50% at 4R; breakeven trail after 1.5R; maximum 72 bars',
    dependencies: ['closed 1h OHLCV', 'prior Donchian high20', 'relative volume20', 'EMA50/200', 'ATR14'], weaknesses: ['False breakouts', 'Liquidity and costs may invalidate theoretical entries'],
  },
  range_reversion: {
    entry: ['ADX14 < 20; close < lower Bollinger band; RSI14 < 32', '(Bollinger mid - close) / (1.5 ATR14) >= 1'],
    stop: 'close - 1.5 ATR14', exit: '100% at min((Bollinger mid - close) / risk, 2.5)R; no trail; maximum 24 bars',
    dependencies: ['closed 1h OHLCV', 'Bollinger bands20', 'RSI14', 'ADX14', 'ATR14'], weaknesses: ['Continued directional breakdowns', 'Intended range regime may change after entry'],
  },
};

const STATE: Record<string, string> = { RESEARCH: 'RESEARCH', BACKTESTED: 'VALIDATION', PAPER: 'PAPER_TRADING', LIVE_CANDIDATE: 'APPROVED', SUSPENDED: 'RESTRICTED', RETIRED: 'RETIRED' };
const WINDOW = 50, MIN_SAMPLES = 30;

/** Read-only statistical summary. No thresholds here mutate strategy eligibility. */
export function returnHealth(returns: number[]) {
  const rs = returns.filter(Number.isFinite), n = rs.length;
  const mean = n ? rs.reduce((s, r) => s + r, 0) / n : null;
  const sampleVariance = n > 1 ? rs.reduce((s, r) => s + (r - mean!) ** 2, 0) / (n - 1) : null;
  const half = n >= MIN_SAMPLES ? 1.96 * Math.sqrt(sampleVariance! / n) : null;
  let equity = 0, peak = 0, maxDrawdownR = 0;
  const profit = rs.filter(r => r > 0).reduce((s, r) => s + r, 0), loss = -rs.filter(r => r < 0).reduce((s, r) => s + r, 0);
  for (const r of rs) { equity += r; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); }
  return { samples: n, minimumSamples: MIN_SAMPLES, status: n < MIN_SAMPLES ? 'INSUFFICIENT_SAMPLE' : mean! + half! < -0.3 ? 'DEGRADED_REVIEW' : 'OBSERVING', expectancyR: mean,
    winRate: n ? rs.filter(r => r > 0).length / n : null, profitFactor: loss > 0 ? profit / loss : null, maxDrawdownR: n ? maxDrawdownR : null,
    expectancyCi95: half == null ? null : { low: mean! - half, high: mean! + half, method: 'normal approximation; assumes independent returns; not a certification' },
    calibration: 'UNCALIBRATED', recommendation: 'Research review only; no automatic promotion or lifecycle change.' };
}

/** Passports project existing registry/history; they neither create a parallel registry nor promote strategies. */
export function strategyPassports() {
  return STRATEGIES.map(s => {
    const registry = get<{ status: string; version: string }>('SELECT status, version FROM strategies WHERE id=?', s.id);
    // Never blend PAPER and another account's trades into strategy-health or a
    // 30-trade readiness sample. The canonical financial ledger remains owner.
    const recent = all<{ realized_pnl: number; planned_risk: number; report: string | null }>(`SELECT p.realized_pnl, p.planned_risk, d.report FROM positions p LEFT JOIN decisions d ON d.id=p.decision_id
      WHERE p.account=? AND p.strategy=? AND p.status='CLOSED'
      ORDER BY p.closed_at DESC, p.id DESC LIMIT ?`, PAPER_ACCOUNT, s.id, WINDOW);
    const valid: number[] = [];
    let unknownVersion = 0, otherVersion = 0, invalidRisk = 0;
    // Unlike the canonical read-only 30-trade cohort in portfolio/paperExpectancy.ts,
    // passports project a 50-trade, strategy-version-specific DITAS diagnostic.
    for (const p of recent) {
      let version: string | undefined;
      try { version = P<{ strategy?: { version?: string } }>(p.report)?.strategy?.version; } catch { /* malformed legacy evidence is unknown */ }
      if (!version) { unknownVersion++; continue; }
      if (version !== s.version) { otherVersion++; continue; }
      const r = p.realized_pnl / p.planned_risk;
      if (!(Number.isFinite(p.planned_risk) && p.planned_risk > 0 &&
        Number.isFinite(p.realized_pnl) && Number.isFinite(r))) { invalidRisk++; continue; }
      valid.push(r);
    }
    // returnHealth computes drawdown sequentially; the SQL query is newest first.
    valid.reverse();
    const rules = RULES[s.id];
    return { id: s.id, name: s.name, version: s.version, description: s.description, suitableMarkets: ['crypto spot long-only'], timeframes: [s.interval], regimes: s.suitableRegimes,
      rules, positionSizing: 'Existing deterministic risk/gate.ts; agent agreement never increases budget.',
      execution: 'Paper only, observed order-book liquidity, configured fees/spread/slippage; stops are OMS monitored.',
      currentStatus: registry?.status ?? 'UNREGISTERED', ditasState: STATE[registry?.status ?? ''] ?? 'DISABLED', lifecycleMapping: 'Read-only mapping of existing strategy states; no additional approval is granted.',
      registryVersion: registry?.version ?? null, registryVersionMismatch: registry != null && registry.version !== s.version,
      outOfSample: strategyStats(s.id), paperHealth: { ...returnHealth(valid), windowClosedPositions: WINDOW, observedClosedPositions: recent.length, excludedUnknownVersion: unknownVersion, excludedOtherVersion: otherVersion, excludedInvalidRisk: invalidRisk },
      limitations: ['Historical paper outcomes without a linked strategy version are excluded from version-specific health.', 'Out-of-sample records are research evidence; promotion still requires explicit owner review.', 'Health intervals assume independent outcomes; regime clustering can invalidate that approximation.'] };
  });
}
