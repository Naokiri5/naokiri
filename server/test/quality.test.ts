import { describe, it, expect, beforeEach } from 'vitest';
import { market } from '../src/market/store.js';
import { assessQuality, bookImpact } from '../src/market/quality.js';
import { parseRss } from '../src/providers/googlenews.js';
import { synthCandles } from './helpers.js';

const inst = { id: 'crypto:binance:TESTUSDT', symbol: 'TESTUSDT', base: 'TEST', quote: 'USDT', market: 'crypto' as const, venue: 'binance', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5 };
function seed(nowTs: number) {
  market.reset(); market.instruments.set(inst.id, inst);
  const d = market.deepState(inst);
  const cs = synthCandles(300, { t0: nowTs - 301 * 3600_000 });
  d.engines['1h'].ingest(cs);
  const last = cs[cs.length - 1].c;
  market.tickers.set(inst.id, { instrumentId: inst.id, symbol: 'TESTUSDT', base: 'TEST', quote: 'USDT', last, bid: last * 0.9999, ask: last * 1.0001, changePct: 0, quoteVolume: 1e8, high: last, low: last, open: last, trades: 1000, providerTs: nowTs, receivedAt: nowTs, source: 'binance' });
  d.book = { bids: [[last * 0.9999, 10], [last * 0.999, 50]], asks: [[last * 1.0001, 10], [last * 1.001, 50]], ts: nowTs };
  d.cross.kraken = { price: last * 1.001, bid: last, ask: last, ts: nowTs, venue: 'kraken' };
  return last;
}
describe('data quality gate (Part 32.2)', () => {
  const T = 1_800_000_000_000;
  beforeEach(() => seed(T));
  it('fresh multi-source data is OK', () => { const q = assessQuality(inst.id, '1h', T); expect(q.status).toBe('OK'); expect(q.independentSources).toBe(2); });
  it('stale quote fails closed', () => { expect(assessQuality(inst.id, '1h', T + 120_000).status).toBe('FAIL'); });
  it('cross-venue deviation fails', () => { market.deep.get(inst.id)!.cross.kraken.price *= 1.05; const q = assessQuality(inst.id, '1h', T); expect(q.status).toBe('FAIL'); expect(q.issues.join()).toMatch(/deviation/); });
  it('missing instrument fails', () => { expect(assessQuality('crypto:binance:NOPE', '1h', T).status).toBe('FAIL'); });
});
describe('book impact', () => {
  it('walks levels and reports impact; partial depth ⇒ Infinity', () => {
    const b = { bids: [[99, 1]] as [number, number][], asks: [[101, 1], [102, 1]] as [number, number][], ts: 0 };
    const r = bookImpact(b, 'buy', 151.5)!;
    expect(r.filledFully).toBe(true); expect(r.avgPrice).toBeGreaterThan(101); expect(r.avgPrice).toBeLessThan(102);
    expect(r.spreadBps).toBeCloseTo(200, 0);
    expect(bookImpact(b, 'buy', 1e6)!.impactBps).toBe(Infinity);
  });
});
describe('RSS parsing', () => {
  it('parses Google News RSS items', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>BTC rallies - Reuters</title><link>https://x</link><guid isPermaLink="false">abc</guid><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
    const r = parseRss(xml); expect(r).toHaveLength(1); expect(r[0].source).toBe('Reuters'); expect(r[0].guid).toBe('abc');
  });
});
