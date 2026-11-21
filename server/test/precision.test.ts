import { describe, expect, it } from 'vitest';
import { analyzeDeepPrecision, type PrecisionEvidence } from '../src/chart/precision.js';
import type { Candle, Instrument, Interval } from '../src/market/types.js';
import { WORKERS } from '../src/workers/registry.js';
import type { DataQuality } from '../src/market/quality.js';

/** All fixtures below are synthetic, point-in-time closed-bar data only. */
const NOW = 1_785_400_000_000;
const quality: DataQuality = {
  status: 'OK', quoteAgeMs: 500, candleAgeMs: 300, bookAgeMs: 500,
  sources: ['binance', 'kraken'], independentSources: 2, maxDeviationPct: 0.02, issues: [],
};
const instrument: Instrument = {
  id: 'crypto:binance:BTCUSDT', symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT',
  market: 'crypto', venue: 'binance', tickSize: 0.01, stepSize: 0.0001,
  minQty: 0.0001, minNotional: 5,
};
const duration: Record<Interval, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
function history(iv: Interval, descending = false): Candle[] {
  const step = duration[iv];
  const t0 = Math.floor(NOW / step) * step - 60 * step;
  return Array.from({ length: 60 }, (_, i) => {
    const p = 150 + (descending ? -0.24 : 0.24) * i + 3 * Math.sin(i * Math.PI / 4);
    return { t: t0 + i * step, o: p, h: p + 1.25, l: p - 1.25, c: p + 0.06, v: 1000 + i };
  });
}
const data = (): PrecisionEvidence => ({
  nowMs: NOW, style: 'DAY_TRADING', instrument,
  candles: { '15m': history('15m'), '1h': history('1h'), '4h': history('4h') },
  quality, quote: { price: 159, ts: NOW - 500 },
});

describe('MIA DEEP PRECISION — canonical chart and worker evidence projection', () => {
  it('never claims trading or signing authority, even with favorable synthetic structure', () => {
    const result = analyzeDeepPrecision(data());
    expect(result).toMatchObject({
      version: 'mia-deep-precision-research-v1',
      instrumentId: instrument.id,
      style: 'DAY_TRADING', marketSupport: 'SPOT_RESEARCH_ONLY',
      canAuthorizeTrade: false, canSignOrder: false, canSubmitOrder: false,
      qci: 'NOT_RUN_FOR_THIS_ZONE',
      nextStep: 'WAIT_FOR_CANONICAL_DECISION',
    });
    expect(result.stage).toMatch(/ZONE_IDENTIFIED|ZONE_TOUCHED_UNCONFIRMED/);
    expect(result.bias).toBe('LONG');
    expect(result.zone).toMatchObject({ bias: 'LONG', calibration: 'NOT_CALIBRATED',
      provenance: 'PRIOR_CONFIRMED_15M_EXTREMA' });
    expect(result.zone!.low).toBeLessThanOrEqual(result.zone!.high);
    expect(result.zone!.stop).toBeLessThan(result.zone!.low);
    expect(result.zone!.target).toBeGreaterThan(result.zone!.high);
    expect(result.zone!.rewardRiskAtWorstEdge).toBeGreaterThan(0);
  });
  it('reuses existing 100-worker registry metadata without manufacturing worker votes', () => {
    const r = analyzeDeepPrecision(data());
    expect(r.workerPlan.registeredWorkers).toBe(WORKERS.length);
    expect(r.workerPlan.selectedWorkers).toBeLessThanOrEqual(WORKERS.length);
    expect(new Set(r.workerPlan.eligibleWorkerIds).size).toBe(r.workerPlan.selectedWorkers);
    expect(r.workerPlan.evidenceQuorum).toBe('NOT_EVALUATED');
    expect(r.reasons).toContain('QCI_AND_CANONICAL_RISK_RECHECK_REQUIRED_BEFORE_ENTRY');
  });
  it('rejects an unknown broker/market execution capability rather than inventing forex/futures/ETF support', () => {
    const r = analyzeDeepPrecision({ ...data(), instrument: {
      ...instrument, id: 'stocks:unverified:TEST', market: 'stocks', venue: 'unverified',
    } });
    expect(r.stage).toBe('NO_TRADE');
    expect(r.marketSupport).toBe('MARKET_ADAPTER_NOT_CERTIFIED');
    expect(r.reasons).toContain('MARKET_ADAPTER_NOT_CERTIFIED');
  });
  it('refuses scalping execution without a verified 1m/tick trigger feed', () => {
    const r = analyzeDeepPrecision({ ...data(), style: 'SCALPING' });
    expect(r.stage).toBe('NO_TRADE');
    expect(r.reasons).toContain('ONE_MINUTE_OR_TICK_TRIGGER_FEED_NOT_AVAILABLE');
  });
  it('does not silently replace a failed canonical market-quality gate with chart confidence', () => {
    const r = analyzeDeepPrecision({ ...data(), quality: { ...quality, status: 'FAIL', issues: ['cross-venue disagreement'] } });
    expect(r.stage).toBe('NO_TRADE');
    expect(r.reasons).toContain('CANONICAL_DATA_QUALITY_NOT_OK');
    expect(r.canAuthorizeTrade).toBe(false);
  });
  it('fails closed for stale, future-dated or missing quotes', () => {
    const base = data();
    for (const quote of [
      null, { price: 159, ts: NOW + 1 }, { price: 159, ts: NOW - 60_001 },
      { price: NaN, ts: NOW - 500 }, { price: 0, ts: NOW - 500 },
    ]) {
      const r = analyzeDeepPrecision({ ...base, quote });
      expect(r.stage).toBe('NO_TRADE');
      expect(r.reasons).toContain('NO_FRESH_EXECUTABLE_REFERENCE_QUOTE');
    }
  });
  it('requires all three native closed and contiguous candle timeframes', () => {
    const a = data();
    for (const candles of [
      { ...a.candles, '1h': [] },
      { ...a.candles, '4h': a.candles['4h']!.slice(0, -6) },
      { ...a.candles, '15m': a.candles['15m']!.map((c, i) => i === 5 ? { ...c, c: NaN } : c) },
      { ...a.candles, '15m': a.candles['15m']!.map((c, i) => i === 59 ? { ...c, t: NOW } : c) },
    ]) {
      const r = analyzeDeepPrecision({ ...a, candles });
      expect(r.stage).toBe('NO_TRADE');
      expect(r.reasons).toContain('CONFIRMED_MULTI_TIMEFRAME_DATA_REQUIRED');
    }
  });
  it('refuses a synthetic short even when downtrend pivots are confirmed in spot', () => {
    const x = data();
    const r = analyzeDeepPrecision({ ...x,
      candles: { '15m': history('15m', true), '1h': history('1h', true), '4h': history('4h', true) } });
    expect(r.bias).toBe('SHORT');
    expect(r.stage).toBe('NO_TRADE');
    expect(r.reasons).toContain('SPOT_SHORT_NOT_SUPPORTED');
  });
  it('never mutates original candles or uses the explicitly forming candle supplied elsewhere in MIA', () => {
    const x = data();
    const before = structuredClone(x.candles);
    expect(analyzeDeepPrecision(x)).toEqual(analyzeDeepPrecision(x));
    expect(x.candles).toEqual(before);
  });
  it('fails closed when the requested chart has an invalid tick size', () => {
    const r = analyzeDeepPrecision({ ...data(), instrument: { ...instrument, tickSize: 0 } });
    expect(r.stage).toBe('NO_TRADE');
    expect(r.reasons).toContain('INVALID_MARKET_TICK_SIZE');
  });
});
