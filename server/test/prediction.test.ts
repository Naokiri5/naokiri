import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { config } from '../src/config.js';
import { failureGate } from '../src/core/ratelimit.js';
import { _resetProviderBlocks } from '../src/providers/http.js';
import * as an from '../src/prediction/analytics.js';
import * as v from '../src/prediction/venues.js';
import { replay } from '../src/prediction/backtest.js';

/** Prediction-market research, offline: synthetic books and stubbed venue replies shaped like the public APIs. */
const book = (bids: [number, number][], asks: [number, number][], tick = 0.01) =>
  an.normaliseBook({ bids: bids.map(([price, size]) => ({ price, size })), asks: asks.map(([price, size]) => ({ price, size })), tick });
const free: an.FeeFn = () => 0;

describe('fees', () => {
  it('Polymarket taker fee = shares × rate × p × (1 − p); fee-free markets cost nothing', () => {
    expect(an.polymarketTakerFee(100, 0.5, 100)).toBeCloseTo(0.25, 10);
    expect(an.polymarketTakerFee(100, 0.9, 100)).toBeCloseTo(0.09, 10);
    expect(an.polymarketTakerFee(100, 0.5, 0)).toBe(0);
  });
  it('Kalshi taker fee rounds UP to the next cent per order', () => {
    expect(an.kalshiTakerFee(100, 0.5)).toBe(1.75);
    expect(an.kalshiTakerFee(1, 0.5)).toBe(0.02); // 0.0175 → 0.02
    expect(an.kalshiTakerFee(0, 0.5)).toBe(0);
  });
});

describe('order books', () => {
  it('normalises untrusted levels: drops prices outside (0,1) and empty sizes, merges duplicates, sorts', () => {
    const b = book([[0.4, 10], [0.45, 5], [0.45, 5], [1.2, 9], [0.3, 0]], [[0.6, 3], [0.55, 4], [-1, 2]]);
    expect(b.bids).toEqual([{ price: 0.45, size: 10 }, { price: 0.4, size: 10 }]);
    expect(b.asks).toEqual([{ price: 0.55, size: 4 }, { price: 0.6, size: 3 }]);
  });
  it('mirrors YES into NO (bid p ↔ ask 1 − p) and computes top-of-book statistics', () => {
    const b = book([[0.48, 300], [0.47, 100]], [[0.52, 100]]);
    expect(an.mirror(b).asks[0]).toEqual({ price: 0.52, size: 300 });
    const s = an.bookStats(b);
    expect(s).toMatchObject({ bestBid: 0.48, bestAsk: 0.52, mid: 0.5, spread: 0.04, spreadTicks: 4, bidDepth: 400, askDepth: 100, imbalance: 0.6 });
    expect(s.microprice).toBeCloseTo(0.51, 6); // leans to the thin ask side
  });
  it('a taker walk never invents depth: a thin book gives a partial fill', () => {
    const w = an.walkBook(book([], [[0.5, 10], [0.55, 10]]).asks, 50);
    expect(w).toMatchObject({ shares: 20, complete: false, worstPrice: 0.55 });
    expect(w.avgPrice).toBeCloseTo(0.525, 6);
    expect(an.walkBook(book([], [[0.5, 10], [0.55, 10]]).asks, 50, free, 0.5).shares).toBe(10); // limit price respected
  });
});

