import * as binance from '../providers/binance.js';
import * as coinbase from '../providers/coinbase.js';
import * as kraken from '../providers/kraken.js';
import * as coingecko from '../providers/coingecko.js';
import * as dexscreener from '../providers/dexscreener.js';
import * as frankfurter from '../providers/frankfurter.js';
import { market } from './store.js';
import { INTERVAL_MS, type Instrument, type Interval } from './types.js';
import { bus } from '../core/bus.js';
import { timed } from '../core/latency.js';
import { config } from '../config.js';

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
  for (const t of elig) { if (ids.size >= config.deepTierSize) break; ids.add(t.instrumentId); }
  market.universe = [...ids];
  universeAt = Date.now();
}

async function refreshCandles(id: string, interval: Interval) {
  const inst = market.instruments.get(id)!; const d = market.deepState(inst);
  const eng = d.engines[interval];
  const limit = eng.lastT < 0 ? 400 : Math.min(400, Math.ceil((Date.now() - eng.lastT) / INTERVAL_MS[interval]) + 2);
  const cs = await binance.klines(inst.symbol, interval, limit);
  const nowTs = Date.now();
  const closed = cs.filter((c) => (c.closeTime ?? c.t + INTERVAL_MS[interval]) < nowTs);
  const forming = cs.find((c) => (c.closeTime ?? 0) >= nowTs);
  await timed('features.incremental', () => eng.ingest(closed));
  if (forming) d.forming[interval] = forming;
  d.candleFetchedAt[interval] = nowTs;
}

export async function refreshDeep(ids = market.universe) {
  const nowTs = Date.now();
  await Promise.all(ids.map(async (id) => {
    const inst = market.instruments.get(id); if (!inst) return;
    const d = market.deepState(inst);
    try {
      for (const iv of ['15m', '1h', '4h'] as Interval[]) {
        const fetched = d.candleFetchedAt[iv] ?? 0;
        // only refetch after a new candle could have closed (incremental, Part 33.5)
        const eng = d.engines[iv];
        if (eng.lastT < 0 || nowTs >= eng.lastT + 2 * INTERVAL_MS[iv] || nowTs - fetched > INTERVAL_MS[iv] / 4) await refreshCandles(id, iv);
      }
      d.book = await timed('fabric.book', () => binance.depth(inst.symbol, 100));
    } catch { /* provider health already tracked; quality gate will fail-closed */ }
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

export async function ensureRules() { if (Date.now() - rulesFetchedAt > 6 * 3600_000) await refreshRules(); }
