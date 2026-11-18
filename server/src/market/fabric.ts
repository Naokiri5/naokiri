import * as binance from '../providers/binance.js';
import * as coinbase from '../providers/coinbase.js';
import * as kraken from '../providers/kraken.js';
import * as coingecko from '../providers/coingecko.js';
import * as dexscreener from '../providers/dexscreener.js';
import * as frankfurter from '../providers/frankfurter.js';
import { market, type DeepState } from './store.js';
import { validateCandles } from '../chart/analysis.js';
import { INTERVAL_MS, type Candle, type Instrument, type Interval } from './types.js';
import { bus } from '../core/bus.js';
import { FeatureEngine } from '../features/indicators.js';
import { timed } from '../core/latency.js';
import { config } from '../config.js';
import { openPositions } from '../portfolio/ledger.js';
import type { Book } from '../providers/binance.js';
import { startDepthStream, binanceStreamUrl, type StreamBook, type StreamDeps } from './depthStream.js';

/** Install a book snapshot unless it is older than the one already held (concurrent refreshes can land out of order). */
function setBook(id: string, b: Book) {
  const d = market.deep.get(id); if (!d) return;
  const cur = d.book;
  if (cur && ((b.lastUpdateId != null && cur.lastUpdateId != null && b.lastUpdateId < cur.lastUpdateId) || b.ts < cur.ts)) return;
  d.book = b;
}

/** Part 29 L0 + Part 33.6 tiered scanning. Polling is the documented fallback (no WS hosts allow-listed). */
const STABLES = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'BUSD', 'USDP', 'USDE', 'EUR', 'EURI', 'AEUR', 'XUSD', 'USD1', 'BFUSD', 'RLUSD', 'USDS', 'PYUSD', 'TRY', 'BRL', 'GBP']);
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;
export const isEligibleSpot = (base: string, quote: string) => quote === 'USDT' && !STABLES.has(base) && !LEVERAGED.test(base) && base !== 'PAXG';

let rulesFetchedAt = 0;
const coinbaseMissing = new Set<string>();
let universeAt = 0;

export async function refreshRules() {
  const rules = await binance.exchangeInfo();
  for (const r of rules) {
    if (r.status !== 'TRADING' || r.quote !== 'USDT') continue;
    const inst: Instrument = { id: `crypto:binance:${r.symbol}`, symbol: r.symbol, base: r.base, quote: r.quote, market: 'crypto', venue: 'binance', tickSize: r.tickSize, stepSize: r.stepSize, minQty: r.minQty, minNotional: r.minNotional };
    market.instruments.set(inst.id, inst);
  }
  rulesFetchedAt = Date.now();
}

export async function refreshTickers() {
  const ts = await timed('fabric.tickers', () => binance.tickers24h());
  const recv = Date.now();
  for (const t of ts) {
    const id = `crypto:binance:${t.symbol}`; const inst = market.instruments.get(id);
    if (!inst) continue;
    // Out-of-order / replayed payload: never overwrite a newer exchange timestamp with an older one.
    const prev = market.tickers.get(id);
    if (prev && Number.isFinite(t.closeTime) && t.closeTime < prev.providerTs) continue;
    if (!(t.lastPrice > 0)) continue;
    market.tickers.set(id, { instrumentId: id, symbol: t.symbol, base: inst.base, quote: inst.quote, last: t.lastPrice, bid: t.bidPrice, ask: t.askPrice, changePct: t.priceChangePercent, quoteVolume: t.quoteVolume, high: t.highPrice, low: t.lowPrice, open: t.openPrice, trades: t.count, providerTs: t.closeTime, receivedAt: recv, source: 'binance' });
  }
  market.tickersFetchedAt = recv;
  if (recv - universeAt > 10 * 60_000 || !market.universe.length) selectUniverse();
  bus.publish('ticker', { count: market.tickers.size, at: recv });
}

