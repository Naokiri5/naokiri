import { createHash } from 'node:crypto';
import { analyzeChart, type ChartReport } from '../chart/analysis.js';
import { FeatureEngine } from '../features/indicators.js';
import { INTERVAL_MS } from '../market/types.js';
import type { DexPair } from '../providers/dexscreener.js';
import type { FuturesMarketContext, FuturesResearchSnapshot } from '../providers/binanceFuturesResearch.js';
import { assessDexPair } from '../safety/safety.js';

export const DUAL_RESEARCH_VERSION = 'mia-dual-research-v1';
type MissingFuturesEvidence = 'FUTURES_FUNDING' | 'OPEN_INTEREST' | 'MARGIN' | 'LIQUIDATION_STRESS' | 'EXECUTABLE_BOOK' | 'VALIDATED_STRATEGY_EDGE';

export interface FastResearchResult {
  version: typeof DUAL_RESEARCH_VERSION;
  lane: 'FAST_MEMECOIN';
  rolloutMode: 'RESEARCH_ONLY';
  tradingAuthority: false;
  status: 'NO_TRADE';
  reason: string;
  sourceAsOf: number;
  candidates: Array<{
    chainId: string; pairAddress: string; mintAddress: string; symbol: string;
    ageMs: number | null; liquidityUsd: number; safetyStatus: string;
    eligibleForAutomation: false; reasons: string[];
  }>;
}

/** Actual DEX discovery state + canonical safety function. Not a new scanner or signer. */
export function assessFastMemecoinResearch(pairs: readonly DexPair[], sourceAsOf: number, nowTs = Date.now()): FastResearchResult {
  if (!Number.isSafeInteger(nowTs) || nowTs < 0) throw new Error('INVALID_RESEARCH_TIME');
  const stale = !Number.isSafeInteger(sourceAsOf) || sourceAsOf <= 0
    || sourceAsOf > nowTs || nowTs - sourceAsOf > 4 * 60_000; // upstream DEX refresh is every 3 minutes
  const candidates = stale ? [] : [...pairs]
    .filter((p) => p.pairCreatedAt !== null && Number.isSafeInteger(p.pairCreatedAt)
      && p.pairCreatedAt <= nowTs && nowTs - p.pairCreatedAt <= 24 * 60 * 60_000)
    .sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0)
      || a.pairAddress.localeCompare(b.pairAddress))
    .slice(0, 20).map((p) => {
      const safety = assessDexPair(p, nowTs);
      return {
        chainId: p.chainId, pairAddress: p.pairAddress, mintAddress: p.baseAddress,
        symbol: p.baseSymbol, ageMs: nowTs - p.pairCreatedAt!, liquidityUsd: p.liquidityUsd,
        safetyStatus: safety.status, eligibleForAutomation: false as const,
        reasons: [...safety.reasons, 'UNVERIFIED_SELL_EXECUTION_AND_CONTRACT_PERMISSIONS'],
      };
    });
  return {
    version: DUAL_RESEARCH_VERSION, lane: 'FAST_MEMECOIN', rolloutMode: 'RESEARCH_ONLY',
    tradingAuthority: false, status: 'NO_TRADE',
    reason: stale ? 'DEX_SOURCE_STALE_OR_MISSING'
      : candidates.length ? 'ONCHAIN_SECURITY_AND_SELL_ROUTE_NOT_VERIFIED' : 'NO_RECENT_DEX_PAIRS',
    sourceAsOf, candidates,
  };
}

export interface DeepFuturesResearchResult {
  version: typeof DUAL_RESEARCH_VERSION;
  lane: 'DEEP_FUTURES';
  rolloutMode: 'RESEARCH_ONLY';
  tradingAuthority: false;
  market: 'CRYPTO_PERPETUAL_FUTURES';
  symbol: string;
  source: string;
  asOf: number;
  state: 'NO_TRADE' | 'WAIT_FOR_TRIGGER' | 'RESEARCH_HYPOTHESIS';
  reason: string;
  marketContext: FuturesMarketContext;
  chartEvidence: Record<'15m' | '1h' | '4h', ChartReport>;
  plan: null | {
    planId: string;
    strategyId: 'multi_timeframe_structure_research';
    strategyVersion: 'research-v2';
    direction: 'LONG' | 'SHORT';
    state: 'WAIT_FOR_TRIGGER' | 'RESEARCH_HYPOTHESIS';
    entryTrigger: '15M_BREAKOUT_UP' | '15M_BREAKOUT_DOWN';
    invalidationLevel: number;
    evidenceAsOf: number;
    expiresAt: number;
    stopAuthority: false;
    requiredMissing: readonly MissingFuturesEvidence[];
    volatilityScenarios: readonly { scenario: 'ONE_ATR_UP' | 'ONE_ATR_DOWN'; price: number; breachesInvalidation: boolean }[];
  };
}

/**
 * Reconstructs a frozen hypothesis from closed futures candles and timestamped market conditions.
 * Chart pattern evidence is NOT a profitable futures strategy or order authorization.
 * Never imports Risk, OMS, credentials or the financial ledger.
 */
