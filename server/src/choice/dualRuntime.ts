import { market } from '../market/store.js';
import { fetchFuturesResearchSnapshot, FUTURES_RESEARCH_SYMBOLS, type FuturesResearchSymbol } from '../providers/binanceFuturesResearch.js';
import {
  assessFastMemecoinResearch, FAST_RESEARCH_MAX_AGE_MS, reconstructDeepFuturesResearch,
  type FastResearchResult, type DeepFuturesResearchResult,
} from './dualResearch.js';

/**
 * Running, bounded FAST/DEEP research using the existing market store and public futures feed.
 * This service does not create candidates for the canonical OMS or authorize any order.
 * PAPER and a future certified LIVE environment can consume the same observations.
 */
const DEEP_POLL_MS = 5 * 60_000;
export const DEEP_RESEARCH_MAX_AGE_MS = 20 * 60_000;
type FuturesReader = typeof fetchFuturesResearchSnapshot;

let fast: FastResearchResult | null = null;
let fastCheckedAt = 0;
let deep: DeepFuturesResearchResult | null = null;
let deepAttemptAt = 0;
let deepSuccessAt = 0;
let deepSymbol: FuturesResearchSymbol | null = null;
let deepError: string | null = null;
let deepFailures = 0;
let nextSymbol = 0;
let running = false;

export interface DualResearchRuntimeStatus {
  version: 'dual-runtime-v1';
  tradingAuthority: false;
  backgroundRunning: boolean;
  fast: { checkedAt: number; stale: boolean; result: FastResearchResult | null };
  deep: {
    attemptAt: number; successAt: number; symbol: FuturesResearchSymbol | null;
    stale: boolean; error: string | null; consecutiveFailures: number;
    result: DeepFuturesResearchResult | null;
  };
}

/** A snapshot is always explicitly labeled stale; old plans must never be treated as fresh. */
export function dualResearchStatus(now = Date.now()): DualResearchRuntimeStatus {
  const fastStale = !fast || !Number.isSafeInteger(fast.sourceAsOf)
    || fast.sourceAsOf <= 0 || now < fast.sourceAsOf || now - fast.sourceAsOf > FAST_RESEARCH_MAX_AGE_MS;
  const deepStale = !deep || !deepSuccessAt || now < deep.asOf
    || now - deep.asOf > DEEP_RESEARCH_MAX_AGE_MS
    || (deep.plan != null && now >= deep.plan.expiresAt);
  return {
    version: 'dual-runtime-v1', tradingAuthority: false, backgroundRunning: running,
    fast: { checkedAt: fastCheckedAt, stale: fastStale, result: fast },
    deep: { attemptAt: deepAttemptAt, successAt: deepSuccessAt,
      symbol: deepSymbol, stale: deepStale, error: deepError,
      consecutiveFailures: deepFailures, result: deep },
  };
}

/**
 * Invoked by MIA's existing background lane after the canonical provider refresh.
 * FAST uses already-fetched DEX data, DEEP rotates through at most one futures symbol
 * per five minutes. Provider failure never blocks risk, exits, or the scanner.
 */
export async function runDualResearchPass(
  reader: FuturesReader = fetchFuturesResearchSnapshot,
  now = Date.now(),
): Promise<DualResearchRuntimeStatus> {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_DUAL_RESEARCH_TIME');
  if (running || process.env.MIA_DUAL_RESEARCH === '0') return dualResearchStatus(now);
  running = true;
  try {
    try {
      fast = assessFastMemecoinResearch(market.dex, market.dexFetchedAt, now);
      fastCheckedAt = now;
    } catch {
      // A failed evaluation cannot keep a previously valid FAST result.
      fast = null;
      fastCheckedAt = now;
    }
    if (!deepAttemptAt || now - deepAttemptAt >= DEEP_POLL_MS || now < deepAttemptAt) {
      const symbol = FUTURES_RESEARCH_SYMBOLS[nextSymbol % FUTURES_RESEARCH_SYMBOLS.length];
      nextSymbol = (nextSymbol + 1) % FUTURES_RESEARCH_SYMBOLS.length;
      deepAttemptAt = now;
      deepSymbol = symbol;
      try {
        const snapshot = await reader(symbol, now - 2000);
        // Reject a response from the wrong instrument or an impossible future snapshot.
        if (snapshot.symbol !== symbol || snapshot.asOf > now || snapshot.asOf <= 0)
          throw new Error('FUTURES_SNAPSHOT_IDENTITY_MISMATCH');
        deep = reconstructDeepFuturesResearch(snapshot);
        deepSuccessAt = now;
        deepError = null;
        deepFailures = 0;
      } catch (error: unknown) {
        // Never treat an older successful plan as current when the provider fails.
        deep = null;
        deepError = String(error instanceof Error ? error.message : error).slice(0, 200);
        deepFailures++;
      }
    }
  } finally {
    running = false;
  }
  return dualResearchStatus(now);
}

/** Test isolation only; not an API endpoint or a trading control. */
export function _resetDualResearchForTests() {
  fast = null; fastCheckedAt = 0; deep = null; deepAttemptAt = 0; deepSuccessAt = 0;
  deepSymbol = null; deepError = null; deepFailures = 0; nextSymbol = 0; running = false;
}
