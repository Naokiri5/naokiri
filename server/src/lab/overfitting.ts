/**
 * Selection-bias and overfitting statistics for Strategy Lab qualification. Pure and deterministic.
 *
 * - Probabilistic Sharpe Ratio (PSR): probability that the true Sharpe exceeds a benchmark, given sample length,
 *   skewness and kurtosis of the returns.
 * - Deflated Sharpe Ratio (DSR): PSR against the Sharpe expected from the best of N independent trials with no skill.
 *   Bailey and Lopez de Prado, "The Deflated Sharpe Ratio" (2014).
 * - Probability of Backtest Overfitting (PBO) by combinatorially symmetric cross-validation (CSCV).
 *   Bailey, Borwein, Lopez de Prado and Zhu, "The Probability of Backtest Overfitting" (2016).
 *
 * All Sharpe ratios here are per observation (per trade or per period), never annualized. These are evidence
 * statistics, not probabilities of profit.
 */

const EULER_MASCHERONI = 0.5772156649015329;
/** Minimum deflated Sharpe for Strategy Lab qualification and genome verification (one shared rule). */
export const MIN_DEFLATED_SHARPE = 0.95;

/**
 * Variance of a Sharpe estimate under the no-skill null for n observations with the given raw moments. Used as a floor
 * for cross-trial variance, so repeated near-identical trials cannot shrink the DSR benchmark toward zero.
 */
export function sharpeEstimatorVariance(sharpe: number, n: number, skewness = 0, kurtosis = 3): number {
  if (!Number.isInteger(n) || n < 2) throw new Error('SHARPE_VARIANCE_INPUT_INVALID');
  return Math.max(0, 1 - skewness * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe) / (n - 1);
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 via erf; absolute error below 1.5e-7). */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Number.POSITIVE_INFINITY) return 1;
  if (x === Number.NEGATIVE_INFINITY) return 0;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Inverse standard normal CDF (Acklam's rational approximation; relative error below 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    return Number.NaN;
  }
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface ReturnMoments { n: number; mean: number; sd: number; sharpe: number; skewness: number; kurtosis: number }

/** Sample moments of a return series. Kurtosis is the raw (non-excess) fourth standardized moment: 3 for a normal. */
export function returnMoments(returns: readonly number[]): ReturnMoments {
  const n = returns.length;
  if (n < 2 || !returns.every(Number.isFinite)) throw new Error('RETURNS_INVALID: need at least two finite returns');
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const m2 = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const m3 = returns.reduce((s, r) => s + (r - mean) ** 3, 0) / n;
  const m4 = returns.reduce((s, r) => s + (r - mean) ** 4, 0) / n;
  const sd = Math.sqrt(m2 * n / (n - 1));
  if (!(m2 > 0)) return { n, mean, sd: 0, sharpe: 0, skewness: 0, kurtosis: 3 };
  return { n, mean, sd, sharpe: mean / sd, skewness: m3 / m2 ** 1.5, kurtosis: m4 / m2 ** 2 };
}

/**
 * P(true Sharpe > benchmark). `kurtosis` is raw (3 for normal returns). Returns 0 when the variance term is not
 * positive, which only happens for degenerate inputs, so the result can never overstate evidence.
 */
export function probabilisticSharpe(sharpe: number, benchmark: number, n: number, skewness = 0, kurtosis = 3): number {
  if (![sharpe, benchmark, skewness, kurtosis].every(Number.isFinite) || !Number.isInteger(n) || n < 2) throw new Error('PSR_INPUT_INVALID');
  const variance = 1 - skewness * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe;
  if (!(variance > 0)) return 0;
  return normalCdf(((sharpe - benchmark) * Math.sqrt(n - 1)) / Math.sqrt(variance));
}

/** Sharpe expected from the best of `trials` independent no-skill strategies whose Sharpe estimates vary as given. */
export function expectedMaxSharpe(trials: number, sharpeVariance: number): number {
  if (!Number.isInteger(trials) || trials < 1 || !(Number.isFinite(sharpeVariance) && sharpeVariance >= 0)) throw new Error('EXPECTED_MAX_SHARPE_INPUT_INVALID');
  if (trials === 1 || sharpeVariance === 0) return 0;
  return Math.sqrt(sharpeVariance) * ((1 - EULER_MASCHERONI) * normalQuantile(1 - 1 / trials) + EULER_MASCHERONI * normalQuantile(1 - 1 / (trials * Math.E)));
}

