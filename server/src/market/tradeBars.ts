import { createHash, type Hash } from 'node:crypto';
import type { Candle } from './types.js';

/**
 * Trade-built bars (BrainOS V2 roadmap P1.2).
 *
 * Bars are built incrementally from actual trades or swaps, never from quotes. All prices and quantities are exact
 * 1e9 fixed-point integers, the same scale as the Strategy Lab tape. The builder is single-instrument and fully
 * deterministic: the same events with the same receive clock always produce the same final bars and digest, so live
 * processing and historical replay share one implementation.
 *
 * Event-time rules:
 *  - Each base bar (the finest resolution) finalizes once `clock - allowedLateness` passes its end. Coarser bars
 *    finalize the same way and are merged from base bars, so every interval agrees exactly.
 *  - A trade for an already-final base bar is quarantined as late, never silently merged.
 *  - A retraction (chain reorg or venue bust) rebuilds a non-final bar from its retained trades. If the bar is
 *    already final, or its trades were not retained, the affected bars are marked invalidated instead.
 *  - Bars without trades are emitted as empty with null prices. Missing trades are marked, never fabricated.
 *
 * Bars are market evidence only. They carry no order, capital or trading authority.
 */
export const FP_SCALE = 1_000_000_000n;

export interface TradeEvent {
  instrumentId: string;
  /** Venue-unique identity (trade id, or transaction signature plus instruction index). */
  eventId: string;
  eventTimeMs: number;
  /** Quote per base unit, 1e9 fixed point. */
  priceFp: bigint;
  /** Base quantity, 1e9 fixed point. */
  baseQtyFp: bigint;
  aggressor: 'buy' | 'sell';
  /** Funded wallet or account, when the venue exposes it. Required to verify volume authenticity. */
  participant?: string;
  finality: 'final' | 'provisional';
}

export interface TradeBarConfig {
  instrumentId: string;
  baseIntervalMs: number;
  /** Each interval must be a multiple of `baseIntervalMs`. */
  intervalsMs: readonly number[];
  allowedLatenessMs: number;
  /** A trade timestamped further than this beyond its receive time is quarantined as future-dated. */
  maxFutureSkewMs: number;
  /** Final bars retained per interval. */
  maxFinalBars: number;
  /** Trades retained per non-final base bar for deterministic rebuilds. */
  maxTradesPerBaseBar: number;
  maxParticipantsPerBar: number;
  /**
   * How long after receipt a reorg or bust notice can still arrive. Trade ids are kept for deduplication and exact
   * retraction answers for `allowedLatenessMs + baseIntervalMs + retractionWindowMs`, then evicted by time.
   */
  retractionWindowMs: number;
  /** Hard cap on retained ids. Evicting an id still inside the horizon invalidates its bar (fail closed). */
  maxSeenIds: number;
}

export const FAST_TRADE_BARS: Omit<TradeBarConfig, 'instrumentId'> = {
  baseIntervalMs: 1_000, intervalsMs: [1_000, 5_000, 15_000, 60_000, 300_000], allowedLatenessMs: 2_000,
  maxFutureSkewMs: 2_000, maxFinalBars: 120, maxTradesPerBaseBar: 5_000, maxParticipantsPerBar: 5_000,
  retractionWindowMs: 30_000, maxSeenIds: 50_000,
};
export const DEEP_TRADE_BARS: Omit<TradeBarConfig, 'instrumentId'> = {
  baseIntervalMs: 60_000, intervalsMs: [60_000, 300_000, 900_000, 3_600_000, 14_400_000], allowedLatenessMs: 5_000,
  maxFutureSkewMs: 5_000, maxFinalBars: 500, maxTradesPerBaseBar: 20_000, maxParticipantsPerBar: 2_000,
  retractionWindowMs: 10_000, maxSeenIds: 100_000,
};

