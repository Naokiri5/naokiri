/**
 * Owner-authenticated prediction-market research routes (session + CSRF gate applies). Every answer is labelled
 * RESEARCH_ONLY / tradeEligible:false. There is no order route: MIA never trades prediction markets.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as an from './analytics.js';
import * as v from './venues.js';
import { replay } from './backtest.js';

const envelope = <T>(source: string, data: T, caveats: string[] = []) => ({
  source, kind: 'RESEARCH_ONLY' as const, tradeEligible: false as const, asOf: Date.now(), caveats, data,
});
const VENUE = z.enum(['polymarket', 'kalshi']);
const ID = z.string().trim().min(1).max(100);

/** The venue's taker fee function and a caveat when the rate had to be assumed. */
function feeFor(m: v.PmMarket, overrideBps?: number): { fee: an.FeeFn; caveat: string | null; bps: number | null } {
  if (m.venue === 'kalshi') return { fee: (q, p) => an.kalshiTakerFee(q, p), caveat: null, bps: null };
  const bps = overrideBps ?? m.takerFeeBps;
  return { fee: (q, p) => an.polymarketTakerFee(q, p, bps ?? 0), caveat: bps === null || bps === undefined ? 'Polymarket fee rate unknown for this market: computed fee-free. Pass feeBps to include it.' : null, bps: bps ?? null };
}

/** Market + YES/NO books for one venue market. */
async function load(venue: v.Venue, id: string) {
  if (venue === 'kalshi') {
    const ticker = id.toUpperCase();
    const [list, yes] = await Promise.all([v.kalshiMarkets({ query: ticker, limit: 5 }), v.kalshiBook(ticker)]);
    const market = list.find((m) => m.id === ticker) ?? v.normaliseKalshiMarket({ ticker, title: ticker })!;
    return { market, yes, no: an.mirror(yes) };
  }
  const market = await v.polymarketMarket(id);
  const [yesTok, noTok] = market.outcomes.map((o) => o.tokenId);
  if (market.outcomes.length !== 2 || !yesTok || !noTok) throw Object.assign(new Error('only binary Polymarket markets with two outcome tokens can be analysed here'), { statusCode: 422 });
  const [yes, no] = await Promise.all([v.polymarketBook(yesTok, market.tick), v.polymarketBook(noTok, market.tick)]);
  return { market, yes, no };
}

function analyse(market: v.PmMarket, yes: an.Book, no: an.Book, feeBps?: number) {
  const { fee, caveat, bps } = feeFor(market, feeBps);
  const stats = an.bookStats(yes, 5);
  const arb = an.completeSetArb(yes, no, fee);
  let rewards = null;
  if (market.rewards && stats.mid !== null) {
    // A hypothetical two-sided quote one tick inside the reward band at the minimum size.
    const h = Math.max(yes.tick, Math.min(market.rewards.maxSpreadCents / 100 - yes.tick, 2 * yes.tick));
    const size = Math.max(market.rewards.minSize, 1);
    const mine = { bids: [{ price: stats.mid - h, size }], asks: [{ price: stats.mid + h, size }] };
    rewards = { quote: { bid: +(stats.mid - h).toFixed(4), ask: +(stats.mid + h).toFixed(4), size },
      ...an.rewardShare({ mid: stats.mid, maxSpreadCents: market.rewards.maxSpreadCents, minSize: market.rewards.minSize, book: yes, mine, dailyRewardUsd: market.rewards.dailyRateUsd ?? undefined }),
      fillRisk: { bid: an.fillRisk({ book: yes, side: 'BUY', price: stats.mid - h }), ask: an.fillRisk({ book: yes, side: 'SELL', price: stats.mid + h }) } };
  }
  return { market, feeBps: bps, stats, noStats: an.bookStats(no, 5), arbitrage: arb, rewards, caveats: caveat ? [caveat] : [] };
}

