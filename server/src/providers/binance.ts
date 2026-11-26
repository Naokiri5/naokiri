import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';

/** Binance public market-data mirror (data-api.binance.vision). Read-only, no key. */
const BASE = 'https://data-api.binance.vision/api/v3';
registerProvider({
  id: 'binance', name: 'Binance Spot (public market-data mirror)', sourceClass: 'cex', markets: ['crypto'],
  license: 'Binance public market data API — subject to Binance Terms of Use; no redistribution.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('binance', 600); // well below the documented 6000 weight/min

export interface Ticker24 { symbol: string; lastPrice: number; priceChangePercent: number; quoteVolume: number; volume: number; highPrice: number; lowPrice: number; openPrice: number; count: number; closeTime: number; bidPrice: number; askPrice: number }
export interface SymbolRules { symbol: string; base: string; quote: string; status: string; tickSize: number; stepSize: number; minQty: number; minNotional: number; maxQty?: number }
/** Filter value as a number: undefined when absent, NaN when present but malformed (which fails closed downstream). */
const filterNum = (v: unknown): number | undefined => v === undefined || v === null ? undefined : typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
/**
 * Entry quantity rules for a paper MARKET order: LOT_SIZE combined with MARKET_LOT_SIZE (the stricter of each limit).
 * A missing LOT_SIZE step yields NaN so the risk gate refuses the instrument instead of skipping lot rounding.
 * NOTIONAL.maxNotional is not modeled; paper fills are capped by the risk gate's own notional limit.
 */
export function quantityRules(filters: Array<Record<string, unknown>>) {
  const f = (t: string) => filters.find((x) => x.filterType === t) ?? {};
  const lot = f('LOT_SIZE'), mkt = f('MARKET_LOT_SIZE');
  const lotStep = filterNum(lot.stepSize) ?? Number.NaN, mktStep = filterNum(mkt.stepSize);
  const stepSize = mktStep !== undefined && mktStep !== 0 ? Math.max(lotStep, mktStep) : lotStep;
  const minQty = Math.max(filterNum(lot.minQty) ?? 0, filterNum(mkt.minQty) ?? 0);
  // 0 means "no maximum" on Binance; any other non-positive or malformed value fails closed.
  const maxes = [filterNum(lot.maxQty), filterNum(mkt.maxQty)].filter((v): v is number => v !== undefined && v !== 0);
  const maxQty = maxes.length ? Math.min(...maxes) : undefined;
  return { stepSize, minQty, ...(maxQty === undefined ? {} : { maxQty }) };
}

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
      tickSize: +(f('PRICE_FILTER').tickSize ?? 0), ...quantityRules(s.filters),
      minNotional: +(f('NOTIONAL').minNotional ?? f('MIN_NOTIONAL').minNotional ?? 0),
    };
  });
}
export async function klines(symbol: string, interval: string, limit = 300): Promise<Candle[]> {
  const raw: any[] = await fetchProvider('binance', `${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  return raw.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbv: +k[9], closeTime: k[6] }));
}
/** ts is stamped when the request STARTS (age is never understated by latency); lastUpdateId orders snapshots. */
export interface Book { bids: [number, number][]; asks: [number, number][]; ts: number; lastUpdateId?: number }
export async function depth(symbol: string, limit = 100): Promise<Book> {
  const ts = Date.now();
  const raw = await fetchProvider('binance', `${BASE}/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  const side = (xs: string[][]) => xs.map((x) => [+x[0], +x[1]] as [number, number]).filter(([p, q]) => Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0);
  return { bids: side(raw.bids ?? []), asks: side(raw.asks ?? []), ts, lastUpdateId: Number.isFinite(+raw.lastUpdateId) ? +raw.lastUpdateId : undefined };
}
export interface AggTrade { id: number; price: number; qty: number; ts: number; buyerIsMaker: boolean }
export async function aggTrades(symbol: string, limit = 500): Promise<AggTrade[]> {
  const raw: any[] = await fetchProvider('binance', `${BASE}/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
  return raw.map((a) => ({ id: a.a, price: +a.p, qty: +a.q, ts: a.T, buyerIsMaker: a.m }));
}

/** Exact historical bar from the same public provider; never substitute a latest quote. */
export async function closedKlineAt(symbol: string, interval: Interval, targetAt: number): Promise<Candle | null> {
  const width = INTERVAL_MS[interval];
  if (!/^[A-Z0-9]{2,30}$/.test(symbol) || !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(targetAt) || targetAt < width || targetAt % width !== 0 ||
      targetAt > Date.now() - 2_000) return null;
  const start = targetAt - width;
  const raw: unknown = await fetchProvider('binance',
    `${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${start}&endTime=${targetAt-1}&limit=1`,
    { timeoutMs: 5_000 });
  if (!Array.isArray(raw) || raw.length !== 1 || !Array.isArray(raw[0])) return null;
  const k = raw[0];
  if (k[0] !== start || k[6] !== targetAt - 1 ||
      ![1,2,3,4,5].every(i => typeof k[i] === 'string' && k[i].trim() !== '')) return null;
  const [o,h,l,c,v] = [1,2,3,4,5].map(i => Number(k[i]));
  if (![o,h,l,c,v].every(Number.isFinite) || Math.min(o,h,l,c) <= 0 || v < 0 ||
      h < Math.max(o,c,l) || l > Math.min(o,c,h)) return null;
  return { t:start, closeTime:targetAt-1, o,h,l,c,v };
}
