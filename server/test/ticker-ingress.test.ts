import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as binance from '../src/providers/binance.js';
import { bus } from '../src/core/bus.js';
import { ingestTickerSnapshot, refreshTickers } from '../src/market/fabric.js';
import { validateTicker24 } from '../src/market/quality.js';
import { market } from '../src/market/store.js';
import type { Instrument } from '../src/market/types.js';

vi.mock('../src/providers/binance.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/providers/binance.js')>();
  return { ...original, tickers24h: vi.fn() };
});

const AT = 1_800_000_000_000;
const instrument: Instrument = {
  id: 'crypto:binance:BTCUSDT', symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT',
  market: 'crypto', venue: 'binance', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5,
};
const tick = (changes: Partial<binance.Ticker24> = {}): binance.Ticker24 => ({
  symbol: 'BTCUSDT', lastPrice: 100, bidPrice: 99.9, askPrice: 100.1,
  highPrice: 110, lowPrice: 90, openPrice: 95,
  priceChangePercent: 5, quoteVolume: 1_000_000, volume: 10_000,
  count: 100, closeTime: AT, ...changes,
});

describe('canonical Bronze → validated market ticker ingress', () => {
  beforeEach(() => {
    market.reset();
    market.instruments.set(instrument.id, instrument);
    vi.mocked(binance.tickers24h).mockReset();
  });

  it('accepts a valid quote and preserves its exchange source timestamp', () => {
    expect(validateTicker24(tick(), instrument, AT)).toBeNull();
    expect(ingestTickerSnapshot([tick()], AT)).toEqual({ accepted: 1, rejected: 0, outOfOrder: 0, unknown: 0 });
    expect(market.tickers.get(instrument.id)).toMatchObject({
      last: 100, bid: 99.9, ask: 100.1, providerTs: AT, receivedAt: AT, source: 'binance',
    });
  });

  it.each([
    ['NaN price', { lastPrice: NaN }],
    ['nonpositive bid', { bidPrice: 0 }],
    ['crossed spread', { bidPrice: 101 }],
    ['inverted day high/low', { highPrice: 80 }],
    ['last outside day range', { lastPrice: 150 }],
    ['negative volume', { quoteVolume: -1 }],
    ['nonfinite change', { priceChangePercent: Infinity }],
    ['fractional trade count', { count: 1.25 }],
    ['future source', { closeTime: AT + 10_000 }],
    ['stale source', { closeTime: AT - 120_000 }],
    ['missing exchange source time', { closeTime: 0 }],
    ['source instrument mismatch', { symbol: 'ETHUSDT' }],
  ] as Array<[string, Partial<binance.Ticker24>]>)('rejects %s before it can overwrite a valid quote', (_name, changes) => {
    ingestTickerSnapshot([tick()], AT);
    const prior = structuredClone(market.tickers.get(instrument.id));
    // ETH is not registered and remains unknown; the current tracked BTC state still cannot be overwritten.
    const report = ingestTickerSnapshot([tick(changes)], AT + 1_000);
    expect(report.accepted).toBe(0);
    expect(market.tickers.get(instrument.id)).toEqual(prior);
  });

  it('does not accept a replayed older exchange event even when received later', () => {
    ingestTickerSnapshot([tick()], AT);
    expect(ingestTickerSnapshot([tick({ closeTime: AT - 1, lastPrice: 101 })], AT + 10)).toEqual({
      accepted: 0, rejected: 0, outOfOrder: 1, unknown: 0,
    });
    expect(market.tickers.get(instrument.id)?.last).toBe(100);
  });

  it('separately counts unknown symbols; leaves known valid quotes untouched', () => {
    const report = ingestTickerSnapshot([tick({ symbol: 'OTHERUSDT' }), tick()], AT);
    expect(report).toEqual({ accepted: 1, rejected: 0, outOfOrder: 0, unknown: 1 });
  });

  it('preserves valid market state when a refresh has only invalid tracked ticks, and reports failure', async () => {
    ingestTickerSnapshot([tick()], AT);
    const prior = structuredClone(market.tickers.get(instrument.id));
    const prevRefresh = market.tickersFetchedAt;
    vi.mocked(binance.tickers24h).mockResolvedValue([tick({ lastPrice: NaN, closeTime: Date.now() })]);
    const reports: unknown[] = [];
    const listener = (payload: unknown) => reports.push(payload);
    bus.on('health', listener);
    try {
      await expect(refreshTickers()).rejects.toThrow(/no fresh validated tracked quotes/);
    } finally {
      bus.off('health', listener);
    }
    expect(market.tickers.get(instrument.id)).toEqual(prior);
    expect(market.tickersFetchedAt).toBe(prevRefresh);
    expect(reports).toContainEqual(expect.objectContaining({
      type: 'market-ticker-ingress', status: 'FAIL', accepted: 0, rejected: 1,
    }));
  });

  it('accepts a mixed batch without suppressing valid ticks', async () => {
    vi.mocked(binance.tickers24h).mockResolvedValue([
      tick({ closeTime: Date.now(), lastPrice: 100 }),
      tick({ closeTime: Date.now(), lastPrice: NaN }),
    ]);
    await expect(refreshTickers()).resolves.toBeUndefined();
    expect(market.tickers.get(instrument.id)?.last).toBe(100);
    expect(market.tickersFetchedAt).toBeGreaterThan(0);
  });
});
