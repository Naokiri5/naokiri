import type { FeatureSnapshot } from '../features/indicators.js';
import type { Signal } from '../lab/strategies.js';
import type { Regime } from '../regime/regime.js';
import type { DataQuality } from '../market/quality.js';
import type { SafetyResult } from '../safety/safety.js';
import type { Interval } from '../market/types.js';

export type Stance = 'SUPPORT' | 'OPPOSE' | 'ABSTAIN';
export type Domain = 'trend' | 'momentum' | 'volatility' | 'flow' | 'liquidity' | 'structure' | 'regime' | 'news' | 'onchain' | 'risk' | 'execution';
export interface Candidate {
  id: string; eventId: string; traceId: string; instrumentId: string; symbol: string; base: string; market: string; venue: string;
  strategyId: string; strategyVersion: string; interval: Interval; signal: Signal; regime: Regime; createdAt: number;
}
export interface WorkerContext {
  /** Immutable evidence captured before asynchronous QCI review. */
  memorySnapshotId?: string;
  frameQuality?: Record<string, DataQuality>;
  candidate: Candidate;
  f: Partial<Record<Interval, FeatureSnapshot | null>>;
  btc1h: FeatureSnapshot | null; btc4h: FeatureSnapshot | null;
  ticker: { last: number; changePct: number; quoteVolume: number; trades: number; high: number; low: number } | null;
  impact: { spreadBps: number; impactBps: number; depth1pct: number; filledFully: boolean; bookImbalance: number } | null;
  intendedNotional: number; feeRate: number;
  quality: DataQuality; safety: SafetyResult;
  news: { relevant: number; positive: number; negative: number; highImpactMacro: number; headlines: string[] } | null;
  prints: { buyNotional: number; sellNotional: number; count: number } | null;
  corrToBtc: number | null;
  strategyStats: { trades: number; expectancyR: number; profitFactor: number } | null;
}
export interface WorkerResult { stance: Stance; features: Record<string, number | string | boolean | null>; reasons: string[]; veto?: boolean }
export interface WorkerDef {
  id: string; name: string; domain: Domain; version: string;
  /** Workers in the same dependency group share an upstream input and are NOT independent confirmations. */
  dependencyGroup: string; sourceIds: string[];
  mandatory?: boolean; canVeto?: boolean;
  evaluate(ctx: WorkerContext): WorkerResult;
}
