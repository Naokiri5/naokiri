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
export const QUALITY_LIMITS = { maxQuoteAgeMs: 60_000, maxBookAgeMs: 180_000, warnDeviationPct: 0.5, failDeviationPct: 1.5 };

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
  if (ref && d) {
    for (const [v, q] of Object.entries(d.cross)) {
      if (nowTs - q.ts > 300_000) { warn(`${v} quote stale`); continue; }
      const dev = (Math.abs(q.price - ref) / ref) * 100; maxDev = Math.max(maxDev ?? 0, dev);
    }
    if (maxDev != null && maxDev > QUALITY_LIMITS.failDeviationPct) bad(`cross-venue deviation ${maxDev.toFixed(2)}%`);
    else if (maxDev != null && maxDev > QUALITY_LIMITS.warnDeviationPct) warn(`cross-venue deviation ${maxDev.toFixed(2)}%`);
  }
  const independentSources = 1 + Object.values(d?.cross ?? {}).filter((q) => nowTs - q.ts < 300_000).length;
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
