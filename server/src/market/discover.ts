import { market } from './store.js';
import { isEligibleSpot } from './fabric.js';
import { assessCexAsset, assessDexPair } from '../safety/safety.js';
import { classifyRegime } from '../regime/regime.js';
import { rankSolanaPairs } from '../solana/hunting.js';
import { isTrustedSolanaQuote } from '../solana/quotes.js';
import { applyMintChecks, mintCheckSummary } from '../solana/mintChecks.js';
import { watchAlertStatus } from '../solana/watchAlerts.js';

/** Solana watchlist freshness: DEX Screener cache older than this, missing, or future-dated (clock jump) is stale. */
const SOLANA_HUNTER_MAX_AGE_MS = 5 * 60_000;
const SOLANA_HUNTER_NOTE = 'DEX Screener watchlist only. Mint checks, holder data and an executable sell route are not yet verified.';
const SOLANA_HUNTER_NOTE_WITH_MINT_CHECKS = 'DEX Screener watchlist with read-only on-chain mint checks. Holder data, pool custody and an executable sell route are not yet verified.';

/**
 * Explicitly fresh, read-only Solana watchlist: never an order-authorizing signal (Omega PR-01).
 * One clock reading; a future-dated fetch is stale too (fail closed). The ranker runs on untrusted provider rows, so a
 * failure there empties only this block (`rankerFailed`) instead of turning the whole Discover response into a 500.
 * Only pools quoted against SOL, USDC or USDT are ranked: another quote token makes `liquidityUsd` untrustworthy, so
 * those pools are skipped and counted (`skippedUntrustedQuote`), never shown as WATCH.
 * Omega PR-06: on-chain mint checks (when MIA_SOLANA_RPC_URL is set) are joined in and can only make a row stricter.
 */
export function solanaWatchlist(nowMs: number) {
  const asOf = market.dexFetchedAt || null;
  const age = asOf === null ? null : nowMs - asOf;
  const fresh = age !== null && age >= 0 && age <= SOLANA_HUNTER_MAX_AGE_MS;
  let candidates: ReturnType<typeof applyMintChecks> = [];
  let rankerFailed = false;
  let skippedUntrustedQuote = 0;
  if (fresh) {
    try {
      const solana = market.dex.filter((p) => typeof p.chainId === 'string' && p.chainId.toLowerCase() === 'solana');
      const trusted = solana.filter((p) => isTrustedSolanaQuote(p.quoteAddress));
      skippedUntrustedQuote = solana.length - trusted.length;
      candidates = applyMintChecks(rankSolanaPairs(trusted, { nowMs }), nowMs);
    } catch { rankerFailed = true; candidates = []; }
  }
  const mintChecks = mintCheckSummary();
  return { asOf, stale: !fresh, rankerFailed, skippedUntrustedQuote, candidates, mintChecks, alerts: watchAlertStatus(), executionReady: false as const,
    note: mintChecks.configured ? SOLANA_HUNTER_NOTE_WITH_MINT_CHECKS : SOLANA_HUNTER_NOTE };
}

/** Asset Discovery (Part 10 "Discover"): ranked lists drawn only from live feeds. */
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
    solanaHunter: solanaWatchlist(nowMs),
    universe: rows.length, asOf: market.tickersFetchedAt, dexAsOf: market.dexFetchedAt,
    note: 'Unusual volume uses the 1h relative-volume feature, available for deep-tier instruments only. Not recommendations.',
  };
}
