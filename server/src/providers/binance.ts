import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import type { Candle } from '../market/types.js';

/** Binance public market-data mirror (data-api.binance.vision). Read-only, no key. */
const BASE = 'https://data-api.binance.vision/api/v3';
registerProvider({
  id: 'binance', name: 'Binance Spot (public market-data mirror)', sourceClass: 'cex', markets: ['crypto'],
  license: 'Binance public market data API — subject to Binance Terms of Use; no redistribution.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('binance', 600); // well below the documented 6000 weight/min

export interface Ticker24 { symbol: string; lastPrice: number; priceChangePercent: number; quoteVolume: number; volume: number; highPrice: number; lowPrice: number; openPrice: number; count: number; closeTime: number; bidPrice: number; askPrice: number }
export interface SymbolRules { symbol: string; base: string; quote: string; status: string; tickSize: number; stepSize: number; minQty: number; minNotional: number }

export async function tickers24h(): Promise<Ticker24[]> {
  const raw: any[] = await fetchProvider('binance', `${BASE}/ticker/24hr`, { timeoutMs: 15_000 });
  return raw.map((t) => ({
    symbol: t.symbol, lastPrice: +t.lastPrice, priceChangePercent: +t.priceChangePercent, quoteVolume: +t.quoteVolume,
    volume: +t.volume, highPrice: +t.highPrice, lowPrice: +t.lowPrice, openPrice: +t.openPrice, count: +t.count, closeTime: +t.closeTime,
    bidPrice: +t.bidPrice, askPrice: +t.askPrice,
  }));
}
export async function exchangeInfo(): Promise<SymbolRules[]> {
  const raw = await fetchProvider('binance', `${BASE}/exchangeInfo?permissions=SPOT`, { timeoutMs: 20_000 });
  return raw.symbols.map((s: any) => {
    const f = (t: string) => s.filters.find((x: any) => x.filterType === t) ?? {};
    return {
      symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset, status: s.status,
      tickSize: +(f('PRICE_FILTER').tickSize ?? 0), stepSize: +(f('LOT_SIZE').stepSize ?? 0), minQty: +(f('LOT_SIZE').minQty ?? 0),
      minNotional: +(f('NOTIONAL').minNotional ?? f('MIN_NOTIONAL').minNotional ?? 0),
    };
  });
}
export async function klines(symbol: string, interval: string, limit = 300): Promise<Candle[]> {
  const raw: any[] = await fetchProvider('binance', `${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  return raw.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbv: +k[9], closeTime: k[6] }));
}
export interface Book { bids: [number, number][]; asks: [number, number][]; ts: number }
export async function depth(symbol: string, limit = 100): Promise<Book> {
  const raw = await fetchProvider('binance', `${BASE}/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  return { bids: raw.bids.map((x: string[]) => [+x[0], +x[1]]), asks: raw.asks.map((x: string[]) => [+x[0], +x[1]]), ts: Date.now() };
}
export interface AggTrade { id: number; price: number; qty: number; ts: number; buyerIsMaker: boolean }
export async function aggTrades(symbol: string, limit = 500): Promise<AggTrade[]> {
  const raw: any[] = await fetchProvider('binance', `${BASE}/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  return raw.map((a) => ({ id: a.a, price: +a.p, qty: +a.q, ts: a.T, buyerIsMaker: a.m }));
}
