/**
 * Prediction-market analytics (binary contracts priced 0–1). Pure functions, no I/O, deterministic.
 *
 * Clean-room TypeScript implementations of publicly documented formulas and ideas reviewed in four uploaded
 * projects (see docs/research/PREDICTION_MARKETS.md for provenance). No code was copied: one project has no licence
 * and another is partly LGPL.
 *
 * Everything here is EVIDENCE for the owner. A result never becomes an order, never reaches the scanner, QCI vote,
 * decision engine, risk gate or paper OMS, and no number is a calibrated win probability.
 */

export interface Level { price: number; size: number }
/** Bids best-first (descending), asks best-first (ascending). `tick` is the venue's minimum price step. */
export interface Book { bids: Level[]; asks: Level[]; tick: number }

const EPS = 1e-12;
const round = (v: number, dp = 6) => Math.round(v * 10 ** dp) / 10 ** dp;
const valid = (l: Level) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price > 0 && l.price < 1 && l.size > 0;

/** Sorts, drops invalid levels (price outside (0,1), non-positive size) and merges equal prices. */
export function normaliseBook(raw: { bids: Level[]; asks: Level[]; tick?: number }): Book {
  const merge = (ls: Level[], desc: boolean) => {
    const m = new Map<number, number>();
    for (const l of ls.filter(valid)) m.set(round(l.price, 6), (m.get(round(l.price, 6)) ?? 0) + l.size);
    return [...m].map(([price, size]) => ({ price, size })).sort((a, b) => (desc ? b.price - a.price : a.price - b.price));
  };
  const tick = raw.tick && raw.tick > 0 && raw.tick < 0.5 ? raw.tick : 0.01;
  return { bids: merge(raw.bids, true), asks: merge(raw.asks, false), tick };
}

/** The NO side of a binary market seen through the YES book: a YES bid at p is a NO ask at 1-p, and vice versa. */
export function mirror(book: Book): Book {
  return {
    tick: book.tick,
    bids: book.asks.map((l) => ({ price: round(1 - l.price), size: l.size })),
    asks: book.bids.map((l) => ({ price: round(1 - l.price), size: l.size })),
  };
}

// ---- fees ---------------------------------------------------------------------------------------------------------
/**
 * Polymarket taker fee per fill: shares × feeRate × p × (1 − p), feeRate = takerBaseFeeBps / 10 000.
 * Maker (resting) fills pay nothing. Source: docs.polymarket.com/trading/fees. Fee-free markets have rate 0.
 */
export const polymarketTakerFee = (shares: number, price: number, feeRateBps: number) =>
  feeRateBps > 0 ? shares * (feeRateBps / 10_000) * price * (1 - price) : 0;
/**
 * Kalshi taker fee per order: ceil-to-cent(0.07 × contracts × P × (1 − P)). Source: Kalshi fee schedule.
 * The coefficient is a parameter because Kalshi varies it by product.
 */
export const kalshiTakerFee = (contracts: number, price: number, coefficient = 0.07) =>
  contracts > 0 ? Math.ceil(coefficient * contracts * price * (1 - price) * 100 - 1e-9) / 100 : 0;
export type FeeFn = (shares: number, price: number) => number;