export interface TradeBar {
  instrumentId: string;
  intervalMs: number;
  startMs: number;
  endMs: number;
  status: 'PROVISIONAL' | 'FINAL';
  trades: number;
  openFp: bigint | null;
  highFp: bigint | null;
  lowFp: bigint | null;
  closeFp: bigint | null;
  vwapFp: bigint | null;
  baseVolumeFp: bigint;
  quoteVolumeFp: bigint;
  buyBaseFp: bigint;
  buyQuoteFp: bigint;
  sellQuoteFp: bigint;
  /** Distinct participants (a lower bound when truncated). */
  participants: number;
  /** Largest single participant's buy plus sell quote volume. */
  topParticipantQuoteFp: bigint;
  /** Quote volume from participants who both bought and sold within the bar (wash and circular-swap indicator). */
  twoSidedQuoteFp: bigint;
  quality: {
    /** False when any trade lacked a participant identity. */
    participantsKnown: boolean;
    participantsTruncated: boolean;
    provisionalTrades: number;
    feedGap: boolean;
    /** A reorg or bust touched this bar after it could no longer be rebuilt exactly. */
    invalidated: boolean;
  };
}

export type IngestStatus = 'ACCEPTED' | 'DUPLICATE' | 'QUARANTINED_LATE' | 'QUARANTINED_FUTURE' | 'QUARANTINED_INVALID';
export type RetractStatus = 'REBUILT' | 'INVALIDATED' | 'UNKNOWN';

type Key = { t: number; id: string };
interface Side { buy: bigint; sell: bigint }
interface Agg {
  trades: number;
  open: (Key & { price: bigint }) | null;
  close: (Key & { price: bigint }) | null;
  high: bigint | null;
  low: bigint | null;
  base: bigint;
  quote: bigint;
  buyBase: bigint;
  buyQuote: bigint;
  sellQuote: bigint;
  /** Unrounded sum of price x quantity (FP^2 scale); VWAP divides it by base volume once, at build time. */
  notional: bigint;
  byParticipant: Map<string, Side>;
  participantsTruncated: boolean;
  anonymous: number;
  provisional: number;
}
interface BaseBar {
  startMs: number;
  agg: Agg;
  /** Retained while non-final, for deterministic rebuilds; null once final or after overflow. */
  trades: Map<string, TradeEvent> | null;
  /** More trades than `maxTradesPerBaseBar`: membership is unknown and retractions must invalidate. */
  overflow: boolean;
  invalidated: boolean;
}

const ID = /^[A-Za-z0-9:_.\-]{1,128}$/;
const PARTICIPANT = /^[A-Za-z0-9]{1,64}$/;
const before = (a: Key, b: Key) => a.t < b.t || (a.t === b.t && a.id < b.id);
const encode = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
const emptyAgg = (): Agg => ({
  trades: 0, open: null, close: null, high: null, low: null, base: 0n, quote: 0n, buyBase: 0n, buyQuote: 0n,
  sellQuote: 0n, notional: 0n, byParticipant: new Map(), participantsTruncated: false, anonymous: 0, provisional: 0,
});

/** Quality records are immutable and few distinct values recur, so they are shared instead of allocated per bar. */
const QUALITY = new Map<string, TradeBar['quality']>();
function quality(participantsKnown: boolean, participantsTruncated: boolean, provisionalTrades: number, feedGap: boolean, invalidated: boolean) {
  if (provisionalTrades > 0) return Object.freeze({ participantsKnown, participantsTruncated, provisionalTrades, feedGap, invalidated });
  const key = `${+participantsKnown}${+participantsTruncated}${+feedGap}${+invalidated}`;
  let q = QUALITY.get(key);
  if (!q) { q = Object.freeze({ participantsKnown, participantsTruncated, provisionalTrades: 0, feedGap, invalidated }); QUALITY.set(key, q); }
  return q;
}

function validConfig(c: TradeBarConfig) {
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  return ID.test(c.instrumentId) && positive(c.baseIntervalMs) && c.intervalsMs.length > 0 &&
    c.intervalsMs.every((i) => positive(i) && i % c.baseIntervalMs === 0) &&
    new Set(c.intervalsMs).size === c.intervalsMs.length &&
    Number.isSafeInteger(c.allowedLatenessMs) && c.allowedLatenessMs >= 0 &&
    Number.isSafeInteger(c.maxFutureSkewMs) && c.maxFutureSkewMs >= 0 &&
    positive(c.maxFinalBars) && positive(c.maxTradesPerBaseBar) && positive(c.maxParticipantsPerBar) && positive(c.maxSeenIds) &&
    Number.isSafeInteger(c.retractionWindowMs) && c.retractionWindowMs >= 0;
}

