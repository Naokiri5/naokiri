import { validateCandles } from '../chart/analysis.js';
import { bookAge, bookImpact, QUALITY_LIMITS, walkBook } from './quality.js';
import { market, type DeepState } from './store.js';
import { INTERVAL_MS, type Candle } from './types.js';
import type { AggressiveFlow, BookActivity, CexActivityReport, DepthProbe, VolumeWindow } from './cexActivityTypes.js';

const BASELINE_WINDOWS = 10;
const MIN_BASELINE_WINDOWS = 4;
const IMPACT_PROBES = [1_000, 10_000, 50_000] as const;
const WINDOWS = [
  { window: '1h', interval: '15m', candles: 4 },
  { window: '24h', interval: '1h', candles: 24 },
] as const;

const finite = (value: number) => Number.isFinite(value) ? value : null;

function unavailableVolume(window: VolumeWindow['window'], reason: NonNullable<VolumeWindow['reason']>): VolumeWindow {
  return {
    window, status: 'UNAVAILABLE', reason, closedAt: null, receivedAt: null, baseVolume: null, baselineWindows: 0,
    medianBaseVolume: null, relativeToMedian: null, changeVsPreviousPct: null, aggressiveFlow: null, candles: 0,
  };
}

/** Binance reports base volume and its taker-buy subset for each closed interval. */
function aggressiveFlow(current: readonly Candle[], baseVolume: number): AggressiveFlow | null {
  let buyBase = 0;
  let tradeCount = 0;
  for (const c of current) {
    if (c.tbv === undefined || !Number.isFinite(c.tbv) || c.tbv < 0 || c.tbv > c.v) return null;
    buyBase += c.tbv;
    tradeCount += c.n != null && Number.isSafeInteger(c.n) && c.n >= 0 ? c.n : NaN;
  }
  const sellBase = baseVolume - buyBase;
  const deltaBase = buyBase - sellBase;
  return {
    buyBase, sellBase, deltaBase,
    imbalance: baseVolume > 0 ? deltaBase / baseVolume : null,
    tradeCount: Number.isSafeInteger(tradeCount) ? tradeCount : null,
  };
}

function readVolumeWindow(spec: typeof WINDOWS[number], deep: DeepState | undefined, asOf: number): VolumeWindow {
  const { window, interval, candles: blockSize } = spec;
  const history = deep?.engines[interval].candles;
  if (!history || history.length < blockSize) return unavailableVolume(window, 'CANDLES_MISSING');
  if (deep?.integrityIssues?.[interval]?.length) return unavailableVolume(window, 'CANDLE_BATCH_REJECTED');

  const totalWindows = Math.min(1 + BASELINE_WINDOWS, Math.floor(history.length / blockSize));
  const sample = history.slice(-totalWindows * blockSize);
  const duration = INTERVAL_MS[interval];
  const closedAt = sample[sample.length - 1].t + duration;
  const expectedClose = Math.floor(asOf / duration) * duration;
  if (closedAt < expectedClose) return unavailableVolume(window, 'CANDLES_STALE');
  const receivedAt = deep?.candleFetchedAt[interval] ?? null;
  if (closedAt !== expectedClose || validateCandles(sample, interval, asOf).length ||
      (receivedAt !== null && (!Number.isFinite(receivedAt) || receivedAt < closedAt || receivedAt > asOf)) ||
      sample.some(c => c.closeTime != null && (c.closeTime < c.t || c.closeTime > c.t + duration))) {
    return unavailableVolume(window, 'CANDLES_INVALID');
  }

  const volumes: number[] = [];
  for (let i = 0; i < sample.length; i += blockSize) {
    volumes.push(sample.slice(i, i + blockSize).reduce((sum, c) => sum + c.v, 0));
  }
  const baseVolume = volumes.pop()!;
  if (!Number.isFinite(baseVolume)) return unavailableVolume(window, 'CANDLES_INVALID');

  const previous = volumes.at(-1);
  const sorted = volumes.filter(Number.isFinite).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianBaseVolume = sorted.length < MIN_BASELINE_WINDOWS ? null
    : sorted.length % 2 === 1 ? sorted[mid] : sorted[mid - 1] / 2 + sorted[mid] / 2;
  const relativeToMedian = medianBaseVolume && medianBaseVolume > 0 ? finite(baseVolume / medianBaseVolume) : null;
  const changeVsPreviousPct = previous && Number.isFinite(previous) && previous > 0 ? finite((baseVolume / previous - 1) * 100) : null;
  return {
    window, status: 'AVAILABLE', reason: relativeToMedian === null ? 'BASELINE_UNAVAILABLE' : null,
    closedAt, receivedAt, baseVolume, baselineWindows: sorted.length, medianBaseVolume, relativeToMedian, changeVsPreviousPct,
    aggressiveFlow: aggressiveFlow(sample.slice(-blockSize), baseVolume), candles: blockSize,
  };
}

