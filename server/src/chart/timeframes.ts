import { INTERVAL_MS, type Interval } from '../market/types.js';
import type { DeepState } from '../market/store.js';
import { analyzeChart, type ChartReport } from './analysis.js';

interface TimeframeReading {
  timeframe: Interval;
  trend: ChartReport['trend'];
  status: ChartReport['status'] | 'UNAVAILABLE' | 'STALE';
  closedAt: number | null;
  issues: string[];
}

export interface TimeframeAgreement {
  asOf: number;
  state: 'ALIGNED_BULLISH' | 'ALIGNED_BEARISH' | 'CONFLICTING_SIGNALS' | 'MIXED' | 'NO_DIRECTION' | 'INSUFFICIENT_DATA';
  readings: TimeframeReading[];
}

/** Compare the same confirmed structure across each existing Binance spot cache at one clock reading. */
export function summarizeTimeframes(
  selected: ChartReport,
  deep: Pick<DeepState, 'engines' | 'integrityIssues'> | undefined,
): TimeframeAgreement {
  const { asOf } = selected;
  const readings = (Object.keys(INTERVAL_MS) as Interval[]).map((timeframe): TimeframeReading => {
    const unavailable = (status: TimeframeReading['status'], issues: string[]): TimeframeReading =>
      ({ timeframe, status, trend: 'UNKNOWN', closedAt: null, issues });
    const candles = deep?.engines[timeframe].candles;
    if (!candles?.length) return unavailable('UNAVAILABLE', ['No closed candles in the market cache']);
    const sourceIssues = deep?.integrityIssues?.[timeframe];
    if (sourceIssues?.length) return unavailable('INVALID', sourceIssues);

    const report = timeframe === selected.timeframe ? selected : analyzeChart(selected.instrument, timeframe, candles, asOf);
    if (report.status === 'INSUFFICIENT_DATA') return unavailable(report.status, ['At least 22 closed candles are required']);
    if (report.status !== 'VALID') return unavailable(report.status, report.issues);

    const duration = INTERVAL_MS[timeframe];
    const closedAt = candles[candles.length - 1].t + duration;
    if (closedAt % duration !== 0) return unavailable('INVALID', ['Candle timestamps do not match the UTC timeframe boundaries']);
    if (closedAt < Math.floor(asOf / duration) * duration) {
      return { ...unavailable('STALE', ['The latest completed candle has not reached the market cache']), closedAt };
    }
    const issues = report.trend === 'UNKNOWN' ? ['Too few confirmed swing highs or lows'] : [];
    return { timeframe, status: 'VALID', trend: report.trend, closedAt, issues };
  });

  const bullish = readings.filter(r => r.trend === 'BULLISH').length;
  const bearish = readings.filter(r => r.trend === 'BEARISH').length;
  let state: TimeframeAgreement['state'];
  if (bullish && bearish) state = 'CONFLICTING_SIGNALS';
  else if (readings.some(r => r.status !== 'VALID' || r.trend === 'UNKNOWN')) state = 'INSUFFICIENT_DATA';
  else if (bullish === readings.length) state = 'ALIGNED_BULLISH';
  else if (bearish === readings.length) state = 'ALIGNED_BEARISH';
  else state = bullish || bearish ? 'MIXED' : 'NO_DIRECTION';

  return { asOf, state, readings };
}
