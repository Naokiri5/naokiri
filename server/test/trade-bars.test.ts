import { describe, expect, it } from 'vitest';
import { FeatureEngine } from '../src/features/indicators.js';
import { FP_SCALE, tradeBarCandle, TradeBarBuilder, type TradeBarConfig, type TradeEvent } from '../src/market/tradeBars.js';

const FP = FP_SCALE;
const T0 = 1_800_000_000_000; // fixed, aligned to every interval below
const CONFIG: TradeBarConfig = {
  instrumentId: 'SOLANA_JUPITER:MEME.SOL', baseIntervalMs: 1_000, intervalsMs: [1_000, 5_000], allowedLatenessMs: 2_000,
  maxFutureSkewMs: 1_000, maxFinalBars: 50, maxTradesPerBaseBar: 100, maxParticipantsPerBar: 100,
  retractionWindowMs: 10_000, maxSeenIds: 10_000,
};
let sequence = 0;
function trade(atMs: number, price: bigint, qty: bigint, over: Partial<TradeEvent> = {}): TradeEvent {
  return {
    instrumentId: CONFIG.instrumentId, eventId: `sig${++sequence}:0`, eventTimeMs: atMs, priceFp: price, baseQtyFp: qty,
    aggressor: 'buy', participant: 'walletA', finality: 'final', ...over,
  };
}
const build = (over: Partial<TradeBarConfig> = {}) => new TradeBarBuilder({ ...CONFIG, ...over });

describe('trade-built bars: golden values', () => {
  it('builds exact OHLC, volume, VWAP, flow and participant metrics from trades and merges coarse bars', () => {
    const b = build();
    const trades = [
      trade(T0 + 100, 2n * FP, 3n * FP, { participant: 'walletA', aggressor: 'buy' }),
      trade(T0 + 400, 4n * FP, 1n * FP, { participant: 'walletB', aggressor: 'sell' }),
      trade(T0 + 900, 1n * FP, 2n * FP, { participant: 'walletA', aggressor: 'sell' }),
      trade(T0 + 1_500, 3n * FP, 1n * FP, { participant: 'walletC', aggressor: 'buy' }),
    ];
    for (const t of trades) expect(b.ingest(t, t.eventTimeMs).status).toBe('ACCEPTED');
    b.advance(T0 + 7_000);
    const [first, second] = b.finalBars(1_000);
    expect(first).toMatchObject({
      startMs: T0, endMs: T0 + 1_000, status: 'FINAL', trades: 3,
      openFp: 2n * FP, highFp: 4n * FP, lowFp: 1n * FP, closeFp: 1n * FP,
      baseVolumeFp: 6n * FP, quoteVolumeFp: 12n * FP, buyBaseFp: 3n * FP, buyQuoteFp: 6n * FP, sellQuoteFp: 6n * FP,
      vwapFp: 2n * FP, participants: 2, topParticipantQuoteFp: 8n * FP, twoSidedQuoteFp: 8n * FP,
    });
    expect(first.quality).toEqual({ participantsKnown: true, participantsTruncated: false, provisionalTrades: 0, feedGap: false, invalidated: false });
    expect(second).toMatchObject({ trades: 1, openFp: 3n * FP, quoteVolumeFp: 3n * FP, participants: 1 });
    const [coarse] = b.finalBars(5_000);
    expect(coarse).toMatchObject({
      startMs: T0, endMs: T0 + 5_000, trades: 4, openFp: 2n * FP, highFp: 4n * FP, lowFp: 1n * FP, closeFp: 3n * FP,
      quoteVolumeFp: 15n * FP, participants: 3, topParticipantQuoteFp: 8n * FP, twoSidedQuoteFp: 8n * FP,
    });
  });

  it('emits empty bars for quiet seconds with null prices instead of fabricating trades', () => {
    const b = build();
    b.ingest(trade(T0 + 10, 5n * FP, FP), T0 + 10);
    b.ingest(trade(T0 + 3_200, 6n * FP, FP), T0 + 3_200);
    b.advance(T0 + 6_000);
    const bars = b.finalBars(1_000);
    expect(bars.map((bar) => bar.trades)).toEqual([1, 0, 0, 1]);
    expect(bars[1]).toMatchObject({ openFp: null, closeFp: null, vwapFp: null, quoteVolumeFp: 0n });
    expect(tradeBarCandle(bars[1])).toBeNull();
    expect(tradeBarCandle(bars[0])).toMatchObject({ t: T0, o: 5, c: 5, v: 1, qv: 5, n: 1, tbv: 1, closeTime: T0 + 999 });
  });

  it('exposes only final bars to models; the in-progress bar is provisional', () => {
    const b = build();
    b.ingest(trade(T0 + 10, 5n * FP, FP), T0 + 10);
    expect(b.finalBars(1_000)).toHaveLength(0);
    expect(b.provisionalBar(1_000)).toMatchObject({ status: 'PROVISIONAL', trades: 1 });
    expect(tradeBarCandle(b.provisionalBar(1_000)!)).toBeNull();
  });
});

