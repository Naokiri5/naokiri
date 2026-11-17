import { analyzeChart, validateCandles } from './analysis.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';

/** Pure cursor replay: only the visible prefix reaches chart analysis. No OMS or model calls. */
export function replayChart(instrument: string, timeframe: Interval, history: readonly Candle[], visibleBars: number) {
  if (!Number.isInteger(visibleBars) || visibleBars < 1 || visibleBars > history.length || history.length > 2000) throw new Error('visibleBars must be within history; maximum 2000 candles');
  const visible = history.slice(0, visibleBars).map(c => ({ ...c }));
  const asOf = visible[visible.length - 1].t + INTERVAL_MS[timeframe];
  const issues = validateCandles(visible, timeframe, asOf);
  if (issues.length) throw new Error(issues.join('; '));
  return { visibleBars, asOf, candles: visible, report: analyzeChart(instrument, timeframe, visible, asOf), note: 'Blind chart replay only. No trade execution, outcome scoring or profitability certification.' };
}
