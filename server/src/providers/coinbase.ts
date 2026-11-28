import { fetchProvider, registerProvider, setRateLimit } from './http.js';
registerProvider({
  hosts: ['api.exchange.coinbase.com'],
  id: 'coinbase', name: 'Coinbase Exchange (public)', sourceClass: 'cex', markets: ['crypto'],
  license: 'Coinbase Exchange public market data — Coinbase Market Data Terms.', realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('coinbase', 300); // public limit ~10 req/s
export interface Quote { price: number; bid: number; ask: number; ts: number; venue: string }
export async function ticker(productId: string): Promise<Quote> {
  const r = await fetchProvider('coinbase', `https://api.exchange.coinbase.com/products/${encodeURIComponent(productId)}/ticker`);
  return { price: +r.price, bid: +r.bid, ask: +r.ask, ts: Date.parse(r.time), venue: 'coinbase' };
}
