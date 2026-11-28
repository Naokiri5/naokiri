import { market } from '../market/store.js';
import { isDbOpen } from '../db/db.js';
import { persistFlinPreparation, prepareFlinDexSnapshot, type FlinIntakeResult } from '../market/flinQueue.js';
import { fetchFuturesResearchSnapshot, futuresResearchInstrumentId, FUTURES_CONTEXT_MAX_AGE_MS, FUTURES_RESEARCH_SYMBOLS, type FuturesResearchSymbol } from '../providers/binanceFuturesResearch.js';
import { fetchFinalizedMintObservations, MAX_FAST_MINTS_PER_PASS, type MintObservation } from '../providers/solanaRpc.js';
import {
  describeFastPreparation, FAST_RESEARCH_MAX_AGE_MS, reconstructDeepFuturesResearch,
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
let fastIntake: FlinIntakeResult | null = null;
let latestDeepSymbol: FuturesResearchSymbol | null = null;
const deepReadings = new Map<FuturesResearchSymbol, DeepReading>();
let deepAttemptAt = 0;
let nextSymbol = 0;
let running = false;

interface DeepReading {
  attemptAt: number;
  successAt: number;
  error: string | null;
  consecutiveFailures: number;
  result: DeepFuturesResearchResult | null;
}

const emptyDeepReading: DeepReading = { attemptAt: 0, successAt: 0, error: null, consecutiveFailures: 0, result: null };

function deepReading(symbol: FuturesResearchSymbol | null): DeepReading {
  return symbol === null ? emptyDeepReading : deepReadings.get(symbol) ?? emptyDeepReading;
}

function deepStatus<Symbol extends FuturesResearchSymbol | null>(symbol: Symbol, now: number) {
  const reading = deepReading(symbol);
  const { result, successAt } = reading;
  const stale = !result || !successAt || now < successAt || now < result.asOf
    || now - result.asOf > DEEP_RESEARCH_MAX_AGE_MS
    || (result.plan !== null && now >= result.plan.expiresAt);
  if (!result) return { ...reading, symbol, stale };
  const freshContext = <T extends { localAt: number }>(item: T | null) =>
    item && item.localAt <= now && now - item.localAt <= FUTURES_CONTEXT_MAX_AGE_MS ? item : null;
  const directionForecasts = Object.fromEntries(Object.entries(result.directionForecasts)
    .filter(([, forecast]) => !stale && forecast.targetAt > now));
  return { ...reading, symbol, stale, result: { ...result, directionForecasts, marketContext: {
    funding: freshContext(result.marketContext.funding), openInterest: freshContext(result.marketContext.openInterest),
  } } };
}

export interface DualResearchRuntimeStatus {
  version: 'dual-runtime-v1';
  tradingAuthority: false;
  backgroundRunning: boolean;
  fast: { checkedAt: number; stale: boolean; result: FastResearchResult | null; launchIntake: FlinIntakeResult | null };
  deep: DeepReading & { symbol: FuturesResearchSymbol | null; stale: boolean };
  deepInstruments: (DeepReading & { instrumentId: string; symbol: FuturesResearchSymbol; stale: boolean })[];
}

/** A snapshot is always explicitly labeled stale; old plans must never be treated as fresh. */
export function dualResearchStatus(now = Date.now()): DualResearchRuntimeStatus {
  const fastStale = !fast || !Number.isSafeInteger(fast.sourceAsOf)
    || fast.sourceAsOf <= 0 || fast.sourceAsOf !== market.dexFetchedAt || now < fastCheckedAt
    || now < fast.sourceAsOf || now - fast.sourceAsOf > FAST_RESEARCH_MAX_AGE_MS;
  return {
    version: 'dual-runtime-v1', tradingAuthority: false, backgroundRunning: running,
    fast: { checkedAt: fastCheckedAt, stale: fastStale, result: fast, launchIntake: fastIntake },
    deep: deepStatus(latestDeepSymbol, now),
    deepInstruments: FUTURES_RESEARCH_SYMBOLS.map((symbol) => ({
      instrumentId: futuresResearchInstrumentId(symbol), ...deepStatus(symbol, now),
    })),
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
  stillCurrent: () => boolean = () => true,
  mintReader = fetchFinalizedMintObservations,
): Promise<DualResearchRuntimeStatus> {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_DUAL_RESEARCH_TIME');
  if (running || process.env.MIA_DUAL_RESEARCH === '0' || !stillCurrent()) return dualResearchStatus(now);
  const startedAt = Date.now();
  const observedNow = () => now + Math.max(0, Date.now() - startedAt);
  running = true;
  try {
    try {
      const sourceAsOf = market.dexFetchedAt;
      const sourceStale = sourceAsOf <= 0 || sourceAsOf > now || now - sourceAsOf > FAST_RESEARCH_MAX_AGE_MS;
      if (!fast || fast.sourceAsOf !== sourceAsOf || now < fastCheckedAt ||
          (fast.reason === 'DEX_SOURCE_STALE_OR_MISSING') !== sourceStale) {
        let prepared = prepareFlinDexSnapshot(market.dex, sourceAsOf, now);
        const batch = [...new Set(prepared.candidates.filter((row) => row.knownQuote && !row.safety.hardLaunchRisk)
          .map((row) => row.pair.baseAddress))].slice(0, MAX_FAST_MINTS_PER_PASS);
        let mintSourceStatus: FastResearchResult['mintSourceStatus'] = 'NOT_CHECKED';
        const mints = new Map<string, MintObservation>();
        if (batch.length) {
          try {
            for (const observation of await mintReader(batch)) {
              if (batch.includes(observation.mintAddress) && observation.checkedAt >= sourceAsOf && observation.checkedAt <= Date.now()) {
                mints.set(observation.mintAddress, observation);
              }
            }
            mintSourceStatus = mints.size ? 'OBSERVED' : 'UNAVAILABLE';
          } catch { mintSourceStatus = 'UNAVAILABLE'; }
        }
        if (stillCurrent() && market.dexFetchedAt === sourceAsOf) {
          const finishedAt = observedNow();
          if (prepared.status === 'OK' && finishedAt > prepared.expiresAt) {
            prepared = prepareFlinDexSnapshot([], sourceAsOf, finishedAt);
            mints.clear();
            mintSourceStatus = 'NOT_CHECKED';
          }
          // The generation is checked again under the existing FLIN write lock.
          const intake = isDbOpen() ? persistFlinPreparation(prepared, mints, stillCurrent) : null;
          if (stillCurrent()) {
            fastIntake = intake;
            fast = describeFastPreparation(prepared, mints, mintSourceStatus);
            fastCheckedAt = now;
          }
        }
      }
    } catch {
      // A failed evaluation cannot keep a previously valid FAST result.
      if (stillCurrent()) { fast = null; fastCheckedAt = now; fastIntake = null; }
    }
    if (stillCurrent() && (!deepAttemptAt || now - deepAttemptAt >= DEEP_POLL_MS || now < deepAttemptAt)) {
      const symbol = FUTURES_RESEARCH_SYMBOLS[nextSymbol];
      nextSymbol = (nextSymbol + 1) % FUTURES_RESEARCH_SYMBOLS.length;
      deepAttemptAt = now;
      const previous = deepReading(symbol);
      try {
        const snapshot = await reader(symbol, now - 2000);
        if (stillCurrent()) {
          // Reject a response from the wrong instrument or an impossible future snapshot.
          if (snapshot.symbol !== symbol || snapshot.asOf > now || snapshot.asOf <= 0)
            throw new Error('FUTURES_SNAPSHOT_IDENTITY_MISMATCH');
          const result = reconstructDeepFuturesResearch(snapshot);
          deepReadings.set(symbol, { result, attemptAt: now, successAt: now, error: null, consecutiveFailures: 0 });
          latestDeepSymbol = symbol;
        }
      } catch (error: unknown) {
        // A failed refresh invalidates only this instrument's current evidence.
        if (stillCurrent()) {
          deepReadings.set(symbol, { ...previous, attemptAt: now, result: null,
            error: String(error instanceof Error ? error.message : error).slice(0, 200),
            consecutiveFailures: previous.consecutiveFailures + 1,
          });
          latestDeepSymbol = symbol;
        }
      }
    }
  } finally {
    running = false;
  }
  return dualResearchStatus(observedNow());
}

/** Test isolation only; not an API endpoint or a trading control. */
export function _resetDualResearchForTests() {
  fast = null; fastCheckedAt = 0; fastIntake = null;
  deepReadings.clear(); latestDeepSymbol = null; deepAttemptAt = 0; nextSymbol = 0; running = false;
}
