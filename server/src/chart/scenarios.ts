import type { ChartReport } from './analysis.js';

/**
 * DEEP scenario reconstruction from point-in-time CLOSED candle evidence.
 * Direction weights describe agreement of deterministic rules, not probabilities
 * of profit. Proper scoring and model governance live in the existing DITAS calibration.
 */
export type DeepChartRegime = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'TRANSITIONAL';
export interface DeepScenarioAnalysis {
  asOf: number;
  regime: DeepChartRegime;
  relativeWeights: { bullish: number; sideways: number; bearish: number };
  calibration: 'UNCALIBRATED';
  modelVersion: 'structure-weights-v1';
  tradingAuthority: false;
  signals: string[];
  invalidation: string[];
  note: string;
}
export function analyzeDeepScenarios(
  charts: Record<'15m' | '1h' | '4h', ChartReport>,
): DeepScenarioAnalysis | null {
  const items = [charts['15m'], charts['1h'], charts['4h']];
  if (items.some(x => x.status !== 'VALID')
      || items.some(x => !Number.isSafeInteger(x.asOf) || x.asOf <= 0)
      || items.some(x => x.asOf !== items[0].asOf)) return null;
  const trends = items.map(x => x.trend);
  const bullish = trends.filter(x => x === 'BULLISH').length;
  const bearish = trends.filter(x => x === 'BEARISH').length;
  const ranging = trends.filter(x => x === 'RANGING').length;
  const regime: DeepChartRegime =
    charts['4h'].trend === 'BULLISH' && charts['1h'].trend === 'BULLISH'
      ? 'TRENDING_BULL'
      : charts['4h'].trend === 'BEARISH' && charts['1h'].trend === 'BEARISH'
        ? 'TRENDING_BEAR'
        : ranging >= 2 ? 'RANGING' : 'TRANSITIONAL';
  const breakoutUp = charts['15m'].detections.some(x => x.kind === 'BREAKOUT_UP');
  const breakoutDown = charts['15m'].detections.some(x => x.kind === 'BREAKOUT_DOWN');
  // Never present these as calibrated win probabilities.
  const raw = {
    bullish: 1 + bullish * 2 + (breakoutUp ? 1 : 0),
    sideways: 1 + ranging * 2 + (regime === 'TRANSITIONAL' ? 2 : 0),
    bearish: 1 + bearish * 2 + (breakoutDown ? 1 : 0),
  };
  const total = raw.bullish + raw.sideways + raw.bearish;
  return {
    asOf: items[0].asOf, regime,
    relativeWeights: {
      bullish: raw.bullish / total, sideways: raw.sideways / total, bearish: raw.bearish / total,
    },
    calibration: 'UNCALIBRATED', modelVersion: 'structure-weights-v1', tradingAuthority: false,
    signals: [
      '4H=' + charts['4h'].trend, '1H=' + charts['1h'].trend,
      '15M=' + charts['15m'].trend,
      breakoutUp ? '15M_BREAKOUT_UP' : breakoutDown ? '15M_BREAKOUT_DOWN' : 'AWAITING_BREAKOUT',
    ],
    invalidation: items.flatMap(x => x.detections.filter(d => d.kind.startsWith('BREAKOUT'))
      .map(d => d.invalidation)),
    note: 'Heuristic agreement weights only, NOT forecast probabilities or a trade authorization. Validate on point-in-time held-out outcomes first.',
  };
}