/** T2 deep tier: most liquid eligible spot pairs (pinned majors always included). */
export function selectUniverse() {
  const pinned = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  const elig = [...market.tickers.values()].filter((t) => isEligibleSpot(t.base, t.quote) && t.quoteVolume > 0).sort((a, b) => b.quoteVolume - a.quoteVolume);
  const ids = new Set(pinned.map((s) => `crypto:binance:${s}`).filter((id) => market.tickers.has(id)));
  // Instruments with an open position must stay in the deep tier or their candles/books stop refreshing.
  try { for (const p of openPositions()) if (market.instruments.has(p.instrument)) ids.add(p.instrument); } catch { /* db not ready */ }
  for (const t of elig) { if (ids.size >= config.deepTierSize) break; ids.add(t.instrumentId); }
  market.universe = [...ids];
  universeAt = Date.now();
}

/** Validate raw provider ordering before FeatureEngine's overlap/deduplication behavior. */
/**
 * `closedBefore` (default nowTs) is the cut-off for treating the LAST candle of a batch as final. Callers pass the
 * time the request was sent (minus skew margin): a candle that closed while the request was in flight may still be
 * a partial snapshot, and ingesting it as closed would make the engine ignore its real close (PR #3 fix).
 * Any candle followed by a later one in the same batch is final.
 */
export function validateCandleBatch(candles: readonly Candle[], interval: Interval, nowTs: number, closedBefore = nowTs) {
  const duration = INTERVAL_MS[interval];
  const last = candles[candles.length - 1];
  const validationTime = Math.max(nowTs, last ? last.t + duration : nowTs);
  const issues = new Set(validateCandles(candles, interval, validationTime));
  // The current interval may be forming; no candle may start in the future.
  if (candles.some(c => c.t > nowTs)) issues.add('future candle open timestamp');
  if (candles.some(c => c.closeTime != null && (c.closeTime < c.t || c.closeTime > c.t + duration))) issues.add('inconsistent candle close timestamp');
  const cut = Math.min(nowTs, closedBefore);
  const isClosed = (c: Candle, i: number) => i < candles.length - 1 || (c.t + duration <= cut && (c.closeTime == null || c.closeTime < cut));
  const closed = candles.filter((c, i) => isClosed(c, i));
  const forming = candles.filter((c, i) => !isClosed(c, i));
  if (forming.length > 1 || (forming.length && forming[0] !== last)) issues.add('multiple or misplaced forming candles');
  for (const issue of validateCandles(closed, interval, nowTs)) issues.add(issue);
  return { closed, forming: forming[0], issues: [...issues] };
}

/** Minimum validated contiguous closed candles needed to rebuild an engine after an unbridgeable gap (EMA200 + margin). */
export const REBUILD_MIN_BARS = 300;
/** Bad source batches never alter indicators; the quality gate remains failed until recovery. */
export function ingestCandleBatch(state: DeepState, interval: Interval, candles: readonly Candle[], nowTs: number, closedBefore = nowTs) {
  const result = validateCandleBatch(candles, interval, nowTs, closedBefore);
  const engine = state.engines[interval];
  const firstNew = result.closed.find(c => c.t > engine.lastT);
  const gap = engine.lastT >= 0 && !!firstNew && firstNew.t !== engine.lastT + INTERVAL_MS[interval];
  // Explicit recovery policy: after an outage longer than one fetch window the gap can never be bridged by appending.
  // A batch that is itself fully valid, contiguous, entirely newer than the cache and long enough to warm every
  // indicator (EMA200) REBUILDS the engine from that window. Anything less keeps the quality gate failed.
  if (gap && !result.issues.length && result.closed.length >= REBUILD_MIN_BARS && result.closed[0].t > engine.lastT) {
    const fresh = new FeatureEngine(); fresh.ingest(result.closed); state.engines[interval] = fresh;
    state.integrityIssues ??= {}; state.integrityIssues[interval] = []; state.candleFetchedAt[interval] = nowTs;
    if (result.forming) state.forming[interval] = result.forming; else delete state.forming[interval];
    bus.publish('health', { type: 'market-data-integrity', instrumentId: state.instrument.id, interval, source: state.instrument.venue, at: nowTs, status: 'REBUILT',
      issues: [`history rebuilt from ${result.closed.length} validated candles after a gap since ${new Date(engine.lastT).toISOString()}`] });
    return result.closed.length;
  }
  if (gap) result.issues.push('missing candles between cached history and source batch');
  const previousIssues = state.integrityIssues?.[interval] ?? [];
  state.integrityIssues ??= {};
  state.integrityIssues[interval] = result.issues;
  state.candleFetchedAt[interval] = nowTs;
  if (result.issues.length || previousIssues.length) bus.publish('health', {
    type: 'market-data-integrity', instrumentId: state.instrument.id, interval, source: state.instrument.venue, at: nowTs,
    status: result.issues.length ? 'FAIL' : 'RECOVERED', issues: result.issues,
  });
  if (result.issues.length) return 0;
  // Repeated candles across separate refreshes are expected and handled idempotently.
  const added = engine.ingest(result.closed);
  if (result.forming) state.forming[interval] = result.forming;
  else delete state.forming[interval];
  return added;
}