// ---- book statistics --------------------------------------------------------------------------------------------
export interface BookStats {
  bestBid: number | null; bestAsk: number | null; mid: number | null; spread: number | null; spreadTicks: number | null;
  microprice: number | null; bidDepth: number; askDepth: number; imbalance: number | null; levels: number;
}
/** Top-of-book, spread and size imbalance over the first `levels` levels on each side (−1 = all asks, +1 = all bids). */
export function bookStats(book: Book, levels = 5): BookStats {
  const bb = book.bids[0]; const ba = book.asks[0];
  const bidDepth = book.bids.slice(0, levels).reduce((s, l) => s + l.size, 0);
  const askDepth = book.asks.slice(0, levels).reduce((s, l) => s + l.size, 0);
  const mid = bb && ba ? round((bb.price + ba.price) / 2) : null;
  const spread = bb && ba ? round(ba.price - bb.price) : null;
  return {
    bestBid: bb?.price ?? null, bestAsk: ba?.price ?? null, mid, spread,
    spreadTicks: spread === null ? null : Math.round(spread / book.tick),
    // Size-weighted touch price: leans toward the side with less resting size (where price is likelier to move).
    microprice: bb && ba ? round((bb.price * ba.size + ba.price * bb.size) / (bb.size + ba.size)) : null,
    bidDepth: round(bidDepth, 4), askDepth: round(askDepth, 4),
    imbalance: bidDepth + askDepth > 0 ? round((bidDepth - askDepth) / (bidDepth + askDepth), 4) : null,
    levels,
  };
}

export interface Walk { shares: number; avgPrice: number | null; notional: number; fee: number; complete: boolean; worstPrice: number | null }
/**
 * Walks visible levels to take `shares` (taker). Never invents liquidity: if the book is too thin the result is
 * partial (`complete: false`) — the same rule as MIA's paper OMS (no fill without executable depth).
 */
export function walkBook(levels: Level[], shares: number, fee: FeeFn = () => 0, limitPrice?: number, side: 'buy' | 'sell' = 'buy'): Walk {
  let left = Math.max(0, shares); let filled = 0; let notional = 0; let feeSum = 0; let worst: number | null = null;
  for (const l of levels) {
    if (left <= EPS) break;
    if (limitPrice !== undefined && (side === 'buy' ? l.price > limitPrice + EPS : l.price < limitPrice - EPS)) break;
    const q = Math.min(left, l.size);
    filled += q; notional += q * l.price; feeSum += fee(q, l.price); left -= q; worst = l.price;
  }
  return { shares: round(filled, 6), avgPrice: filled > 0 ? round(notional / filled) : null, notional: round(notional, 6), fee: round(feeSum, 6), complete: left <= EPS, worstPrice: worst };
}

// ---- arbitrage --------------------------------------------------------------------------------------------------
export interface ArbResult {
  kind: 'BUY_BOTH' | 'MINT_AND_SELL' | 'MULTI_OUTCOME' | 'CROSS_VENUE';
  route: string; sets: number; costPerSet: number; payoutPerSet: number; edgePerSet: number; lockedProfit: number; fees: number;
  caveats: string[];
}
const ARB_CAVEATS = ['Prices move while legs execute; both legs must fill or the position is naked.', 'Hypothetical: computed from a snapshot of visible depth.'];

/**
 * Complete-set arbitrage inside one binary market, walked level by level:
 *  - BUY_BOTH: YES ask + NO ask + fees < 1 → one YES + one NO always pays exactly 1.
 *  - MINT_AND_SELL: YES bid + NO bid − fees > 1 → split 1 USDC into a YES+NO pair and sell both (Polymarket "split";
 *    needs an on-chain transaction, whose gas is not counted here).
 * Stops when the next pair no longer clears `minEdge` per set. Returns the better of the two, or null.
 */