describe('arbitrage', () => {
  it('BUY_BOTH: YES ask + NO ask < 1 locks a profit, sized level by level until the gap closes', () => {
    const yes = book([[0.44, 100]], [[0.45, 100], [0.5, 100]]); const no = book([[0.5, 50]], [[0.5, 60], [0.53, 100]]);
    const r = an.completeSetArb(yes, no, free, 0.01)!;
    expect(r.kind).toBe('BUY_BOTH');
    expect(r.sets).toBe(100); // 60 @ 0.95, then 40 @ 0.98; 0.50+0.53 = 1.03 stops
    expect(r.lockedProfit).toBeCloseTo(60 * 0.05 + 40 * 0.02, 6);
  });
  it('fees can remove an apparent gap', () => {
    const yes = book([], [[0.49, 100]]); const no = book([], [[0.495, 100]]);
    expect(an.completeSetArb(yes, no, free, 0.01)).not.toBeNull();
    expect(an.completeSetArb(yes, no, (q, p) => an.polymarketTakerFee(q, p, 300), 0.01)).toBeNull();
  });
  it('MINT_AND_SELL: YES bid + NO bid > 1 (split then sell both), flagged as needing an on-chain split', () => {
    const r = an.completeSetArb(book([[0.56, 40]], [[0.6, 1]]), book([[0.47, 30]], [[0.5, 1]]), free, 0.01)!;
    expect(r.kind).toBe('MINT_AND_SELL'); expect(r.sets).toBe(30); expect(r.edgePerSet).toBeCloseTo(0.03, 6);
    expect(r.caveats.join(' ')).toMatch(/on-chain/);
  });
  it('multi-outcome: buying every outcome below 1 total; requires an exhaustive list', () => {
    const r = an.multiOutcomeArb([{ name: 'A', book: book([], [[0.3, 50]]) }, { name: 'B', book: book([], [[0.32, 20]]) }, { name: 'C', book: book([], [[0.33, 90]]) }], free)!;
    expect(r).toMatchObject({ kind: 'MULTI_OUTCOME', sets: 20 }); expect(r.edgePerSet).toBeCloseTo(0.05, 6);
    expect(r.caveats.join(' ')).toMatch(/exhaustive/);
    expect(an.multiOutcomeArb([{ name: 'A', book: book([], [[0.5, 5]]) }, { name: 'B', book: book([], [[0.5, 5]]) }], free)).toBeNull();
  });
  it('cross-venue: finds the cheaper direction and always warns about resolution rules', () => {
    const a = { name: 'A', yes: book([[0.6, 100]], [[0.62, 100]]), fee: free };
    const b = { name: 'B', yes: book([[0.7, 100]], [[0.72, 100]]), fee: free };
    const r = an.crossVenueArb(a, b, 0.01)!;
    expect(r.route).toBe('YES on A, NO on B'); // 0.62 + (1 − 0.70) = 0.92
    expect(r.edgePerSet).toBeCloseTo(0.08, 6);
    expect(r.caveats.join(' ')).toMatch(/resolve the question identically/);
  });
});

describe('liquidity rewards and quoting risk', () => {
  it('scores ((v − s)/v)² × size; one-sided earns a third inside 0.10–0.90 and nothing outside', () => {
    const r = an.rewardScore({ mid: 0.5, maxSpreadCents: 3, minSize: 50, bids: [{ price: 0.49, size: 100 }], asks: [] });
    expect(r.qOne).toBeCloseTo(44.4444, 3); expect(r.qMin).toBeCloseTo(14.8148, 3);
    expect(an.rewardScore({ mid: 0.95, maxSpreadCents: 3, minSize: 50, bids: [{ price: 0.94, size: 100 }], asks: [] }).qMin).toBe(0);
    expect(an.rewardScore({ mid: 0.5, maxSpreadCents: 3, minSize: 50, bids: [{ price: 0.46, size: 100 }], asks: [] }).qOne).toBe(0); // outside the band
    expect(an.rewardScore({ mid: 0.5, maxSpreadCents: 3, minSize: 50, bids: [{ price: 0.49, size: 10 }], asks: [] }).qOne).toBe(0); // under min size
  });
  it('estimates the share of the reward pool against the visible book', () => {
    const b = book([[0.49, 100]], [[0.51, 100]]);
    const r = an.rewardShare({ mid: 0.5, maxSpreadCents: 3, minSize: 10, book: b, mine: { bids: [{ price: 0.49, size: 100 }], asks: [{ price: 0.51, size: 100 }] }, dailyRewardUsd: 100 });
    expect(r.share).toBeCloseTo(0.5, 6); expect(r.estDailyUsd).toBe(50);
  });
  it('fill risk is HIGH at the touch with little queue ahead, LOW well behind it', () => {
    const b = book([[0.5, 10], [0.45, 5000]], [[0.52, 10]]);
    expect(an.fillRisk({ book: b, side: 'BUY', price: 0.5 }).level).toBe('HIGH');
    expect(an.fillRisk({ book: b, side: 'BUY', price: 0.44 })).toMatchObject({ level: 'LOW', ticksBehind: 6 });
  });
});

