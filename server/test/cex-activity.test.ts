import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCexActivity } from '../src/market/cexActivity.js';
import { measureDepthExhaustion } from '../src/market/depthExhaustion.js';
import type { Book } from '../src/providers/binance.js';
import * as prints from '../src/whales/prints.js';
import { QUALITY_LIMITS } from '../src/market/quality.js';
import { market } from '../src/market/store.js';
import { INTERVAL_MS, type Instrument, type Interval } from '../src/market/types.js';

const asOf = Date.UTC(2026, 10, 18, 12, 3);
const instrument: Instrument = {
  id: 'crypto:binance:TESTUSDT', symbol: 'TESTUSDT', base: 'TEST', quote: 'USDT',
  market: 'crypto', venue: 'binance', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5,
};

function history(interval: Interval, length: number) {
  const step = INTERVAL_MS[interval];
  const close = Math.floor(asOf / step) * step;
  return Array.from({ length }, (_, i) => ({
    t: close - (length - i) * step, closeTime: close - (length - i - 1) * step - 1,
    o: 100, h: 101, l: 99, c: 100, v: 10, tbv: 6, n: 3,
  }));
}

function seed() {
  market.instruments.set(instrument.id, instrument);
  const deep = market.deepState(instrument);
  deep.engines['15m'].ingest(history('15m', 44));
  deep.engines['1h'].ingest(history('1h', 264));
  deep.candleFetchedAt = { '15m': asOf - 200, '1h': asOf - 400 };
  deep.book = { ts: asOf - 500, bids: [[100, 25], [99.5, 20], [98, 100]], asks: [[100.2, 30], [100.8, 200], [101.5, 500]] };
  return deep;
}

