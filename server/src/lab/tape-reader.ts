import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { TextDecoder } from 'node:util';
import { z } from 'zod';

/** Research-only historical evidence. Units are 1e9 fixed point, not floats.
 * A tape is caller-supplied, not authenticated venue evidence. A book tick carries the displayed top-of-book quantity
 * for each side: buys can only consume ask depth and sells only bid depth.
 */
const fp = z.string().regex(/^(0|[1-9][0-9]{0,38})$/).transform(v => BigInt(v));
const signedFp = z.string().regex(/^(0|-?[1-9][0-9]{0,38})$/).transform(v => BigInt(v));
const ts = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const venue = z.enum(['BINANCE_SPOT', 'BINANCE_FUTURES', 'SOLANA_JUPITER']);
const symbol = z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/);
const bps = z.number().int().min(0).max(10_000);
const book = z.strictObject({
  type: z.literal('BOOK_TICK'), tsMs: ts, venue, symbol,
  bidFp: fp, askFp: fp, bidQtyFp: fp, askQtyFp: fp,
}).refine(v => v.bidFp > 0n && v.askFp >= v.bidFp);
const funding = z.strictObject({
  type: z.literal('FUNDING_TICK'), tsMs: ts, venue: z.literal('BINANCE_FUTURES'),
  symbol, fundingRateBpsFp: signedFp,
});
const launch = z.strictObject({
  type: z.literal('MEMECOIN_LAUNCH_AUDIT'), tsMs: ts, venue: z.literal('SOLANA_JUPITER'),
  symbol, mintAddress: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  poolLiquiditySolFp: fp, top10HolderBps: bps, bundledSniperBps: bps,
  mintAuthorityRevoked: z.boolean(), freezeAuthorityRevoked: z.boolean(),
  hasPermanentDelegate: z.boolean(), hasTransferHook: z.boolean(), transferFeeBps: bps,
});
export type HistoricalEvent = z.infer<typeof book> | z.infer<typeof funding> | z.infer<typeof launch>;
export type HistoricalVenue = z.infer<typeof venue>;
export interface TapeReadOptions {
  startTsMs?: number; endTsMs?: number; venues?: ReadonlySet<HistoricalVenue>;
}
export const MAX_TAPE_LINE_BYTES = 65_536;

/** Fail closed on malformed, oversized, crossed, or nonmonotonic observations.
 * Validate the entire file even outside the requested window; equal timestamps
 * retain tape order. Never stop early and silently accept a corrupt suffix.
 * Streaming buffers are bounded; no unbounded readline line or full-file array.
 */
export async function* streamCompressedMarketTape(path: string, opts: TapeReadOptions = {}): AsyncGenerator<HistoricalEvent> {
  const start = opts.startTsMs ?? 0, end = opts.endTsMs ?? Number.MAX_SAFE_INTEGER;
  if (!ts.safeParse(start).success || !ts.safeParse(end).success || start > end)
    throw new Error('INVALID_TAPE_WINDOW');
  const allowed = opts.venues ? new Set(opts.venues) : undefined;
  if (allowed && [...allowed].some(v => !venue.safeParse(v).success)) throw new Error('INVALID_TAPE_VENUE');
  const source = createReadStream(path);
  const unzip = createGunzip();
  source.on('error', error => unzip.destroy(error));
  source.pipe(unzip);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = 0, last = -1, pending = Buffer.alloc(0);
  function parse(raw: Buffer): HistoricalEvent | undefined {
    line++;
    let value: unknown;
    try {
      const decoded = decoder.decode(raw).trim();
      if (!decoded) return;
      value = JSON.parse(decoded);
    } catch { throw new Error('TAPE_PARSE_ERROR line ' + line); }
    const type = value && typeof value === 'object' && 'type' in value ? value.type : null;
    const schema = type === 'BOOK_TICK' ? book : type === 'FUNDING_TICK' ? funding : type === 'MEMECOIN_LAUNCH_AUDIT' ? launch : null;
    const result = schema?.safeParse(value);
    if (!result?.success) throw new Error('TAPE_INVALID_EVENT line ' + line);
    const event = result.data;
    if (event.tsMs < last) throw new Error('TAPE_NON_MONOTONIC line ' + line);
    last = event.tsMs;
    return event.tsMs >= start && event.tsMs <= end && (!allowed || allowed.has(event.venue)) ? event : undefined;
  }
  try {
    for await (const raw of unzip) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const stop = newline === -1 ? chunk.length : newline;
        const part = chunk.subarray(offset, stop);
        if (pending.length + part.length > MAX_TAPE_LINE_BYTES) throw new Error('TAPE_LINE_TOO_LONG line ' + (line + 1));
        pending = Buffer.concat([pending, part]);
        if (newline === -1) break;
        const event = parse(pending);
        pending = Buffer.alloc(0);
        if (event) yield event;
        offset = newline + 1;
      }
    }
    if (pending.length) {
      const event = parse(pending);
      if (event) yield event;
    }
  } finally {
    source.destroy();
    unzip.destroy();
  }
}
