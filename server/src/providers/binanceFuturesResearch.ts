import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import { validateCandles } from '../chart/analysis.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';

/** Public USD-M perpetual market observations. */
const BASE = 'https://fapi.binance.com/fapi/v1';
export const FUTURES_RESEARCH_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
export type FuturesResearchSymbol = typeof FUTURES_RESEARCH_SYMBOLS[number];
type Frame = '15m' | '1h' | '4h';
export const FUTURES_CONTEXT_MAX_AGE_MS = 5 * 60_000;
export interface FuturesMarketContext {
  funding: { rate: number; markPrice: number; at: number; localAt: number } | null;
  openInterest: { quantity: number; at: number; localAt: number } | null;
}
export interface FuturesResearchSnapshot {
  symbol: FuturesResearchSymbol;
  market: 'CRYPTO_PERPETUAL_FUTURES';
  source: 'binance-usdm-public-klines';
  asOf: number;
  candles: Record<Frame, Candle[]>;
  context?: FuturesMarketContext;
}

registerProvider({
  id: 'binance-usdm-research',
  name: 'Binance USD-M Perpetual (public research only)',
  sourceClass: 'cex',
  markets: ['crypto-futures'],
  license: 'Binance Futures public market data — subject to Binance Terms of Use; no redistribution.',
  realtime: 'NEAR_REALTIME',
  requiresCredentials: false,
  note: 'Public candles, mark price, funding and open interest for research.',
});
setRateLimit('binance-usdm-research', 30);

/** Reject malformed, future, out-of-order and stale data; never repair a provider history silently. */
export function parseFuturesResearchCandles(raw: unknown, interval: Interval, cutoff: number): Candle[] {
  if (!Array.isArray(raw) || raw.length > 90 || !Number.isSafeInteger(cutoff)) throw new Error('INVALID_FUTURES_PAYLOAD');
  const parsed: Candle[] = raw.map((item: unknown) => {
    if (!Array.isArray(item) || item.length < 7) throw new Error('INVALID_FUTURES_ROW');
    const row: Candle = { t: Number(item[0]), o: Number(item[1]), h: Number(item[2]),
      l: Number(item[3]), c: Number(item[4]), v: Number(item[5]), closeTime: Number(item[6]) };
    if (![row.t, row.o, row.h, row.l, row.c, row.v, row.closeTime].every(Number.isFinite)
        || !Number.isSafeInteger(row.t) || !Number.isSafeInteger(row.closeTime)
        || row.closeTime! !== row.t + INTERVAL_MS[interval] - 1) throw new Error('INVALID_FUTURES_ROW');
    return row;
  });
  if (parsed.some((c, i) => i > 0 && c.t - parsed[i - 1].t !== INTERVAL_MS[interval])) throw new Error('FUTURES_GAP_OR_REPLAY');
  const closed = parsed.filter((c) => c.t + INTERVAL_MS[interval] <= cutoff);
  const issues = validateCandles(closed, interval, cutoff);
  if (issues.length || closed.length < 22) throw new Error('UNUSABLE_FUTURES_CANDLES: ' + (issues.join('|') || 'LESS_THAN_22'));
  return closed;
}

function observation(raw: unknown, symbol: FuturesResearchSymbol, receivedAt: number, exchangeTime: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const at = row.time;
  if (row.symbol !== symbol || typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0) return null;
  const age = exchangeTime - at;
  if (age < 0 || age > FUTURES_CONTEXT_MAX_AGE_MS) return null;
  return { row, at, localAt: receivedAt - age };
}

const decimal = (value: unknown) =>
  typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) ? Number(value) : NaN;

export function parseFuturesMarketContext(symbol: FuturesResearchSymbol, premium: unknown, interest: unknown, receivedAt: number, serverTime?: unknown): FuturesMarketContext {
  const exchangeTime = typeof serverTime === 'number' && Number.isSafeInteger(serverTime) && Math.abs(serverTime - receivedAt) <= 30_000
    ? serverTime : receivedAt;
  const mark = observation(premium, symbol, receivedAt, exchangeTime);
  const oi = observation(interest, symbol, receivedAt, exchangeTime);
  const markPrice = decimal(mark?.row.markPrice), rate = decimal(mark?.row.lastFundingRate);
  const quantity = decimal(oi?.row.openInterest);
  return {
    funding: mark && Number.isFinite(markPrice) && markPrice > 0 && Number.isFinite(rate)
      ? { rate, markPrice, at: mark.at, localAt: mark.localAt } : null,
    openInterest: oi && Number.isFinite(quantity) && quantity >= 0 ? { quantity, at: oi.at, localAt: oi.localAt } : null,
  };
}

async function fetchMarketContext(symbol: FuturesResearchSymbol): Promise<FuturesMarketContext> {
  const [premium, interest] = await Promise.allSettled(['premiumIndex', 'openInterest'].map((path) =>
    fetchProvider('binance-usdm-research', `${BASE}/${path}?symbol=${symbol}`, { timeoutMs: 8000 })));
  const clock = await fetchProvider('binance-usdm-research', `${BASE}/time`, { timeoutMs: 2500 }).catch(() => null);
  return parseFuturesMarketContext(symbol, premium.status === 'fulfilled' ? premium.value : null,
    interest.status === 'fulfilled' ? interest.value : null, Date.now(), clock?.serverTime);
}

/** A single candle cutoff avoids mixing forming bars. Current context carries its own source timestamps. */
export async function fetchFuturesResearchSnapshot(symbol: FuturesResearchSymbol, cutoff = Date.now() - 2000): Promise<FuturesResearchSnapshot> {
  if (!FUTURES_RESEARCH_SYMBOLS.includes(symbol) || !Number.isSafeInteger(cutoff) || cutoff > Date.now())
    throw new Error('UNSUPPORTED_FUTURES_RESEARCH_REQUEST');
  const timeframes = ['15m', '1h', '4h'] as const;
  const bars = Promise.all(timeframes.map(async (interval) => {
    const raw: unknown = await fetchProvider('binance-usdm-research',
      BASE + '/klines?symbol=' + symbol + '&interval=' + interval + '&limit=80', { timeoutMs: 8000 });
    return parseFuturesResearchCandles(raw, interval, cutoff);
  }));
  // A historical candle request can never attach today's funding or open interest.
  const [results, context] = await Promise.all([bars,
    Date.now() - cutoff <= 30_000 ? fetchMarketContext(symbol) : undefined,
  ]);
  return { symbol, market: 'CRYPTO_PERPETUAL_FUTURES', source: 'binance-usdm-public-klines',
    asOf: cutoff, candles: { '15m': results[0], '1h': results[1], '4h': results[2] }, context };
}
