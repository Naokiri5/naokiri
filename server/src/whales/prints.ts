import { aggTrades } from '../providers/binance.js';
import { market } from '../market/store.js';
import { bus } from '../core/bus.js';

/**
 * Part 4 (CEX scope): large-print detection from public aggregated trades. These are exchange
 * trades above a liquidity-scaled threshold — NOT identified wallets. Wallet-level whale tracking
 * and copy trading require an on-chain provider (pending credentials) and are not simulated.
 */
export interface LargePrint { instrumentId: string; symbol: string; ts: number; price: number; qty: number; notional: number; side: 'BUY' | 'SELL'; threshold: number }
const prints: LargePrint[] = [];
const lastId = new Map<string, number>();
export const printThreshold = (quoteVol24h: number) => Math.max(100_000, quoteVol24h * 0.0004);

export async function scanPrints(ids = market.universe.slice(0, 12)) {
  let found = 0;
  for (const id of ids) {
    const t = market.tickers.get(id); if (!t) continue;
    let trades; try { trades = await aggTrades(t.symbol, 1000); } catch { continue; }
    const th = printThreshold(t.quoteVolume); const prev = lastId.get(id) ?? 0;
    for (const a of trades) {
      if (a.id <= prev) continue;
      const notional = a.price * a.qty;
      if (notional >= th) { prints.push({ instrumentId: id, symbol: t.symbol, ts: a.ts, price: a.price, qty: a.qty, notional, side: a.buyerIsMaker ? 'SELL' : 'BUY', threshold: th }); found++; }
    }
    if (trades.length) lastId.set(id, trades[trades.length - 1].id);
  }
  const cutoff = Date.now() - 6 * 3600_000;
  while (prints.length && prints[0].ts < cutoff) prints.shift();
  prints.sort((a, b) => a.ts - b.ts);
  if (found) bus.publish('whale', { found });
  return found;
}
export const recentPrints = (limit = 200) => prints.slice(-limit).reverse();
export function printContext(id: string, windowMs = 3600_000, nowTs = Date.now()) {
  const r = prints.filter((p) => p.instrumentId === id && nowTs - p.ts < windowMs);
  return { buyNotional: r.filter((p) => p.side === 'BUY').reduce((s, p) => s + p.notional, 0), sellNotional: r.filter((p) => p.side === 'SELL').reduce((s, p) => s + p.notional, 0), count: r.length };
}
export function _injectPrintsForTest(p: LargePrint[]) { prints.splice(0, prints.length, ...p); }
