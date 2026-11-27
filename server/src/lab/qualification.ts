/**
 * Strategy qualification: does a strategy version's out-of-sample evidence support a statistical edge after costs,
 * once the number of backtest trials is accounted for? Pure; Strategy Lab (lab.ts) supplies the evidence and owns the
 * lifecycle. A QUALIFIED verdict is a precondition for the owner's PAPER promotion, never a promotion by itself and
 * never LIVE authorization.
 */
import { mean } from '../core/util.js';
import { stats, BACKTEST_MODEL_VERSION, type BtTrade } from './backtest.js';
import { deflatedSharpe, MIN_DEFLATED_SHARPE, returnMoments, sharpeEstimatorVariance } from './overfitting.js';

/** Thresholds are fixed in code so they are reviewed like any other risk rule; they are not owner-tunable at runtime. */
export const QUALIFICATION_RULES = Object.freeze({
  minOosTrades: 30,
  /** z for a one-sided 97.5% / two-sided 95% interval on mean trade R. */
  confidenceZ: 1.96,
  minDeflatedSharpe: MIN_DEFLATED_SHARPE,
  minProfitFactor: 1.2,
  /** Placeholder envelope pending owner confirmation; tighter is allowed, looser is not. Max OOS drawdown in R. */
  maxDrawdownR: 10,
  /** Walk-forward consistency: OOS trades in exit order are split into this many equal-count periods. */
  periods: 3,
  /** At most this many periods may have mean R <= 0, and the most recent period must be positive. */
  maxNonPositivePeriods: 1,
  /** Cost stress: one extra unit of modeled cost per trade (2x total costs). */
  costStressMultiple: 2,
});

export type QualificationReason =
  | 'NO_BACKTEST' | 'LEGACY_FILL_MODEL' | 'INSUFFICIENT_SAMPLE' | 'NON_POSITIVE_EXPECTANCY'
  | 'EXPECTANCY_NOT_SIGNIFICANT' | 'DEFLATED_SHARPE_TOO_LOW'
  | 'PROFIT_FACTOR_TOO_LOW' | 'DRAWDOWN_TOO_LARGE' | 'PERIOD_INCONSISTENT' | 'COST_STRESS_FAILED';

export interface QualificationEvidence {
  strategyVersion: string;
  modelVersion: number;
  instruments: number;
  /** Out-of-sample trades, net of the backtest's fee, spread and slippage model, in R. */
  trades: readonly BtTrade[];
  /** OOS trade R of every distinct backtest configuration of this version: each one is a trial. */
  runOosR: readonly (readonly number[])[];
  /** Stored runs of this strategy version under another, non-current fill model. They are never evidence; they only mean a re-run is needed. */
  otherModelRuns?: number;
}

export interface QualificationReport {
  verdict: 'QUALIFIED' | 'NOT_QUALIFIED';
  reasons: QualificationReason[];
  strategyVersion: string | null;
  metrics: null | {
    oosTrades: number; instruments: number; trials: number; expectancyR: number; expectancyLowerR: number;
    sharpePerTrade: number; skewness: number; kurtosis: number; deflatedSharpe: number; deflatedSharpeBenchmark: number;
    sharpeVarianceSource: 'CROSS_TRIAL' | 'ESTIMATOR'; profitFactor: number;
    /** Over the pooled trades in exit-time order. */
    maxDrawdownR: number;
    /** Extra cost per trade, in R, that would remove the measured edge. */
    breakevenExtraCostR: number;
    /** Mean R of each chronological OOS period (exit order, equal counts); empty when fewer trades than periods. */
    periodExpectancyR: number[];
    /** Mean R after one extra cost unit per trade (2x modeled costs); null when any trade lacks a finite costR >= 0. */
    stressedExpectancyR: number | null;
    stressedExpectancyLowerR: number | null;
  };
  rules: typeof QUALIFICATION_RULES;
  limitations: readonly string[];
  automaticPromotion: false;
  liveAuthority: false;
}

const LIMITATIONS = Object.freeze([
  'Costs are the backtest model (fixed fee, spread and slippage), not measured executable depth.',
  'Trades pooled across instruments can overlap in time and are not independent, so the sample size is optimistic.',
  'OOS is the latest segment of each history; selection made while designing a strategy in code is not counted as a trial.',
]);
const report = (reasons: QualificationReason[], strategyVersion: string | null, metrics: QualificationReport['metrics'] = null): QualificationReport =>
  ({ verdict: reasons.length ? 'NOT_QUALIFIED' : 'QUALIFIED', reasons, strategyVersion, metrics, rules: QUALIFICATION_RULES, limitations: LIMITATIONS, automaticPromotion: false, liveAuthority: false });

/**
 * Variance of Sharpe across trials: the cross-sectional variance of the trials' OOS Sharpe ratios (as in the DSR paper)
 * when two or more trials have at least two trades, floored at the variance of the Sharpe estimator itself, so
 * near-identical trials cannot collapse the benchmark.
 */
