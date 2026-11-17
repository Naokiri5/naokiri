import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { closeDb } from '../src/db/db.js';
import { market } from '../src/market/store.js';
import { buildContext } from '../src/market/scanner.js';
import { assessQuality } from '../src/market/quality.js';
import { memoryDetail, recordOpportunity } from '../src/ditas/memory.js';
import type { Candidate } from '../src/workers/types.js';

const T = 1_800_000_000_000;
const instrumentId = 'crypto:binance:FRAMESUSDT';
const btcId = 'crypto:binance:BTCUSDT';
const candidate = (): Candidate => {
  const entry = market.deep.get(instrumentId)!.engines['1h'].last!.close;
  return {
    id: 'fixture-frames-candidate', eventId: 'fixture-frames-event', traceId: 'fixture-frames-trace',
    instrumentId, symbol: 'FRAMESUSDT', base: 'FRAMES', market: 'crypto', venue: 'binance',
    strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h', regime: 'TREND_UP', createdAt: T,
    signal: { direction: 'long', entryRef: entry, stop: entry * 0.95, targets: [{ r: 2, fraction: 1 }], maxHoldBars: 48, trailAfterR: 1, trigger: 'fixture', invalidation: 'fixture', reasons: ['synthetic frame-quality fixture'] },
  };
};

describe('DITAS per-timeframe worker input integrity', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(T);
    freshDb(false); market.reset();
    seedInstrument('FRAMESUSDT', { nowTs: T }); seedInstrument('BTCUSDT', { nowTs: T });
  });
  afterEach(() => { closeDb(); market.reset(); vi.useRealTimers(); });

  it('excludes a failed 4h input while retaining valid 1h evidence', () => {
    const d = market.deep.get(instrumentId)!;
    d.integrityIssues = { '4h': ['fixture provider batch integrity failure'] };
    const ctx = buildContext(candidate());
    expect(ctx.quality.status).toBe('OK');
    expect(ctx.frameQuality?.['1h'].status).toBe('OK');
    expect(ctx.frameQuality?.['4h'].status).toBe('FAIL');
    expect(ctx.f['1h']).toBe(d.engines['1h'].last);
    expect(ctx.f['15m']).toBe(d.engines['15m'].last);
    expect(ctx.f['4h']).toBeNull();
  });

  it('excludes stale 15m inputs even when the 1h signal remains current', () => {
    const d = market.deep.get(instrumentId)!;
    const shift = 10 * 900_000;
    for (const candle of d.engines['15m'].candles) {
      candle.t -= shift;
      if (candle.closeTime != null) candle.closeTime -= shift;
    }
    d.engines['15m'].last!.t -= shift;
    const ctx = buildContext(candidate());
    expect(ctx.frameQuality?.['15m'].status).toBe('FAIL');
    expect(ctx.frameQuality?.['15m'].issues.join('; ')).toMatch(/stale/);
    expect(ctx.f['15m']).toBeNull();
    expect(ctx.f['1h']).toBe(d.engines['1h'].last);
    expect(ctx.quality.status).toBe('OK');
  });

  it('validates BTC reference frames independently before sharing them with workers', () => {
    const btc = market.deep.get(btcId)!;
    btc.integrityIssues = { '4h': ['fixture BTC source batch integrity failure'] };
    const ctx = buildContext(candidate());
    expect(ctx.frameQuality?.btc4h.status).toBe('FAIL');
    expect(ctx.btc4h).toBeNull();
    expect(ctx.btc1h).toBe(btc.engines['1h'].last);
    expect(ctx.f['4h']).toBe(market.deep.get(instrumentId)!.engines['4h'].last);
  });

  it('preserves excluded null inputs and their quality reports in permanent memory', () => {
    const d = market.deep.get(instrumentId)!, btc = market.deep.get(btcId)!;
    d.integrityIssues = { '4h': ['fixture failed instrument frame'] };
    btc.integrityIssues = { '4h': ['fixture failed BTC frame'] };
    const cand = candidate(), ctx = buildContext(cand);
    expect(ctx.f['4h']).toBeNull(); expect(ctx.btc4h).toBeNull();
    // A provider can recover while this captured worker context is under review.
    // Snapshot capture must preserve the exclusion instead of falling back to live caches.
    d.integrityIssues['4h'] = []; btc.integrityIssues['4h'] = [];
    expect(assessQuality(instrumentId, '4h', T).status).toBe('OK');
    expect(assessQuality(btcId, '4h', T).status).toBe('OK');
    expect(d.engines['4h'].last).not.toBeNull(); expect(btc.engines['4h'].last).not.toBeNull();
    const event = recordOpportunity({ kind: 'PROPOSAL', instrumentId, strategyId: cand.strategyId, dedupeKey: 'fixture:excluded-frame-snapshot', reason: 'fixture preserved exclusion', candidate: cand, ctx });
    const snapshot = memoryDetail(event.id)!.snapshot!;
    expect(snapshot.features['4h']).toBeNull();
    expect(snapshot.features['1h']).toMatchObject({ t: ctx.f['1h']!.t, close: ctx.f['1h']!.close });
    expect(snapshot.context.btc4h).toBeNull();
    expect(snapshot.context.btc1h).toMatchObject({ t: ctx.btc1h!.t, close: ctx.btc1h!.close });
    expect(snapshot.context.frameQuality['4h'].status).toBe('FAIL');
    expect(snapshot.context.frameQuality.btc4h.status).toBe('FAIL');
  });
});
