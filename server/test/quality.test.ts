import { describe, it, expect, beforeEach } from 'vitest';
import { ingestCandleBatch, validateCandleBatch, REBUILD_MIN_BARS } from '../src/market/fabric.js';
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
  it('stale order book fails closed', () => { expect(assessQuality(inst.id, '1h', T + 180_001).status).toBe('FAIL'); });
  it('future-dated order book fails closed', () => { market.deep.get(inst.id)!.book!.ts = T + 1; expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL'); });
  it('cross-venue deviation fails', () => { market.deep.get(inst.id)!.cross.kraken.price *= 1.05; const q = assessQuality(inst.id, '1h', T); expect(q.status).toBe('FAIL'); expect(q.issues.join()).toMatch(/deviation/); });
  it('missing instrument fails', () => { expect(assessQuality('crypto:binance:NOPE', '1h', T).status).toBe('FAIL'); });
  it('does not invent a primary source when data is absent', () => {
    const q = assessQuality('crypto:binance:NOPE', '1h', T);
    expect(q.independentSources).toBe(0); expect(q.sources).toEqual([]);
  });
  it('rejects delayed source events even when just received', () => {
    market.tickers.get(inst.id)!.providerTs = T - 120_000;
    const q = assessQuality(inst.id, '1h', T);
    expect(q.status).toBe('FAIL'); expect(q.issues.join()).toMatch(/source event stale/);
    expect(q.sources).not.toContain('binance');
  });
  it.each(['receivedAt', 'providerTs'] as const)('rejects future quote %s', field => {
    market.tickers.get(inst.id)![field] = T + 60_000;
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it('allows small timestamp clock skew without accepting stale events', () => {
    Object.assign(market.tickers.get(inst.id)!, { receivedAt: T + 1000, providerTs: T + 1000 });
    expect(assessQuality(inst.id, '1h', T).status).toBe('OK');
  });
  it.each(['providerTs', 'receivedAt', 'last', 'ask', 'quoteVolume'] as const)('rejects nonfinite %s', field => {
    market.tickers.get(inst.id)![field] = NaN;
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it('rejects a mismatched instrument or source identity', () => {
    market.tickers.get(inst.id)!.symbol = 'OTHERUSDT';
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
    seed(T); market.tickers.get(inst.id)!.source = 'unknown';
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it.each(['gap', 'duplicate', 'unordered', 'invalid', 'forming', 'closeTime'] as const)('rejects %s cached candles', fault => {
    const cs = market.deep.get(inst.id)!.engines['1h'].candles;
    if (fault === 'gap') cs.splice(5, 1);
    if (fault === 'duplicate') cs[5].t = cs[4].t;
    if (fault === 'unordered') [cs[4], cs[5]] = [cs[5], cs[4]];
    if (fault === 'invalid') cs[5].c = -1;
    if (fault === 'forming') cs[cs.length - 1].t = T;
    if (fault === 'closeTime') cs[5].closeTime = cs[5].t - 1;
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it('rejects malformed and future books', () => {
    const d = market.deep.get(inst.id)!;
    d.book!.bids[0][0] = d.book!.asks[0][0] * 2;
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
    seed(T);
    market.deep.get(inst.id)!.book!.ts = T + 60_000;
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it('excludes stale cross quotes and deduplicates source identities', () => {
    const d = market.deep.get(inst.id)!;
    d.cross.kraken.ts = T - 600_000;
    expect(assessQuality(inst.id, '1h', T)).toMatchObject({ status: 'WARN', independentSources: 1, sources: ['binance'] });
    delete d.cross.kraken;
    d.cross.binance = { price: 100, bid: 99, ask: 101, venue: 'binance', ts: T };
    expect(assessQuality(inst.id, '1h', T).independentSources).toBe(1);
  });
  it.each(['future', 'nonfinite', 'negative', 'wrongVenue'] as const)('rejects %s cross quotes', fault => {
    const q = market.deep.get(inst.id)!.cross.kraken;
    if (fault === 'future') q.ts = T + 60_000;
    if (fault === 'nonfinite') q.price = Infinity;
    if (fault === 'negative') q.bid = -1;
    if (fault === 'wrongVenue') q.venue = 'coinbase';
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it('fails an invalid assessment clock', () => {
    expect(assessQuality(inst.id, '1h', NaN).status).toBe('FAIL');
  });

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
describe('book truth failures', () => {
  const valid = () => ({ bids: [[99, 1], [98, 1]] as [number, number][], asks: [[101, 1], [102, 1]] as [number, number][], ts: 0 });
  it.each([0, -1, NaN, Infinity])('rejects invalid notional %s', value => {
    expect(bookImpact(valid(), 'buy', value)).toBeNull();
  });
  it.each(['crossed', 'unsortedBid', 'unsortedAsk', 'duplicate', 'negativeSize', 'nonfinite', 'empty', 'overflow'] as const)('rejects %s depth', fault => {
    const b = valid();
    if (fault === 'crossed') b.bids[0][0] = 103;
    if (fault === 'unsortedBid') b.bids.reverse();
    if (fault === 'unsortedAsk') b.asks.reverse();
    if (fault === 'duplicate') b.bids[1][0] = b.bids[0][0];
    if (fault === 'negativeSize') b.asks[0][1] = -1;
    if (fault === 'nonfinite') b.asks[0][0] = NaN;
    if (fault === 'empty') b.bids = [];
    if (fault === 'overflow') b.asks[0][1] = Number.MAX_VALUE;
    expect(bookImpact(b, 'buy', 50)).toBeNull();
  });
});
describe('RSS parsing', () => {
  it('parses Google News RSS items', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>BTC rallies - Reuters</title><link>https://x</link><guid isPermaLink="false">abc</guid><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item></channel></rss>`;
    const r = parseRss(xml); expect(r).toHaveLength(1); expect(r[0].source).toBe('Reuters'); expect(r[0].guid).toBe('abc');
  });
});

describe('raw candle batch integrity and recovery', () => {
  const T = 1_800_000_000_000;
  beforeEach(() => seed(T));
  it.each(['duplicate', 'unordered', 'gap', 'badOHLCV', 'future'] as const)('blocks %s before ingestion can mask it', fault => {
    const d = market.deep.get(inst.id)!;
    const before = structuredClone(d.engines['1h'].candles);
    const cs = synthCandles(4, { t0: T - 4 * 3_600_000 });
    if (fault === 'duplicate') cs[1].t = cs[0].t;
    if (fault === 'unordered') [cs[0], cs[1]] = [cs[1], cs[0]];
    if (fault === 'gap') cs.splice(1, 1);
    if (fault === 'badOHLCV') cs[1].h = -1;
    if (fault === 'future') cs[3].t = T + 3_600_000;
    expect(ingestCandleBatch(d, '1h', cs, T)).toBe(0);
    expect(d.engines['1h'].candles).toEqual(before);
    expect(d.integrityIssues?.['1h']?.length).toBeGreaterThan(0);
    expect(assessQuality(inst.id, '1h', T).status).toBe('FAIL');
  });
  it('does not advance indicators across a gap between otherwise valid batches', () => {
    const d = market.deep.get(inst.id)!;
    const before = structuredClone(d.engines['1h'].last);
    const cs = synthCandles(1, { t0: T - 3_600_000 });
    // Seed history ends two hours before T; make the new batch skip one complete interval.
    const newer = T + 3_600_000;
    cs[0] = { ...cs[0], t: T, closeTime: T + 3_600_000 - 1 };
    expect(ingestCandleBatch(d, '1h', cs, newer)).toBe(0);
    expect(d.integrityIssues?.['1h']?.join()).toMatch(/between cached history/);
    expect(d.engines['1h'].last).toEqual(before);
  });
  it('rebuilds from a full validated window after an outage longer than one fetch, but never from a short batch', () => {
    const d = market.deep.get(inst.id)!; const H = 3_600_000; const lastT = d.engines['1h'].lastT;
    const later = lastT + 500 * H; // 500 missed bars: more than one 400-candle fetch window
    const short = synthCandles(50, { t0: later - 50 * H });
    expect(ingestCandleBatch(d, '1h', short, later + H)).toBe(0); // too short to warm indicators: stays failed
    expect(d.integrityIssues?.['1h']?.join()).toMatch(/between cached history/);
    const full = synthCandles(REBUILD_MIN_BARS + 20, { t0: later - (REBUILD_MIN_BARS + 20) * H });
    expect(ingestCandleBatch(d, '1h', full, later + H)).toBe(REBUILD_MIN_BARS + 20);
    expect(d.integrityIssues?.['1h']).toEqual([]);
    expect(d.engines['1h'].lastT).toBe(full[full.length - 1].t);
    const bad = synthCandles(REBUILD_MIN_BARS + 20, { t0: later + 600 * H }); bad[5].h = -1; // invalid window never rebuilds
    expect(ingestCandleBatch(d, '1h', bad, later + 1000 * H)).toBe(0); expect(d.engines['1h'].lastT).toBe(full[full.length - 1].t);
  });
  it('allows repeated history across refreshes without duplicate indicator updates', () => {
    const d = market.deep.get(inst.id)!;
    const cs = structuredClone(d.engines['1h'].candles);
    const before = structuredClone(d.engines['1h'].last);
    expect(ingestCandleBatch(d, '1h', cs, T)).toBe(0);
    expect(ingestCandleBatch(d, '1h', cs, T)).toBe(0);
    expect(d.engines['1h'].last).toEqual(before);
    expect(d.integrityIssues?.['1h']).toEqual([]);
    expect(assessQuality(inst.id, '1h', T).status).toBe('OK');
  });
  it('clears only the recovered interval and does not clear flags after invalid refreshes', () => {
    const d = market.deep.get(inst.id)!;
    d.integrityIssues = { '1h': ['prior failure'], '4h': ['separate failure'] };
    ingestCandleBatch(d, '1h', [], T);
    expect(d.integrityIssues['1h']?.length).toBeGreaterThan(0);
    ingestCandleBatch(d, '1h', structuredClone(d.engines['1h'].candles), T);
    expect(d.integrityIssues['1h']).toEqual([]);
    expect(d.integrityIssues['4h']).toEqual(['separate failure']);
    expect(assessQuality(inst.id, '1h', T).status).toBe('OK');
    market.reset();
    expect(market.deepState(inst).integrityIssues).toBeUndefined();
  });
  it('retains one latest forming candle without ingesting it as closed', () => {
    const d = market.deep.get(inst.id)!;
    const cs = synthCandles(3, { t0: T - 2 * 3_600_000 });
    const result = validateCandleBatch(cs, '1h', T);
    expect(result.issues).toEqual([]); expect(result.closed).toHaveLength(2);
    expect(result.forming?.t).toBe(T);
    ingestCandleBatch(d, '1h', cs, T);
    expect(d.engines['1h'].last?.t).toBe(T - 3_600_000);
    expect(d.forming['1h']?.t).toBe(T);
    expect(d.integrityIssues?.['1h']).toEqual([]);
  });
});