export function completeSetArb(yes: Book, no: Book, fee: FeeFn, minEdge = 0.005, maxSets = 1e6): ArbResult | null {
  const run = (aLv: Level[], bLv: Level[], buy: boolean): ArbResult | null => {
    const a = aLv.map((l) => ({ ...l })); const b = bLv.map((l) => ({ ...l }));
    let i = 0; let j = 0; let sets = 0; let cash = 0; let fees = 0;
    while (i < a.length && j < b.length && sets < maxSets) {
      const pa = a[i].price; const pb = b[j].price;
      const per = buy ? pa + pb + fee(1, pa) + fee(1, pb) : pa + pb - fee(1, pa) - fee(1, pb);
      const edge = buy ? 1 - per : per - 1;
      if (edge < minEdge) break;
      const q = Math.min(a[i].size, b[j].size, maxSets - sets);
      sets += q; cash += q * (pa + pb); fees += fee(q, pa) + fee(q, pb);
      a[i].size -= q; b[j].size -= q; if (a[i].size <= EPS) i++; if (b[j].size <= EPS) j++;
    }
    if (sets <= EPS) return null;
    const costPerSet = buy ? (cash + fees) / sets : 1;
    const payoutPerSet = buy ? 1 : (cash - fees) / sets;
    return {
      kind: buy ? 'BUY_BOTH' : 'MINT_AND_SELL', route: buy ? 'buy YES + buy NO, hold to resolution' : 'split 1 → YES+NO, sell both',
      sets: round(sets, 4), costPerSet: round(costPerSet), payoutPerSet: round(payoutPerSet), edgePerSet: round(payoutPerSet - costPerSet),
      lockedProfit: round((payoutPerSet - costPerSet) * sets, 4), fees: round(fees, 6),
      caveats: buy ? ARB_CAVEATS : [...ARB_CAVEATS, 'Splitting needs an on-chain transaction; its gas cost is not included.'],
    };
  };
  const options = [run(yes.asks, no.asks, true), run(yes.bids, no.bids, false)].filter((r): r is ArbResult => !!r);
  return options.sort((x, y) => y.lockedProfit - x.lockedProfit)[0] ?? null;
}

/**
 * Mutually exclusive, exhaustive outcomes (e.g. a Polymarket negative-risk event): buying one YES of every outcome
 * pays exactly 1. Profitable when the sum of best YES asks plus fees is below 1 − minEdge. Sized by the thinnest
 * outcome's top level. The caller must confirm the outcome list is exhaustive ("Other" included).
 */
export function multiOutcomeArb(outcomes: { name: string; book: Book }[], fee: FeeFn, minEdge = 0.005): ArbResult | null {
  if (outcomes.length < 2) return null;
  const tops = outcomes.map((o) => o.book.asks[0]);
  if (tops.some((t) => !t)) return null;
  const cost = tops.reduce((s, t) => s + t!.price + fee(1, t!.price), 0);
  const edge = 1 - cost;
  if (edge < minEdge) return null;
  const sets = Math.min(...tops.map((t) => t!.size));
  return {
    kind: 'MULTI_OUTCOME', route: `buy YES on all ${outcomes.length} outcomes`, sets: round(sets, 4), costPerSet: round(cost), payoutPerSet: 1,
    edgePerSet: round(edge), lockedProfit: round(edge * sets, 4), fees: round(tops.reduce((s, t) => s + fee(sets, t!.price), 0), 6),
    caveats: [...ARB_CAVEATS, 'Only riskless if the outcomes are truly mutually exclusive AND exhaustive.'],
  };
}

/**
 * Cross-venue: YES on venue A + NO on venue B (or the reverse) for the SAME question. Pairing must come from an
 * explicit owner-confirmed link, never from matching titles: venues with different resolution rules turn a "hedge"
 * into two losing positions. Each venue's own fee function applies.
 */
