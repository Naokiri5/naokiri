/**
 * TITAN HUNTER: deterministic, read-only ranking of already cached observations.
 * Never fetches data, declares tokens safe, authorizes orders or calls the OMS.
 */
export type HuntVenue = 'CEX_SPOT' | 'DEX_POOL';

export interface HuntObservation {
  /** Canonical source identity, e.g. crypto:binance:BTCUSDT or dex:solana:<pair-address>. */
  id: string;
  venue: HuntVenue;
  symbol: string;
  source: string;
  /** Receipt and provider-event timestamps, Unix milliseconds; do not fabricate missing timestamps. */
  receivedAt: number;
  providerAt: number;
  priceUsd: number;
  volume24hUsd: number;
  volume1hUsd?: number | null;
  liquidityUsd?: number | null;
  change24hPct?: number | null;
  change1hPct?: number | null;
  trades1h?: number | null;
}

export interface HuntRankedObservation {
  id: string;
  venue: HuntVenue;
  symbol: string;
  source: string;
  score: number;
  receivedAt: number;
  providerAt: number;
  /** Discovery ranking is NEVER a trading permission or a probability of profit. */
  classification: 'WATCH_ONLY';
  tradeEligible: false;
  warnings: string[];
}

export interface HuntScreenResult {
  results: HuntRankedObservation[];
  inspected: number;
  valid: number;
  discarded: number;
  duplicates: number;
  asOf: number;
  scope: 'CACHED_OBSERVATIONS_ONLY';
}

const MAX_FUTURE_SKEW_MS = 2_000;
const CEX_MAX_AGE_MS = 60_000;
const DEX_MAX_AGE_MS = 5 * 60_000;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const safe = (x: number | null | undefined) =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;
const logRatio = (x: number, scale: number) =>
  clamp(Math.log1p(Math.max(0, x)) / Math.log1p(scale));

/** Stable tie-break for conflicting observations carrying the same two timestamps. */
function observationKey(o: HuntObservation) {
  return JSON.stringify([o.venue, o.symbol, o.source, o.priceUsd, o.volume24hUsd, safe(o.volume1hUsd),
    safe(o.liquidityUsd), safe(o.change24hPct), safe(o.change1hPct), safe(o.trades1h)]);
}

/**
 * O(n log n) ranking; milliseconds budget is for cached computations only.
 * Network ingestion, security, historical analysis, QCI and execution are excluded.
 */
export function screenCachedTokens(
  observations: readonly HuntObservation[],
  now = Date.now(),
  limit = 30,
): HuntScreenResult {
  if (!Number.isFinite(now) || now <= 0) throw new RangeError('now must be positive Unix milliseconds');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError('limit must be 1..1000');
  if (observations.length > 200_000) throw new RangeError('batch exceeds 200000 observations');

  const unique = new Map<string, HuntObservation>();
  let discarded = 0;
  let duplicates = 0;

  for (const o of observations) {
    const maxAge = o.venue === 'CEX_SPOT' ? CEX_MAX_AGE_MS : DEX_MAX_AGE_MS;
    const valid = (o.venue === 'CEX_SPOT' || o.venue === 'DEX_POOL')
      && typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 200
      && typeof o.symbol === 'string' && o.symbol.length > 0
      && typeof o.source === 'string' && o.source.length > 0
      && Number.isFinite(o.receivedAt) && Number.isFinite(o.providerAt)
      && o.receivedAt > 0 && o.providerAt > 0
      && o.receivedAt <= now + MAX_FUTURE_SKEW_MS && o.providerAt <= now + MAX_FUTURE_SKEW_MS
      && now - o.receivedAt <= maxAge && now - o.providerAt <= maxAge
      && Number.isFinite(o.priceUsd) && o.priceUsd > 0
      && Number.isFinite(o.volume24hUsd) && o.volume24hUsd >= 0;
    if (!valid) { discarded++; continue; }
    const previous = unique.get(o.id);
    if (previous) {
      duplicates++;
      const newer = o.providerAt - previous.providerAt || o.receivedAt - previous.receivedAt;
      if (newer < 0 || (newer === 0 && observationKey(o) >= observationKey(previous))) continue;
    }
    unique.set(o.id, o);
  }

  const results = [...unique.values()].map((o): HuntRankedObservation => {
    const liq = safe(o.liquidityUsd);
    const vol1h = safe(o.volume1hUsd);
    const change1h = safe(o.change1hPct);
    const change24h = safe(o.change24hPct);
    const trades1h = safe(o.trades1h);
    const warnings: string[] = [];
    if (liq == null) warnings.push('POOL_LIQUIDITY_UNVERIFIED');
    else if (liq < 25_000) warnings.push('THIN_POOL_LIQUIDITY');
    if (o.venue === 'DEX_POOL') warnings.push('TOKEN_CONTRACT_AND_SELLABILITY_UNVERIFIED');
    if (change24h != null && Math.abs(change24h) >= 35) warnings.push('LARGE_24H_PRICE_MOVE');
    if (vol1h == null) warnings.push('HOURLY_VOLUME_UNAVAILABLE');

    // Research ordering heuristic, not a trained prediction, safety check or entry signal.
    const volume = logRatio(o.volume24hUsd, 25_000_000);
    const liquidity = liq != null ? logRatio(liq, 5_000_000) : 0;
    const activity = trades1h != null ? logRatio(trades1h, 4_000) : 0;
    const hourlyAcceleration = vol1h != null && o.volume24hUsd > 0
      ? clamp((vol1h / Math.max(o.volume24hUsd / 24, 1) - 1) / 6) : 0;
    const momentum = change1h != null ? clamp(change1h / 12) : 0;
    const concentrationPenalty = change24h != null && Math.abs(change24h) >= 35 ? 0.2 : 0;
    const thinLiquidityPenalty = liq != null && liq < 25_000 ? 0.2 : 0;
    const score = Math.round(100 * clamp(0.30 * volume + 0.22 * liquidity + 0.16 * activity
      + 0.18 * hourlyAcceleration + 0.14 * momentum - concentrationPenalty - thinLiquidityPenalty) * 100) / 100;

    return {
      id: o.id, venue: o.venue, symbol: o.symbol, source: o.source,
      score, providerAt: o.providerAt, receivedAt: o.receivedAt,
      classification: 'WATCH_ONLY', tradeEligible: false, warnings,
    };
  });

  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    results: results.slice(0, limit), inspected: observations.length, valid: unique.size,
    discarded, duplicates, asOf: now, scope: 'CACHED_OBSERVATIONS_ONLY',
  };
}
