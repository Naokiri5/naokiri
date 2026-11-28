/**
 * BrainOS intelligence evaluation (V3 section 05): six kinds of accuracy measured only from verified evidence.
 *
 * Reads ledger-verified closed-trade records (ditas/tradeOutcomes.ts) and source-verified forecast cohorts
 * (ditas/service.ts). Each area reports NEEDS_EVIDENCE until it has a minimum sample; nothing is estimated, imputed or
 * labelled a probability of profit. PAPER only; backtest, TESTNET and LIVE results are never mixed in. Read-only: no
 * area changes strategy state, sizing or authority.
 */
import { all, P } from '../db/db.js';
import { forecastCohorts, sourceVerifiedCalibration } from './service.js';
import { MIN_OUTCOME_SAMPLE, type TradeOutcomePayload } from './tradeOutcomes.js';

export type EvaluationStatus = 'MEASURED' | 'NEEDS_EVIDENCE';
export interface EvaluationArea<M> {
  area: string; question: string; status: EvaluationStatus; sample: number; minimumSample: number; metrics: M | null; note: string;
}

/** Wilson score interval for a proportion (95%): stays inside [0, 1] and is honest at small samples. */
export function wilsonInterval(successes: number, n: number, z = 1.96) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(successes) || successes < 0 || successes > n) throw new Error('WILSON_INPUT_INVALID');
  const p = successes / n, z2 = z * z, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom, half = (z / denom) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return { rate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

function meanInterval(values: readonly number[], z = 1.96) {
  const n = values.length, mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, lower: mean - z * sd / Math.sqrt(n), upper: mean + z * sd / Math.sqrt(n) };
}

const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function area<M>(name: string, question: string, sample: number, minimumSample: number, metrics: () => M, note: string): EvaluationArea<M> {
  const measured = sample >= minimumSample;
  return { area: name, question, status: measured ? 'MEASURED' : 'NEEDS_EVIDENCE', sample, minimumSample, metrics: measured ? metrics() : null, note };
}

interface Row { closed_at: number; net_r: number | null; net_pnl: number; payload: string }

export function intelligenceEvaluation() {
  const rows = all<Row>("SELECT closed_at, net_r, net_pnl, payload FROM ditas_trade_outcomes WHERE settlement='VERIFIED' ORDER BY closed_at, position_id");
  const trades = rows.map((r) => ({ closedAt: r.closed_at, netR: r.net_r, netPnl: r.net_pnl, payload: P<TradeOutcomePayload>(r.payload) }));
  const min = MIN_OUTCOME_SAMPLE;

  const directional = area('DIRECTIONAL', 'Did price move in the trade direction, before costs?', trades.length, min, () => {
    const up = trades.filter((t) => t.payload.attribution.grossPnl > 0).length;
    return { grossWinRate: wilsonInterval(up, trades.length) };
  }, 'Long-only paper trades: exit above entry before fees.');

  const cohorts = forecastCohorts().map((c) => sourceVerifiedCalibration(c.cohort));
  const calibrated = cohorts.filter((c) => c.status === 'EVALUATED');
  const probability: EvaluationArea<{ cohorts: { cohort: string; sample: number; brierScore: number | null; logLoss: number | null; ece: number | null }[] }> = {
    area: 'PROBABILITY', question: 'Were forecast probabilities consistent with observed frequencies?',
    status: calibrated.length ? 'MEASURED' : 'NEEDS_EVIDENCE', sample: calibrated.reduce((s, c) => s + c.sample, 0),
    minimumSample: cohorts[0]?.minSamples ?? 100,
    metrics: calibrated.length ? { cohorts: calibrated.map((c) => ({ cohort: c.cohort, sample: c.sample, brierScore: c.brierScore, logLoss: c.logLoss, ece: c.ece })) } : null,
    note: 'Exact cohorts only, provider-verified outcomes only; never pooled across strategies, versions or horizons.',
  };

  const withSlip = trades.map((t) => t.payload.execution.entrySlippageBps).filter((v): v is number => v !== null && Number.isFinite(v));
  const entry = area('ENTRY', 'Was the entry achievable at the expected cost?', withSlip.length, min, () => {
    const sorted = [...withSlip].sort((a, b) => a - b);
    return { adverseSlippageBps: meanInterval(withSlip), medianBps: quantile(sorted, 0.5), p90Bps: quantile(sorted, 0.9) };
  }, 'Fill against the decision reference price; positive is worse than expected.');

  const excursion = trades.filter((t) => t.netR !== null && t.payload.attribution.maxFavorableR > 0);
  const exit = area('EXIT', 'Did the exit logic keep the favourable move it was given?', excursion.length, min, () => {
    const capture = excursion.map((t) => t.netR! / t.payload.attribution.maxFavorableR);
    const stops = trades.filter((t) => t.payload.execution.exitReason === 'STOP');
    return { meanCaptureOfFavourableMove: meanInterval(capture), stoppedAfterReachingOneR: stops.length ? wilsonInterval(stops.filter((t) => t.payload.attribution.reachedOneRBeforeStop).length, stops.length) : null,
      lossBeyondPlannedRisk: wilsonInterval(trades.filter((t) => t.payload.attribution.lossBeyondPlannedRisk).length, trades.length) };
  }, 'Capture = realized R / maximum favourable excursion in R.');

  const byRegime = new Map<string, number[]>();
  for (const t of trades) if (t.netR !== null) { const k = t.payload.decision?.regime ?? 'UNKNOWN'; byRegime.set(k, [...(byRegime.get(k) ?? []), t.netR]); }
  const regimes = [...byRegime.entries()].map(([regime, rs]) => ({ regime, sample: rs.length, status: (rs.length >= min ? 'MEASURED' : 'NEEDS_EVIDENCE') as EvaluationStatus, netR: rs.length >= min ? meanInterval(rs) : null }));
  const regime: EvaluationArea<{ regimes: typeof regimes }> = {
    area: 'REGIME', question: 'Did the selected strategy match observed market behaviour in each regime?',
    status: regimes.some((r) => r.status === 'MEASURED') ? 'MEASURED' : 'NEEDS_EVIDENCE', sample: trades.length, minimumSample: min,
    metrics: regimes.length ? { regimes } : null, note: 'Net R per decision-time regime; each regime needs its own minimum sample.',
  };

  const rs = trades.map((t) => t.netR).filter((v): v is number => v !== null && Number.isFinite(v));
  const performance = area('PERFORMANCE', 'Did trading show robust net performance after costs?', rs.length, min, () => {
    let peak = 0, equity = 0, maxDrawdownR = 0;
    for (const r of rs) { equity += r; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity); }
    const gross = trades.reduce((s, t) => s + Math.abs(t.payload.attribution.grossPnl), 0);
    const costs = trades.reduce((s, t) => s + t.payload.attribution.costs, 0);
    return { netExpectancyR: meanInterval(rs), maxDrawdownR, netPnl: trades.reduce((s, t) => s + t.netPnl, 0), costShareOfGrossMove: gross > 0 ? costs / gross : null };
  }, 'Ledger-verified paper trades in close order.');

  return {
    label: 'PAPER' as const, areas: [directional, probability, entry, exit, regime, performance],
    tradingAuthority: false as const, automaticPromotion: false as const,
    limitations: ['Paper fills are simulated against live order books; they are not exchange executions.',
      'Single trades never change strategy state; areas below their minimum sample report NEEDS_EVIDENCE.',
      'Research scores and QCI votes are not probabilities and are not shown as such.'],
  };
}