function addTrade(agg: Agg, trade: TradeEvent, maxParticipants: number) {
  const key = { t: trade.eventTimeMs, id: trade.eventId };
  const quote = trade.priceFp * trade.baseQtyFp / FP_SCALE;
  agg.trades++;
  if (!agg.open || before(key, agg.open)) agg.open = { ...key, price: trade.priceFp };
  if (!agg.close || before(agg.close, key)) agg.close = { ...key, price: trade.priceFp };
  if (agg.high === null || trade.priceFp > agg.high) agg.high = trade.priceFp;
  if (agg.low === null || trade.priceFp < agg.low) agg.low = trade.priceFp;
  agg.base += trade.baseQtyFp;
  agg.quote += quote;
  agg.notional += trade.priceFp * trade.baseQtyFp;
  if (trade.aggressor === 'buy') { agg.buyBase += trade.baseQtyFp; agg.buyQuote += quote; } else agg.sellQuote += quote;
  if (trade.finality === 'provisional') agg.provisional++;
  if (!trade.participant) { agg.anonymous++; return; }
  addParticipant(agg, trade.participant, trade.aggressor === 'buy' ? { buy: quote, sell: 0n } : { buy: 0n, sell: quote }, maxParticipants);
}

function addParticipant(agg: Agg, who: string, side: Side, maxParticipants: number) {
  const existing = agg.byParticipant.get(who);
  if (existing) { existing.buy += side.buy; existing.sell += side.sell; return; }
  if (agg.byParticipant.size >= maxParticipants) { agg.participantsTruncated = true; return; }
  agg.byParticipant.set(who, { buy: side.buy, sell: side.sell });
}

function mergeInto(target: Agg, source: Agg, maxParticipants: number) {
  if (source.trades === 0) return;
  target.trades += source.trades;
  if (source.open && (!target.open || before(source.open, target.open))) target.open = source.open;
  if (source.close && (!target.close || before(target.close, source.close))) target.close = source.close;
  if (source.high !== null && (target.high === null || source.high > target.high)) target.high = source.high;
  if (source.low !== null && (target.low === null || source.low < target.low)) target.low = source.low;
  target.base += source.base; target.quote += source.quote; target.notional += source.notional; target.buyBase += source.buyBase;
  target.buyQuote += source.buyQuote; target.sellQuote += source.sellQuote;
  target.anonymous += source.anonymous; target.provisional += source.provisional;
  target.participantsTruncated ||= source.participantsTruncated;
  // Deterministic: participant maps are merged in sorted key order.
  for (const who of [...source.byParticipant.keys()].sort()) addParticipant(target, who, source.byParticipant.get(who)!, maxParticipants);
}

/** Incremental, bounded, deterministic trade-to-bar builder for one instrument. */
export class TradeBarBuilder {
  readonly config: Readonly<TradeBarConfig>;
  private clock = -1;
  /** Base bars that are not final yet (at most about `allowedLatenessMs + baseIntervalMs` of history). */
  private readonly baseBars = new Map<number, BaseBar>();
  /** Per interval, the open bar's accumulator: final base bars are merged in and then dropped. */
  private readonly open = new Map<number, Map<number, { agg: Agg; invalidated: boolean }>>();
  /** Next bar start to finalize, per interval; null until the first accepted trade. */
  private readonly nextStart = new Map<number, number | null>();
  private readonly finals = new Map<number, TradeBar[]>();
  /** Accepted trade id → event time, in receive order. Evicted by time horizon, capped by `maxSeenIds`. */
  private readonly seen = new Map<string, number>();
  /** The same ids bucketed by base-bar start, so expiry follows event time even when trades arrive out of order. */
  private readonly seenBuckets = new Map<number, string[]>();
  private readonly gaps: Array<{ fromMs: number; toMs: number }> = [];
  /** Event times invalidated while ingest applies its trade; null outside ingest. */
  private pendingInvalidations: number[] | null = null;
  private readonly hash: Hash = createHash('sha256');
  private readonly counts = { accepted: 0, duplicate: 0, late: 0, future: 0, invalid: 0, rebuilt: 0, invalidated: 0, dedupeOverflow: 0 };

  constructor(config: TradeBarConfig) {
    if (!validConfig(config)) throw new Error('INVALID_TRADE_BAR_CONFIG');
    this.config = Object.freeze({ ...config, intervalsMs: [...config.intervalsMs].sort((a, b) => a - b) });
    for (const interval of this.config.intervalsMs) {
      this.nextStart.set(interval, null); this.finals.set(interval, []); this.open.set(interval, new Map());
    }
    this.hash.update(encode({ version: 1, ...this.config }) + '\n');
  }

