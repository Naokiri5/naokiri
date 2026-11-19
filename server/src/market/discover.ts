import { market } from './store.js';
import { isEligibleSpot } from './fabric.js';
import { assessCexAsset, assessDexPair } from '../safety/safety.js';
import { classifyRegime } from '../regime/regime.js';
import { rankSolanaPairs } from '../solana/hunting.js';

/** Asset Discovery (Part 10 "Discover"): ranked lists drawn only from live feeds. */
/** Solana watchlist freshness: DEX Screener cache older than this, missing, or future-dated (clock jump) is stale. */
const SOLANA_HUNTER_MAX_AGE_MS = 5 * 60_000;

export function discover(minVolume = 1_000_000, nowMs = Date.now()) {
  const rows = [...market.tickers.values()].filter((t) => isEligibleSpot(t.base, t.quote) && t.quoteVolume >= minVolume);
  const row = (t: typeof rows[0]) => {
    const cg = market.cg.get(t.base); const d = market.deep.get(t.instrumentId);
    return { instrumentId: t.instrumentId, symbol: t.symbol, base: t.base, price: t.last, changePct: t.changePct, quoteVolume: t.quoteVolume, trades: t.trades,
      marketCap: cg?.marketCap ?? null, rank: cg?.rank ?? null, name: cg?.name ?? null, deep: !!d,
      relVol1h: d?.engines['1h'].last?.relVol20 ?? null, regime: d ? classifyRegime(d.engines['1h'].last).regime : null, safety: d ? assessCexAsset(t.instrumentId).status : null };
  };
  const sorted = (f: (a: any, b: any) => number, n = 25) => rows.map(row).sort(f).slice(0, n);
  const deepRows = rows.filter((t) => market.deep.has(t.instrumentId)).map(row);
  return {
    volumeLeaders: sorted((a, b) => b.quoteVolume - a.quoteVolume),
    gainers: sorted((a, b) => b.changePct - a.changePct),
    losers: sorted((a, b) => a.changePct - b.changePct),
    unusualVolume: deepRows.filter((r) => r.relVol1h != null).sort((a, b) => (b.relVol1h ?? 0) - (a.relVol1h ?? 0)).slice(0, 25),
    largeCaps: rows.map(row).filter((r) => r.rank != null).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 25),
    dexLaunches: market.dex.map((p) => ({ ...p, safety: assessDexPair(p) })).sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0)).slice(0, 30),
    // Explicitly fresh, read-only Solana watchlist: never an order-authorizing signal.
    // MIA review (Omega PR-01): one clock reading; a future-dated fetch is stale too (fail closed), not "fresh".
    solanaHunter: (() => {
      const age = market.dexFetchedAt ? nowMs - market.dexFetchedAt : null;
      const fresh = age !== null && age >= 0 && age <= SOLANA_HUNTER_MAX_AGE_MS;
      return {
      asOf: market.dexFetchedAt,
      stale: !fresh,
      candidates: fresh ? rankSolanaPairs(market.dex, { nowMs }) : [],
      executionReady: false,
      note: 'DEX Screener watchlist only. Mint checks, holder data and an executable sell route are not yet verified.',
      };
    })(),
    universe: rows.length, asOf: market.tickersFetchedAt, dexAsOf: market.dexFetchedAt,
    note: 'Unusual volume uses the 1h relative-volume feature, available for deep-tier instruments only. Not recommendations.',
  };
}