describe('trade-built bars: ordering, lateness and quarantine', () => {
  it('produces identical bars and digests whether on-time trades arrive in order or shuffled', () => {
    const ordered = [0, 150, 300, 800, 1_100, 1_700, 2_300].map((dt, i) =>
      trade(T0 + dt, BigInt(10 + i) * FP, FP, { eventId: `ordered${i}:0`, participant: `w${i % 3}` }));
    const shuffled = [ordered[2], ordered[0], ordered[1], ordered[4], ordered[3], ordered[6], ordered[5]];
    const run = (events: TradeEvent[]) => {
      const b = build();
      events.forEach((e, i) => b.ingest(e, T0 + 2_300 + i));
      b.advance(T0 + 10_000);
      return { bars: b.finalBars(1_000), coarse: b.finalBars(5_000), digest: b.digest() };
    };
    const a = run(ordered), c = run(shuffled);
    expect(c.bars).toEqual(a.bars);
    expect(c.coarse).toEqual(a.coarse);
    expect(c.digest).toBe(a.digest);
    expect(a.bars[0]).toMatchObject({ openFp: 10n * FP, closeFp: 13n * FP });
  });

  it('quarantines late, duplicate, future-dated and malformed trades without touching published bars', () => {
    const b = build();
    const first = trade(T0 + 100, 2n * FP, FP);
    expect(b.ingest(first, T0 + 100).status).toBe('ACCEPTED');
    expect(b.ingest({ ...first }, T0 + 200).status).toBe('DUPLICATE');
    expect(b.ingest(trade(T0 + 5_000, 2n * FP, FP), T0 + 3_000).status).toBe('QUARANTINED_FUTURE');
    expect(b.ingest(trade(T0 + 300, 0n, FP), T0 + 3_000).status).toBe('QUARANTINED_INVALID');
    expect(b.ingest(trade(T0 + 300, FP, FP, { instrumentId: 'OTHER' }), T0 + 3_000).status).toBe('QUARANTINED_INVALID');
    expect(b.ingest(trade(T0 + 300, FP, FP, { participant: 'bad wallet!' }), T0 + 3_000).status).toBe('QUARANTINED_INVALID');
    b.advance(T0 + 4_000);
    const published = b.finalBars(1_000)[0];
    // Base bar T0 ended at T0+1000 <= watermark T0+2000: a trade for it is late.
    expect(b.ingest(trade(T0 + 500, 9n * FP, FP), T0 + 4_100).status).toBe('QUARANTINED_LATE');
    expect(b.finalBars(1_000)[0]).toBe(published);
    expect(b.quality()).toMatchObject({ accepted: 1, duplicate: 1, future: 1, invalid: 3, late: 1 });
  });

  it('accepts an on-time trade earlier than the first trade before any bar is published', () => {
    const b = build();
    b.ingest(trade(T0 + 5_500, 2n * FP, FP), T0 + 5_500);
    expect(b.ingest(trade(T0 + 4_900, 3n * FP, FP), T0 + 5_600).status).toBe('ACCEPTED');
    b.advance(T0 + 20_000);
    expect(b.finalBars(5_000)[0]).toMatchObject({ startMs: T0, trades: 1, openFp: 3n * FP });
    expect(b.finalBars(1_000)[0]).toMatchObject({ startMs: T0 + 4_000, trades: 1 });
  });

  it('rejects a regressing receive clock', () => {
    const b = build();
    b.advance(T0 + 1_000);
    expect(() => b.advance(T0 + 999)).toThrow('TRADE_BAR_CLOCK_REGRESSION');
  });
});

