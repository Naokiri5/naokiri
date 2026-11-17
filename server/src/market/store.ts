import { FeatureEngine } from '../features/indicators.js';
import type { Candle, Instrument, Interval } from './types.js';
import type { Book } from '../providers/binance.js';
import type { Quote } from '../providers/coinbase.js';
import type { CgMarket } from '../providers/coingecko.js';
import type { DexPair } from '../providers/dexscreener.js';
import type { FxSeries } from '../providers/frankfurter.js';

export interface TickerState {
  instrumentId: string; symbol: string; base: string; quote: string; last: number; bid: number; ask: number;
  changePct: number; quoteVolume: number; high: number; low: number; open: number; trades: number;
  providerTs: number; receivedAt: number; source: string;
}
export interface DeepState {
  instrument: Instrument;
  engines: Record<Interval, FeatureEngine>;
  forming: Partial<Record<Interval, Candle>>;
  candleFetchedAt: Partial<Record<Interval, number>>;
  /** Raw source-batch failures persist until a validated refresh for the same interval. */
  integrityIssues?: Partial<Record<Interval, string[]>>;
  book: Book | null;
  cross: Record<string, Quote>;
}

class MarketStore {
  instruments = new Map<string, Instrument>();
  tickers = new Map<string, TickerState>(); // by instrumentId
  deep = new Map<string, DeepState>();
  universe: string[] = []; // instrumentIds in T2
  cg = new Map<string, CgMarket>(); // by symbol
  cgFetchedAt = 0;
  dex: DexPair[] = []; dexFetchedAt = 0;
  fx: FxSeries[] = []; fxFetchedAt = 0;
  tickersFetchedAt = 0;
  lastScanAt = 0;

  deepState(inst: Instrument): DeepState {
    let d = this.deep.get(inst.id);
    if (!d) {
      d = { instrument: inst, engines: { '15m': new FeatureEngine(), '1h': new FeatureEngine(), '4h': new FeatureEngine() }, forming: {}, candleFetchedAt: {}, book: null, cross: {} };
      this.deep.set(inst.id, d);
    }
    return d;
  }
  bySymbol(symbol: string) {
    const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const i of this.instruments.values()) if (i.symbol === s || i.symbol === `${s}USDT` || i.base === s && i.quote === 'USDT') return i;
    return undefined;
  }
  /** Best live price for an instrument: forming candle close if fresher, otherwise ticker. */
  price(id: string): { price: number; bid: number; ask: number; ts: number } | null {
    const t = this.tickers.get(id); const d = this.deep.get(id);
    const book = d?.book;
    if (book && book.bids.length && book.asks.length && (!t || book.ts > t.receivedAt)) {
      const bid = book.bids[0][0], ask = book.asks[0][0];
      return { price: (bid + ask) / 2, bid, ask, ts: book.ts };
    }
    if (!t) return null;
    return { price: t.last, bid: t.bid, ask: t.ask, ts: t.receivedAt };
  }
  reset() { this.instruments.clear(); this.tickers.clear(); this.deep.clear(); this.universe = []; this.cg.clear(); this.dex = []; this.fx = []; }
}
export const market = new MarketStore();
