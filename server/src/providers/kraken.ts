import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import type { Quote } from './coinbase.js';
registerProvider({
  hosts: ['api.kraken.com'],
  id: 'kraken', name: 'Kraken (public)', sourceClass: 'cex', markets: ['crypto'],
  license: 'Kraken public REST market data — Kraken Terms of Service.', realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('kraken', 50);
let altToKey: Map<string, string> | null = null;
async function pairMap() {
  if (altToKey) return altToKey;
  const r = await fetchProvider('kraken', 'https://api.kraken.com/0/public/AssetPairs', { timeoutMs: 15_000 });
  altToKey = new Map(Object.entries<any>(r.result).map(([k, v]) => [v.altname as string, k]));
  return altToKey;
}
/** Kraken uses XBT for BTC. altnames like XBTUSD, ETHUSD. */
export const krakenAlt = (base: string) => `${base === 'BTC' ? 'XBT' : base}USD`;
export async function tickers(altnames: string[]): Promise<Record<string, Quote>> {
  const map = await pairMap();
  const valid = altnames.filter((a) => map.has(a));
  if (!valid.length) return {};
  const r = await fetchProvider('kraken', `https://api.kraken.com/0/public/Ticker?pair=${valid.join(',')}`);
  if (r.error?.length) throw new Error(`kraken: ${r.error.join(';')}`);
  const out: Record<string, Quote> = {};
  for (const alt of valid) {
    const t = r.result[map.get(alt)!];
    if (t) out[alt] = { price: +t.c[0], bid: +t.b[0], ask: +t.a[0], ts: Date.now(), venue: 'kraken' };
  }
  return out;
}