export function crossVenueArb(a: { name: string; yes: Book; fee: FeeFn }, b: { name: string; yes: Book; fee: FeeFn }, minEdge = 0.01): ArbResult | null {
  const route = (yesV: typeof a, noV: typeof b) => {
    const ya = yesV.yes.asks; const na = mirror(noV.yes).asks;
    const sets: { q: number; cost: number; fee: number }[] = [];
    let i = 0; let j = 0; const A = ya.map((l) => ({ ...l })); const B = na.map((l) => ({ ...l }));
    while (i < A.length && j < B.length) {
      const fa = yesV.fee(1, A[i].price); const fb = noV.fee(1, B[j].price);
      const per = A[i].price + B[j].price + fa + fb;
      if (1 - per < minEdge) break;
      const q = Math.min(A[i].size, B[j].size);
      sets.push({ q, cost: q * (A[i].price + B[j].price), fee: yesV.fee(q, A[i].price) + noV.fee(q, B[j].price) });
      A[i].size -= q; B[j].size -= q; if (A[i].size <= EPS) i++; if (B[j].size <= EPS) j++;
    }
    const n = sets.reduce((s, x) => s + x.q, 0);
    if (n <= EPS) return null;
    const total = sets.reduce((s, x) => s + x.cost + x.fee, 0); const fees = sets.reduce((s, x) => s + x.fee, 0);
    return {
      kind: 'CROSS_VENUE' as const, route: `YES on ${yesV.name}, NO on ${noV.name}`, sets: round(n, 4), costPerSet: round(total / n), payoutPerSet: 1,
      edgePerSet: round(1 - total / n), lockedProfit: round(n - total, 4), fees: round(fees, 6),
      caveats: [...ARB_CAVEATS, 'Both venues must resolve the question identically (same source, same deadline). Check the rules.'],
    };
  };
  const found: ArbResult[] = [];
  for (const r of [route(a, b), route(b, a)]) if (r) found.push(r);
  return found.sort((x, y) => y.lockedProfit - x.lockedProfit)[0] ?? null;
}

// ---- liquidity rewards ------------------------------------------------------------------------------------------
/**
 * Polymarket liquidity-reward score (docs.polymarket.com, "Liquidity rewards"):
 *   S(v, s) = ((v − s) / v)²  for an order s cents from the midpoint, v = the market's max reward spread (cents);
 *   Q_one = Σ S·size over bid-side orders, Q_two over ask-side orders (orders under the minimum size score 0);
 *   if 0.10 ≤ mid ≤ 0.90: Q_min = max(min(Q_one, Q_two), max(Q_one/c, Q_two/c)), c = 3 (one-sided earns a third);
 *   otherwise both sides are required: Q_min = min(Q_one, Q_two).
 * The program rewards Q_min relative to everyone else's; `share` estimates that against the visible book.
 */
export function rewardScore(o: { mid: number; maxSpreadCents: number; minSize: number; bids: Level[]; asks: Level[]; c?: number }) {
  const v = o.maxSpreadCents; const c = o.c ?? 3;
  const s = (l: Level) => {
    const dist = Math.abs(l.price - o.mid) * 100;
    return v > 0 && dist < v && l.size >= o.minSize ? ((v - dist) / v) ** 2 * l.size : 0;
  };
  const qOne = o.bids.reduce((t, l) => t + s(l), 0); const qTwo = o.asks.reduce((t, l) => t + s(l), 0);
  const inBand = o.mid >= 0.1 && o.mid <= 0.9;
  const qMin = inBand ? Math.max(Math.min(qOne, qTwo), Math.max(qOne / c, qTwo / c)) : Math.min(qOne, qTwo);
  return { qOne: round(qOne, 4), qTwo: round(qTwo, 4), qMin: round(qMin, 4), twoSidedRequired: !inBand };
}
/** Estimated share of the market's reward pool for a hypothetical quote, competing with the visible book. */
export function rewardShare(o: { mid: number; maxSpreadCents: number; minSize: number; book: Book; mine: { bids: Level[]; asks: Level[] }; dailyRewardUsd?: number }) {
  const mine = rewardScore({ ...o, bids: o.mine.bids, asks: o.mine.asks });
  const others = rewardScore({ ...o, bids: o.book.bids, asks: o.book.asks });
  const share = mine.qMin + others.qMin > 0 ? mine.qMin / (mine.qMin + others.qMin) : 0;
  return { mine, others, share: round(share, 4), estDailyUsd: o.dailyRewardUsd === undefined ? null : round(share * o.dailyRewardUsd, 2),
    note: 'Estimate against the visible book only; real scoring samples every minute and counts every participant.' };
}