/** Deflated Sharpe Ratio: PSR against the best-of-N no-skill benchmark. */
export function deflatedSharpe(input: { sharpe: number; n: number; skewness: number; kurtosis: number; trials: number; sharpeVariance: number }) {
  const benchmark = expectedMaxSharpe(input.trials, input.sharpeVariance);
  return { benchmark, dsr: probabilisticSharpe(input.sharpe, benchmark, input.n, input.skewness, input.kurtosis) };
}

function sharpeOf(values: readonly number[]): number {
  const n = values.length; if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  // Zero dispersion ranks by the sign of the mean only (used for ranking, never reported as a Sharpe).
  return sd > 0 ? mean / sd : mean > 0 ? Number.MAX_VALUE : mean < 0 ? -Number.MAX_VALUE : 0;
}

/** All k-element subsets of 0..n-1 in lexicographic order. */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = [], pick: number[] = [];
  const walk = (start: number) => {
    if (pick.length === k) { out.push([...pick]); return; }
    for (let i = start; i <= n - (k - pick.length); i++) { pick.push(i); walk(i + 1); pick.pop(); }
  };
  walk(0);
  return out;
}

/**
 * Probability of Backtest Overfitting by CSCV. `returns[t][j]` is the return of trial j in period t (all trials share
 * the same periods). Rows are split into `groups` contiguous blocks; for every half/half split the trial with the best
 * in-sample Sharpe is ranked out of sample. PBO is the share of splits where it ranks at or below the OOS median.
 */
export function probabilityOfBacktestOverfitting(returns: readonly (readonly number[])[], groups = 8) {
  const periods = returns.length, trials = returns[0]?.length ?? 0;
  if (!Number.isInteger(groups) || groups < 2 || groups > 16 || groups % 2 !== 0) throw new Error('PBO_GROUPS_INVALID: use an even number from 2 to 16');
  if (trials < 2) throw new Error('PBO_INPUT_INVALID: need at least two trials');
  if (periods < groups * 2) throw new Error('PBO_INPUT_INVALID: need at least two periods per group');
  if (!returns.every((row) => row.length === trials && row.every(Number.isFinite))) throw new Error('PBO_INPUT_INVALID: ragged or non-finite returns');
  const size = Math.floor(periods / groups);
  // Trailing periods beyond an even split are dropped so every group has the same length.
  const blocks = Array.from({ length: groups }, (_, g) => Array.from({ length: size }, (_, i) => g * size + i));
  const column = (rows: number[], j: number) => rows.map((t) => returns[t][j]);
  const logits: number[] = [];
  for (const inSample of combinations(groups, groups / 2)) {
    const isRows = inSample.flatMap((g) => blocks[g]);
    const oosRows = blocks.map((_, g) => g).filter((g) => !inSample.includes(g)).flatMap((g) => blocks[g]);
    const isPerf = Array.from({ length: trials }, (_, j) => sharpeOf(column(isRows, j)));
    const oosPerf = Array.from({ length: trials }, (_, j) => sharpeOf(column(oosRows, j)));
    // Ties in-sample resolve to the lowest index, so the result is deterministic.
    const best = isPerf.reduce((b, v, j) => (v > isPerf[b] ? j : b), 0);
    const below = oosPerf.filter((v) => v < oosPerf[best]).length, equal = oosPerf.filter((v) => v === oosPerf[best]).length;
    const rank = below + (equal + 1) / 2; // 1..trials, average rank for ties
    const omega = rank / (trials + 1);
    logits.push(Math.log(omega / (1 - omega)));
  }
  const overfit = logits.filter((l) => l <= 0).length;
  return { pbo: overfit / logits.length, splits: logits.length, trials, periodsUsed: size * groups, medianLogit: [...logits].sort((x, y) => x - y)[Math.floor(logits.length / 2)] };
}
