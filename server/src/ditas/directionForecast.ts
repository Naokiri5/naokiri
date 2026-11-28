import { validateCandles } from '../chart/analysis.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';
import { scoreMulticlassForecast, type ScenarioOutcomeClass, type ScenarioProbabilities } from './calibration.js';

export const DIRECTION_MODEL_VERSION = 'empirical-direction-v1';
export const DIRECTION_FORECAST_TARGET = 'DIRECTION_WITH_DEADBAND';
export const DIRECTION_FORECAST_SOURCE = 'BINANCE_USDM_PUBLIC_CLOSED_BAR';
export const DIRECTION_DEADBAND_BPS: Readonly<Record<Interval, number>> = { '15m': 10, '1h': 20, '4h': 40 };
const MIN_TRAINING_RETURNS = 24;
const MIN_EVALUATION_RETURNS = 24;
const MAX_CANDLES = 400;
const LOWER_QUANTILE = 0.1;
const UPPER_QUANTILE = 0.9;
const UNIFORM: ScenarioProbabilities = { BULLISH: 1 / 3, SIDEWAYS: 1 / 3, BEARISH: 1 / 3 };

interface ForecastScores { brierScore: number; logLoss: number }

export interface DirectionForecast {
  modelVersion: typeof DIRECTION_MODEL_VERSION;
  instrumentId: string;
  horizon: Interval;
  asOf: number;
  referenceAt: number;
  targetAt: number;
  referencePrice: number;
  deadbandBps: number;
  sampleCount: number;
  probabilities: ScenarioProbabilities;
  empiricalPriceRange: { lower: number; upper: number; lowerQuantile: typeof LOWER_QUANTILE; upperQuantile: typeof UPPER_QUANTILE };
  historicalEvaluation: { sampleCount: number; model: ForecastScores; uniform: ForecastScores };
  calibrationStatus: 'MEASURED_NOT_CERTIFIED';
  tradingAuthority: false;
}

function distribution(counts: Record<ScenarioOutcomeClass, number>, sampleCount: number): ScenarioProbabilities {
  return {
    BULLISH: (counts.BULLISH + 1) / (sampleCount + 3),
    SIDEWAYS: (counts.SIDEWAYS + 1) / (sampleCount + 3),
    BEARISH: (counts.BEARISH + 1) / (sampleCount + 3),
  };
}

export function directionOutcome(growth: number, deadbandBps: number): ScenarioOutcomeClass | null {
  if (!Number.isFinite(growth) || growth <= 0) return null;
  const boundary = deadbandBps / 10_000;
  return growth > 1 + boundary ? 'BULLISH' : growth < 1 - boundary ? 'BEARISH' : 'SIDEWAYS';
}

/**
 * Fit an unconditional Laplace-smoothed distribution of one-bar, close-to-close returns. The input must be one
 * instrument's contiguous closed bars. Growth beyond ±deadband is directional; either boundary is sideways.
 * Historical evaluation uses an expanding prefix and scores each target before adding its observed return.
 */
export function buildDirectionForecast(
  instrumentId: string, horizon: Interval, candles: readonly Candle[], asOf: number,
): DirectionForecast | null {
  if (typeof instrumentId !== 'string' || !instrumentId.trim() || !Object.hasOwn(INTERVAL_MS, horizon)
      || !Number.isSafeInteger(asOf) || asOf <= 0 || !Array.isArray(candles)
      || candles.length < 1 + MIN_TRAINING_RETURNS + MIN_EVALUATION_RETURNS || candles.length > MAX_CANDLES) return null;
  const duration = INTERVAL_MS[horizon];
  for (const bar of candles) {
    if (!bar || !Number.isSafeInteger(bar.t) || (bar.closeTime != null &&
        (!Number.isSafeInteger(bar.closeTime) || bar.closeTime < bar.t || bar.closeTime > bar.t + duration))) return null;
  }
  if (validateCandles(candles, horizon, asOf).length) return null;

  const reference = candles[candles.length - 1];
  const referenceAt = reference.t + duration;
  const targetAt = referenceAt + duration;
  if (!Number.isSafeInteger(targetAt) || asOf >= targetAt) return null;

  const deadbandBps = DIRECTION_DEADBAND_BPS[horizon];
  const counts: Record<ScenarioOutcomeClass, number> = { BULLISH: 0, SIDEWAYS: 0, BEARISH: 0 };
  const returns: number[] = [];
  const model = { brierScore: 0, logLoss: 0 };
  const uniform = { brierScore: 0, logLoss: 0 };
  for (let i = 1; i < candles.length; i++) {
    const growth = candles[i].c / candles[i - 1].c;
    const outcome = directionOutcome(growth, deadbandBps);
    if (!outcome) return null;
    if (returns.length >= MIN_TRAINING_RETURNS) {
      const candidate = scoreMulticlassForecast(distribution(counts, returns.length), outcome);
      const baseline = scoreMulticlassForecast(UNIFORM, outcome);
      model.brierScore += candidate.brierScore;
      model.logLoss += candidate.logLoss;
      uniform.brierScore += baseline.brierScore;
      uniform.logLoss += baseline.logLoss;
    }
    returns.push(growth);
    counts[outcome]++;
  }

  // Nearest-rank historical return quantiles anchored to the reference close. Coverage is not certified.
  returns.sort((a, b) => a - b);
  const lower = reference.c * returns[Math.ceil(LOWER_QUANTILE * returns.length) - 1];
  const upper = reference.c * returns[Math.ceil(UPPER_QUANTILE * returns.length) - 1];
  if (!(lower > 0) || !Number.isFinite(upper)) return null;

  const evaluationCount = returns.length - MIN_TRAINING_RETURNS;
  return {
    modelVersion: DIRECTION_MODEL_VERSION, instrumentId, horizon, asOf, referenceAt, targetAt, referencePrice: reference.c,
    deadbandBps, sampleCount: returns.length, probabilities: distribution(counts, returns.length),
    empiricalPriceRange: { lower, upper, lowerQuantile: LOWER_QUANTILE, upperQuantile: UPPER_QUANTILE },
    historicalEvaluation: {
      sampleCount: evaluationCount,
      model: { brierScore: model.brierScore / evaluationCount, logLoss: model.logLoss / evaluationCount },
      uniform: { brierScore: uniform.brierScore / evaluationCount, logLoss: uniform.logLoss / evaluationCount },
    },
    calibrationStatus: 'MEASURED_NOT_CERTIFIED', tradingAuthority: false,
  };
}