describe('trade-built bars: reorgs, gaps and bounds', () => {
  it('rebuilds a non-final bar exactly when a provisional trade is retracted', () => {
    const b = build();
    const kept = trade(T0 + 100, 2n * FP, FP, { participant: 'walletA' });
    const reorged = trade(T0 + 200, 9n * FP, 5n * FP, { participant: 'walletB', finality: 'provisional' });
    b.ingest(kept, T0 + 100); b.ingest(reorged, T0 + 200);
    expect(b.provisionalBar(1_000)).toMatchObject({ trades: 2, highFp: 9n * FP, quality: { provisionalTrades: 1 } });
    expect(b.retract(reorged.eventId, reorged.eventTimeMs)).toBe('REBUILT');
    b.advance(T0 + 5_000);
    const reference = build();
    reference.ingest({ ...kept }, T0 + 100);
    reference.advance(T0 + 5_000);
    // Compare the whole bar, quality included: a rebuild that kept the retracted trade's provisional flag must fail.
    expect(b.finalBars(1_000)[0]).toEqual(reference.finalBars(1_000)[0]);
    expect(b.finalBars(1_000)[0].quality.provisionalTrades).toBe(0);
    expect(b.retract('neverSeen:0', T0 + 100)).toBe('UNKNOWN');
  });

  it('uses the accepted time for a retraction and re-accepts a re-included transaction', () => {
    const b = build();
    const t = trade(T0 + 100, 2n * FP, FP, { finality: 'provisional' });
    b.ingest(t, T0 + 100);
    expect(b.retract(t.eventId, T0 + 5_000)).toBe('REBUILT'); // caller's time is wrong; the accepted time wins
    expect(b.provisionalBar(1_000)).toMatchObject({ trades: 0 });
    expect(b.ingest({ ...t, finality: 'final' }, T0 + 200).status).toBe('ACCEPTED');
  });

  it('finalizes data bars after a long silence without walking every empty interval', () => {
    const b = build({ maxFinalBars: 10 });
    b.ingest(trade(T0 + 100, 2n * FP, FP), T0 + 100);
    const finalized = b.advance(T0 + 7 * 86_400_000);
    expect(finalized.length).toBeLessThanOrEqual(2 * (10 + 1));
    expect(finalized.some((bar) => bar.startMs === T0 && bar.trades === 1)).toBe(true);
  });

  it('invalidates instead of rewriting when a final bar is reorged, and the bar stops feeding models', () => {
    const b = build();
    const t = trade(T0 + 100, 2n * FP, FP);
    b.ingest(t, T0 + 100);
    b.advance(T0 + 7_000);
    expect(tradeBarCandle(b.finalBars(1_000)[0])).not.toBeNull();
    const before = b.digest();
    expect(b.retract(t.eventId, t.eventTimeMs)).toBe('INVALIDATED');
    expect(b.finalBars(1_000)[0].quality.invalidated).toBe(true);
    expect(b.finalBars(5_000)[0].quality.invalidated).toBe(true);
    expect(tradeBarCandle(b.finalBars(1_000)[0])).toBeNull();
    expect(b.digest()).not.toBe(before);
  });

  it('flags bars that overlap a feed outage so silence is not mistaken for no trading', () => {
    const b = build();
    b.ingest(trade(T0 + 100, 2n * FP, FP), T0 + 100);
    b.advance(T0 + 7_000);
    b.markFeedGap(T0 + 1_000, T0 + 3_000);
    const flags = b.finalBars(1_000).map((bar) => bar.quality.feedGap);
    expect(flags.slice(0, 4)).toEqual([false, true, true, false]);
    expect(b.finalBars(5_000)[0].quality.feedGap).toBe(true);
    expect(() => b.markFeedGap(T0 + 3_000, T0 + 3_000)).toThrow('INVALID_FEED_GAP');
  });

  it('keeps memory bounded across long silence and heavy flow', () => {
    const b = build({ maxFinalBars: 10, maxTradesPerBaseBar: 3, maxParticipantsPerBar: 2, maxSeenIds: 5 });
    for (let i = 0; i < 6; i++) b.ingest(trade(T0 + 100 + i, FP, FP, { participant: `w${i}` }), T0 + 100 + i);
    b.advance(T0 + 86_400_000); // a day of silence finalizes at most one ring of empty bars per interval
    expect(b.finalBars(1_000)).toHaveLength(10);
    expect(b.quality().retainedBaseBars).toBeLessThanOrEqual(2);
    const busy = build({ maxFinalBars: 10, maxTradesPerBaseBar: 3, maxParticipantsPerBar: 2, maxSeenIds: 5 });
    const events = Array.from({ length: 6 }, (_, i) => trade(T0 + 100 + i, FP, FP, { participant: `w${i}` }));
    events.forEach((e) => busy.ingest(e, e.eventTimeMs));
    // Over the retention bound, a retraction can no longer rebuild exactly and invalidates instead.
    expect(busy.retract(events[0].eventId, events[0].eventTimeMs)).toBe('INVALIDATED');
    busy.advance(T0 + 5_000);
    expect(busy.finalBars(1_000)[0]).toMatchObject({ trades: 6, participants: 2, quality: { participantsTruncated: true, invalidated: true } });
  });

  it('evicts ids by time: a copy beyond the horizon is quarantined as late, never double counted', () => {
    const b = build();
    const t = trade(T0 + 100, 2n * FP, FP);
    b.ingest(t, T0 + 100);
    b.advance(T0 + 60_000); // horizon = clock − lateness − base − retraction window = T0 + 47s
    expect(b.ingest({ ...t }, T0 + 60_000).status).toBe('QUARANTINED_LATE');
    expect(b.finalBars(5_000).find((bar) => bar.startMs === T0)).toMatchObject({ trades: 1 }); // the 1s ring has rolled on
    // Beyond the horizon membership is unknown, so a reorg of published data invalidates rather than being ignored.
    expect(b.retract(t.eventId, t.eventTimeMs)).toBe('INVALIDATED');
    expect(b.retract('neverSeen:0', T0 - 3_600_000)).toBe('UNKNOWN'); // no published bar covers that time
  });

  it('invalidates instead of risking a double count when the dedupe cap evicts an id inside the horizon', () => {
    const b = build({ maxSeenIds: 2 });
    for (let i = 0; i < 3; i++) b.ingest(trade(T0 + 100 + i, FP, FP), T0 + 100 + i);
    expect(b.quality()).toMatchObject({ accepted: 3, dedupeOverflow: 1, invalidated: 1 });
    b.advance(T0 + 5_000);
    expect(b.finalBars(1_000)[0].quality.invalidated).toBe(true);
  });

  it('feeds final trade bars into the canonical FeatureEngine without a second indicator engine', () => {
    const b = build({ intervalsMs: [1_000], maxFinalBars: 400 });
    for (let s = 0; s < 260; s++) {
      const price = BigInt(100 + (s % 7)) * FP;
      b.ingest(trade(T0 + s * 1_000 + 10, price, FP, { participant: `w${s % 9}` }), T0 + s * 1_000 + 10);
    }
    b.advance(T0 + 300_000);
    const candles = b.finalBars(1_000).map(tradeBarCandle).filter((c): c is NonNullable<typeof c> => c !== null);
    const engine = new FeatureEngine();
    expect(engine.ingest(candles)).toBe(candles.length);
    expect(engine.last).toMatchObject({ t: candles.at(-1)!.t, n: candles.length });
    expect(Number.isFinite(engine.last!.ema20) && Number.isFinite(engine.last!.rsi14) && Number.isFinite(engine.last!.atr14)).toBe(true);
    expect(engine.last!.takerBuyRatio).toBeCloseTo(1, 9); // every fixture trade is a taker buy
  });

  it('rejects an invalid configuration', () => {
    expect(() => build({ intervalsMs: [1_500] })).toThrow('INVALID_TRADE_BAR_CONFIG');
    expect(() => build({ instrumentId: 'bad id' })).toThrow('INVALID_TRADE_BAR_CONFIG');
    expect(() => build({ maxFinalBars: 0 })).toThrow('INVALID_TRADE_BAR_CONFIG');
  });
});

