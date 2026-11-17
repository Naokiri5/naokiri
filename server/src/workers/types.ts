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
  /** Market advance/decline breadth (optional: older snapshots and fixtures may not carry it). */
  breadth?: { universe: number; advancers: number; decliners: number; asOf: number | null } | null;
  strategyStats: { trades: number; expectancyR: number; profitFactor: number } | null;
}
export interface WorkerResult { stance: Stance; features: Record<string, number | string | boolean | null>; reasons: string[]; veto?: boolean }
export type WorkerCapability = 'DATA_DRIVEN' | 'CONSTANT_RULE' | 'PROVIDER_BLOCKED';
export interface WorkerDef {
  id: string; name: string; domain: Domain; version: string;
  /** Workers in the same dependency group share an upstream input and are NOT independent confirmations. */
  dependencyGroup: string; sourceIds: string[];
  mandatory?: boolean; canVeto?: boolean;
  /** DATA_DRIVEN evaluates market data; CONSTANT_RULE returns a fixed verdict by construction; PROVIDER_BLOCKED needs a feed that is not connected. */
  capability: WorkerCapability;
  evaluate(ctx: WorkerContext): WorkerResult;
}
