import { describe, it, expect } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
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

describe.skipIf(!LIVE)('live paper execution (real order book, simulated fills)', () => {
  it('enters and exits BTCUSDT against the live Binance book and reconciles', async () => {
    const { config } = await import('../src/config.js'); (config as any).offline = false;
    const { freshDb } = await import('./helpers.js'); freshDb();
    const { market } = await import('../src/market/store.js'); market.reset();
    const fabric = await import('../src/market/fabric.js');
    await fabric.refreshRules(); await fabric.refreshTickers(); await fabric.refreshDeep(['crypto:binance:BTCUSDT']);
    const { acceptPolicy, DEFAULT_POLICY } = await import('../src/risk/policy.js');
    const { updateControl } = await import('../src/core/mode.js');
    const { ledger, PAPER_ACCOUNT, openPositions } = await import('../src/portfolio/ledger.js');
    const oms = await import('../src/exec/oms.js'); const { reconcile } = await import('../src/portfolio/calendar.js');
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const px = market.price('crypto:binance:BTCUSDT')!;
    const stop = px.price * 0.98;
    const r: any = { id: 'dec_live', candidateId: 'cand_live', traceId: 't', asset: 'BTCUSDT', instrumentId: 'crypto:binance:BTCUSDT', market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
      entryRef: px.price, stopLoss: stop, takeProfit: [{ price: px.price * 1.03, fraction: 1, r: 1.5 }], decision: 'PAPER_TRADE', opportunity: { score: 70 },
      consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.6, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    const res = oms.submitEntry(r, 'bot');
    expect(res.ok, res.reason).toBe(true);
    const pos = openPositions()[0];
    expect(Math.abs(pos.entry_price / px.ask - 1)).toBeLessThan(0.001); // filled near the real ask
    expect(oms.protectPositions().state).toBe('CONFIRMED');
    oms.closePosition('owner', pos.id);
    const rec = reconcile(); expect(rec.ok).toBe(true);
    expect(rec.positionsRealized).toBeLessThan(0); // round trip costs fees + spread
    console.log('live round trip', { entry: pos.entry_price, qty: pos.qty, realized: rec.positionsRealized });
  }, 90_000);
});
