import { market } from './store.js';
import { isEligibleSpot } from './fabric.js';
import { assessCexAsset, assessDexPair } from '../safety/safety.js';
import { classifyRegime } from '../regime/regime.js';

/** Asset Discovery (Part 10 "Discover"): ranked lists drawn only from live feeds. */
export function discover(minVolume = 1_000_000) {
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
    universe: rows.length, asOf: market.tickersFetchedAt, dexAsOf: market.dexFetchedAt,
    note: 'Unusual volume uses the 1h relative-volume feature, available for deep-tier instruments only. Not recommendations.',
  };
}