describe('trade-built bars: review regressions', () => {
  it('computes VWAP from the unrounded notional', () => {
    const b = build();
    b.ingest(trade(T0 + 100, 1n, 1n), T0 + 100);
    b.advance(T0 + 7_000);
    expect(b.finalBars(1_000)[0]).toMatchObject({ quoteVolumeFp: 0n, vwapFp: 1n });
  });

  it('rebuilds from the trade as accepted, not from a later mutation of the caller object', () => {
    const b = build();
    const kept = trade(T0 + 100, 2n * FP, FP);
    const gone = trade(T0 + 200, 3n * FP, FP, { finality: 'provisional' });
    b.ingest(kept, T0 + 100); b.ingest(gone, T0 + 200);
    kept.priceFp = 999n * FP; // caller mutates its object after ingestion
    expect(b.retract(gone.eventId, gone.eventTimeMs)).toBe('REBUILT');
    b.advance(T0 + 7_000);
    expect(b.finalBars(1_000)[0]).toMatchObject({ trades: 1, highFp: 2n * FP, closeFp: 2n * FP });
  });

  it('returns a just-finalized bar with the quality it has after the triggering trade is applied', () => {
    const b = build({ maxSeenIds: 1 });
    b.ingest(trade(T0 + 100, 2n * FP, FP), T0 + 100);
    // This receive time finalizes the first bar; admitting the new id evicts the old one inside the horizon.
    const { finalized } = b.ingest(trade(T0 + 3_000, 2n * FP, FP), T0 + 3_000);
    const first = finalized.find((bar) => bar.intervalMs === 1_000 && bar.startMs === T0)!;
    expect(first.quality.invalidated).toBe(true);
    expect(tradeBarCandle(first)).toBeNull();
  });

  it('flags a just-finalized bar invalidated after the same advance evicted it from the ring', () => {
    const b = build({ intervalsMs: [1_000], maxFinalBars: 1, maxSeenIds: 1 });
    b.ingest(trade(T0 + 100, 2n * FP, FP), T0 + 100);
    const { finalized } = b.ingest(trade(T0 + 4_000, 2n * FP, FP), T0 + 4_000);
    const first = finalized.find((bar) => bar.startMs === T0)!;
    expect(first.quality.invalidated).toBe(true);
    expect(tradeBarCandle(first)).toBeNull();
  });

  it('expires accepted ids by event time even when they arrived out of order', () => {
    const b = build();
    const later = trade(T0 + 2_100, 2n * FP, FP); const earlier = trade(T0 + 1_900, 2n * FP, FP);
    b.ingest(later, T0 + 2_100); b.ingest(earlier, T0 + 2_100);
    b.advance(T0 + 15_000); // horizon is now T0 + 2_000: earlier has expired, later has not
    expect(b.ingest({ ...earlier }, T0 + 15_000).status).toBe('QUARANTINED_LATE');
  });

  it('skips the empty intervals between retained data bars after a long silence', () => {
    const b = build({ intervalsMs: [1_000], allowedLatenessMs: 100_000, maxFinalBars: 5 });
    b.ingest(trade(T0 + 100, 2n * FP, FP), T0 + 100);
    b.ingest(trade(T0 + 50_100, 3n * FP, FP), T0 + 50_100);
    const finalized = b.advance(T0 + 10_000_000);
    expect(finalized.length).toBeLessThanOrEqual(5 + 2);
    expect(finalized.filter((bar) => bar.trades > 0).map((bar) => bar.startMs)).toEqual([T0, T0 + 50_000]);
  });

  it('keeps an open bar flagged when many later outage notices arrive before it finalizes', () => {
    const b = build();
    b.ingest(trade(T0 + 100, 2n * FP, FP), T0 + 100);
    b.markFeedGap(T0 + 200, T0 + 300);
    for (let i = 0; i < 300; i++) b.markFeedGap(T0 + 100_000 + i * 10, T0 + 100_000 + i * 10 + 5);
    b.advance(T0 + 7_000);
    const bar = b.finalBars(1_000)[0];
    expect(bar.quality.feedGap).toBe(true);
    expect(tradeBarCandle(bar)).toBeNull();
  });
});

