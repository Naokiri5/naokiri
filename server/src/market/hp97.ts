import { market } from './store.js';
import { assessQuality, bookAge, validBook, QUALITY_LIMITS } from './quality.js';
import { INTERVAL_MS } from './types.js';
import { Feature97ProjectionBuilder } from './feature97.js';

/**
 * Map existing verified canonical data into the HP97 vocabulary. This is an
 * analytical read model, not a second indicator engine, feed, risk gate or OMS.
 * Unsupported slots (perps, on-chain, whale, macro and forecast edge) stay absent.
 */
export function hp97MarketSnapshot(instrumentId: string, nowMs = Date.now()) {
  const instrument = market.instruments.get(instrumentId);
  if (!instrument) return null;
  const builder = new Feature97ProjectionBuilder(instrumentId);
  const ticker = market.tickers.get(instrumentId);
  const d = market.deep.get(instrumentId);
  const set = (name: string, value: number | undefined, timestamp: number, source: string) => {
    if (value !== undefined && Number.isFinite(value) && Number.isSafeInteger(timestamp) &&
        timestamp > 0 && timestamp <= nowMs && source.trim()) builder.set(name, value, timestamp, source, nowMs);
  };

  // Snapshot-independent quote evidence; the market store already selects the best current price.
  if (ticker && nowMs - ticker.receivedAt >= 0 && nowMs - ticker.receivedAt <= QUALITY_LIMITS.maxExecQuoteAgeMs)
    set('LAST_TRADE_PRICE', ticker.last, ticker.receivedAt, 'market.tickers:' + ticker.source);

  const book = d?.book;
  const age = bookAge(book, nowMs);
  if (book && validBook(book) && age !== null && age <= QUALITY_LIMITS.maxExecBookAgeMs) {
    const [bid, bidQty] = book.bids[0];
    const [ask, askQty] = book.asks[0];
    const mid = (bid + ask) / 2;
    if (mid > 0 && ask > bid && bidQty > 0 && askQty > 0) {
      const source = 'market.deep.book:' + instrument.venue;
      set('MID_PRICE', mid, book.ts, source);
      set('BEST_BID', bid, book.ts, source);
      set('BEST_ASK', ask, book.ts, source);
      set('SPREAD_ABS', ask - bid, book.ts, source);
      set('SPREAD_BPS', (ask - bid) / mid * 10_000, book.ts, source);
      const micro = (bid * askQty + ask * bidQty) / (bidQty + askQty);
      set('MICROPRICE', micro, book.ts, source);
      set('MICROPRICE_EDGE_BPS', (micro / mid - 1) * 10_000, book.ts, source);
      for (const [levels, slot] of [[1, 'OBI_L1'], [5, 'OBI_L5'], [10, 'OBI_L10']] as const) {
        const b = book.bids.slice(0, levels).reduce((sum, x) => sum + x[1], 0);
        const a = book.asks.slice(0, levels).reduce((sum, x) => sum + x[1], 0);
        if (b + a > 0) set(slot, (b - a) / (b + a), book.ts, source);
      }
      const bidsWithin = book.bids.filter(([p]) => p >= mid * 0.99)
        .reduce((sum, [p,q]) => sum + p * q, 0);
      const asksWithin = book.asks.filter(([p]) => p <= mid * 1.01)
        .reduce((sum, [p,q]) => sum + p * q, 0);
      // Conservative two-sided executable depth. This is a current book measurement, not a fill guarantee.
      set('BOOK_DEPTH_USD_1PCT', Math.min(bidsWithin, asksWithin), book.ts, source);
    }
  }

  // Only closed 1h-candle outputs from MIA's existing incremental FeatureEngine are used.
  const f = d?.engines['1h'].last;
  if (f && f.n >= 20) {
    const timestamp = f.t + INTERVAL_MS['1h'] - 1;
    const source = 'features.indicators:closed-1h';
    set('EMA_FAST_9', f.ema9, timestamp, source);
    set('REALIZED_VOL_20', f.realizedVol20, timestamp, source);
    set('ATR_14', f.atr14, timestamp, source);
    set('ATR_PCT_14', f.atrPct * 100, timestamp, source);
    set('BOLLINGER_ZSCORE_20', f.zscore20, timestamp, source);
    set('BOLLINGER_BANDWIDTH_20', f.bbWidth, timestamp, source);
    set('RSI_14', f.rsi14, timestamp, source);
    set('MACD_HIST_NORM', f.close > 0 ? f.macdHist / f.close : NaN, timestamp, source);
    set('ADX_14', f.adx14, timestamp, source);
    set('PLUS_DI_14', f.plusDI, timestamp, source);
    set('MINUS_DI_14', f.minusDI, timestamp, source);
    set('CCI_20', f.cci20, timestamp, source);
    // Existing Donchian levels; no extra indicator engine or look-ahead candle.
    if (f.donchHigh20 > f.donchLow20) {
      set('DONCHIAN_POS_20', (f.close - f.donchLow20) / (f.donchHigh20 - f.donchLow20), timestamp, source);
    }
  }

  // Closed 1h indicators remain valid for their own bar horizon; the fresh book and quote
  // were checked independently above against their much shorter execution freshness windows.
  const projection = builder.capture(nowMs, INTERVAL_MS['1h']);
  const quality = assessQuality(instrumentId, '1h', nowMs);
  const eligible = projection.coverage.eligibleForSpotResearch && quality.status !== 'FAIL' && instrument.market === 'crypto';
  return {
    ...projection, symbol: instrument.symbol, market: instrument.market,
    quality: { status: quality.status, issues: quality.issues },
    coverage: { ...projection.coverage, eligibleForSpotResearch: eligible },
    usage: 'research-observability-only; cannot authorize or block orders',
  };
}
