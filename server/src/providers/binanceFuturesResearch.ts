import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import { validateCandles } from '../chart/analysis.js';
import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';

/** Public USD-M perpetual candles ONLY. No account endpoint, signer or execution. */
const BASE = 'https://fapi.binance.com/fapi/v1';
export const FUTURES_RESEARCH_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
export type FuturesResearchSymbol = typeof FUTURES_RESEARCH_SYMBOLS[number];

registerProvider({
  id: 'binance-usdm-research',
  name: 'Binance USD-M Perpetual (public research only)',
  sourceClass: 'cex',
  markets: ['crypto-futures'],
  license: 'Binance Futures public market data — subject to Binance Terms of Use; no redistribution.',
  realtime: 'NEAR_REALTIME',
  requiresCredentials: false,
  note: 'Candle-only research. Futures orders, funding, margin, and liquidation are NOT implemented.',
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

/** A single request snapshot cutoff across all timeframes avoids mixing forming bars. */
export async function fetchFuturesResearchSnapshot(symbol: FuturesResearchSymbol, cutoff = Date.now() - 2000) {
  if (!FUTURES_RESEARCH_SYMBOLS.includes(symbol) || !Number.isSafeInteger(cutoff) || cutoff > Date.now())
    throw new Error('UNSUPPORTED_FUTURES_RESEARCH_REQUEST');
  const timeframes = ['15m', '1h', '4h'] as const;
  const results = await Promise.all(timeframes.map(async (interval) => {
    const raw: unknown = await fetchProvider('binance-usdm-research',
      BASE + '/klines?symbol=' + symbol + '&interval=' + interval + '&limit=80', { timeoutMs: 8000 });
    return parseFuturesResearchCandles(raw, interval, cutoff);
  }));
  return { symbol, market: 'CRYPTO_PERPETUAL_FUTURES' as const, source: 'binance-usdm-public-klines' as const,
    asOf: cutoff, candles: { '15m': results[0], '1h': results[1], '4h': results[2] } };
}