function readBook(deep: DeepState | undefined, asOf: number, requestedBaseQty: number | null): BookActivity {
  const emptyExit: BookActivity['exit'] = { bandBps: 100, requestedBaseQty, conservativeBaseCapacity: null, fitsVisibleCapacity: null, avgPrice: null, impactBps: null };
  const book = deep?.book;
  const unavailable = (reason: NonNullable<BookActivity['reason']>, age: number | null = null): BookActivity => ({
    status: 'UNAVAILABLE', reason, quoteAgeMs: age, capturedAt: age === null ? null : book?.ts ?? null,
    bidLevelCount: null, askLevelCount: null, spreadBps: null, bidDepth1pctQuote: null,
    askDepth1pctQuote: null, bidShare1pct: null, impactCurve: [], exit: emptyExit,
  });
  if (!book) return unavailable('BOOK_MISSING');
  const age = bookAge(book, asOf);
  if (age === null) return unavailable('BOOK_INVALID');
  if (age > QUALITY_LIMITS.maxExecBookAgeMs) return unavailable('BOOK_STALE', age);

  const probes = (['buy', 'sell'] as const).flatMap(side => IMPACT_PROBES.map(requestedQuote => ({
    side, requestedQuote, impact: bookImpact(book, side, requestedQuote),
  })));
  const buy = probes[0].impact, sell = probes[IMPACT_PROBES.length].impact;
  if (!buy || !sell) return unavailable('BOOK_INVALID');
  const impactCurve: DepthProbe[] = probes.map(({ side, requestedQuote, impact }) => ({
    side, requestedQuote, filledFully: impact?.filledFully ?? false,
    impactBps: impact?.filledFully ? finite(impact.impactBps) : null,
    avgPrice: impact?.filledFully ? finite(impact.avgPrice) : null,
  }));
  // Dividing the bounded bid notional by the best bid gives a lower bound on base quantity.
  const conservativeBaseCapacity = finite(sell.depth1pct / sell.bid);
  const fitsVisibleCapacity = requestedBaseQty === null || conservativeBaseCapacity === null ? null
    : requestedBaseQty <= conservativeBaseCapacity;
  const estimate = fitsVisibleCapacity && requestedBaseQty !== null ? walkBook(book, 'sell', requestedBaseQty) : null;
  const priced = Boolean(estimate?.filledFully && Number.isFinite(estimate.avgPrice) && estimate.avgPrice > 0);
  const combinedDepth = sell.depth1pct + buy.depth1pct;
  return {
    status: 'AVAILABLE', reason: null, quoteAgeMs: age, capturedAt: book.ts,
    bidLevelCount: book.bids.length, askLevelCount: book.asks.length, spreadBps: finite(buy.spreadBps),
    bidDepth1pctQuote: sell.depth1pct, askDepth1pctQuote: buy.depth1pct,
    bidShare1pct: combinedDepth > 0 && Number.isFinite(combinedDepth) ? buy.bookImbalance : null,
    impactCurve, exit: {
      ...emptyExit, conservativeBaseCapacity,
      fitsVisibleCapacity: fitsVisibleCapacity === true ? priced : fitsVisibleCapacity,
      avgPrice: priced ? estimate!.avgPrice : null,
      impactBps: priced ? finite(estimate!.impactBps) : null,
    },
  };
}

/** Read-only research projection over the existing Binance spot candle and depth caches. */
export function readCexActivity(instrumentId: string, asOf = Date.now(), requestedSellBaseQty?: number): CexActivityReport {
  if (!Number.isFinite(asOf) || asOf < 0 || (requestedSellBaseQty !== undefined &&
      (!Number.isFinite(requestedSellBaseQty) || requestedSellBaseQty <= 0))) {
    throw new RangeError('CEX activity requires a valid timestamp and positive exit quantity');
  }
  const instrument = market.instruments.get(instrumentId);
  const supported = instrument?.market === 'crypto' && instrument.venue === 'binance';
  const deep = supported ? market.deep.get(instrumentId) : undefined;
  return {
    schemaVersion: 1, instrumentId, asOf, source: supported ? 'binance' : null,
    baseAsset: instrument?.base ?? null, quoteAsset: instrument?.quote ?? null,
    volume: [unavailableVolume('5m', 'NO_CANDLE_FEED'), ...WINDOWS.map(spec =>
      supported ? readVolumeWindow(spec, deep, asOf) : unavailableVolume(spec.window, 'NO_CANDLE_FEED'))],
    book: readBook(deep, asOf, requestedSellBaseQty ?? null),
  };
}
