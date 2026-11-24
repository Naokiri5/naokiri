import { validateCandles } from '../chart/analysis.js';
import { market } from './store.js';
import { INTERVAL_MS, type Interval } from './types.js';
import type { Book } from '../providers/binance.js';

/** Part 32.2 data-quality gate. Fail-closed: missing data ⇒ FAIL. */
export interface DataQuality {
  status: 'OK' | 'WARN' | 'FAIL';
  quoteAgeMs: number | null; candleAgeMs: number | null; bookAgeMs: number | null;
  sources: string[]; independentSources: number; maxDeviationPct: number | null;
  issues: string[];
}
const envMs = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };
/**
 * maxBookAgeMs is the ANALYSIS limit; maxExecBookAgeMs is the stricter EXECUTION limit (risk gate + paper OMS refuse to
 * size or fill an entry against an older book, and exits stop walking it). maxExecQuoteAgeMs bounds any fill's anchor
 * quote. maxCrossAgeMs / clockSkewMs come from the DITAS data-truth checks. (Merged from PR #3 and PR #6.)
 */
export const QUALITY_LIMITS = {
  maxQuoteAgeMs: 60_000, maxBookAgeMs: 180_000, maxCrossAgeMs: 300_000,
  clockSkewMs: 5_000, warnDeviationPct: 0.5, failDeviationPct: 1.5,
  maxExecBookAgeMs: envMs('MIA_MAX_EXEC_BOOK_AGE_MS', 60_000), maxExecQuoteAgeMs: 120_000,
};
const positive = (x: number) => Number.isFinite(x) && x > 0;
const timestamp = (x: number) => Number.isFinite(x) && x >= 0;

/** Structural validation is shared by data truth and execution-impact estimation. */
export function validBook(book: Book | null): book is Book {
  if (!book || !timestamp(book.ts) || !Array.isArray(book.bids) || !Array.isArray(book.asks) || !book.bids.length || !book.asks.length) return false;
  const validSide = (levels: [number, number][], descending: boolean) => {
    let total = 0;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (!Array.isArray(level) || level.length < 2 || !positive(level[0]) || !positive(level[1]) || !Number.isFinite(level[0] * level[1])) return false;
      if (i && (descending ? level[0] >= levels[i - 1][0] : level[0] <= levels[i - 1][0])) return false;
      total += level[0] * level[1];
    }
    return Number.isFinite(total);
  };
  return validSide(book.bids, true) && validSide(book.asks, false) && book.bids[0][0] < book.asks[0][0];
}
/** Age of a usable book in ms, or null (missing, structurally invalid, crossed, or timestamped in the future). */
export function bookAge(book: Book | null | undefined, nowTs = Date.now()): number | null {
  if (!book || !validBook(book) || !timestamp(nowTs)) return null;
  const age = nowTs - book.ts;
  return age < 0 ? null : age; // locally stamped: a future timestamp is never usable
}
export const bookFreshForExecution = (book: Book | null | undefined, nowTs = Date.now()) => { const a = bookAge(book, nowTs); return a != null && a <= QUALITY_LIMITS.maxExecBookAgeMs; };