describe('model value and sizing (hypothetical)', () => {
  it('normal CDF and the driftless digital match known values', () => {
    expect(an.normalCdf(0)).toBeCloseTo(0.5, 6); expect(an.normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(an.digitalUp(100, 100, 0.001, 300)).toBeLessThan(0.5); // ATM is slightly below 0.5 (−σ√t/2 drift term)
    expect(an.digitalUp(110, 100, 0.0005, 60)).toBeGreaterThan(0.99);
    expect(an.digitalUp(99, 100, 0.01, 0)).toBe(0);
  });
  it('EWMA volatility is positive for a moving series and zero for a flat one', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ t: i * 1000, price: 100 * (1 + 0.001 * Math.sin(i)) }));
    expect(an.ewmaVol(pts).vol).toBeGreaterThan(0);
    expect(an.ewmaVol(pts.map((p) => ({ ...p, price: 100 }))).vol).toBe(0);
  });
  it('fractional Kelly: (b − p)/(1 − p) scaled and capped; zero without an edge after fees', () => {
    expect(an.fractionalKelly(0.6, 0.5)).toMatchObject({ full: 0.2, stake: 0.05 });
    expect(an.fractionalKelly(0.6, 0.5, { fraction: 0.1, cap: 1 }).stake).toBeCloseTo(0.02, 6);
    expect(an.fractionalKelly(0.5, 0.5).stake).toBe(0);
    expect(an.fractionalKelly(0.52, 0.5, { feePerShare: 0.03 }).stake).toBe(0);
  });
});

describe('book replay (conservative fills)', () => {
  const snap = (t: number, bid: number, ask: number, size = 100) => ({ t, bids: [{ price: bid, size }], asks: [{ price: ask, size }] });
  it('a resting quote fills only when the next snapshot trades THROUGH it, never at an equal price', () => {
    const equal = replay({ snapshots: [snap(1, 0.48, 0.52), snap(2, 0.47, 0.49)], strategy: { type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 50 } });
    expect(equal.fillCount).toBe(0); // our bid was 0.49; the ask came down TO 0.49, not through it
    const through = replay({ snapshots: [snap(1, 0.48, 0.52), snap(2, 0.46, 0.48)], strategy: { type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 50 } });
    expect(through.fills[0]).toMatchObject({ side: 'BUY', price: 0.49, shares: 10, liquidity: 'MAKER', fee: 0 });
  });
  it('never sells short and settles inventory at the given resolution', () => {
    const r = replay({ resolution: 1, snapshots: [snap(1, 0.48, 0.52), snap(2, 0.46, 0.48), snap(3, 0.47, 0.49)], strategy: { type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 50 } });
    expect(r.fills.every((f) => f.side === 'BUY')).toBe(true);
    expect(r.finalInventory).toBe(10); expect(r.pnl).toBeCloseTo(10 * (1 - 0.49), 6);
    expect(r).toMatchObject({ kind: 'HYPOTHETICAL', tradeEligible: false });
  });
  it('the taker strategy buys below fair minus edge, pays the taker fee and uses visible depth only', () => {
    const r = replay({ feeRateBps: 100, snapshots: [snap(1, 0.38, 0.4, 5), snap(2, 0.62, 0.64)], strategy: { type: 'threshold_taker', fair: 0.5, edge: 0.05, size: 20, maxInventory: 20 } });
    expect(r.fills[0]).toMatchObject({ side: 'BUY', shares: 5, liquidity: 'TAKER' }); // only 5 visible
    expect(r.fills[0].fee).toBeCloseTo(an.polymarketTakerFee(5, 0.4, 100), 9);
    expect(r.fills[1]).toMatchObject({ side: 'SELL', shares: 5 });
  });
});