  /** Advances the receive clock, then applies the trade. Returns bars finalized by the clock advance. */
  ingest(trade: TradeEvent, receiveTimeMs: number): { status: IngestStatus; finalized: TradeBar[] } {
    const finalized = this.advance(receiveTimeMs);
    // Applying the trade can invalidate a bar the advance just finalized (dedupe overflow). Publish the current ring
    // version; a bar the same advance already evicted from the ring is flagged here from the recorded invalidation times.
    const invalidatedTimes: number[] = [];
    this.pendingInvalidations = invalidatedTimes;
    let status: IngestStatus;
    try { status = this.apply(trade, receiveTimeMs); } finally { this.pendingInvalidations = null; }
    const flagged = (bar: TradeBar) => !bar.quality.invalidated && invalidatedTimes.some((t) => bar.startMs <= t && t < bar.endMs)
      ? Object.freeze({ ...bar, quality: Object.freeze({ ...bar.quality, invalidated: true }) }) : bar;
    return { status, finalized: finalized.map((bar) => flagged(this.finals.get(bar.intervalMs)!.find((b) => b.startMs === bar.startMs) ?? bar)) };
  }

  /** Moves the monotonic receive clock and finalizes every bar whose end is at or before the watermark. */
  advance(nowMs: number): TradeBar[] {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('INVALID_TRADE_BAR_CLOCK');
    if (nowMs < this.clock) throw new Error('TRADE_BAR_CLOCK_REGRESSION');
    this.clock = nowMs;
    const watermark = nowMs - this.config.allowedLatenessMs;
    // A base bar at or before the watermark is final and immutable: merge it into every interval's open bar, in start
    // order (deterministic participant truncation), and drop it. Every bar of a coarse interval is merged before
    // that interval can finalize, because the coarse end is never before its last base bar's end.
    const ready = [...this.baseBars.keys()].filter((t) => t + this.config.baseIntervalMs <= watermark).sort((a, b) => a - b);
    for (const startMs of ready) {
      const bar = this.baseBars.get(startMs)!;
      for (const interval of this.config.intervalsMs) {
        const accumulators = this.open.get(interval)!;
        const key = Math.floor(startMs / interval) * interval;
        let acc = accumulators.get(key);
        if (!acc) { acc = { agg: emptyAgg(), invalidated: false }; accumulators.set(key, acc); }
        mergeInto(acc.agg, bar.agg, this.config.maxParticipantsPerBar);
        acc.invalidated ||= bar.invalidated;
      }
      this.baseBars.delete(startMs);
    }
    // Ids older than the horizon can no longer arrive on time or be retracted exactly; a later copy is quarantined as late.
    const horizon = this.horizonStart();
    for (const bucket of [...this.seenBuckets.keys()].filter((k) => k < horizon).sort((a, b) => a - b)) {
      const ids = this.seenBuckets.get(bucket)!;
      const keep = ids.filter((id) => { const t = this.seen.get(id); if (t === undefined) return false; if (t < horizon) { this.seen.delete(id); return false; } return true; });
      if (keep.length) this.seenBuckets.set(bucket, keep); else this.seenBuckets.delete(bucket);
    }
    const finalized: TradeBar[] = [];
    for (const interval of this.config.intervalsMs) {
      let start = this.nextStart.get(interval);
      if (start === null || start === undefined) continue;
      // After a long silence, keep at most one ring of empty bars instead of looping through every missing interval.
      // Only empty ranges are skipped; bars holding trades are always finalized.
      const latestStart = Math.floor(watermark / interval) * interval - interval;
      const floor = latestStart - (this.config.maxFinalBars - 1) * interval;
      // Below the floor, finalize only the bars that hold data (in start order), never the empty intervals between
      // them; then continue contiguously from the floor.
      const from = start;
      const dataStarts = [...new Set([...this.open.get(interval)!.keys(), ...[...this.baseBars.keys()].map((t) => Math.floor(t / interval) * interval)])]
        .filter((t) => t >= from && t < floor && t + interval <= watermark).sort((a, b) => a - b);
      for (const t of dataStarts) finalized.push(this.finalizeBar(interval, t));
      if (start < floor) start = floor;
      while (start + interval <= watermark) {
        finalized.push(this.finalizeBar(interval, start));
        start += interval;
      }
      this.nextStart.set(interval, start);
    }
    return finalized;
  }