export function assessQuality(instrumentId: string, interval: Interval = '1h', nowTs = Date.now()): DataQuality {
  const issues: string[] = []; let status: DataQuality['status'] = 'OK';
  const bad = (m: string) => { issues.push(m); status = 'FAIL'; };
  const warn = (m: string) => { issues.push(m); if (status === 'OK') status = 'WARN'; };
  const inst = market.instruments.get(instrumentId);
  const t = market.tickers.get(instrumentId); const d = market.deep.get(instrumentId);
  const validNow = timestamp(nowTs);
  if (!validNow) bad('invalid assessment timestamp');
  if (!inst) bad('unknown instrument');
  const quoteAgeMs = t && timestamp(t.receivedAt) && validNow ? nowTs - t.receivedAt : null;
  const activeSources = new Set<string>();
  let primaryValid = !!t;
  const badQuote = (m: string) => { primaryValid = false; bad(m); };
  if (!t) badQuote('no quote');
  else {
    if (t.instrumentId !== instrumentId || (inst && (t.symbol !== inst.symbol || t.base !== inst.base || t.quote !== inst.quote))) badQuote('quote instrument mismatch');
    if (!t.source?.trim() || (inst && t.source !== inst.venue)) badQuote('quote source mismatch');
    if (![t.last, t.bid, t.ask, t.high, t.low, t.open].every(positive) || t.bid > t.ask || t.low > t.high || !Number.isFinite(t.changePct) || !Number.isFinite(t.quoteVolume) || t.quoteVolume < 0 || !Number.isFinite(t.trades) || t.trades < 0) badQuote('invalid quote prices or volume');
    if (!timestamp(t.receivedAt) || !timestamp(t.providerTs)) badQuote('invalid quote timestamps');
    else {
      if (t.receivedAt > nowTs + QUALITY_LIMITS.clockSkewMs || t.providerTs > nowTs + QUALITY_LIMITS.clockSkewMs || t.providerTs > t.receivedAt + QUALITY_LIMITS.clockSkewMs) badQuote('future quote timestamp');
      if (nowTs - t.receivedAt > QUALITY_LIMITS.maxQuoteAgeMs) badQuote(`quote stale (${Math.round((nowTs - t.receivedAt) / 1000)}s)`);
      if (nowTs - t.providerTs > QUALITY_LIMITS.maxQuoteAgeMs) badQuote('quote source event stale despite receipt time');
    }
    if (primaryValid && validNow) activeSources.add(t.source);
  }
  for (const issue of d?.integrityIssues?.[interval] ?? []) bad(`${interval} source batch: ${issue}`);
  const eng = d?.engines[interval];
  let candleAgeMs: number | null = null;
  if (!eng?.last || !eng.candles.length) bad(`no ${interval} candles`);
  else {
    const duration = INTERVAL_MS[interval];
    candleAgeMs = Number.isFinite(eng.last.t) && duration && validNow ? nowTs - (eng.last.t + duration) : null;
    for (const issue of validateCandles(eng.candles, interval, nowTs)) bad(`${interval}: ${issue}`);
    if (eng.last.t !== eng.candles[eng.candles.length - 1].t || eng.last.close !== eng.candles[eng.candles.length - 1].c || !positive(eng.last.close)) bad(`${interval}: feature/candle snapshot mismatch`);
    if (duration && eng.candles.some(c => c.closeTime != null && (c.closeTime < c.t || c.closeTime > c.t + duration))) bad(`${interval}: inconsistent candle close timestamp`);
  }
  const bookAgeMs = d?.book && timestamp(d.book.ts) && validNow ? nowTs - d.book.ts : null;
  if (!d?.book) warn('no order book');
  else if (!validBook(d.book)) bad('invalid, crossed or unordered order book');
  // Book timestamps are stamped locally on receipt (no venue clock involved), so ANY future value is invalid —
  // the skew allowance applies to provider-stamped quotes only.
  else if (d.book.ts > nowTs) bad('future order-book timestamp');
  else if (bookAgeMs != null && bookAgeMs > QUALITY_LIMITS.maxBookAgeMs) bad('order book stale');
  let maxDev: number | null = null;
  for (const [venue, quote] of Object.entries(d?.cross ?? {})) {
    if (!quote.venue || quote.venue !== venue || ![quote.price, quote.bid, quote.ask].every(positive) || quote.bid > quote.ask || !timestamp(quote.ts)) { bad(`${venue} quote invalid`); continue; }
    if (quote.ts > nowTs + QUALITY_LIMITS.clockSkewMs) { bad(`${venue} quote timestamp in future`); continue; }
    if (nowTs - quote.ts > QUALITY_LIMITS.maxCrossAgeMs) { warn(`${venue} quote stale`); continue; }
    if (validNow) activeSources.add(quote.venue);
    if (primaryValid && t && positive(t.last)) {
      const dev = Math.abs(quote.price / t.last - 1) * 100;
      maxDev = Math.max(maxDev ?? 0, dev);
    }
  }
  if (maxDev != null && maxDev > QUALITY_LIMITS.failDeviationPct) bad(`cross-venue deviation ${maxDev.toFixed(2)}%`);
  else if (maxDev != null && maxDev > QUALITY_LIMITS.warnDeviationPct) warn(`cross-venue deviation ${maxDev.toFixed(2)}%`);
  const sources = [...activeSources]; const independentSources = sources.length;
  if (independentSources < 2) warn('fewer than two valid price sources (no independent cross-venue confirmation)');
  return { status, quoteAgeMs, candleAgeMs, bookAgeMs, sources, independentSources, maxDeviationPct: maxDev, issues };
}