describe('venue parsing (untrusted replies)', () => {
  const gamma = { id: '512345', question: 'Will it rain in Paris on Friday?', slug: 'rain-paris', endDate: '2026-12-01T00:00:00Z', outcomes: '["Yes","No"]',
    outcomePrices: '["0.43","0.57"]', clobTokenIds: '["1111111111","2222222222"]', volume24hr: 12345.6, liquidityNum: 50000, bestBid: 0.42, bestAsk: 0.44,
    orderPriceMinTickSize: 0.01, negRisk: false, rewardsMaxSpread: 3, rewardsMinSize: 50, clobRewards: [{ rewardsDailyRate: 25 }] };
  it('Polymarket: JSON-string arrays, rewards and tick parsed; bad token ids and garbage rejected', () => {
    const m = v.normaliseGammaMarket(gamma)!;
    expect(m).toMatchObject({ venue: 'polymarket', id: '512345', tick: 0.01, rewards: { maxSpreadCents: 3, minSize: 50, dailyRateUsd: 25 } });
    expect(m.outcomes).toEqual([{ name: 'Yes', price: 0.43, tokenId: '1111111111' }, { name: 'No', price: 0.57, tokenId: '2222222222' }]);
    expect(v.normaliseGammaMarket({ ...gamma, clobTokenIds: '["../../x","2"]' })!.outcomes[0].tokenId).toBeNull();
    expect(v.normaliseGammaMarket({ question: 'no id' })).toBeNull(); expect(v.normaliseGammaMarket('x')).toBeNull();
  });
  it('Kalshi: dollar strings and legacy cents both become 0–1; invalid tickers rejected', () => {
    expect(v.normaliseKalshiMarket({ ticker: 'KXRAIN-26DEC01', title: 'Rain?', yes_bid_dollars: '0.41', yes_ask_dollars: '0.44' })).toMatchObject({ bestBid: 0.41, bestAsk: 0.44 });
    expect(v.normaliseKalshiMarket({ ticker: 'KXRAIN-26DEC01', title: 'Rain?', yes_bid: 41, yes_ask: 44 })).toMatchObject({ bestBid: 0.41, bestAsk: 0.44 });
    expect(v.normaliseKalshiMarket({ ticker: 'bad ticker!', title: 'x' })).toBeNull();
  });
  it('Kalshi books: NO bids become YES asks, in both the current and the legacy format', () => {
    const cur = v.normaliseKalshiBook({ orderbook_fp: { yes_dollars: [['0.40', '100']], no_dollars: [['0.55', '80']] } });
    const old = v.normaliseKalshiBook({ orderbook: { yes: [[40, 100]], no: [[55, 80]] } });
    for (const b of [cur, old]) { expect(b.bids[0]).toEqual({ price: 0.4, size: 100 }); expect(b.asks[0]).toEqual({ price: 0.45, size: 80 }); }
  });
});

