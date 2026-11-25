import { createHash } from 'node:crypto';
import { TradeBarBuilder, type TradeBar, type TradeBarConfig } from '../market/tradeBars.js';
import { assessVolumeSpike, VOLUME_SPIKE_POLICY_V1, type VolumeSpikeAssessment, type VolumeSpikeVerdict } from '../market/volumeSpike.js';
import type { HistoricalEvent, HistoricalVenue } from './tape-reader.js';

type Book = Extract<HistoricalEvent, { type: 'BOOK_TICK' }>;
export interface ReplayProbe {
  side: 'buy' | 'sell'; qtyFp: bigint;
}
export interface ReplayOptions {
  venue: HistoricalVenue; symbol: string; latencyMs: number; maxWaitMs: number;
  /** Conservative additional cost beyond observed bid/ask. */
  feeBps: number; slippageBps: number;
}
export interface ReplayObservation {
  signalTsMs: number; dueTsMs: number; observedTsMs: number | null;
  side: ReplayProbe['side']; qtyFp: bigint; status: 'OBSERVED' | 'INSUFFICIENT_DEPTH' | 'EXPIRED' | 'END_OF_TAPE';
  priceFp: bigint | null; feeQuoteFp: bigint | null;
}
const SCALE = 1_000_000_000n, BPS = 10_000n;
const MAX_PENDING = 1024;
const encode = (v: unknown) => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? value.toString() : value);
const safe = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Deterministic execution-cost research, NOT a second OMS or a portfolio backtest.
 * A probe observes only a later book at or after its due time. No fill is invented
 * between observations or after EOF. Funding/launch events are evidence only.
 * Run a single venue/instrument at a time; no cross-asset aggregation.
 * Trusted, fresh research callback per run; no sandbox for arbitrary JS.
 */
export async function replayBookProbes(
  events: AsyncIterable<HistoricalEvent> | Iterable<HistoricalEvent>,
  options: Readonly<ReplayOptions>,
  onBook: (event: Readonly<Book>) => ReplayProbe | null,
  onObservation: (observation: Readonly<ReplayObservation>) => void = () => {},
) {
  const o = { ...options };
  if (!['BINANCE_SPOT', 'BINANCE_FUTURES', 'SOLANA_JUPITER'].includes(o.venue) ||
      !/^[A-Za-z0-9._:/-]{1,128}$/.test(o.symbol) ||
      !safe(o.latencyMs, 1, 86_400_000) || !safe(o.maxWaitMs, 0, 86_400_000) ||
      !safe(o.feeBps, 0, 10_000) || !safe(o.slippageBps, 0, 9_999))
    throw new Error('INVALID_REPLAY_OPTIONS');
  const digest = createHash('sha256');
  digest.update(encode({ version: 1, ...o }) + '\n');
  let last = -1, eventsProcessed = 0, matchingBooks = 0, probes = 0, observed = 0, insufficient = 0, expired = 0, endOfTape = 0;
  const pending: Array<{ signalTsMs: number; dueTsMs: number; side: ReplayProbe['side']; qtyFp: bigint }> = [];
  function finish(p: typeof pending[number], status: ReplayObservation['status'], at: number | null, priceFp: bigint | null = null) {
    const feeQuoteFp = priceFp === null ? null : ceilDiv(priceFp * p.qtyFp * BigInt(o.feeBps), SCALE * BPS);
    const row = Object.freeze({ ...p, status, observedTsMs: at, priceFp, feeQuoteFp });
    digest.update(encode(row) + '\n');
    if (status === 'OBSERVED') observed++;
    else if (status === 'INSUFFICIENT_DEPTH') insufficient++;
    else if (status === 'EXPIRED') expired++;
    else endOfTape++;
    onObservation(row);
  }
  for await (const event of events) {
    if (!safe(event.tsMs, 0, Number.MAX_SAFE_INTEGER) || event.tsMs < last) throw new Error('REPLAY_NON_MONOTONIC');
    last = event.tsMs; eventsProcessed++;
    digest.update(encode(event) + '\n');
    const relevant = event.type === 'BOOK_TICK' && event.venue === o.venue && event.symbol === o.symbol;
    if (relevant) {
      if (typeof event.bidFp !== 'bigint' || typeof event.askFp !== 'bigint' || typeof event.availableTopQtyFp !== 'bigint' ||
          event.bidFp <= 0n || event.askFp < event.bidFp || event.availableTopQtyFp < 0n) throw new Error('REPLAY_INVALID_BOOK');
      matchingBooks++;
    }
    // Expiry follows the virtual clock, including events for unrelated instruments.
    // Consume displayed capacity only once across probes on the same observation.
    let available = relevant ? event.availableTopQtyFp : 0n;
    while (pending.length && pending[0].dueTsMs <= last) {
      const p = pending[0];
      if (last - p.dueTsMs > o.maxWaitMs) { pending.shift(); finish(p, 'EXPIRED', null); continue; }
      if (!relevant) break;
      pending.shift();
      if (p.qtyFp > available) { finish(p, 'INSUFFICIENT_DEPTH', last); continue; }
      available -= p.qtyFp;
      const price = p.side === 'buy'
        ? ceilDiv(event.askFp * (BPS + BigInt(o.slippageBps)), BPS)
        : event.bidFp * (BPS - BigInt(o.slippageBps)) / BPS;
      if (price <= 0n) throw new Error('REPLAY_INVALID_EXECUTION_PRICE');
      finish(p, 'OBSERVED', last, price);
    }
    if (!relevant) continue;
    const probe = onBook(Object.freeze({ ...event }));
    if (probe === null) continue;
    if (!probe || (probe.side !== 'buy' && probe.side !== 'sell') || typeof probe.qtyFp !== 'bigint' ||
        probe.qtyFp <= 0n || probe.qtyFp > 10n ** 39n - 1n ||
        !Number.isSafeInteger(last + o.latencyMs)) throw new Error('INVALID_REPLAY_PROBE');
    if (pending.length >= MAX_PENDING) throw new Error('REPLAY_QUEUE_LIMIT');
    pending.push({ signalTsMs: last, dueTsMs: last + o.latencyMs, side: probe.side, qtyFp: probe.qtyFp });
    probes++;
  }
  for (const p of pending) finish(p, 'END_OF_TAPE', null);
  return {
    version: 1, evidence: 'RESEARCH_UNVERIFIED_TAPE' as const, tradingAuthority: false as const,
    eventsProcessed, matchingBooks, probes, observed, insufficient, expired, endOfTape,
    determinismHash: digest.digest('hex'),
  };
}