  /** Reorg or bust: remove a trade. Final or unretained bars are invalidated instead of being silently rewritten. */
  retract(eventId: string, eventTimeMs: number): RetractStatus {
    if (!ID.test(eventId) || !Number.isSafeInteger(eventTimeMs) || eventTimeMs < 0) return 'UNKNOWN';
    // The accepted trade's own time is authoritative over the caller's.
    const known = this.seen.get(eventId);
    if (known !== undefined) eventTimeMs = known;
    const start = this.baseStart(eventTimeMs);
    const bar = this.baseBars.get(start);
    if (bar?.trades) {
      // Exact retention while non-final: a trade absent from this bar was never part of it.
      if (!bar.trades.has(eventId)) return 'UNKNOWN';
      bar.trades.delete(eventId);
      bar.agg = emptyAgg();
      const ordered = [...bar.trades.values()].sort((a, b) => before({ t: a.eventTimeMs, id: a.eventId }, { t: b.eventTimeMs, id: b.eventId }) ? -1 : 1);
      for (const trade of ordered) addTrade(bar.agg, trade, this.config.maxParticipantsPerBar);
      // Forget the id so a reorg that re-includes the same transaction is accepted again, not dropped as a duplicate.
      this.seen.delete(eventId);
      this.counts.rebuilt++;
      this.hash.update(encode({ event: 'RETRACT_REBUILT', eventId, startMs: start }) + '\n');
      return 'REBUILT';
    }
    // A final, pruned or over-retention bar cannot be rebuilt exactly, so it is invalidated (fail closed). Inside the
    // deduplication horizon the retained ids say whether the trade was ever accepted; beyond it, membership is unknown.
    if (!bar?.overflow && !this.seen.has(eventId) && eventTimeMs >= this.horizonStart()) return 'UNKNOWN';
    if (!this.hasData(eventTimeMs)) return 'UNKNOWN';
    this.invalidate(eventTimeMs);
    return 'INVALIDATED';
  }