/** Walk the book to estimate execution price & impact for a notional (Part 2.3 / 32.6). */
export function bookImpact(book: Book | null, side: 'buy' | 'sell', notional: number) {
  if (!validBook(book) || !positive(notional) || (side !== 'buy' && side !== 'sell')) return null;
  const bid = book.bids[0][0], ask = book.asks[0][0], mid = bid / 2 + ask / 2;
  const levels = side === 'buy' ? book.asks : book.bids;
  let remaining = notional, qty = 0, cost = 0;
  for (const [p, q] of levels) {
    const take = Math.min(remaining, p * q);
    qty += take / p; cost += take; remaining -= take;
    if (remaining <= 1e-9) break;
  }
  const depthNotional = levels.reduce((s, [p, q]) => s + p * q, 0);
  const filled = remaining <= 1e-9;
  const avg = qty ? cost / qty : NaN;
  if (!positive(qty) || !positive(cost) || !positive(avg)) return null;
  return {
    mid, bid, ask, spreadBps: ((ask - bid) / mid) * 1e4, avgPrice: avg, filledFully: filled,
    impactBps: filled ? (Math.abs(avg - mid) / mid) * 1e4 : Infinity, depthNotional,
    depth1pct: levels.filter(([p]) => Math.abs(p - mid) / mid <= 0.01).reduce((s, [p, q]) => s + p * q, 0),
    bookImbalance: (() => { const w = (ls: [number, number][]) => ls.filter(([p]) => Math.abs(p - mid) / mid <= 0.01).reduce((s, [p, q]) => s + p * q, 0); const b = w(book.bids), a = w(book.asks); return b + a ? b / (b + a) : 0.5; })(),
  };
}

/**
 * Walk the book for a BASE quantity (exact, unlike the notional estimate above). Reports how much the visible depth
 * absorbed, the average and worst level touched, and slipFrac = |avg − best| / best so a caller can re-anchor the
 * fill to a fresher top-of-book quote. Returns null for an empty, crossed or malformed book.
 */
export function walkBook(book: Book | null | undefined, side: 'buy' | 'sell', qty: number) {
  // Use the same strict structural validator as the risk and impact paths.
  // Never skip malformed depth and return a plausible execution estimate.
  if (!validBook(book ?? null) || !book || !positive(qty) || (side !== 'buy' && side !== 'sell')) return null;
  const bid = book.bids[0][0], ask = book.asks[0][0];
  const mid = bid / 2 + ask / 2; const levels = side === 'buy' ? book.asks : book.bids; const best = levels[0][0];
  let remaining = qty, cost = 0, worst = best;
  for (const [p, q] of levels) {
    const take = Math.min(remaining, q);
    cost += take * p; remaining -= take; worst = p;
    if (remaining <= qty * 1e-12) break;
  }
  const filledQty = qty - Math.max(0, remaining);
  if (!positive(filledQty) || !positive(cost)) return null;
  const avgPrice = cost / filledQty;
  const slipFrac = Math.abs(avgPrice - best) / best;
  const spreadBps = ((ask - bid) / mid) * 1e4;
  const impactBps = (Math.abs(avgPrice - mid) / mid) * 1e4;
  if (!positive(avgPrice) || ![slipFrac, spreadBps, impactBps].every(Number.isFinite)) return null;
  return { bid, ask, mid, best, worst, avgPrice, filledQty, filledFully: remaining <= qty * 1e-12, slipFrac, spreadBps, impactBps };
}