async function refreshCandles(id: string, interval: Interval) {
  const inst = market.instruments.get(id)!; const d = market.deepState(inst);
  const eng = d.engines[interval];
  const limit = eng.lastT < 0 ? 400 : Math.min(400, Math.ceil((Date.now() - eng.lastT) / INTERVAL_MS[interval]) + 2);
  // A candle is final only if it closed BEFORE the request was sent (2 s margin for clock skew / cached mirror
  // responses) or a later candle exists in the same response. Judging by receive time ingested forming candles as
  // closed, and the engine then ignored the real close forever.
  const reqTs = Date.now();
  const cs = await binance.klines(inst.symbol, interval, limit);
  await timed('features.incremental', () => ingestCandleBatch(d, interval, cs, Date.now(), reqTs - 2_000));
}

export async function refreshDeep(ids = market.universe) {
  const nowTs = Date.now();
  await Promise.all(ids.map(async (id) => {
    const inst = market.instruments.get(id); if (!inst) return;
    const d = market.deepState(inst);
    // Each interval and the book fail independently: one bad klines call must not freeze the others.
    {
      for (const iv of ['15m', '1h', '4h'] as Interval[]) {
        const fetched = d.candleFetchedAt[iv] ?? 0;
        // only refetch after a new candle could have closed (incremental, Part 33.5)
        const eng = d.engines[iv];
        if (d.integrityIssues?.[iv]?.length || eng.lastT < 0 || nowTs >= eng.lastT + 2 * INTERVAL_MS[iv] || nowTs - fetched > INTERVAL_MS[iv] / 4) {
          try { await refreshCandles(id, iv); } catch { /* provider health tracked; quality gate fails closed on stale candles */ }
        }
      }
      try { setBook(id, await timed('fabric.book', () => binance.depth(inst.symbol, 100))); }
      catch { /* a book that could not be refreshed keeps its old timestamp and ages out of the execution limit */ }
    }
  }));
  await refreshCross(ids);
}

async function refreshCross(ids: string[]) {
  const bases = ids.map((id) => market.instruments.get(id)?.base).filter(Boolean) as string[];
  try {
    const kq = await kraken.tickers(bases.map(kraken.krakenAlt));
    for (const id of ids) { const b = market.instruments.get(id)!.base; const q = kq[kraken.krakenAlt(b)]; if (q) market.deepState(market.instruments.get(id)!).cross.kraken = q; }
  } catch { /* tracked */ }
  await Promise.all(ids.slice(0, 15).map(async (id) => {
    const inst = market.instruments.get(id)!; const pid = `${inst.base}-USD`;
    if (coinbaseMissing.has(pid)) return;
    try { market.deepState(inst).cross.coinbase = await coinbase.ticker(pid); }
    catch (e: any) { if (e?.status === 404) coinbaseMissing.add(pid); }
  }));
}

