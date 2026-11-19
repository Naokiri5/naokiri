import { fetchProvider, registerProvider, setRateLimit } from './http.js';
registerProvider({
  id: 'coinbase', name: 'Coinbase Exchange (public)', sourceClass: 'cex', markets: ['crypto'],
  license: 'Coinbase Exchange public market data — Coinbase Market Data Terms.', realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('coinbase', 300); // public limit ~10 req/s
export interface Quote { price: number; bid: number; ask: number; ts: number; venue: string }
export async function ticker(productId: string): Promise<Quote> {
  const r = await fetchProvider('coinbase', `https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/ticker`);
  const q = { price: +r.price, bid: +r.bid, ask: +r.ask, ts: Date.parse(r.time), venue: 'coinbase' };
  if (!validQuote(q)) throw new Error('coinbase: malformed quote (non-finite, non-positive, crossed or undated)'); // MIA-PROV-002
  return q;
}
/** A cross-venue quote is usable only with finite positive prices, bid <= ask and a finite timestamp. */
export function validQuote(q: Quote) {
  return [q.price, q.bid, q.ask].every((x) => Number.isFinite(x) && x > 0) && q.bid <= q.ask && Number.isFinite(q.ts);
}
