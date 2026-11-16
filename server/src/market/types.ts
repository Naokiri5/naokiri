export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number; qv?: number; n?: number; tbv?: number; closeTime?: number }
export type Market = 'crypto' | 'crypto-dex' | 'forex' | 'stocks' | 'commodities';
export interface Instrument {
  id: string; // canonical: crypto:binance:BTCUSDT
  symbol: string; base: string; quote: string; market: Market; venue: string;
  tickSize: number; stepSize: number; minQty: number; minNotional: number;
}
export type Interval = '15m' | '1h' | '4h';
export const INTERVAL_MS: Record<Interval, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
