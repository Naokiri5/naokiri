import { aggTrades, type AggTrade } from '../providers/binance.js';
import { market } from '../market/store.js';
import { bus } from '../core/bus.js';

/**
 * Part 4 (CEX scope): large-print detection from public aggregated trades. These are exchange
 * trades above a liquidity-scaled threshold — NOT identified wallets. Wallet-level whale tracking
 * and copy trading require an on-chain provider (pending credentials) and are not simulated.
 */
export interface LargePrint { instrumentId: string; symbol: string; ts: number; price: number; qty: number; notional: number; side: 'BUY' | 'SELL'; threshold: number; aggregateTradeId?: number; receivedAt?: number }
export type SpotTapeTrade = Readonly<AggTrade & { receivedAt: number; threshold: number }>;
const SOURCE = 'BINANCE_SPOT_AGG_TRADES' as const;
const TAPE_LIMIT = 1000, RETENTION_MS = 6 * 3600_000, SAMPLE_LIMIT = 20;
export interface LargePrintContext {
  buyNotional: number; sellNotional: number; count: number;
  /** Old immutable decision records contain aggregate totals only. */
  evidence?: {
    source: typeof SOURCE; asOf: number; windowMs: number; sampleLimit: number;
    latestObservedLargePrints: { aggregateTradeId: number | null; exchangeAt: number; receivedAt: number | null;
      price: number; qty: number; side: LargePrint['side']; threshold: number }[];
  };
}
interface InstrumentTape { symbol: string; polledAt: number; evictedThroughId: number; trades: SpotTapeTrade[] }
const tapes = new Map<string, InstrumentTape>();
// The six-hour large-print view also retains qualifying trades after they leave the bounded raw sample.
let olderPrints: LargePrint[] = [];
export const printThreshold = (quoteVol24h: number) => Math.max(100_000, quoteVol24h * 0.0004);

function asLargePrint(instrumentId: string, symbol: string, trade: SpotTapeTrade): LargePrint {
  return { instrumentId, symbol, ts: trade.ts, price: trade.price, qty: trade.qty, notional: trade.price * trade.qty,
    side: trade.buyerIsMaker ? 'SELL' : 'BUY', threshold: trade.threshold, aggregateTradeId: trade.id, receivedAt: trade.receivedAt };
}

/** Retained, observed public trades only. Continuity applies between the two returned exchange IDs. */
export function readSpotTradeTape(instrumentId: string, asOf: number) {
  const tape = tapes.get(instrumentId);
  const trades = tape?.trades.filter(t => t.ts <= asOf && t.receivedAt <= asOf && t.ts > asOf - RETENTION_MS) ?? [];
  const polledAt = tape && tape.polledAt <= asOf ? tape.polledAt : trades.reduce<number | null>((latest, t) => Math.max(latest ?? 0, t.receivedAt), null);
  return { source: SOURCE, polledAt, trades, firstId: trades.at(0)?.id ?? null, lastId: trades.at(-1)?.id ?? null,
    contiguous: trades.length > 0 && trades.every((t, i) => i === 0 || t.id === trades[i - 1].id + 1) };
}

export async function scanPrints(ids = market.universe.slice(0, 12)) {
  let found = 0;
  for (const id of ids) {
    const t = market.tickers.get(id); if (!t) continue;
    let trades; try { trades = await aggTrades(t.symbol, TAPE_LIMIT); } catch { continue; }
    const receivedAt = Date.now(), threshold = printThreshold(t.quoteVolume);
    const tape = tapes.get(id) ?? { symbol: t.symbol, polledAt: receivedAt, evictedThroughId: -1, trades: [] };
    const byId = new Map(tape.trades.map(trade => [trade.id, trade]));
    for (const a of trades) {
      if (a.ts > receivedAt || a.ts <= receivedAt - RETENTION_MS || a.id <= tape.evictedThroughId || byId.has(a.id)) continue;
      byId.set(a.id, Object.freeze({ ...a, receivedAt, threshold }));
      if (a.price * a.qty >= threshold) found++;
    }
    const ordered = [...byId.values()].sort((a, b) => a.id - b.id);
    const evicted = ordered.splice(0, Math.max(0, ordered.length - TAPE_LIMIT));
    for (const trade of evicted) {
      tape.evictedThroughId = trade.id;
      if (trade.price * trade.qty >= trade.threshold) olderPrints.push(asLargePrint(id, tape.symbol, trade));
    }
    tape.trades = ordered;
    tape.polledAt = receivedAt;
    tapes.set(id, tape);
  }
  const cutoff = Date.now() - RETENTION_MS;
  olderPrints = olderPrints.filter(p => p.ts > cutoff);
  for (const [id, tape] of tapes) if (tape.polledAt <= cutoff) tapes.delete(id);
  if (found) bus.publish('whale', { found });
  return found;
}

function observedPrints(id: string | undefined, windowMs: number, asOf: number) {
  const selected = olderPrints.filter(p => id === undefined || p.instrumentId === id);
  for (const [instrumentId, tape] of tapes) {
    if (id !== undefined && instrumentId !== id) continue;
    for (const trade of tape.trades) {
      if (trade.price * trade.qty >= trade.threshold) selected.push(asLargePrint(instrumentId, tape.symbol, trade));
    }
  }
  return selected.filter(p => p.ts > asOf - windowMs && p.ts <= asOf && (p.receivedAt === undefined || p.receivedAt <= asOf))
    .sort((a, b) => b.ts - a.ts || (b.aggregateTradeId ?? 0) - (a.aggregateTradeId ?? 0));
}

export const recentPrints = (limit = 200) => observedPrints(undefined, RETENTION_MS, Date.now()).slice(0, limit);
export function printContext(id: string, windowMs = 3600_000, nowTs = Date.now()): LargePrintContext {
  const r = observedPrints(id, windowMs, nowTs);
  const sample = r.slice(0, SAMPLE_LIMIT).map(p => ({ aggregateTradeId: p.aggregateTradeId ?? null, exchangeAt: p.ts,
    receivedAt: p.receivedAt ?? null, price: p.price, qty: p.qty, side: p.side, threshold: p.threshold }));
  return { buyNotional: r.filter(p => p.side === 'BUY').reduce((s, p) => s + p.notional, 0),
    sellNotional: r.filter(p => p.side === 'SELL').reduce((s, p) => s + p.notional, 0), count: r.length,
    evidence: { source: SOURCE, asOf: nowTs, windowMs, sampleLimit: SAMPLE_LIMIT, latestObservedLargePrints: sample } };
}
export function _injectPrintsForTest(p: LargePrint[]) { tapes.clear(); olderPrints = [...p]; }
