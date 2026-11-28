import { describe, expect, it } from 'vitest';
import { buildDirectionForecast } from '../src/ditas/directionForecast.js';
import { INTERVAL_MS, type Candle, type Interval } from '../src/market/types.js';

const NOW = Date.UTC(2026, 10, 28);
const INSTRUMENT = 'futures:binance-usdm:BTCUSDT';

function barsFromReturns(horizon: Interval, growth: readonly number[]): Candle[] {
  const duration = INTERVAL_MS[horizon];
  let price = 100;
  return [1, ...growth].map((ratio, i, all) => {
    const t = NOW - (all.length - i) * duration;
    price *= ratio;
    return { t, o: price, h: price, l: price, c: price, v: 1, closeTime: t + duration - 1 };
  });
}

describe('DITAS empirical direction forecasts', () => {
  it('fits a three-way distribution with declared horizon-specific thresholds', () => {
    const growth = Array.from({ length: 48 }, (_, i) => [1.003, 1, 0.997][i % 3]);
    for (const [horizon, deadbandBps, probabilities] of [
      ['15m', 10, { BULLISH: 1 / 3, SIDEWAYS: 1 / 3, BEARISH: 1 / 3 }],
      ['1h', 20, { BULLISH: 1 / 3, SIDEWAYS: 1 / 3, BEARISH: 1 / 3 }],
      ['4h', 40, { BULLISH: 1 / 51, SIDEWAYS: 49 / 51, BEARISH: 1 / 51 }],
    ] as const) {
      const bars = barsFromReturns(horizon, growth);
      const forecast = buildDirectionForecast(INSTRUMENT, horizon, bars, NOW)!;
      expect(forecast).toMatchObject({
        modelVersion: 'empirical-direction-v1', instrumentId: INSTRUMENT, horizon, asOf: NOW, referenceAt: NOW,
        targetAt: NOW + INTERVAL_MS[horizon], referencePrice: bars.at(-1)!.c, deadbandBps, sampleCount: 48,
        probabilities, calibrationStatus: 'MEASURED_NOT_CERTIFIED', tradingAuthority: false,
      });
      expect(forecast.empiricalPriceRange.lower).toBeCloseTo(forecast.referencePrice * 0.997, 10);
      expect(forecast.empiricalPriceRange.upper).toBeCloseTo(forecast.referencePrice * 1.003, 10);
      expect(forecast.empiricalPriceRange).toMatchObject({ lowerQuantile: 0.1, upperQuantile: 0.9 });
    }
  });

  it('scores each historical target before learning it and compares the same targets to a uniform forecast', () => {
    const bars = barsFromReturns('15m', [...Array<number>(24).fill(1), ...Array<number>(24).fill(1.01)]);
    const forecast = buildDirectionForecast(INSTRUMENT, '15m', bars, NOW)!;
    const testProbabilities = Array.from({ length: 24 }, (_, observedBullish) => ({
      pBullish: (observedBullish + 1) / (observedBullish + 27),
      pSideways: 25 / (observedBullish + 27),
      pBearish: 1 / (observedBullish + 27),
    }));
    const meanBrier = testProbabilities.reduce((sum, p) => sum + (1 - p.pBullish) ** 2 + p.pSideways ** 2 + p.pBearish ** 2, 0) / 24;
    const meanLogLoss = testProbabilities.reduce((sum, p) => sum - Math.log(p.pBullish), 0) / 24;
    expect(forecast.historicalEvaluation.sampleCount).toBe(24);
    expect(forecast.historicalEvaluation.model.brierScore).toBeCloseTo(meanBrier, 12);
    expect(forecast.historicalEvaluation.model.logLoss).toBeCloseTo(meanLogLoss, 12);
    expect(forecast.historicalEvaluation.uniform.brierScore).toBeCloseTo(2 / 3, 12);
    expect(forecast.historicalEvaluation.uniform.logLoss).toBeCloseTo(Math.log(3), 12);
    expect(forecast.historicalEvaluation.model.logLoss).toBeGreaterThan(forecast.historicalEvaluation.uniform.logLoss);
    expect(forecast.probabilities).toEqual({ BULLISH: 25 / 51, SIDEWAYS: 25 / 51, BEARISH: 1 / 51 });
  });

  it('withholds forecasts for insufficient, malformed, gapped, forming, expired or oversized histories', () => {
    const bars = barsFromReturns('1h', Array<number>(48).fill(1));
    const duration = INTERVAL_MS['1h'];
    expect(buildDirectionForecast(INSTRUMENT, '1h', bars, NOW + duration - 1)).not.toBeNull();
    expect(buildDirectionForecast(INSTRUMENT, '1h', bars, NOW + duration)).toBeNull();
    expect(buildDirectionForecast(INSTRUMENT, '1h', bars, NOW - 1)).toBeNull();
    expect(buildDirectionForecast(INSTRUMENT, '1h', bars.slice(1), NOW)).toBeNull();
    expect(buildDirectionForecast(INSTRUMENT, '1h', barsFromReturns('1h', Array<number>(401).fill(1)), NOW)).toBeNull();
    const broken = bars.slice();
    broken[1] = { ...broken[1], h: 99 };
    expect(buildDirectionForecast(INSTRUMENT, '1h', broken, NOW)).toBeNull();
    const gap = barsFromReturns('1h', Array<number>(49).fill(1)).filter((_, i) => i !== 1);
    expect(buildDirectionForecast(INSTRUMENT, '1h', gap, NOW)).toBeNull();
  });
});
