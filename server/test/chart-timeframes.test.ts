import { describe, expect, it } from 'vitest';
import { analyzeChart } from '../src/chart/analysis.js';
import { summarizeTimeframes } from '../src/chart/timeframes.js';
import { FeatureEngine } from '../src/features/indicators.js';
import type { DeepState } from '../src/market/store.js';
import { INTERVAL_MS, type Candle, type Interval } from '../src/market/types.js';

const asOf = Date.UTC(2026, 10, 18, 13, 14);
const instrument = 'crypto:binance:TESTUSDT';

function candles(timeframe: Interval, trend: 'UP' | 'DOWN' | 'RANGE'): Candle[] {
  const duration = INTERVAL_MS[timeframe];
  const close = Math.floor(asOf / duration) * duration;
  const bars = Array.from({ length: 24 }, (_, i) => ({
    t: close - (24 - i) * duration, o: 100, h: 101, l: 99, c: 100, v: 10,
  }));
  bars[3].h = 104; bars[13].h = trend === 'UP' ? 105 : 103;
  bars[8].l = 95; bars[18].l = trend === 'DOWN' ? 94 : 96;
  return bars;
}

function state(): Pick<DeepState, 'engines' | 'integrityIssues'> {
  const engines = { '15m': new FeatureEngine(), '1h': new FeatureEngine(), '4h': new FeatureEngine() };
  for (const interval of Object.keys(engines) as Interval[]) engines[interval].ingest(candles(interval, 'UP'));
  return { engines, integrityIssues: {} };
}

function summarize(deep: ReturnType<typeof state>) {
  const selected = analyzeChart(instrument, '1h', deep.engines['1h'].candles, asOf);
  return summarizeTimeframes(selected, deep);
}

describe('timeframe agreement from the existing market cache', () => {
  it('aligns directional structures from each current closed interval at one instant', () => {
    const report = summarize(state());
    expect(report).toMatchObject({ asOf, state: 'ALIGNED_BULLISH' });
    expect(report.readings.map(r => [r.timeframe, r.trend, r.closedAt])).toEqual([
      ['15m', 'BULLISH', Date.UTC(2026, 10, 18, 13)],
      ['1h', 'BULLISH', Date.UTC(2026, 10, 18, 13)],
      ['4h', 'BULLISH', Date.UTC(2026, 10, 18, 12)],
    ]);
  });

  it('reports opposing trends even when another interval is unavailable', () => {
    const deep = state();
    deep.engines['15m'] = new FeatureEngine();
    deep.engines['4h'] = new FeatureEngine();
    deep.engines['4h'].ingest(candles('4h', 'DOWN'));
    const report = summarize(deep);
    expect(report.state).toBe('CONFLICTING_SIGNALS');
    expect(report.readings[0].status).toBe('UNAVAILABLE');
    expect(report.readings[2].trend).toBe('BEARISH');
  });

  it('separates range structure from bullish alignment', () => {
    const deep = state();
    deep.engines['4h'] = new FeatureEngine();
    deep.engines['4h'].ingest(candles('4h', 'RANGE'));
    expect(summarize(deep)).toMatchObject({ state: 'MIXED', readings: [expect.anything(), expect.anything(), { trend: 'RANGING' }] });
  });

  it('waits for the latest completed higher-timeframe candle', () => {
    const deep = state();
    deep.engines['4h'].candles.pop();
    const report = summarize(deep);
    expect(report.state).toBe('INSUFFICIENT_DATA');
    expect(report.readings[2]).toMatchObject({ status: 'STALE', trend: 'UNKNOWN', closedAt: Date.UTC(2026, 10, 18, 8) });
  });

  it('withholds a trend when the higher-timeframe cache contains an unfinished candle', () => {
    const deep = state();
    const bars = deep.engines['4h'].candles;
    const last = bars[bars.length - 1];
    bars.push({ ...last, t: last.t + INTERVAL_MS['4h'] });
    expect(summarize(deep)).toMatchObject({
      state: 'INSUFFICIENT_DATA',
      readings: [expect.anything(), expect.anything(), { status: 'INVALID', trend: 'UNKNOWN', issues: ['future or forming candle'] }],
    });
  });

  it('withholds a clean-looking cache after its latest provider batch fails', () => {
    const deep = state();
    deep.integrityIssues = { '1h': ['provider reported a gap'] };
    expect(summarize(deep)).toMatchObject({
      state: 'INSUFFICIENT_DATA',
      readings: [expect.anything(), { status: 'INVALID', trend: 'UNKNOWN', issues: ['provider reported a gap'] }, expect.anything()],
    });
  });

  it('withholds off-grid interval candles even when their series has consistent spacing', () => {
    const deep = state();
    for (const candle of deep.engines['4h'].candles) candle.t += 60_000;
    expect(summarize(deep).readings[2]).toMatchObject({ status: 'INVALID', trend: 'UNKNOWN' });
  });
});
