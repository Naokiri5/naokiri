import { describe, it, expect } from 'vitest';
/** Opt-in live integration test: MIA_LIVE_TESTS=1 npx vitest run test/live.providers.test.ts */
const LIVE = process.env.MIA_LIVE_TESTS === '1';
describe.skipIf(!LIVE)('live providers (read-only)', () => {
  it('fetches real data from every key-free provider', async () => {
    process.env.MIA_OFFLINE = '0';
    const { config } = await import('../src/config.js'); (config as any).offline = false;
    const binance = await import('../src/providers/binance.js');
    const coinbase = await import('../src/providers/coinbase.js');
    const kraken = await import('../src/providers/kraken.js');
    const cg = await import('../src/providers/coingecko.js');
    const dex = await import('../src/providers/dexscreener.js');
    const fx = await import('../src/providers/frankfurter.js');
    const news = await import('../src/providers/googlenews.js');
    const t = await binance.tickers24h(); expect(t.length).toBeGreaterThan(100);
    const k = await binance.klines('BTCUSDT', '1h', 5); expect(k).toHaveLength(5);
    const b = await binance.depth('BTCUSDT', 20); expect(b.bids[0][0]).toBeLessThan(b.asks[0][0]);
    const a = await binance.aggTrades('BTCUSDT', 10); expect(a.length).toBe(10);
    const cq = await coinbase.ticker('BTC-USD'); expect(cq.price).toBeGreaterThan(0);
    const kq = await kraken.tickers(['XBTUSD', 'ETHUSD']); expect(kq.XBTUSD.price).toBeGreaterThan(0);
    expect(Math.abs(kq.XBTUSD.price - cq.price) / cq.price).toBeLessThan(0.02);
    const m = await cg.markets(10); expect(m[0].symbol).toBe('BTC');
    const dp = await dex.latestTokenPairs(10); expect(Array.isArray(dp)).toBe(true);
    const f = await fx.fxSeries(30); expect(f.find((x) => x.pair === 'EURUSD')!.rate).toBeGreaterThan(0.5);
    const n = await news.searchNews('bitcoin'); expect(n.length).toBeGreaterThan(0);
  }, 90_000);
});
