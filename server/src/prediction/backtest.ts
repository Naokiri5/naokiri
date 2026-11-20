/**
 * Prediction-market book replay (HYPOTHETICAL research). Replays a sequence of order-book snapshots for one binary
 * outcome and simulates one strategy with a deliberately conservative fill model:
 *  - a resting quote fills only when a LATER snapshot trades THROUGH it (strictly better opposite price) — equal-price
 *    fills are never assumed, because queue position is unknown;
 *  - a taker fill walks only visible depth at that snapshot; a thin book gives a partial fill, never an invented one;
 *  - no short selling (a venue only lets you sell shares you hold); inventory is capped;
 *  - Polymarket taker fees (shares × rate × p × (1 − p)); maker fills pay none;
 *  - at the end, inventory settles at the known resolution (0 or 1) if given, else is marked to the last bid.
 * This is separate from MIA's paper OMS: nothing here creates orders, positions or ledger entries.
 */
import { bookStats, normaliseBook, polymarketTakerFee, walkBook, type Book, type Level } from './analytics.js';

export type ReplayStrategy =
  | { type: 'passive_quote'; halfSpreadTicks: number; size: number; maxInventory: number }
  | { type: 'threshold_taker'; fair: number | number[]; edge: number; size: number; maxInventory: number };
export interface ReplayInput {
  snapshots: { t: number; bids: Level[]; asks: Level[] }[];
  tick?: number; feeRateBps?: number; resolution?: 0 | 1; strategy: ReplayStrategy;
}
export interface ReplayFill { t: number; side: 'BUY' | 'SELL'; price: number; shares: number; fee: number; liquidity: 'MAKER' | 'TAKER' }

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const snapDown = (p: number, tick: number) => Math.floor(p / tick + 1e-9) * tick;
const snapUp = (p: number, tick: number) => Math.ceil(p / tick - 1e-9) * tick;