export function reconstructDeepFuturesResearch(snapshot: FuturesResearchSnapshot): DeepFuturesResearchResult {
  if (snapshot.market !== 'CRYPTO_PERPETUAL_FUTURES' || snapshot.source !== 'binance-usdm-public-klines'
      || !Number.isSafeInteger(snapshot.asOf)) throw new Error('INVALID_FUTURES_SNAPSHOT_IDENTITY');
  const id = 'futures:binance-usdm:' + snapshot.symbol;
  const chartEvidence = {
    '15m': analyzeChart(id, '15m', snapshot.candles['15m'], snapshot.asOf),
    '1h': analyzeChart(id, '1h', snapshot.candles['1h'], snapshot.asOf),
    '4h': analyzeChart(id, '4h', snapshot.candles['4h'], snapshot.asOf),
  };
  const marketContext = snapshot.context ?? { funding: null, openInterest: null };
  const common = {
    version: DUAL_RESEARCH_VERSION as typeof DUAL_RESEARCH_VERSION, lane: 'DEEP_FUTURES' as const,
    rolloutMode: 'RESEARCH_ONLY' as const, tradingAuthority: false as const,
    market: 'CRYPTO_PERPETUAL_FUTURES' as const, symbol: snapshot.symbol,
    source: snapshot.source, asOf: snapshot.asOf, chartEvidence, marketContext,
  };
  if (Object.values(chartEvidence).some((x) => x.status !== 'VALID'))
    return { ...common, state: 'NO_TRADE', reason: 'INVALID_OR_INSUFFICIENT_CLOSED_CANDLES', plan: null };
  const h4 = chartEvidence['4h'], h1 = chartEvidence['1h'], m15 = chartEvidence['15m'];
  const direction = h4.trend === 'BULLISH' && h1.trend === 'BULLISH' ? 'LONG'
    : h4.trend === 'BEARISH' && h1.trend === 'BEARISH' ? 'SHORT' : null;
  if (!direction) return { ...common, state: 'NO_TRADE', reason: 'MULTI_TIMEFRAME_TREND_CONFLICT', plan: null };
  const invalidationLevel = direction === 'LONG' ? h1.support : h1.resistance;
  const last = snapshot.candles['15m'].at(-1)!.c;
  if (invalidationLevel == null || !(invalidationLevel > 0)
      || (direction === 'LONG' ? invalidationLevel >= last : invalidationLevel <= last))
    return { ...common, state: 'NO_TRADE', reason: 'NO_VALID_STRUCTURAL_INVALIDATION', plan: null };
  const entryTrigger = direction === 'LONG' ? '15M_BREAKOUT_UP' : '15M_BREAKOUT_DOWN';
  const triggered = m15.detections.some((d) => d.kind === (direction === 'LONG' ? 'BREAKOUT_UP' : 'BREAKOUT_DOWN'));
  const state = triggered ? 'RESEARCH_HYPOTHESIS' as const : 'WAIT_FOR_TRIGGER' as const;
  const volatility = new FeatureEngine();
  volatility.ingest(snapshot.candles['15m']);
  const atr = volatility.last?.atr14;
  const volatilityScenarios: NonNullable<DeepFuturesResearchResult['plan']>['volatilityScenarios'] =
    atr && Number.isFinite(atr) && atr > 0 && atr < last ? [
      { scenario: 'ONE_ATR_UP', price: last + atr, breachesInvalidation: direction === 'SHORT' && last + atr >= invalidationLevel },
      { scenario: 'ONE_ATR_DOWN', price: last - atr, breachesInvalidation: direction === 'LONG' && last - atr <= invalidationLevel },
    ] : [];
  const requiredMissing: MissingFuturesEvidence[] = ['MARGIN', 'LIQUIDATION_STRESS', 'EXECUTABLE_BOOK', 'VALIDATED_STRATEGY_EDGE'];
  if (!marketContext.funding) requiredMissing.push('FUTURES_FUNDING');
  if (!marketContext.openInterest) requiredMissing.push('OPEN_INTEREST');
  const planId = createHash('sha256').update(JSON.stringify([
    'research-v2', snapshot.symbol, snapshot.asOf, h4.trend, h1.trend,
    entryTrigger, invalidationLevel, last, marketContext, volatilityScenarios,
  ])).digest('hex');
  return {
    ...common, state, reason: triggered ? 'PATTERN_OBSERVED_BUT_FUTURES_RISK_UNVERIFIED' : 'AWAITING_15M_CONFIRMATION',
    plan: {
      planId, strategyId: 'multi_timeframe_structure_research',
      strategyVersion: 'research-v2', direction, state, entryTrigger,
      invalidationLevel, evidenceAsOf: snapshot.asOf, expiresAt: snapshot.asOf + INTERVAL_MS['15m'],
      stopAuthority: false,
      requiredMissing, volatilityScenarios,
    },
  };
}
