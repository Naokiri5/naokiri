import { createHash } from 'node:crypto';
import { analyzeChart, type ChartReport } from '../chart/analysis.js';
import { analyzeDeepScenarios, type DeepScenarioAnalysis } from '../chart/scenarios.js';
import { buildDirectionForecast, type DirectionForecast } from '../ditas/directionForecast.js';
import { FeatureEngine } from '../features/indicators.js';
import { FLIN_SOURCE_MAX_AGE_MS, prepareFlinDexSnapshot, type FlinPreparation } from '../market/flinQueue.js';
import { INTERVAL_MS } from '../market/types.js';
import type { DexPair } from '../providers/dexscreener.js';
import { futuresResearchInstrumentId, type FuturesMarketContext, type FuturesResearchSnapshot } from '../providers/binanceFuturesResearch.js';
import type { MintObservation } from '../providers/solanaRpc.js';

export const DUAL_RESEARCH_VERSION = 'mia-dual-research-v1';
export const FAST_RESEARCH_MAX_AGE_MS = FLIN_SOURCE_MAX_AGE_MS;
type MissingFuturesEvidence = 'FUTURES_FUNDING' | 'OPEN_INTEREST' | 'MARGIN' | 'LIQUIDATION_STRESS' | 'EXECUTABLE_BOOK' | 'VALIDATED_STRATEGY_EDGE';

export interface FastResearchResult {
  version: typeof DUAL_RESEARCH_VERSION;
  lane: 'FAST_MEMECOIN';
  rolloutMode: 'RESEARCH_ONLY';
  tradingAuthority: false;
  status: 'NO_TRADE';
  reason: string;
  sourceAsOf: number;
  expiresAt: number;
  mintSourceStatus: 'NOT_CHECKED' | 'OBSERVED' | 'UNAVAILABLE';
  candidates: Array<{
    chainId: string; pairAddress: string; mintAddress: string; symbol: string;
    ageMs: number | null; liquidityUsd: number; safetyStatus: string;
    knownQuote: boolean; mintObservation: MintObservation | null;
    eligibleForAutomation: false; reasons: string[];
  }>;
}

/** Actual DEX discovery state + canonical safety function. Not a new scanner or signer. */
export function assessFastMemecoinResearch(pairs: readonly DexPair[], sourceAsOf: number, nowTs = Date.now()): FastResearchResult {
  return describeFastPreparation(prepareFlinDexSnapshot(pairs, sourceAsOf, nowTs), new Map(), 'NOT_CHECKED');
}

export function describeFastPreparation(prepared: FlinPreparation, mints: ReadonlyMap<string, MintObservation>,
  mintSourceStatus: FastResearchResult['mintSourceStatus']): FastResearchResult {
  const candidates = prepared.candidates.slice(0, 200).map(({ pair, knownQuote, safety }) => {
    const mintObservation = mints.get(pair.baseAddress) ?? null;
    return {
      chainId: pair.chainId, pairAddress: pair.pairAddress, mintAddress: pair.baseAddress,
      symbol: pair.baseSymbol, ageMs: prepared.observedAt - pair.pairCreatedAt!, liquidityUsd: pair.liquidityUsd,
      knownQuote, mintObservation, safetyStatus: mintObservation?.status === 'BLOCKED' ? 'REJECTED' : safety.status,
      eligibleForAutomation: false as const,
      reasons: [...safety.reasons, ...(mintObservation?.reasons ?? []),
        ...(!knownQuote ? ['SOLANA_QUOTE_MINT_UNVERIFIED'] : []),
        'UNVERIFIED_SELL_EXECUTION_AND_CONTRACT_PERMISSIONS'],
    };
  });
  return {
    version: DUAL_RESEARCH_VERSION, lane: 'FAST_MEMECOIN', rolloutMode: 'RESEARCH_ONLY',
    tradingAuthority: false, status: 'NO_TRADE',
    reason: prepared.status === 'STALE_SOURCE' ? 'DEX_SOURCE_STALE_OR_MISSING'
      : candidates.length ? 'ONCHAIN_SECURITY_AND_SELL_ROUTE_NOT_VERIFIED' : 'NO_RECENT_DEX_PAIRS',
    sourceAsOf: prepared.sourceAsOf, expiresAt: prepared.expiresAt, candidates, mintSourceStatus,
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
  scenarioAnalysis: DeepScenarioAnalysis | null;
  directionForecasts: Partial<Record<'15m' | '1h' | '4h', DirectionForecast>>;
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
  const id = futuresResearchInstrumentId(snapshot.symbol);
  const chartEvidence = {
    '15m': analyzeChart(id, '15m', snapshot.candles['15m'], snapshot.asOf),
    '1h': analyzeChart(id, '1h', snapshot.candles['1h'], snapshot.asOf),
    '4h': analyzeChart(id, '4h', snapshot.candles['4h'], snapshot.asOf),
  };
  const marketContext = snapshot.context ?? { funding: null, openInterest: null };
  const directionForecasts: DeepFuturesResearchResult['directionForecasts'] = {};
  for (const interval of ['15m', '1h', '4h'] as const) {
    const forecast = buildDirectionForecast(id, interval, snapshot.candles[interval], snapshot.asOf);
    if (forecast) directionForecasts[interval] = forecast;
  }
  const common = {
    version: DUAL_RESEARCH_VERSION as typeof DUAL_RESEARCH_VERSION, lane: 'DEEP_FUTURES' as const,
    rolloutMode: 'RESEARCH_ONLY' as const, tradingAuthority: false as const,
    market: 'CRYPTO_PERPETUAL_FUTURES' as const, symbol: snapshot.symbol,
    source: snapshot.source, asOf: snapshot.asOf, chartEvidence, marketContext,
    scenarioAnalysis: analyzeDeepScenarios(chartEvidence),
    directionForecasts,
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
