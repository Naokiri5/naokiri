/**
 * Static MIA5 feature 06 audit. Reuses the canonical W-* registry and bounded
 * dispatch. A proposed AGT-001..100 roster would duplicate trading evaluators.
 * Coverage is descriptive, never a substitute for authenticated QCI evidence.
 */
import { WORKERS } from '../workers/registry.js';
import type { Domain } from '../workers/types.js';
import { HIVE_FEATURE_SLOTS, HIVE_REQUIRED_TICKS } from '../market/hiveFeatureVector.js';

export const HIVE_TARGET_BUCKETS = [
  'B01_TREND_REGIME', 'B02_MEAN_REVERSION', 'B03_ORDERBOOK_OFI',
  'B04_VPIN_TOXICITY', 'B05_VOLATILITY_SURFACE', 'B06_CROSS_SLEEVE_CORR',
  'B07_MEMECOIN_RUG_SHIELD', 'B08_YIELD_CARRY_ARB',
  'B09_EQUITY_MACRO_FLOW', 'B10_EXECUTION_SLIPPAGE',
] as const;
export type HiveBucket = typeof HIVE_TARGET_BUCKETS[number];

interface BucketEvidence {
  domains: readonly Domain[];
  /** Set false where a similar worker must NOT be represented as full support. */
  coverage: 'PARTIAL' | 'NOT_INTEGRATED';
  reason: string;
}
const TARGET_EVIDENCE: Record<HiveBucket, BucketEvidence> = {
  B01_TREND_REGIME: { domains: ['trend', 'regime'], coverage: 'PARTIAL', reason: 'Existing spot EMA and regime workers; no independent multi-venue regime certification.' },
  B02_MEAN_REVERSION: { domains: ['momentum', 'structure'], coverage: 'PARTIAL', reason: 'Existing indicator/swing workers; no separately validated hive alpha model.' },
  B03_ORDERBOOK_OFI: { domains: ['flow', 'liquidity'], coverage: 'PARTIAL', reason: 'Existing spot book and flow workers; full streaming L5 OFI is not certified.' },
  B04_VPIN_TOXICITY: { domains: [], coverage: 'NOT_INTEGRATED', reason: 'Rolling signed-volume imbalance is not calibrated VPIN and is not a trading veto.' },
  B05_VOLATILITY_SURFACE: { domains: ['volatility'], coverage: 'PARTIAL', reason: 'ATR/realized-vol spot workers, not a derivatives volatility surface.' },
  B06_CROSS_SLEEVE_CORR: { domains: [], coverage: 'NOT_INTEGRATED', reason: 'Existing portfolio correlation is not cross-sleeve production risk evidence.' },
  B07_MEMECOIN_RUG_SHIELD: { domains: ['onchain'], coverage: 'NOT_INTEGRATED', reason: 'Provider-blocked on-chain workers cannot certify DEX safety or rugs.' },
  B08_YIELD_CARRY_ARB: { domains: [], coverage: 'NOT_INTEGRATED', reason: 'No authenticated executable yield/carry evidence.' },
  B09_EQUITY_MACRO_FLOW: { domains: ['news'], coverage: 'NOT_INTEGRATED', reason: 'Crypto headline workers are not stocks/ETF macro-flow brokerage evidence.' },
  B10_EXECUTION_SLIPPAGE: { domains: ['execution', 'liquidity'], coverage: 'PARTIAL', reason: 'Spot order-book and fee checks exist; no multi-venue certified fills.' },
};

export function auditHiveWiring() {
  const ids = new Set(WORKERS.map(w => w.id));
  const dependencyGroups = new Set(WORKERS.map(w => w.dependencyGroup));
  const coverage = HIVE_TARGET_BUCKETS.map(id => {
    const target = TARGET_EVIDENCE[id];
    const candidates = WORKERS.filter(w => target.domains.includes(w.domain));
    return {
      id, coverage: target.coverage, reason: target.reason,
      relatedCanonicalWorkerIds: candidates.map(w => w.id),
      dataDriven: candidates.filter(w => w.capability === 'DATA_DRIVEN').length,
      providerBlocked: candidates.filter(w => w.capability === 'PROVIDER_BLOCKED').length,
    };
  });
  return {
    version: 'mia5-hive-coverage-v1' as const,
    canonicalWorkers: WORKERS.length,
    uniqueWorkerIds: ids.size,
    dependencyGroups: dependencyGroups.size,
    allHundredRegistered: WORKERS.length === 100 && ids.size === 100,
    featureSlots: HIVE_FEATURE_SLOTS,
    requiredWarmupTicks: HIVE_REQUIRED_TICKS,
    sharedMemoryAuthority: 'OBSERVATION_ONLY' as const,
    canAuthorizeTrade: false as const,
    canSubmitOrder: false as const,
    certifiedUnder4ms: false as const,
    buckets: coverage,
  };
}