  /** Marks a feed outage. Bars overlapping it are flagged, so their emptiness is not mistaken for no trading. */
  markFeedGap(fromMs: number, toMs: number) {
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs >= toMs) throw new Error('INVALID_FEED_GAP');
    this.gaps.push({ fromMs, toMs });
    // Bounded without losing evidence: the two oldest notices are coalesced into one covering range. That can flag
    // bars between them as gapped too (conservative), but an open bar can never lose its only outage notice.
    if (this.gaps.length > 256) {
      const [a, b] = this.gaps.splice(0, 2);
      this.gaps.unshift({ fromMs: Math.min(a.fromMs, b.fromMs), toMs: Math.max(a.toMs, b.toMs) });
    }
    this.hash.update(encode({ event: 'FEED_GAP', fromMs, toMs }) + '\n');
    for (const ring of this.finals.values()) {
      for (let i = 0; i < ring.length; i++) {
        const bar = ring[i];
        if (bar.startMs < toMs && bar.endMs > fromMs && !bar.quality.feedGap)
          ring[i] = Object.freeze({ ...bar, quality: Object.freeze({ ...bar.quality, feedGap: true }) });
      }
    }
  }

  /** Final bars for one interval, oldest first. Models must only consume final bars. */
  finalBars(intervalMs: number): readonly TradeBar[] {
    const ring = this.finals.get(intervalMs);
    if (!ring) throw new Error('UNKNOWN_TRADE_BAR_INTERVAL');
    return ring;
  }

  /** The current in-progress bar for display only; never feed it to models as complete. */
  provisionalBar(intervalMs: number): TradeBar | null {
    if (!this.finals.has(intervalMs)) throw new Error('UNKNOWN_TRADE_BAR_INTERVAL');
    const start = this.nextStart.get(intervalMs);
    if (start === null || start === undefined || this.clock < 0) return null;
    const currentStart = Math.max(start, Math.floor(this.clock / intervalMs) * intervalMs);
    // Copy the accumulator so display reads never mutate it, then add the not-yet-final base bars.
    const acc = this.open.get(intervalMs)!.get(currentStart);
    const agg = emptyAgg();
    if (acc) mergeInto(agg, acc.agg, this.config.maxParticipantsPerBar);
    let invalidated = acc?.invalidated ?? false;
    for (let t = currentStart; t < currentStart + intervalMs; t += this.config.baseIntervalMs) {
      const bar = this.baseBars.get(t);
      if (!bar) continue;
      mergeInto(agg, bar.agg, this.config.maxParticipantsPerBar);
      invalidated ||= bar.invalidated;
    }
    return this.buildBar(intervalMs, currentStart, 'PROVISIONAL', agg, invalidated);
  }

  quality() {
    let openBars = 0;
    for (const accumulators of this.open.values()) openBars += accumulators.size;
    return { ...this.counts, clockMs: this.clock, retainedBaseBars: this.baseBars.size, openBars, retainedIds: this.seen.size };
  }

  /** SHA-256 over every final bar, retraction and gap in emission order. Equal inputs give equal digests. */
  digest() { return this.hash.copy().digest('hex'); }

  private apply(trade: TradeEvent, receiveTimeMs: number): IngestStatus {
    if (!trade || trade.instrumentId !== this.config.instrumentId || !ID.test(trade.eventId) ||
        !Number.isSafeInteger(trade.eventTimeMs) || trade.eventTimeMs < 0 ||
        typeof trade.priceFp !== 'bigint' || typeof trade.baseQtyFp !== 'bigint' || trade.priceFp <= 0n || trade.baseQtyFp <= 0n ||
        (trade.aggressor !== 'buy' && trade.aggressor !== 'sell') ||
        (trade.finality !== 'final' && trade.finality !== 'provisional') ||
        (trade.participant !== undefined && !PARTICIPANT.test(trade.participant))) {
      this.counts.invalid++;
      return 'QUARANTINED_INVALID';
    }
    if (this.seen.has(trade.eventId)) { this.counts.duplicate++; return 'DUPLICATE'; }
    if (trade.eventTimeMs > receiveTimeMs + this.config.maxFutureSkewMs) { this.counts.future++; return 'QUARANTINED_FUTURE'; }
    const start = this.baseStart(trade.eventTimeMs);
    const watermark = this.clock - this.config.allowedLatenessMs;
    // A trade belongs to a final bar if its base bar ended at or before the watermark, or any interval has already
    // finalized past it. Both are late and quarantined, never merged into published history.
    const finalizedPast = this.config.intervalsMs.some((i) => this.finals.get(i)!.length > 0 && start < (this.nextStart.get(i) ?? 0));
    if (start + this.config.baseIntervalMs <= watermark || finalizedPast) { this.counts.late++; return 'QUARANTINED_LATE'; }
    this.remember(trade.eventId, trade.eventTimeMs);
    // Until an interval publishes its first bar, an earlier (still on-time) trade moves its first bar back.
    for (const interval of this.config.intervalsMs) {
      const aligned = Math.floor(trade.eventTimeMs / interval) * interval;
      const current = this.nextStart.get(interval);
      if (current === null || current === undefined || (this.finals.get(interval)!.length === 0 && aligned < current))
        this.nextStart.set(interval, aligned);
    }
    let bar = this.baseBars.get(start);
    if (!bar) { bar = { startMs: start, agg: emptyAgg(), trades: new Map(), overflow: false, invalidated: false }; this.baseBars.set(start, bar); }
    addTrade(bar.agg, trade, this.config.maxParticipantsPerBar);
    // Retain a copy: the caller's object is mutable, and a rebuild must use exactly what was accepted.
    if (bar.trades && bar.trades.size < this.config.maxTradesPerBaseBar) bar.trades.set(trade.eventId, { ...trade });
    else if (bar.trades) {
      // Over the retention bound: a later retraction invalidates instead of rebuilding.
      bar.trades = null;
      bar.overflow = true;
    }
    this.counts.accepted++;
    return 'ACCEPTED';
  }

  private baseStart(t: number) { return Math.floor(t / this.config.baseIntervalMs) * this.config.baseIntervalMs; }

  private horizonStart() {
    return this.clock - this.config.allowedLatenessMs - this.config.baseIntervalMs - this.config.retractionWindowMs;
  }

  /** True when a base bar, an open bar or a published final bar covers this event time. */
  private hasData(eventTimeMs: number) {
    if (this.baseBars.has(this.baseStart(eventTimeMs))) return true;
    for (const [interval, accumulators] of this.open) {
      if (accumulators.has(Math.floor(eventTimeMs / interval) * interval)) return true;
    }
    for (const ring of this.finals.values()) {
      if (ring.length && ring[0].startMs <= eventTimeMs && eventTimeMs < ring[ring.length - 1].endMs) return true;
    }
    return false;
  }

  private remember(eventId: string, eventTimeMs: number) {
    this.seen.set(eventId, eventTimeMs);
    const bucket = this.baseStart(eventTimeMs);
    const ids = this.seenBuckets.get(bucket);
    if (ids) ids.push(eventId); else this.seenBuckets.set(bucket, [eventId]);
    if (this.seen.size <= this.config.maxSeenIds) return;
    const [oldest, oldestTime] = this.seen.entries().next().value as [string, number];
    this.seen.delete(oldest);
    if (oldestTime >= this.horizonStart()) {
      // A duplicate of the evicted id could now be double counted: invalidate its bar instead.
      this.counts.dedupeOverflow++;
      this.invalidate(oldestTime);
    }
  }

  private buildBar(interval: number, start: number, status: TradeBar['status'], agg: Agg, invalidated: boolean): TradeBar {
    let top = 0n, twoSided = 0n;
    for (const side of agg.byParticipant.values()) {
      const total = side.buy + side.sell;
      if (total > top) top = total;
      if (side.buy > 0n && side.sell > 0n) twoSided += total;
    }
    const end = start + interval;
    return Object.freeze({
      instrumentId: this.config.instrumentId, intervalMs: interval, startMs: start, endMs: end, status, trades: agg.trades,
      openFp: agg.open?.price ?? null, highFp: agg.high, lowFp: agg.low, closeFp: agg.close?.price ?? null,
      vwapFp: agg.base > 0n ? agg.notional / agg.base : null,
      baseVolumeFp: agg.base, quoteVolumeFp: agg.quote, buyBaseFp: agg.buyBase, buyQuoteFp: agg.buyQuote, sellQuoteFp: agg.sellQuote,
      participants: agg.byParticipant.size, topParticipantQuoteFp: top, twoSidedQuoteFp: twoSided,
      quality: quality(agg.anonymous === 0, agg.participantsTruncated, agg.provisional,
        this.gaps.some((g) => g.fromMs < end && g.toMs > start), invalidated),
    });
  }

  private finalizeBar(interval: number, start: number) {
    const accumulators = this.open.get(interval)!;
    const acc = accumulators.get(start);
    accumulators.delete(start);
    const bar = this.buildBar(interval, start, 'FINAL', acc?.agg ?? emptyAgg(), acc?.invalidated ?? false);
    const ring = this.finals.get(interval)!;
    ring.push(bar);
    if (ring.length > this.config.maxFinalBars) ring.shift();
    this.hash.update(encode(bar) + '\n');
    return bar;
  }

  private invalidate(eventTimeMs: number) {
    const start = this.baseStart(eventTimeMs);
    const base = this.baseBars.get(start);
    if (base) { base.invalidated = true; base.trades = null; base.overflow = true; }
    for (const [interval, accumulators] of this.open) {
      const acc = accumulators.get(Math.floor(eventTimeMs / interval) * interval);
      if (acc) acc.invalidated = true;
    }
    for (const ring of this.finals.values()) {
      for (let i = 0; i < ring.length; i++) {
        const bar = ring[i];
        if (bar.startMs <= eventTimeMs && eventTimeMs < bar.endMs && !bar.quality.invalidated)
          ring[i] = Object.freeze({ ...bar, quality: Object.freeze({ ...bar.quality, invalidated: true }) });
      }
    }
    this.counts.invalidated++;
    this.pendingInvalidations?.push(eventTimeMs);
    this.hash.update(encode({ event: 'INVALIDATED', eventTimeMs }) + '\n');
  }
}

/** Converts a usable final bar to the canonical `Candle` consumed by `FeatureEngine`. Unusable bars return null. */
export function tradeBarCandle(bar: TradeBar): Candle | null {
  if (bar.status !== 'FINAL' || bar.trades === 0 || bar.quality.invalidated || bar.quality.feedGap ||
      bar.openFp === null || bar.highFp === null || bar.lowFp === null || bar.closeFp === null) return null;
  const n = (fp: bigint) => Number(fp) / 1e9;
  return {
    t: bar.startMs, o: n(bar.openFp), h: n(bar.highFp), l: n(bar.lowFp), c: n(bar.closeFp),
    v: n(bar.baseVolumeFp), qv: n(bar.quoteVolumeFp), n: bar.trades, tbv: n(bar.buyBaseFp), closeTime: bar.endMs - 1,
  };
}