function sharpeVariance(evidence: QualificationEvidence, moments: ReturnType<typeof returnMoments>) {
  const floor = sharpeEstimatorVariance(moments.sharpe, moments.n, moments.skewness, moments.kurtosis);
  const runSharpes = evidence.runOosR.filter((r) => r.length >= 2).map((r) => returnMoments(r).sharpe);
  if (runSharpes.length >= 2) {
    const mean = runSharpes.reduce((s, v) => s + v, 0) / runSharpes.length;
    const cross = runSharpes.reduce((s, v) => s + (v - mean) ** 2, 0) / (runSharpes.length - 1);
    if (cross > floor) return { variance: cross, source: 'CROSS_TRIAL' as const };
  }
  return { variance: floor, source: 'ESTIMATOR' as const };
}


/** Mean R of each of `k` chronological equal-count periods (sizes differ by at most one). */
function periodMeans(rs: readonly number[], k: number): number[] {
  if (rs.length < k) return [];
  return Array.from({ length: k }, (_, j) => mean(rs.slice(Math.floor(j * rs.length / k), Math.floor((j + 1) * rs.length / k))));
}

/** Cost stress at 2x modeled costs. Fails closed (null) when any trade has no finite non-negative costR. */
function costStress(trades: readonly BtTrade[]): { mean: number; lower: number } | null {
  if (trades.length < 2) return null;
  if (!trades.every((t) => typeof t.costR === 'number' && Number.isFinite(t.costR) && t.costR >= 0)) return null;
  const m = returnMoments(trades.map((t) => t.r - (t.costR as number)));
  return { mean: m.mean, lower: m.mean - QUALIFICATION_RULES.confidenceZ * m.sd / Math.sqrt(m.n) };
}

export function qualifyEvidence(evidence: QualificationEvidence | null): QualificationReport {
  if (!evidence || !evidence.trades.length) {
    return report([evidence?.otherModelRuns ? 'LEGACY_FILL_MODEL' : 'NO_BACKTEST'], evidence?.strategyVersion ?? null);
  }
  const reasons: QualificationReason[] = [];
  if (evidence.modelVersion !== BACKTEST_MODEL_VERSION) reasons.push('LEGACY_FILL_MODEL');
  const rs = evidence.trades.map((t) => t.r);
  if (rs.length < QUALIFICATION_RULES.minOosTrades) reasons.push('INSUFFICIENT_SAMPLE');
  if (rs.length < 2) return report(reasons.length ? reasons : ['INSUFFICIENT_SAMPLE'], evidence.strategyVersion);

  const moments = returnMoments(rs);
  const lower = moments.mean - QUALIFICATION_RULES.confidenceZ * moments.sd / Math.sqrt(moments.n);
  const trials = Math.max(1, evidence.runOosR.length);
  const variance = sharpeVariance(evidence, moments);
  const { dsr, benchmark } = deflatedSharpe({ sharpe: moments.sharpe, n: moments.n, skewness: moments.skewness, kurtosis: moments.kurtosis, trials, sharpeVariance: variance.variance });
  if (!(moments.mean > 0)) reasons.push('NON_POSITIVE_EXPECTANCY');
  else if (!(lower > 0)) reasons.push('EXPECTANCY_NOT_SIGNIFICANT');
  if (!(dsr >= QUALIFICATION_RULES.minDeflatedSharpe)) reasons.push('DEFLATED_SHARPE_TOO_LOW');
  const ordered = [...evidence.trades].sort((a, b) => a.exitT - b.exitT || a.entryT - b.entryT || a.r - b.r);
  const s = stats(ordered);
  if (!(s.profitFactor >= QUALIFICATION_RULES.minProfitFactor)) reasons.push('PROFIT_FACTOR_TOO_LOW');
  if (!(s.maxDrawdownR <= QUALIFICATION_RULES.maxDrawdownR)) reasons.push('DRAWDOWN_TOO_LARGE');
  const periodExpectancyR = periodMeans(ordered.map((t) => t.r), QUALIFICATION_RULES.periods);
  const weak = periodExpectancyR.filter((v) => !(v > 0)).length;
  const recent = periodExpectancyR[periodExpectancyR.length - 1];
  if (periodExpectancyR.length && (!(recent > 0) || weak > QUALIFICATION_RULES.maxNonPositivePeriods)) reasons.push('PERIOD_INCONSISTENT');
  const stress = costStress(ordered);
  if (!stress || !(stress.mean > 0) || !(stress.lower > 0)) reasons.push('COST_STRESS_FAILED');
  return report(reasons, evidence.strategyVersion, {
    oosTrades: moments.n, instruments: evidence.instruments, trials, expectancyR: moments.mean, expectancyLowerR: lower,
    sharpePerTrade: moments.sharpe, skewness: moments.skewness, kurtosis: moments.kurtosis, deflatedSharpe: dsr,
    deflatedSharpeBenchmark: benchmark, sharpeVarianceSource: variance.source, profitFactor: s.profitFactor,
    maxDrawdownR: s.maxDrawdownR, breakevenExtraCostR: Math.max(0, moments.mean),
    periodExpectancyR, stressedExpectancyR: stress?.mean ?? null, stressedExpectancyLowerR: stress?.lower ?? null,
  });
}
