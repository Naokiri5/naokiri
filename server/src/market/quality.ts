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
 * maxBookAgeMs is the ANALYSIS limit (a book this old only degrades quality to WARN). maxExecBookAgeMs is the stricter
 * EXECUTION limit: the risk gate and the paper OMS refuse to size or fill an entry against a book older than this, and
 * exits stop walking it. maxExecQuoteAgeMs bounds the quote any fill may be anchored to.
 */
export const QUALITY_LIMITS = {
  maxQuoteAgeMs: 60_000, maxBookAgeMs: 180_000, warnDeviationPct: 0.5, failDeviationPct: 1.5,
  maxExecBookAgeMs: envMs('MIA_MAX_EXEC_BOOK_AGE_MS', 60_000), maxExecQuoteAgeMs: 120_000,
};
/** Age of a book in ms, or null when there is no usable book. A timestamp in the future is treated as unusable. */
export function bookAge(book: Book | null | undefined, nowTs = Date.now()): number | null {
  if (!book || !Number.isFinite(book.ts) || !book.bids.length || !book.asks.length) return null;
  const age = nowTs - book.ts;
  return age < -5_000 ? null : Math.max(0, age);
}
export const bookFreshForExecution = (book: Book | null | undefined, nowTs = Date.now()) => { const a = bookAge(book, nowTs); return a != null && a <= QUALITY_LIMITS.maxExecBookAgeMs; };

export function assessQuality(instrumentId: string, interval: Interval = '1h', nowTs = Date.now()): DataQuality {
  const issues: string[] = []; let status: DataQuality['status'] = 'OK';
  const bad = (m: string) => { issues.push(m); status = 'FAIL'; };
  const warn = (m: string) => { issues.push(m); if (status === 'OK') status = 'WARN'; };
  const t = market.tickers.get(instrumentId); const d = market.deep.get(instrumentId);
  const quoteAgeMs = t ? nowTs - t.receivedAt : null;
  if (quoteAgeMs == null) bad('no quote'); else if (quoteAgeMs < 0 || quoteAgeMs > QUALITY_LIMITS.maxQuoteAgeMs) bad(`quote stale (${Math.round(quoteAgeMs / 1000)}s)`);
  const eng = d?.engines[interval];
  let candleAgeMs: number | null = null;
  if (!eng?.last) bad(`no ${interval} candles`);
  else { candleAgeMs = nowTs - (eng.last.t + INTERVAL_MS[interval]); if (candleAgeMs > 2 * INTERVAL_MS[interval]) bad(`${interval} candles stale`); }
  const bookAgeMs = d?.book ? nowTs - d.book.ts : null;
  if (bookAgeMs == null) warn('no order book'); else if (bookAgeMs < 0 || bookAgeMs > QUALITY_LIMITS.maxBookAgeMs) bad('order book stale or timestamp is in the future');
  const sources = ['binance', ...Object.keys(d?.cross ?? {})];
  let maxDev: number | null = null;
  const ref = t?.last;
  if (t && !(Number.isFinite(t.last) && t.last > 0)) bad('invalid last price');
  if (ref && d) {
    for (const [v, q] of Object.entries(d.cross)) {
      if (!Number.isFinite(q.price) || !(q.price > 0) || !Number.isFinite(q.ts)) { warn(`${v} quote invalid`); continue; }
      if (nowTs - q.ts > 300_000) { warn(`${v} quote stale`); continue; }
      const dev = (Math.abs(q.price - ref) / ref) * 100; maxDev = Math.max(maxDev ?? 0, dev);
    }
    if (maxDev != null && maxDev > QUALITY_LIMITS.failDeviationPct) bad(`cross-venue deviation ${maxDev.toFixed(2)}%`);
    else if (maxDev != null && maxDev > QUALITY_LIMITS.warnDeviationPct) warn(`cross-venue deviation ${maxDev.toFixed(2)}%`);
  }
  const independentSources = 1 + Object.values(d?.cross ?? {}).filter((q) => Number.isFinite(q.price) && q.price > 0 && nowTs - q.ts < 300_000).length;
  if (independentSources < 2) warn('single price source (no cross-venue confirmation)');
  return { status, quoteAgeMs, candleAgeMs, bookAgeMs, sources, independentSources, maxDeviationPct: maxDev, issues };
}

/** Walk the book to estimate execution price & impact for a notional (Part 2.3 / 32.6). */
export function bookImpact(book: Book | null, side: 'buy' | 'sell', notional: number) {
  if (!book || !book.bids.length || !book.asks.length) return null;
  const bid = book.bids[0][0], ask = book.asks[0][0], mid = (bid + ask) / 2;
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
  if (!book || !book.bids.length || !book.asks.length || !(qty > 0)) return null;
  const bid = book.bids[0][0], ask = book.asks[0][0];
  if (!(bid > 0) || !(ask > 0) || bid > ask) return null;
  const mid = (bid + ask) / 2; const levels = side === 'buy' ? book.asks : book.bids; const best = levels[0][0];
  let remaining = qty, cost = 0, worst = best;
  for (const [p, q] of levels) {
    if (!(p > 0) || !(q > 0)) continue;
    const take = Math.min(remaining, q);
    cost += take * p; remaining -= take; worst = p;
    if (remaining <= qty * 1e-12) break;
  }
  const filledQty = qty - Math.max(0, remaining);
  if (!(filledQty > 0)) return null;
  const avgPrice = cost / filledQty;
  return { bid, ask, mid, best, worst, avgPrice, filledQty, filledFully: remaining <= qty * 1e-12, slipFrac: Math.abs(avgPrice - best) / best,
    spreadBps: ((ask - bid) / mid) * 1e4, impactBps: (Math.abs(avgPrice - mid) / mid) * 1e4 };
}
