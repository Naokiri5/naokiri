import { fetchProvider, registerProvider, setRateLimit } from './http.js';
registerProvider({
  id: 'coingecko', name: 'CoinGecko (public API)', sourceClass: 'aggregator', markets: ['crypto'],
  license: 'CoinGecko public API — attribution required; commercial use requires a paid plan.', realtime: 'DELAYED', requiresCredentials: false,
});
setRateLimit('coingecko', 5);
export interface CgMarket { id: string; symbol: string; name: string; price: number; marketCap: number; rank: number; volume: number; change24h: number; image: string }
export async function markets(perPage = 250): Promise<CgMarket[]> {
  const r: any[] = await fetchProvider('coingecko', `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1`, { timeoutMs: 20_000 });
  return r.map((m) => ({ id: m.id, symbol: String(m.symbol).toUpperCase(), name: m.name, price: m.current_price, marketCap: m.market_cap ?? 0, rank: m.market_cap_rank ?? 9999, volume: m.total_volume ?? 0, change24h: m.price_change_percentage_24h ?? 0, image: m.image }));
}