// ---- fill risk for a resting quote --------------------------------------------------------------------------------
export type FillRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
/**
 * How likely a resting order is to be hit soon: distance behind the touch (ticks), size queued ahead of it at
 * better-or-equal prices, and recent taker flow against it. A passive liquidity provider widens when HIGH.
 */
export function fillRisk(o: { book: Book; side: 'BUY' | 'SELL'; price: number; recentAgainstUsd?: number; queueUsdThreshold?: number }) {
  const same = o.side === 'BUY' ? o.book.bids : o.book.asks;
  const touch = same[0]?.price;
  const ticksBehind = touch === undefined ? null : Math.max(0, Math.round(((o.side === 'BUY' ? touch - o.price : o.price - touch)) / o.book.tick));
  const aheadUsd = same.filter((l) => (o.side === 'BUY' ? l.price >= o.price - EPS : l.price <= o.price + EPS)).reduce((s, l) => s + l.size * l.price, 0);
  const threshold = o.queueUsdThreshold ?? 500;
  let score = 0;
  if (ticksBehind === null || ticksBehind === 0) score += 2; else if (ticksBehind === 1) score += 1;
  if (aheadUsd < threshold) score += 1;
  if ((o.recentAgainstUsd ?? 0) > threshold) score += 1;
  const level: FillRiskLevel = score >= 3 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';
  return { level, score, ticksBehind, queueAheadUsd: round(aheadUsd, 2), suggestWidenTicks: level === 'HIGH' ? 2 : level === 'MEDIUM' ? 1 : 0 };
}

// ---- model fair value for short crypto "up/down" rounds -------------------------------------------------------------
/** Standard normal CDF (Abramowitz–Stegun 7.1.26; |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
/**
 * Probability the price ends above `strike` under a driftless lognormal model with volatility per √second.
 * A MODEL value for comparison with the book, not a calibrated probability.
 */
export function digitalUp(spot: number, strike: number, volPerRootSec: number, secsLeft: number): number {
  if (secsLeft <= 0 || volPerRootSec <= 0) return spot > strike ? 1 : spot < strike ? 0 : 0.5;
  const sd = volPerRootSec * Math.sqrt(secsLeft);
  return normalCdf(Math.log(spot / strike) / sd - sd / 2);
}
/** Exponentially weighted volatility of log returns per √second (time-aware: irregular samples are handled). */
export function ewmaVol(samples: { t: number; price: number }[], halfLifeSecs = 300): { vol: number; n: number } {
  let v = 0; let n = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt <= 0 || samples[i].price <= 0 || samples[i - 1].price <= 0) continue;
    const r2 = Math.log(samples[i].price / samples[i - 1].price) ** 2 / dt;
    const w = 1 - 0.5 ** (dt / halfLifeSecs);
    v = n === 0 ? r2 : v + w * (r2 - v); n++;
  }
  return { vol: Math.sqrt(v), n };
}

// ---- sizing (hypothetical) ----------------------------------------------------------------------------------------
/**
 * Fractional Kelly stake (fraction of bankroll) for buying YES at `price` when YOUR estimate is `belief`:
 * f* = (belief − price) / (1 − price), scaled by `fraction` and capped. Zero when there is no edge after fees.
 * The belief is the owner's input, not something MIA has calibrated.
 */
export function fractionalKelly(belief: number, price: number, o: { fraction?: number; cap?: number; feePerShare?: number } = {}) {
  const fraction = o.fraction ?? 0.25; const cap = o.cap ?? 0.05;
  const cost = price + (o.feePerShare ?? 0);
  if (!(belief > 0 && belief < 1 && cost > 0 && cost < 1) || belief <= cost) return { full: 0, stake: 0, edge: round(belief - cost) };
  const full = (belief - cost) / (1 - cost);
  return { full: round(full, 4), stake: round(Math.min(full * fraction, cap), 4), edge: round(belief - cost) };
}
