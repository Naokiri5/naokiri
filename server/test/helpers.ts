import type { Candle } from '../src/market/types.js';
/** Deterministic synthetic candles for unit tests only (seeded LCG). Never used at runtime. */
export function synthCandles(n: number, opts: { start?: number; drift?: number; vol?: number; seed?: number; t0?: number; step?: number } = {}): Candle[] {
  let s = opts.seed ?? 42; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  let p = opts.start ?? 100; const out: Candle[] = []; const step = opts.step ?? 3_600_000; const t0 = opts.t0 ?? 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    const r = (opts.drift ?? 0) + (rnd() - 0.5) * 2 * (opts.vol ?? 0.01);
    const o = p; const c = p * (1 + r); const h = Math.max(o, c) * (1 + rnd() * 0.003); const l = Math.min(o, c) * (1 - rnd() * 0.003);
    const v = 1000 + rnd() * 500;
    out.push({ t: t0 + i * step, o, h, l, c, v, tbv: v * (0.4 + rnd() * 0.2), closeTime: t0 + (i + 1) * step - 1 });
    p = c;
  }
  return out;
}

import { market } from '../src/market/store.js';
import { closeDb, openDb, run } from '../src/db/db.js';
import { seedStrategies } from '../src/lab/lab.js';
import type { Instrument } from '../src/market/types.js';
export function freshDb(promote = true) {
  closeDb(); openDb(':memory:'); seedStrategies();
  if (promote) run("UPDATE strategies SET status='PAPER'");
}
/** Seed an instrument with synthetic candles on all intervals plus a deep book and cross-venue quote. */
export function seedInstrument(symbol: string, opts: { drift?: number; vol?: number; seed?: number; quoteVolume?: number; nowTs?: number; spreadBps?: number } = {}) {
  const nowTs = opts.nowTs ?? Date.now();
  const inst: Instrument = { id: `crypto:binance:${symbol}`, symbol, base: symbol.replace('USDT', ''), quote: 'USDT', market: 'crypto', venue: 'binance', tickSize: 0.01, stepSize: 0.0001, minQty: 0.0001, minNotional: 5 };
  market.instruments.set(inst.id, inst);
  const d = market.deepState(inst);
  const mk = (step: number, n: number) => synthCandles(n, { drift: opts.drift ?? 0.002, vol: opts.vol ?? 0.004, seed: opts.seed ?? 3, step, t0: Math.floor(nowTs / step) * step - n * step, start: 100 });
  d.engines['1h'].ingest(mk(3_600_000, 400)); d.engines['15m'].ingest(mk(900_000, 400)); d.engines['4h'].ingest(mk(14_400_000, 400));
  const last = d.engines['1h'].last!.close;
  const sp = (opts.spreadBps ?? 2) / 2e4;
  market.tickers.set(inst.id, { instrumentId: inst.id, symbol, base: inst.base, quote: 'USDT', last, bid: last * (1 - sp), ask: last * (1 + sp), changePct: 2, quoteVolume: opts.quoteVolume ?? 500e6, high: last * 1.02, low: last * 0.97, open: last * 0.98, trades: 400_000, providerTs: nowTs, receivedAt: nowTs, source: 'binance' });
  setBook(inst.id, last, nowTs, opts.spreadBps ?? 2);
  d.cross.kraken = { price: last * 1.0005, bid: last, ask: last, ts: nowTs, venue: 'kraken' };
  d.cross.coinbase = { price: last * 0.9998, bid: last, ask: last, ts: nowTs, venue: 'coinbase' };
  market.cg.set(inst.base, { id: inst.base.toLowerCase(), symbol: inst.base, name: inst.base, price: last, marketCap: 50e9, rank: 5, volume: 2e9, change24h: 2, image: '' });
  if (!market.universe.includes(inst.id)) market.universe.push(inst.id);
  return { inst, last };
}
export function setBook(id: string, mid: number, ts = Date.now(), spreadBps = 2) {
  const sp = spreadBps / 2e4;
  const lv = (side: 1 | -1) => Array.from({ length: 50 }, (_, i) => [mid * (1 + side * (sp + i * 0.0002)), 50] as [number, number]);
  market.deep.get(id)!.book = { bids: lv(-1), asks: lv(1), ts };
  const t = market.tickers.get(id); if (t) Object.assign(t, { last: mid, bid: mid * (1 - sp), ask: mid * (1 + sp), receivedAt: ts });
  for (const q of Object.values(market.deep.get(id)!.cross)) { q.price = mid; q.ts = ts; }
}