export async function predictionRoutes(app: FastifyInstance) {
  app.get('/api/research/prediction/markets', async (req) => {
    const q = z.object({ venue: VENUE.default('polymarket'), query: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(req.query);
    const markets = q.venue === 'kalshi' ? await v.kalshiMarkets(q) : await v.polymarketMarkets(q);
    return envelope(q.venue, markets, ['Market text comes from the venue and is shown as data only.']);
  });

  app.get('/api/research/prediction/analyze', async (req) => {
    const q = z.object({ venue: VENUE, id: ID, feeBps: z.coerce.number().min(0).max(1000).optional() }).strict().parse(req.query);
    const { market, yes, no } = await load(q.venue, q.id);
    const a = analyse(market, yes, no, q.feeBps);
    return envelope(q.venue, { ...a, books: { yes: { bids: yes.bids.slice(0, 15), asks: yes.asks.slice(0, 15), tick: yes.tick } } }, a.caveats);
  });

  /** Complete-set arbitrage scan over the most active Polymarket binary markets (bounded: ≤ 10 markets, 20 book reads). */
  app.get('/api/research/prediction/scan', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(10).default(8), minEdge: z.coerce.number().min(0).max(0.5).default(0.005), feeBps: z.coerce.number().min(0).max(1000).optional() }).strict().parse(req.query);
    const markets = (await v.polymarketMarkets({ limit: 40 })).filter((m) => m.outcomes.length === 2 && m.outcomes.every((o) => o.tokenId)).slice(0, q.limit);
    const rows = [];
    for (const m of markets) {
      try {
        const [yes, no] = await Promise.all([v.polymarketBook(m.outcomes[0].tokenId!, m.tick), v.polymarketBook(m.outcomes[1].tokenId!, m.tick)]);
        const { fee } = feeFor(m, q.feeBps);
        rows.push({ id: m.id, question: m.question, stats: an.bookStats(yes), arbitrage: an.completeSetArb(yes, no, fee, q.minEdge) });
      } catch (e) { rows.push({ id: m.id, question: m.question, error: (e as Error).message.slice(0, 120) }); }
    }
    return envelope('polymarket', { scanned: rows.length, opportunities: rows.filter((r) => 'arbitrage' in r && r.arbitrage).length, rows },
      ['A gap that survives fees is rare and short-lived; it is evidence to look at, not an instruction.']);
  });

  app.post('/api/research/prediction/cross-venue', async (req) => {
    const leg = z.object({ venue: VENUE, id: ID }).strict();
    const b = z.object({ a: leg, b: leg, minEdge: z.number().min(0).max(0.5).default(0.01), feeBps: z.number().min(0).max(1000).optional(),
      confirmSameQuestion: z.literal(true, { message: 'confirm both markets resolve the SAME question by the same rules' }) }).strict().parse(req.body);
    const [A, B] = await Promise.all([load(b.a.venue, b.a.id), load(b.b.venue, b.b.id)]);
    const fa = feeFor(A.market, b.feeBps); const fb = feeFor(B.market, b.feeBps);
    const result = an.crossVenueArb({ name: `${b.a.venue}:${A.market.id}`, yes: A.yes, fee: fa.fee }, { name: `${b.b.venue}:${B.market.id}`, yes: B.yes, fee: fb.fee }, b.minEdge);
    return envelope('cross-venue', { a: A.market, b: B.market, arbitrage: result }, [fa.caveat, fb.caveat].filter((x): x is string => !!x));
  });

  const level = z.object({ price: z.number().gt(0).lt(1), size: z.number().positive().max(1e9) }).strict();
  app.post('/api/research/prediction/backtest', async (req) => {
    const b = z.object({
      snapshots: z.array(z.object({ t: z.number().int().nonnegative(), bids: z.array(level).max(50), asks: z.array(level).max(50) }).strict()).min(2).max(5000),
      tick: z.number().positive().max(0.1).optional(), feeRateBps: z.number().min(0).max(1000).optional(), resolution: z.union([z.literal(0), z.literal(1)]).optional(),
      strategy: z.discriminatedUnion('type', [
        z.object({ type: z.literal('passive_quote'), halfSpreadTicks: z.number().int().min(1).max(50), size: z.number().positive().max(1e6), maxInventory: z.number().positive().max(1e7) }).strict(),
        z.object({ type: z.literal('threshold_taker'), fair: z.union([z.number().gt(0).lt(1), z.array(z.number().gt(0).lt(1)).min(1).max(5000)]), edge: z.number().min(0).max(0.5), size: z.number().positive().max(1e6), maxInventory: z.number().positive().max(1e7) }).strict(),
      ]),
    }).strict().parse(req.body);
    return envelope('replay', replay(b));
  });

  app.post('/api/research/prediction/calc', async (req) => {
    const p01 = z.number().gt(0).lt(1);
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('kelly'), belief: p01, price: p01, fraction: z.number().gt(0).max(1).optional(), cap: z.number().gt(0).max(1).optional(), feePerShare: z.number().min(0).max(0.5).optional() }).strict(),
      z.object({ kind: z.literal('digital'), spot: z.number().positive(), strike: z.number().positive(), volPerRootSec: z.number().min(0).max(1), secsLeft: z.number().min(0).max(3.2e7) }).strict(),
      z.object({ kind: z.literal('fee'), venue: VENUE, shares: z.number().positive().max(1e9), price: p01, feeBps: z.number().min(0).max(1000).optional() }).strict(),
    ]).parse(req.body);
    if (b.kind === 'kelly') return envelope('calc', an.fractionalKelly(b.belief, b.price, b), ['Uses YOUR belief; MIA has not calibrated it. Hypothetical sizing only.']);
    if (b.kind === 'digital') return envelope('calc', { probabilityUp: an.digitalUp(b.spot, b.strike, b.volPerRootSec, b.secsLeft) }, ['Driftless lognormal model value, not a calibrated probability.']);
    return envelope('calc', { fee: b.venue === 'kalshi' ? an.kalshiTakerFee(b.shares, b.price) : an.polymarketTakerFee(b.shares, b.price, b.feeBps ?? 0) });
  });
}
