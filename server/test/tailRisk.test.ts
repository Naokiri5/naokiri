import { describe, expect, it } from 'vitest';
import { historicalPortfolioTailRisk, type TailRiskExposure } from '../src/portfolio/tailRisk.js';

const step = 14_400_000;
const end = Date.parse('2026-11-20T12:00:00Z');
const mk = (instrument: string, value: number, prices: number[]): TailRiskExposure => ({
  instrument, value,
  candles: prices.map((c, i) => ({ t: end - prices.length * step + i * step, c })),
});
const priceSeries = Array.from({ length: 101 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i * 1.7)));
const options = { asOf: end, cash: 500 };

describe('historicalPortfolioTailRisk: readonly and fail-closed estimates', () => {
  it('returns a 4h tail-risk estimate but never claims a trade authorization', () => {
    const result = historicalPortfolioTailRisk([mk('BTCUSDT', 1000, priceSeries)], options);
    expect(result.status).toBe('ESTIMATED');
    expect(result.authority).toBe('RESEARCH_ONLY');
    expect(result.observations).toBe(100);
    expect(result.expectedShortfallLoss!).toBeGreaterThanOrEqual(result.varLoss!);
    expect(result.effectiveHoldings).toBe(1);
  });
  it('does not invent a number on insufficient data', () => {
    const result = historicalPortfolioTailRisk([mk('BTCUSDT', 1000, priceSeries.slice(0, 60))], options);
    expect(result).toMatchObject({ status: 'UNAVAILABLE', reason: 'INSUFFICIENT_HISTORY', varLoss: null });
  });
  it('rejects stale observations', () => {
    const old = mk('BTCUSDT', 1000, priceSeries);
    const stale = { ...old, candles: old.candles.map(c => ({ ...c, t: c.t - 5 * step })) };
    expect(historicalPortfolioTailRisk([stale], options).reason).toBe('STALE_HISTORY');
  });
  it('rejects a future or unclosed candle', () => {
    const series = mk('BTCUSDT', 1000, priceSeries);
    const candles = series.candles.map((c, i) => i === series.candles.length - 1 ? { t: end - step / 2, c: 100 } : c);
    expect(historicalPortfolioTailRisk([{ ...series, candles }], options).reason).toBe('INVALID_OR_UNCLOSED_HISTORY');
  });
  it('rejects gaps without silently filling missing bars', () => {
    const series = mk('BTCUSDT', 1000, priceSeries);
    const candles = series.candles.filter((_, i) => i !== 30);
    expect(historicalPortfolioTailRisk([{ ...series, candles }], options).reason).toBe('HISTORY_GAP');
  });
  it('returns NO_EXPOSURE for an empty account and does not pretend zero risk', () => {
    expect(historicalPortfolioTailRisk([], options)).toMatchObject({ status: 'NO_EXPOSURE', varLoss: null });
  });
  it('detects duplicate instruments and nonfinite values', () => {
    const a = mk('BTCUSDT', 1000, priceSeries);
    expect(historicalPortfolioTailRisk([a, a], options).reason).toBe('INVALID_OR_DUPLICATE_EXPOSURE');
    expect(historicalPortfolioTailRisk([{ ...a, value: Infinity }], options).status).toBe('UNAVAILABLE');
  });
  it('reports concentration without pretending equal-weight positions are independent', () => {
    const result = historicalPortfolioTailRisk([
      mk('BTCUSDT', 100, priceSeries), mk('ETHUSDT', 100, priceSeries),
    ], options);
    expect(result.effectiveHoldings).toBe(2);
    expect(result.authority).toBe('RESEARCH_ONLY');
    expect(result.note).toContain('not a forecast');
  });
});
