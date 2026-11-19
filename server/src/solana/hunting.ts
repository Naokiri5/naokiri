/**
 * Read-only Solana Hunter ranking for existing DEX Screener data.
 * Important: this is an opportunity-monitoring score, NEVER a win probability
 * or an authorization to execute a swap. No network I/O or credentials.
 */
export interface SolanaHuntPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseAddress: string;
  baseSymbol: string;
  baseName: string;
  priceUsd: number;
  liquidityUsd: number;
  fdv: number;
  marketCap: number;
  volume24h: number;
  volume1h: number;
  buys1h: number;
  sells1h: number;
  change1h: number;
  pairCreatedAt: number | null;
}

export type SolanaScreenStatus = 'WATCH' | 'REJECT' | 'INSUFFICIENT_DATA';
export interface SolanaHuntResult {
  chain: 'solana';
  mint: string;
  symbol: string;
  pairAddress: string;
  dex: string;
  ageMinutes: number | null;
  liquidityUsd: number;
  volume1hUsd: number;
  observedBuys1h: number;
  observedSells1h: number;
  momentum1hPct: number;
  rankScore: number;
  status: SolanaScreenStatus;
  blockers: string[];
  notes: string[];
  tradingEligible: false;
  source: 'dexscreener';
}
export interface SolanaHunterOptions {
  minLiquidityUsd?: number;
  minVolume1hUsd?: number;
  maxAgeHours?: number;
  limit?: number;
  nowMs?: number;
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const validNum = (n: number) => Number.isFinite(n) && n >= 0;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const rounded = (x: number) => Math.round(x * 100) / 100;
/**
 * MIA review (Omega PR-01): provider strings are attacker-controlled. Strip control and format characters (including
 * bidi overrides that can make one ticker render as another) before they reach the UI; React still escapes the rest.
 */
const displayText = (x: unknown, fallback: string) => {
  const s = typeof x === 'string' ? x.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : '';
  return (s || fallback).slice(0, 40);
};

/** Scores distinct mint addresses only; never assumes missing on-chain checks passed. */
export function rankSolanaPairs(pairs: readonly SolanaHuntPair[], opts: SolanaHunterOptions = {}): SolanaHuntResult[] {
  const now = opts.nowMs ?? Date.now();
  const minLiq = opts.minLiquidityUsd ?? 20_000;
  const minVolume = opts.minVolume1hUsd ?? 5_000;
  const maxAge = opts.maxAgeHours ?? 24;
  const limit = opts.limit ?? 30;
  if (![now, minLiq, minVolume, maxAge, limit].every(Number.isFinite) || now < 0 || minLiq <= 0 || minVolume <= 0 || maxAge <= 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('invalid Solana Hunter options');
  }
  const byMint = new Map<string, SolanaHuntPair>();
  for (const p of pairs) {
    // MIA review: chainId and addresses come straight from the provider; a non-string must be skipped, never throw.
    if (typeof p.chainId !== 'string' || p.chainId.toLowerCase() !== 'solana' || typeof p.baseAddress !== 'string' || typeof p.pairAddress !== 'string'
      || !ADDRESS.test(p.baseAddress) || !ADDRESS.test(p.pairAddress)) continue;
    const old = byMint.get(p.baseAddress);
    if (!old || (validNum(p.liquidityUsd) && p.liquidityUsd > (validNum(old.liquidityUsd) ? old.liquidityUsd : -1))) byMint.set(p.baseAddress, p);
  }
  const results: SolanaHuntResult[] = [];
  for (const p of byMint.values()) {
    const blockers: string[] = [];
    const notes = ['On-chain mint authority, holder distribution, pool custody, route viability and executable sell quote not verified'];
    const metrics = [p.priceUsd, p.liquidityUsd, p.volume1h, p.volume24h, p.buys1h, p.sells1h, p.change1h];
    if (!metrics.every(Number.isFinite) || !(p.priceUsd > 0) || ![p.liquidityUsd, p.volume1h, p.volume24h, p.buys1h, p.sells1h].every(validNum)) {
      blockers.push('MALFORMED_MARKET_METRICS');
    }
    let ageMinutes: number | null = null;
    if (p.pairCreatedAt == null || !Number.isSafeInteger(p.pairCreatedAt) || p.pairCreatedAt <= 0 || p.pairCreatedAt > now) {
      blockers.push('UNVERIFIED_PAIR_AGE');
    } else {
      ageMinutes = (now - p.pairCreatedAt) / 60_000;
      if (ageMinutes > maxAge * 60) blockers.push('OUTSIDE_LAUNCH_WINDOW');
    }
    if (p.liquidityUsd < minLiq) blockers.push('LOW_LIQUIDITY');
    if (p.volume1h < minVolume) blockers.push('LOW_VOLUME');
    if (p.buys1h >= 10 && p.sells1h === 0) blockers.push('NO_OBSERVED_SELLS');
    if (p.liquidityUsd > 0 && p.volume1h / p.liquidityUsd > 30) blockers.push('ANOMALOUS_VOLUME_TO_LIQUIDITY');
    if (p.change1h > 200 || p.change1h < -80) blockers.push('EXTREME_PRICE_CHANGE');
    if (p.fdv > 0 && p.liquidityUsd > 0 && p.fdv / p.liquidityUsd > 500) notes.push('Large FDV relative to visible pool liquidity');
    // Deliberately no safety verdict from this score. Purely useful for watchlist ordering.
    const liquidityPart = validNum(p.liquidityUsd) ? clamp(Math.log10(1 + p.liquidityUsd / minLiq) * 25, 0, 30) : 0;
    const volumePart = validNum(p.volume1h) ? clamp(Math.log10(1 + p.volume1h / minVolume) * 25, 0, 30) : 0;
    const activity = validNum(p.buys1h) && validNum(p.sells1h) ? p.buys1h + p.sells1h : 0;
    const activityPart = clamp(Math.log10(1 + activity) * 8, 0, 20);
    const agePart = ageMinutes == null ? 0 : 20 * (1 - clamp(ageMinutes / (maxAge * 60), 0, 1));
    const rankScore = rounded(clamp(liquidityPart + volumePart + activityPart + agePart, 0, 100));
    const fatal = blockers.some(b => ['MALFORMED_MARKET_METRICS', 'LOW_LIQUIDITY', 'LOW_VOLUME', 'NO_OBSERVED_SELLS', 'ANOMALOUS_VOLUME_TO_LIQUIDITY', 'EXTREME_PRICE_CHANGE'].includes(b));
    results.push({ chain: 'solana', mint: p.baseAddress, symbol: displayText(p.baseSymbol, '?'), pairAddress: p.pairAddress,
      dex: displayText(p.dexId, '?'), ageMinutes: ageMinutes == null ? null : rounded(ageMinutes),
      liquidityUsd: validNum(p.liquidityUsd) ? p.liquidityUsd : 0, volume1hUsd: validNum(p.volume1h) ? p.volume1h : 0,
      observedBuys1h: validNum(p.buys1h) ? p.buys1h : 0, observedSells1h: validNum(p.sells1h) ? p.sells1h : 0,
      momentum1hPct: Number.isFinite(p.change1h) ? p.change1h : 0, rankScore,
      status: fatal ? 'REJECT' : blockers.length ? 'INSUFFICIENT_DATA' : 'WATCH',
      blockers, notes, tradingEligible: false, source: 'dexscreener' });
  }
  const order: Record<SolanaScreenStatus, number> = { WATCH: 0, INSUFFICIENT_DATA: 1, REJECT: 2 };
  return results.sort((a,b) => order[a.status] - order[b.status] || b.rankScore - a.rankScore || a.mint.localeCompare(b.mint)).slice(0, limit);
}