export interface TradeEvidenceOptions {
  venue: HistoricalVenue; symbol: string;
  bars: Omit<TradeBarConfig, 'instrumentId'>;
  /** Intervals assessed together for persistence, finest first; each must be a configured bar interval. */
  detectorIntervalsMs: readonly number[];
  /** Launch time for launch-age confidence, when known. */
  launchTsMs?: number;
}
export interface TradeEvidenceAssessment { atMs: number; barStartMs: number; assessment: VolumeSpikeAssessment }

/**
 * Deterministic replay of trade-built bars and FAST volume assessments through the SAME `TradeBarBuilder` and
 * `assessVolumeSpike` used for live evidence (live/replay parity). The tape clock is the receive clock, so lateness,
 * quarantine and finalization behave exactly as they would live. Evidence only: no orders, capital or promotion.
 */
export async function replayTradeEvidence(
  events: AsyncIterable<HistoricalEvent> | Iterable<HistoricalEvent>,
  options: Readonly<TradeEvidenceOptions>,
  onAssessment: (row: Readonly<TradeEvidenceAssessment>) => void = () => {},
) {
  const finest = options.detectorIntervalsMs[0];
  if (!/^[A-Za-z0-9._:/-]{1,128}$/.test(options.symbol) || options.detectorIntervalsMs.length === 0 ||
      !options.detectorIntervalsMs.every((i) => options.bars.intervalsMs.includes(i)) ||
      (options.launchTsMs !== undefined && !safe(options.launchTsMs, 0, Number.MAX_SAFE_INTEGER)))
    throw new Error('INVALID_TRADE_REPLAY_OPTIONS');
  const builder = new TradeBarBuilder({ ...options.bars, instrumentId: `${options.venue}:${options.symbol}`.replace(/\//g, '.') });
  const digest = createHash('sha256');
  digest.update(encode({ version: 1, policy: VOLUME_SPIKE_POLICY_V1.version, ...options }) + '\n');
  const verdicts: Record<VolumeSpikeVerdict, number> = { AUTHENTIC_SPIKE: 0, SUSPECT_SPIKE: 0, NO_SPIKE: 0, INSUFFICIENT_EVIDENCE: 0 };
  const statuses: Record<string, number> = {};
  let last = -1, eventsProcessed = 0, trades = 0;
  function assess(finalized: TradeBar[], atMs: number) {
    for (const bar of finalized) {
      if (bar.intervalMs !== finest) continue;
      const assessment = assessVolumeSpike({
        windows: options.detectorIntervalsMs.map((intervalMs) => ({ intervalMs, bars: builder.finalBars(intervalMs) })),
        launchAgeMs: options.launchTsMs === undefined ? null : atMs - options.launchTsMs,
      });
      verdicts[assessment.verdict]++;
      const row = Object.freeze({ atMs, barStartMs: bar.startMs, assessment });
      digest.update(encode(row) + '\n');
      onAssessment(row);
    }
  }
  for await (const event of events) {
    if (!safe(event.tsMs, 0, Number.MAX_SAFE_INTEGER) || event.tsMs < last) throw new Error('REPLAY_NON_MONOTONIC');
    last = event.tsMs; eventsProcessed++;
    if (event.type === 'TRADE_TICK' && event.venue === options.venue && event.symbol === options.symbol) {
      trades++;
      const { status, finalized } = builder.ingest({
        instrumentId: builder.config.instrumentId, eventId: event.eventId, eventTimeMs: event.tsMs,
        priceFp: event.priceFp, baseQtyFp: event.baseQtyFp, aggressor: event.aggressor,
        participant: event.participant, finality: event.finality,
      }, event.tsMs);
      statuses[status] = (statuses[status] ?? 0) + 1;
      assess(finalized, event.tsMs);
    } else {
      // The virtual clock advances on every event, so bars finalize even while this instrument is quiet.
      assess(builder.advance(event.tsMs), event.tsMs);
    }
  }
  const barsDigest = builder.digest();
  digest.update(barsDigest + '\n');
  return {
    version: 1, evidence: 'RESEARCH_UNVERIFIED_TAPE' as const, tradingAuthority: false as const,
    policyVersion: VOLUME_SPIKE_POLICY_V1.version, eventsProcessed, trades, ingest: statuses, verdicts,
    quality: builder.quality(), barsDigest, determinismHash: digest.digest('hex'),
  };
}
