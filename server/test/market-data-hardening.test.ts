import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { config } from '../src/config.js';
import { refreshBooks, refreshTickers, ensureRules } from '../src/market/fabric.js';
import { bookFreshForExecution } from '../src/market/quality.js';
import { fetchProvider, providerBlockedUntil, _resetProviderBlocks } from '../src/providers/http.js';
import { depth } from '../src/providers/binance.js';
import { floorToStep } from '../src/core/util.js';

/** Squad B findings (100-agent audit 2026-11-18). fetch is stubbed: no network. */
const realFetch = globalThis.fetch; let calls = 0;
const stub = (fn: (url: string) => Response) => { calls = 0; globalThis.fetch = (async (u: any) => { calls++; return fn(String(u)); }) as typeof fetch; };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const flags = { offline: config.offline };
beforeEach(() => { freshDb(); market.reset(); _resetProviderBlocks(); Object.assign(config, { offline: false }); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, flags); _resetProviderBlocks(); });

describe('market data hardening (Squad B)', () => {
  it('B-01: a re-fetched book with the same lastUpdateId keeps its old timestamp and ages out', async () => {
    const { inst, last } = seedInstrument('ETHUSDT');
    const book = { lastUpdateId: 777, bids: [[String(last * 0.999), '5']], asks: [[String(last * 1.001), '5']] };
    stub(() => json(book));
    await refreshBooks([inst.id]); const first = market.deep.get(inst.id)!.book!;
    expect(first.lastUpdateId).toBe(777);
    const later = first.ts + 120_000; // two minutes on, the venue book still has not changed
    await refreshBooks([inst.id]);
    expect(market.deep.get(inst.id)!.book!.ts).toBe(first.ts); // was re-stamped with a fresh receive time
    expect(bookFreshForExecution(market.deep.get(inst.id)!.book!, later)).toBe(false);
  });

  it('B-02: a future-dated ticker is ignored and does not block later valid updates', async () => {
    const { inst } = seedInstrument('BTCUSDT');
    const t = (price: number, closeTime: number) => ({ symbol: 'BTCUSDT', lastPrice: String(price), bidPrice: String(price), askPrice: String(price), priceChangePercent: '0', quoteVolume: '1000000', highPrice: String(price), lowPrice: String(price), openPrice: String(price), count: 10, closeTime, openTime: closeTime - 86_400_000 });
    stub(() => json([t(50_000, Date.now() + 365 * 86_400_000)])); await refreshTickers();
    stub(() => json([t(50_100, Date.now())])); await refreshTickers();
    expect(market.tickers.get(inst.id)!.last).toBe(50_100); // was stuck at the future-dated payload's price
  });

  it('B-03: 429 with Retry-After blocks further requests to that provider without sending', async () => {
    stub(() => json({ code: -1003 }, 429, { 'retry-after': '120' }));
    await expect(fetchProvider('binance', 'https://data-api.binance.vision/api/v3/ping')).rejects.toThrow(/HTTP 429/);
    expect(providerBlockedUntil('binance')).toBeGreaterThan(Date.now() + 100_000);
    await expect(fetchProvider('binance', 'https://data-api.binance.vision/api/v3/ping')).rejects.toThrow(/rate limited by provider/);
    expect(calls).toBe(1); // the second request was never sent
  });

  it('B-03: a failing first rules fetch is throttled, not retried on every tick', async () => {
    stub(() => json({}, 500));
    await expect(ensureRules()).rejects.toThrow();
    await ensureRules(); await ensureRules();
    expect(calls).toBe(1);
  });

  it('B-04: depth() returns sorted levels and rejects a crossed book', async () => {
    stub(() => json({ lastUpdateId: 1, bids: [['49990', '1'], ['50010', '1']], asks: [['50005', '1'], ['50020', '1']] }));
    await expect(depth('BTCUSDT')).rejects.toThrow(/crossed order book/);
    stub(() => json({ lastUpdateId: 1, bids: [['49980', '1'], ['49990', '1']], asks: [['50020', '1'], ['50005', '1']] }));
    const b = await depth('BTCUSDT');
    expect(b.bids[0][0]).toBe(49990); expect(b.asks[0][0]).toBe(50005);
  });

  it('B-09: floorToStep never rounds a quantity up', () => {
    // Never more than float noise above the input (≤ 1e-6 of a lot): a real overshoot is stepped back down, while noise
    // just below a lot multiple keeps the lot (R-04, independent review, refines B-09).
    expect(floorToStep(0.0029999999999, 0.001)).toBeLessThanOrEqual(0.0029999999999 + 0.001 * 1e-6);
    expect(floorToStep(0.0025, 0.001)).toBe(0.002);
    expect(floorToStep(0.003, 0.001)).toBe(0.003);
    expect(floorToStep(1.23456, 0.01)).toBe(1.23);
    expect(floorToStep(5, 0)).toBe(5);
    // R-04: float noise just below a lot multiple must not lose a whole lot.
    expect(floorToStep(1 - 0.9, 0.1)).toBe(0.1);
    expect(floorToStep(0.7 * 0.1, 0.01)).toBe(0.07);
  });
});