describe('CEX activity research', () => {
  beforeEach(() => market.reset());

  it('compares closed windows to a median baseline and computes exchange-reported aggression', () => {
    const deep = seed();
    const ordinary = readCexActivity(instrument.id, asOf);
    expect(ordinary).toMatchObject({ schemaVersion: 1, source: 'binance', baseAsset: 'TEST', quoteAsset: 'USDT' });
    expect(ordinary.volume[0]).toMatchObject({ window: '5m', status: 'UNAVAILABLE', reason: 'NO_CANDLE_FEED' });
    expect(ordinary.volume[1]).toMatchObject({
      window: '1h', status: 'AVAILABLE', candles: 4, baseVolume: 40, baselineWindows: 10, medianBaseVolume: 40,
      relativeToMedian: 1, changeVsPreviousPct: 0, closedAt: Date.UTC(2026, 10, 18, 12), receivedAt: asOf - 200,
      aggressiveFlow: { buyBase: 24, sellBase: 16, deltaBase: 8, imbalance: 0.2, tradeCount: 12 },
    });
    expect(ordinary.volume[2]).toMatchObject({ window: '24h', candles: 24, baseVolume: 240, medianBaseVolume: 240, relativeToMedian: 1 });

    for (const candle of deep.engines['15m'].candles.slice(-4)) {
      candle.v = 30;
      candle.tbv = 10;
    }
    const spiked = readCexActivity(instrument.id, asOf);
    expect(spiked.volume[1]).toMatchObject({
      baseVolume: 120, relativeToMedian: 3, changeVsPreviousPct: 200,
      aggressiveFlow: { buyBase: 40, sellBase: 80, deltaBase: -40 },
    });
    expect(spiked.volume[2]).toEqual(ordinary.volume[2]);
  });

  it('does not classify missing or impossible taker volume', () => {
    const deep = seed();
    const bar = deep.engines['15m'].candles.at(-1)!;
    for (const tbv of [undefined, 11, -1, NaN]) {
      bar.tbv = tbv;
      expect(readCexActivity(instrument.id, asOf).volume[1]).toMatchObject({ baseVolume: 40, aggressiveFlow: null });
    }
  });

  it('does not produce a relative multiple when the baseline is all zero', () => {
    const deep = seed();
    for (const candle of deep.engines['15m'].candles.slice(0, -4)) candle.v = 0;
    expect(readCexActivity(instrument.id, asOf).volume[1]).toMatchObject({
      baseVolume: 40, medianBaseVolume: 0, relativeToMedian: null, changeVsPreviousPct: null,
      status: 'AVAILABLE', reason: 'BASELINE_UNAVAILABLE',
    });
  });

  it('withholds rejected, stale, unordered, incomplete and future-received candles', () => {
    const deep = seed();
    const read = () => readCexActivity(instrument.id, asOf).volume[1];
    deep.integrityIssues = { '15m': ['source sequence gap'] };
    expect(read()).toMatchObject({ status: 'UNAVAILABLE', reason: 'CANDLE_BATCH_REJECTED' });
    deep.integrityIssues = {};
    const bars = deep.engines['15m'].candles;
    const latest = bars.pop()!;
    expect(read()).toMatchObject({ status: 'UNAVAILABLE', reason: 'CANDLES_STALE' });
    bars.push(latest);
    const t = bars[2].t;
    bars[2].t = bars[1].t;
    expect(read()).toMatchObject({ status: 'UNAVAILABLE', reason: 'CANDLES_INVALID' });
    bars[2].t = t;
    const duration = INTERVAL_MS['15m'];
    bars.push({ ...latest, t: latest.t + duration, closeTime: latest.closeTime! + duration });
    expect(read()).toMatchObject({ status: 'UNAVAILABLE', reason: 'CANDLES_INVALID' });
    bars.pop();
    deep.candleFetchedAt['15m'] = asOf + 1;
    expect(read()).toMatchObject({ status: 'UNAVAILABLE', reason: 'CANDLES_INVALID' });
  });

  it('observes book pressure and size-dependent cost on distinct buy and sell sides', () => {
    seed();
    const { book } = readCexActivity(instrument.id, asOf, 40);
    expect(book).toMatchObject({
      status: 'AVAILABLE', quoteAgeMs: 500, capturedAt: asOf - 500, bidLevelCount: 3, askLevelCount: 3,
      bidDepth1pctQuote: 4490, askDepth1pctQuote: 23166, bidShare1pct: expect.closeTo(4490 / 27656),
      exit: { requestedBaseQty: 40, conservativeBaseCapacity: 44.9, fitsVisibleCapacity: true, avgPrice: 99.8125 },
    });
    const buys = book.impactCurve.filter(p => p.side === 'buy');
    expect(buys.map(p => p.requestedQuote)).toEqual([1000, 10_000, 50_000]);
    expect(buys[0].avgPrice).toBeCloseTo(100.2);
    expect(buys[1].impactBps).toBeGreaterThan(buys[0].impactBps!);
    expect(book.impactCurve.at(-1)).toMatchObject({ side: 'sell', requestedQuote: 50_000, filledFully: false, avgPrice: null, impactBps: null });
    expect(readCexActivity(instrument.id, asOf, 46).book.exit).toMatchObject({
      requestedBaseQty: 46, fitsVisibleCapacity: false, avgPrice: null, impactBps: null,
    });
  });

  it('keeps a healthy buy side distinct from a zero-capacity exit band', () => {
    const deep = seed();
    deep.book!.bids = [[95, 100]];
    const { book } = readCexActivity(instrument.id, asOf, 1);
    expect(book.exit).toMatchObject({ conservativeBaseCapacity: 0, fitsVisibleCapacity: false });
    expect(book.impactCurve[0].filledFully).toBe(true);
  });

  it('returns no usable depth for stale, future, crossed or missing books', () => {
    const deep = seed();
    const read = () => readCexActivity(instrument.id, asOf, 40).book;
    const ts = deep.book!.ts;
    deep.book!.ts = asOf - QUALITY_LIMITS.maxExecBookAgeMs - 1;
    expect(read()).toMatchObject({ status: 'UNAVAILABLE', reason: 'BOOK_STALE', impactCurve: [], exit: { fitsVisibleCapacity: null } });
    deep.book!.ts = asOf + 1;
    expect(read().reason).toBe('BOOK_INVALID');
    deep.book!.ts = ts;
    deep.book!.bids[0][0] = deep.book!.asks[0][0];
    expect(read().reason).toBe('BOOK_INVALID');
    deep.book = null;
    expect(read().reason).toBe('BOOK_MISSING');
  });

  it('leaves unsupported and unknown instruments unavailable and rejects invalid exit sizes', () => {
    const dex = { ...instrument, id: 'crypto-dex:fake:TEST', market: 'crypto-dex' as const };
    market.instruments.set(dex.id, dex);
    for (const id of [dex.id, 'missing']) {
      const result = readCexActivity(id, asOf);
      expect(result.source).toBeNull();
      expect(result.volume.every(v => v.status === 'UNAVAILABLE')).toBe(true);
      expect(result.book.status).toBe('UNAVAILABLE');
    }
    expect(() => readCexActivity(instrument.id, asOf, NaN)).toThrow(RangeError);
    expect(() => readCexActivity(instrument.id, asOf, 0)).toThrow(RangeError);
  });
});

