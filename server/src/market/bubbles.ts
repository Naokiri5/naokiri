import { market } from './store.js';
import { isEligibleSpot } from './fabric.js';
import { assessCexAsset } from '../safety/safety.js';

/** Part 25.1/25.2 cross-market gainers/losers bubble data + breadth. Only real feeds are included. */
export function bubbleMap(opts: { limit?: number; minVolume?: number } = {}) {
  const rows = [...market.tickers.values()].filter((t) => isEligibleSpot(t.base, t.quote) && t.quoteVolume >= (opts.minVolume ?? 1_000_000));
  const ch = rows.map((r) => r.changePct).sort((a, b) => a - b);
  const median = ch.length ? ch[Math.floor(ch.length / 2)] : 0;
  const top = rows.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, opts.limit ?? 150).map((t) => {
    const cg = market.cg.get(t.base);
    const range = t.high > t.low ? (t.last - t.low) / (t.high - t.low) : 0.5;
    const tags: string[] = [];
    if (Math.abs(t.changePct) > 20 && t.quoteVolume < 20e6) tags.push('THIN_MOVE');
    if (Math.abs(t.changePct) > 10 && t.quoteVolume > 100e6) tags.push('VOLUME_BACKED');
    if (t.changePct > 0 && range < 0.3) tags.push('FADED_FROM_HIGH');
    if (t.changePct < 0 && range > 0.7) tags.push('RECOVERING');
    const safety = market.deep.has(t.instrumentId) ? assessCexAsset(t.instrumentId).status : null;
    return { id: t.instrumentId, symbol: t.base, market: 'crypto', venue: 'binance', changePct: t.changePct, quoteVolume: t.quoteVolume, price: t.last, marketCap: cg?.marketCap ?? null, rank: cg?.rank ?? null, rangePos: range, tags, safety, ts: t.receivedAt };
  });
  const fx = market.fx.map((f) => { const s = f.series; const prev = s[s.length - 2]?.rate; return { id: `forex:ecb:${f.pair}`, symbol: f.pair, market: 'forex', venue: 'ECB reference', changePct: prev ? (f.rate / prev - 1) * 100 : 0, quoteVolume: null, price: f.rate, date: f.date }; });
  return {
    crypto: top, forex: fx,
    breadth: { universe: rows.length, advancers: rows.filter((r) => r.changePct > 0).length, decliners: rows.filter((r) => r.changePct < 0).length, medianChangePct: median, up10: rows.filter((r) => r.changePct >= 10).length, down10: rows.filter((r) => r.changePct <= -10).length },
    unavailable: [{ market: 'stocks', reason: 'PENDING_CREDENTIALS: licensed equities feed not configured' }, { market: 'commodities', reason: 'PENDING_CREDENTIALS: commodities feed not configured' }],
    asOf: market.tickersFetchedAt, fxAsOf: market.fx[0]?.date ?? null,
  };
}
