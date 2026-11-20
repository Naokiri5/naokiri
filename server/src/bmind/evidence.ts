import { z } from 'zod';
import { sha256 } from '../core/util.js';
import { bookAge, QUALITY_LIMITS } from '../market/quality.js';

const timestamp = z.number().int().nonnegative();
const price = z.number().positive().finite();
const tickerSchema = z.object({
  instrumentId: z.string(), symbol: z.string().regex(/^[A-Z0-9]+$/),
  base: z.string().regex(/^[A-Z0-9]+$/), quote: z.literal('USDT'),
  source: z.literal('binance'), providerTs: timestamp, receivedAt: timestamp,
  last: price, bid: price, ask: price, quoteVolume: z.number().nonnegative().finite(),
});
const depthSide = z.array(z.tuple([price, price])).min(1).max(100);
const bookSchema = z.object({ ts: timestamp, bids: depthSide, asks: depthSide });
const snapshotSchema = z.object({
  schemaVersion: z.literal('ditas.snapshot.v1'), instrumentId: z.string(), asOf: timestamp,
  ticker: z.unknown().optional(), book: z.unknown().optional(),
  quality: z.object({ status: z.enum(['OK', 'WARN', 'FAIL']) }),
});

type EvidenceKind = 'TICKER' | 'BOOK';
type EvidenceReference =
  | { kind: EvidenceKind; status: 'UNKNOWN' | 'STALE'; reason: string }
  | {
    kind: EvidenceKind; status: 'AVAILABLE'; originId: string; dependencyGroup: 'binance';
    eventTimeMs: number | null; receivedTimeMs: number | null; requestStartedAtMs: number | null;
  };

function tickerReference(value: unknown, instrumentId: string, asOf: number): EvidenceReference {
  const parsed = tickerSchema.safeParse(value);
  const kind = 'TICKER';
  if (!parsed.success) return { kind, status: 'UNKNOWN', reason: 'TICKER_MISSING_OR_INVALID' };
  const t = parsed.data;
  if (t.instrumentId !== instrumentId || instrumentId !== `crypto:binance:${t.symbol}` || t.symbol !== t.base + t.quote) {
    return { kind, status: 'UNKNOWN', reason: 'TICKER_IDENTITY_MISMATCH' };
  }
  if (t.bid > t.ask || t.receivedAt > asOf || t.providerTs > asOf
    || t.providerTs > t.receivedAt + QUALITY_LIMITS.clockSkewMs) {
    return { kind, status: 'UNKNOWN', reason: 'TICKER_INVALID_SPREAD_OR_CLOCK' };
  }
  if (asOf - Math.min(t.receivedAt, t.providerTs) > QUALITY_LIMITS.maxQuoteAgeMs) {
    return { kind, status: 'STALE', reason: 'TICKER_EXPIRED_AT_CAPTURE' };
  }
  // A refetched copy of the same exchange observation is still the same origin.
  const { receivedAt, ...origin } = t;
  return {
    kind, status: 'AVAILABLE', originId: sha256(JSON.stringify([kind, origin])),
    dependencyGroup: 'binance', eventTimeMs: t.providerTs, receivedTimeMs: receivedAt, requestStartedAtMs: null,
  };
}

function bookReference(value: unknown, instrumentId: string, asOf: number): EvidenceReference {
  const kind = 'BOOK';
  const parsed = bookSchema.safeParse(value);
  if (!parsed.success) return { kind, status: 'UNKNOWN', reason: 'BOOK_MISSING_OR_INVALID' };
  const book = parsed.data;
  const age = bookAge(book, asOf);
  if (age === null) return { kind, status: 'UNKNOWN', reason: 'BOOK_INVALID_DEPTH_OR_CLOCK' };
  if (age > QUALITY_LIMITS.maxBookAgeMs) return { kind, status: 'STALE', reason: 'BOOK_EXPIRED_AT_CAPTURE' };
  return {
    kind, status: 'AVAILABLE', originId: sha256(JSON.stringify([kind, instrumentId, book])),
    dependencyGroup: 'binance', eventTimeMs: null, receivedTimeMs: null, requestStartedAtMs: book.ts,
  };
}

/** An archive projection. Age is measured at capture and no live service is queried. */
export function projectBehaviorEvidence(payload: unknown, instrumentId: string, capturedAt: number) {
  const parsed = snapshotSchema.safeParse(payload);
  if (!parsed.success || parsed.data.instrumentId !== instrumentId || parsed.data.asOf !== capturedAt) return null;
  const snapshot = parsed.data;
  const ticker = tickerReference(snapshot.ticker, instrumentId, capturedAt);
  // The v1 book lacks its own identity. Only attribute it when the primary venue and instrument are corroborated.
  const book: EvidenceReference = ticker.status === 'AVAILABLE'
    ? bookReference(snapshot.book, instrumentId, capturedAt)
    : { kind: 'BOOK', status: 'UNKNOWN', reason: 'PRIMARY_IDENTITY_UNVERIFIED' };
  const evidence: EvidenceReference[] = [ticker, book].map(ref =>
    snapshot.quality.status === 'FAIL' && ref.status === 'AVAILABLE'
      ? { kind: ref.kind, status: 'UNKNOWN', reason: 'SNAPSHOT_QUALITY_FAILED' }
      : ref,
  );
  const status = evidence.some(ref => ref.status === 'AVAILABLE') ? 'AVAILABLE' : 'UNKNOWN';
  return {
    schemaVersion: 'bmind.evidence.v1', use: 'RESEARCH_ONLY', status, asOf: capturedAt, instrumentId,
    dataQuality: snapshot.quality.status, evidence,
  } as const;
}