/** Refresh only the order books for the given instruments (hot lane: open positions; API: just before an owner action). */
/** Last time a sequence-checked stream book was published per instrument (REST skips symbols the stream keeps fresh). */
const streamBookAt = new Map<string, number>();
export const STREAM_FRESH_MS = 2_000;
export const streamFresh = (id: string, nowTs = Date.now()) => nowTs - (streamBookAt.get(id) ?? 0) <= STREAM_FRESH_MS;
let depthStream: ReturnType<typeof startDepthStream> | null = null; let streamKey = '';
/**
 * Keep one combined depth stream for `ids` (open positions + deep tier). Restarted only when the set changes. Each
 * published book goes through setBook, which already refuses an older lastUpdateId, so stream and REST books coexist.
 */
export function syncDepthStreams(ids: string[], seams: Partial<Pick<StreamDeps, 'WebSocketImpl' | 'snapshot'>> = {}) {
  if (!config.streaming || config.offline) return null;
  const symbols = [...new Set(ids.map((id) => market.instruments.get(id)?.symbol).filter((s): s is string => !!s))].sort().slice(0, 200);
  const key = symbols.join(',');
  if (key === streamKey && depthStream) return depthStream;
  depthStream?.stop(); depthStream = null; streamKey = key;
  if (!symbols.length) return null;
  depthStream = startDepthStream(symbols, {
    url: binanceStreamUrl,
    WebSocketImpl: seams.WebSocketImpl,
    snapshot: seams.snapshot ?? (async (sym) => {
      const b = await binance.depth(sym, 100);
      if (b.lastUpdateId == null) throw new Error('snapshot without lastUpdateId cannot be synchronized');
      return { lastUpdateId: b.lastUpdateId, bids: b.bids, asks: b.asks };
    }),
    publish: (sym, b: StreamBook) => {
      const id = `crypto:binance:${sym}`; const inst = market.instruments.get(id); if (!inst) return;
      market.deepState(inst); setBook(id, { bids: b.bids, asks: b.asks, ts: b.ts, lastUpdateId: b.lastUpdateId }); streamBookAt.set(id, b.ts);
    },
  });
  return depthStream;
}
export function stopDepthStreams() { depthStream?.stop(); depthStream = null; streamKey = ''; streamBookAt.clear(); }
export const depthStreamStatus = () => depthStream?.status() ?? null;

export async function refreshBooks(ids: string[]) {
  await Promise.all([...new Set(ids)].map(async (id) => {
    const inst = market.instruments.get(id); if (!inst) return;
    if (streamFresh(id)) return; // the stream already keeps this book continuous and fresh
    try { market.deepState(inst); setBook(id, await timed('fabric.book', () => binance.depth(inst.symbol, 100))); }
    catch { /* provider health tracked; a book that could not be refreshed keeps its old timestamp and ages out */ }
  }));
}

export async function refreshBackground() {
  const t = Date.now();
  if (t - market.cgFetchedAt > 5 * 60_000) {
    try { const ms = await coingecko.markets(250); market.cg.clear(); for (const m of ms) if (!market.cg.has(m.symbol)) market.cg.set(m.symbol, m); market.cgFetchedAt = t; } catch { /* tracked */ }
  }
  if (t - market.dexFetchedAt > 3 * 60_000) {
    try { market.dex = await dexscreener.latestTokenPairs(30); market.dexFetchedAt = t; } catch { /* tracked */ }
  }
  if (t - market.fxFetchedAt > 30 * 60_000) {
    try { market.fx = await frankfurter.fxSeries(180); market.fxFetchedAt = t; } catch { /* tracked */ }
  }
}

let rulesTriedAt = 0;
/** Refresh venue rules every 6 h; after a failure keep the rules already held and retry at most once a minute. */
export async function ensureRules() {
  const t = Date.now();
  if (t - rulesFetchedAt <= 6 * 3600_000 || (rulesFetchedAt && t - rulesTriedAt < 60_000)) return;
  rulesTriedAt = t; await refreshRules();
}