export function replay(input: ReplayInput) {
  // Snapshot order is part of the evidence: a fair-value series is indexed alongside these observations.
  // Sorting only the books would silently pair beliefs with another time; equal times are not a later observation.
  for (let i = 0; i < input.snapshots.length; i++) {
    const t = input.snapshots[i].t;
    if (!Number.isSafeInteger(t) || t < 0) throw new Error('snapshot timestamps must be nonnegative safe integers');
    if (i > 0 && t <= input.snapshots[i - 1].t) throw new Error('snapshot timestamps must be strictly increasing');
  }
  const tick = input.tick && input.tick > 0 ? input.tick : 0.01;
  const fee = (q: number, p: number) => polymarketTakerFee(q, p, input.feeRateBps ?? 0);
  const books: (Book & { t: number })[] = input.snapshots.map((s) => ({ ...normaliseBook({ bids: s.bids, asks: s.asks, tick }), t: s.t }));
  const s = input.strategy;
  let cash = 0; let inv = 0; let fees = 0; let turnover = 0; let maxInv = 0;
  let peak = 0; let maxDd = 0; let lastMark = 0.5;
  const fills: ReplayFill[] = []; const curve: { t: number; equity: number }[] = [];
  const record = (f: ReplayFill) => { if (fills.length < 500) fills.push(f); fees += f.fee; turnover += f.shares * f.price; maxInv = Math.max(maxInv, inv); };
  let quotes: { bid: number | null; ask: number | null } = { bid: null, ask: null };

  for (let i = 0; i < books.length; i++) {
    const b = books[i]; const st = bookStats(b, 5);
    if (s.type === 'passive_quote') {
      // 1. Resting quotes from the previous snapshot fill only if this snapshot traded through them.
      if (quotes.bid !== null && st.bestAsk !== null && st.bestAsk < quotes.bid - 1e-9) {
        const avail = b.asks.filter((l) => l.price < quotes.bid! - 1e-9).reduce((t, l) => t + l.size, 0);
        const q = Math.min(s.size, avail, s.maxInventory - inv);
        if (q > 0) { inv += q; cash -= q * quotes.bid; record({ t: b.t, side: 'BUY', price: r6(quotes.bid), shares: r6(q), fee: 0, liquidity: 'MAKER' }); }
      }
      if (quotes.ask !== null && st.bestBid !== null && st.bestBid > quotes.ask + 1e-9) {
        const avail = b.bids.filter((l) => l.price > quotes.ask! + 1e-9).reduce((t, l) => t + l.size, 0);
        const q = Math.min(s.size, avail, inv);
        if (q > 0) { inv -= q; cash += q * quotes.ask; record({ t: b.t, side: 'SELL', price: r6(quotes.ask), shares: r6(q), fee: 0, liquidity: 'MAKER' }); }
      }
      // 2. Re-quote around the mid, never crossing the book, within (0, 1), respecting inventory.
      if (st.mid !== null && st.bestBid !== null && st.bestAsk !== null) {
        let bid = snapDown(st.mid - s.halfSpreadTicks * tick, tick); let ask = snapUp(st.mid + s.halfSpreadTicks * tick, tick);
        if (bid >= st.bestAsk) bid = snapDown(st.bestAsk - tick, tick);
        if (ask <= st.bestBid) ask = snapUp(st.bestBid + tick, tick);
        quotes = { bid: inv < s.maxInventory && bid > 0 ? r6(bid) : null, ask: inv > 0 && ask < 1 ? r6(ask) : null };
      } else quotes = { bid: null, ask: null };
    } else {
      const fair = Array.isArray(s.fair) ? s.fair[Math.min(i, s.fair.length - 1)] : s.fair;
      if (st.bestAsk !== null && st.bestAsk <= fair - s.edge && inv < s.maxInventory) {
        const w = walkBook(b.asks, Math.min(s.size, s.maxInventory - inv), fee, fair - s.edge, 'buy');
        if (w.shares > 0) { inv += w.shares; cash -= w.notional + w.fee; record({ t: b.t, side: 'BUY', price: w.avgPrice!, shares: w.shares, fee: w.fee, liquidity: 'TAKER' }); }
      } else if (st.bestBid !== null && st.bestBid >= fair + s.edge && inv > 0) {
        const w = walkBook(b.bids, Math.min(s.size, inv), fee, fair + s.edge, 'sell');
        if (w.shares > 0) { inv -= w.shares; cash += w.notional - w.fee; record({ t: b.t, side: 'SELL', price: w.avgPrice!, shares: w.shares, fee: w.fee, liquidity: 'TAKER' }); }
      }
    }
    if (st.bestBid !== null) lastMark = st.bestBid; // conservative mark: what the inventory could be sold for now
    const equity = cash + inv * lastMark;
    peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity);
    if (books.length <= 200 || i % Math.ceil(books.length / 200) === 0 || i === books.length - 1) curve.push({ t: b.t, equity: r6(equity) });
  }
  const settle = input.resolution ?? null;
  const finalValue = cash + inv * (settle ?? lastMark);
  return {
    kind: 'HYPOTHETICAL' as const, tradeEligible: false as const, snapshots: books.length, strategy: s.type,
    pnl: r6(finalValue), settledAt: settle === null ? 'last bid (no resolution given)' : `resolution ${settle}`,
    finalInventory: r6(inv), maxInventory: r6(maxInv), maxDrawdown: r6(maxDd), fees: r6(fees), turnover: r6(turnover),
    fillCount: fills.length, fills, equityCurve: curve,
    assumptions: [
      'Resting quotes fill only when the next snapshot trades strictly through them (queue position unknown).',
      'Taker fills use visible depth only; no hidden liquidity, no latency model.',
      'No short selling; inventory capped. Maker fills pay no fee; taker fees use the Polymarket formula.',
      'Snapshots are what you supplied: gaps between them can hide fills or adverse moves.',
    ],
  };
}