describe('L2 exhaustion research on observed Binance spot depth and signed trades', () => {
  const bookAt = asOf - 100;
  const from = bookAt - 3_000;
  const book: Book = {
    ts: bookAt, source: 'BINANCE_SPOT_DEPTH_STREAM', lastUpdateId: 220,
    bids: [[99.99, 2], [99.7, 900]], asks: [[100.01, 8], [100.3, 900]],
  };
  const trade = (id: number, ts: number, qty: number, buyerIsMaker: boolean) => ({
    id, ts, price: 100, qty, buyerIsMaker, receivedAt: asOf, threshold: 100_000,
  });
  const tape = { source: 'BINANCE_SPOT_AGG_TRADES' as const, polledAt: asOf, trades: [
    trade(10, from - 1, 500, false), trade(11, from, 2, false), trade(12, from + 300, 5, true), trade(13, bookAt, 500, false),
  ] };

  it('includes the observed flow in the existing instrument research report', () => {
    market.reset();
    const deep = seed();
    deep.book = book;
    const read = vi.spyOn(prints, 'readSpotTradeTape').mockReturnValue({ ...tape, firstId: 10, lastId: 13, contiguous: true });
    try {
      expect(readCexActivity(instrument.id, asOf).depthExhaustion).toMatchObject({ status: 'MEASURED', pressure: 'ASK_DEPTH_AND_SELLING' });
      expect(read).toHaveBeenCalledWith(instrument.id, asOf);
    } finally { read.mockRestore(); market.reset(); }
  });

  it('measures only in-band resting depth and the complete three-second signed quote window', () => {
    expect(measureDepthExhaustion(book, tape, asOf)).toMatchObject({
      status: 'MEASURED', pressure: 'ASK_DEPTH_AND_SELLING', bandBps: 15, depthRatioThreshold: 3,
      bidDepthQuote: expect.closeTo(199.98), askDepthQuote: expect.closeTo(800.08), tradeCount: 2, takerDeltaQuote: -300,
      firstCoverageId: 10, lastCoverageId: 13, flowStart: from, flowEndExclusive: bookAt,
      bookSource: 'BINANCE_SPOT_DEPTH_STREAM', bookUpdateId: 220, tradeSource: 'BINANCE_SPOT_AGG_TRADES', polledAt: asOf,
    });
    const bidHeavy: Book = { ...book, bids: [[99.99, 60], [99.7, 1]] };
    expect(measureDepthExhaustion(bidHeavy, tape, asOf)).toMatchObject({ pressure: 'NO_ALIGNMENT' });
    const buying = tape.trades.map(t => ({ ...t, buyerIsMaker: !t.buyerIsMaker }));
    expect(measureDepthExhaustion(bidHeavy, { ...tape, trades: buying }, asOf)).toMatchObject({ pressure: 'BID_DEPTH_AND_BUYING', takerDeltaQuote: 300 });
  });

  it('requires complete trade coverage, excludes future observations and detects sequence gaps', () => {
    expect(measureDepthExhaustion(book, { ...tape, trades: tape.trades.slice(1) }, asOf)).toMatchObject({ reason: 'TRADE_WINDOW_INCOMPLETE' });
    const gap = tape.trades.filter(t => t.id !== 11);
    expect(measureDepthExhaustion(book, { ...tape, trades: gap }, asOf)).toMatchObject({ reason: 'TRADE_SEQUENCE_INVALID' });
    const reordered = [...tape.trades, trade(14, bookAt - 1, 5, false)];
    expect(measureDepthExhaustion(book, { ...tape, trades: reordered }, asOf)).toMatchObject({ reason: 'TRADE_SEQUENCE_INVALID' });
    expect(measureDepthExhaustion(book, { ...tape, polledAt: asOf + 1 }, asOf)).toMatchObject({ reason: 'TRADE_TAPE_UNAVAILABLE' });
    expect(measureDepthExhaustion(book, { ...tape, polledAt: asOf - 3_001 }, asOf)).toMatchObject({ reason: 'TRADE_TAPE_UNAVAILABLE' });
    expect(measureDepthExhaustion(book, null, asOf)).toMatchObject({ reason: 'TRADE_TAPE_UNAVAILABLE' });
  });

  it('requires source and sequence provenance, fresh valid depth and visibility of the full band', () => {
    expect(measureDepthExhaustion({ ...book, source: undefined }, tape, asOf)).toMatchObject({ reason: 'BOOK_PROVENANCE_MISSING' });
    expect(measureDepthExhaustion({ ...book, lastUpdateId: 0 }, tape, asOf)).toMatchObject({ reason: 'BOOK_PROVENANCE_MISSING' });
    expect(measureDepthExhaustion({ ...book, ts: asOf - 3_001 }, tape, asOf)).toMatchObject({ reason: 'BOOK_UNAVAILABLE' });
    expect(measureDepthExhaustion({ ...book, bids: [[99.99, Number.MAX_VALUE]] }, tape, asOf)).toMatchObject({ reason: 'BOOK_UNAVAILABLE' });
    expect(measureDepthExhaustion({ ...book, bids: [[99.99, 2]] }, tape, asOf)).toMatchObject({ reason: 'DEPTH_BAND_INCOMPLETE' });
  });
});