describe('prediction routes', () => {
  const realFetch = globalThis.fetch; const flags = { offline: config.offline };
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let calls: string[] = [];
  const H = () => ({ cookie, 'content-type': 'application/json', 'x-mia-csrf': '1' });
  const stub = (route: (u: string) => unknown) => { calls = []; globalThis.fetch = (async (u: any) => { calls.push(String(u)); return new Response(JSON.stringify(route(String(u))), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch; };
  const gammaMarket = { id: '512345', question: 'Will it rain?', slug: 'rain', outcomes: '["Yes","No"]', outcomePrices: '["0.45","0.5"]', clobTokenIds: '["1111111111","2222222222"]', orderPriceMinTickSize: 0.01, rewardsMaxSpread: 3, rewardsMinSize: 50 };
  beforeAll(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('prediction route owner') })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); });
  afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, flags); _resetProviderBlocks(); });

  it('require an owner session and validate input strictly', async () => {
    expect((await app.inject({ url: '/api/research/prediction/markets' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/research/prediction/markets?venue=ftx', headers: H() })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/research/prediction/analyze?venue=polymarket&id=12&extra=1', headers: H() })).statusCode).toBe(400);
  });
  it('analyse a Polymarket market from public reads only: labelled research, arbitrage and reward estimate included', async () => {
    Object.assign(config, { offline: false });
    stub((u) => u.includes('/markets/512345') ? gammaMarket
      : u.includes('token_id=1111111111') ? { bids: [{ price: '0.44', size: '200' }], asks: [{ price: '0.45', size: '100' }] }
      : { bids: [{ price: '0.49', size: '200' }], asks: [{ price: '0.5', size: '100' }] });
    const r = await app.inject({ url: '/api/research/prediction/analyze?venue=polymarket&id=512345', headers: H() });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ kind: 'RESEARCH_ONLY', tradeEligible: false, data: { arbitrage: { kind: 'BUY_BOTH', sets: 100 }, rewards: { quote: { size: 50 } } } });
    expect(j.caveats.join(' ')).toMatch(/fee rate unknown/);
    expect(calls.every((u) => /^https:\/\/(gamma-api|clob)\.polymarket\.com\//.test(u))).toBe(true);
  });
  it('analyse a Kalshi market with Kalshi fees', async () => {
    Object.assign(config, { offline: false });
    stub((u) => u.includes('/orderbook') ? { orderbook_fp: { yes_dollars: [['0.40', '100']], no_dollars: [['0.58', '100']] } } : { markets: [{ ticker: 'KXRAIN-26DEC01', title: 'Rain?' }] });
    const j = (await app.inject({ url: '/api/research/prediction/analyze?venue=kalshi&id=KXRAIN-26DEC01', headers: H() })).json();
    expect(j.data.stats).toMatchObject({ bestBid: 0.4, bestAsk: 0.42 }); expect(j.data.feeBps).toBeNull();
  });
  it('cross-venue analysis requires explicit confirmation that both markets resolve the same question', async () => {
    const body = { a: { venue: 'polymarket', id: '512345' }, b: { venue: 'kalshi', id: 'KXRAIN-26DEC01' } };
    const r = await app.inject({ method: 'POST', url: '/api/research/prediction/cross-venue', headers: H(), payload: body });
    expect(r.statusCode).toBe(400); expect(r.json().error).toMatch(/SAME question/);
  });
  it('backtest and calculators validate input and label results hypothetical', async () => {
    const snaps = [{ t: 1, bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 100 }] }, { t: 2, bids: [{ price: 0.46, size: 100 }], asks: [{ price: 0.48, size: 100 }] }];
    const ok = await app.inject({ method: 'POST', url: '/api/research/prediction/backtest', headers: H(), payload: { snapshots: snaps, strategy: { type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 50 } } });
    expect(ok.json()).toMatchObject({ kind: 'RESEARCH_ONLY', data: { kind: 'HYPOTHETICAL', fillCount: 1 } });
    expect((await app.inject({ method: 'POST', url: '/api/research/prediction/backtest', headers: H(), payload: { snapshots: [{ t: 1, bids: [{ price: 1.5, size: 1 }], asks: [] }, snaps[1]], strategy: { type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 50 } } })).statusCode).toBe(400);
    const k = await app.inject({ method: 'POST', url: '/api/research/prediction/calc', headers: H(), payload: { kind: 'kelly', belief: 0.6, price: 0.5 } });
    expect(k.json()).toMatchObject({ data: { stake: 0.05 } }); expect(k.json().caveats[0]).toMatch(/YOUR belief/);
  });
  it('offline mode sends nothing to the venues', async () => {
    stub(() => ({}));
    expect((await app.inject({ url: '/api/research/prediction/markets?venue=polymarket', headers: H() })).statusCode).toBeGreaterThanOrEqual(500);
    expect(calls).toHaveLength(0);
  });
  it('static guard: the prediction module has no order, signing, wallet or key handling', () => {
    const dir = new URL('../src/prediction/', import.meta.url);
    const src = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/private[_ ]?key|privateKey|mnemonic|signTypedData|eip712|\/order\b|postOrder|createOrder|approve\(|setApprovalForAll|withdraw|POLY_API_KEY/i);
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|DELETE)['"]/); // venue reads are GET only
  });
});
