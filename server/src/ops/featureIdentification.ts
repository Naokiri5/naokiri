/**
 * MIA 5.x feature ownership and identification manifest.
 * Read-only snapshot inventory; no network calls, trading or wallet access.
 * Baseline inspected: Naokiri5/naokiri main@6476391f4d7e8f8884c76ac4e31bb3779c444d77.
 *
 * EXISTING_IN_MAIN means the canonical source was inspected on that baseline;
 * it does NOT mean the feature is certified for live trading.
 */
export type FeatureStatus = 'EXISTING_IN_MAIN' | 'UNMERGED_CANDIDATE' | 'GAP_OR_UNCERTIFIED';
export type IntegrationAction = 'REUSE' | 'EXTEND_EXISTING' | 'REVIEW_UNMERGED' | 'BUILD_ONLY_AFTER_GAP_PROVEN';

export type FeatureId =
  | 'market_ingestion' | 'market_state' | 'market_quality' | 'feature_calculations'
  | 'worker_evidence' | 'qci_consensus' | 'central_decision' | 'risk_authority'
  | 'trading_modes' | 'paper_oms' | 'financial_ledger' | 'ditas_memory'
  | 'event_bus' | 'engine_lease' | 'release_gates' | 'backups'
  | 'frontend_api' | 'auth_session' | 'live_adapter' | 'isolated_signer'
  | 'futures_risk' | 'production_privy' | 'three_environments'
  | 'live_order_state' | 'durable_outbox' | 'typed_event_envelope'
  | 'multimarket_adapters' | 'native_live_protection';

export interface FeatureIdentification {
  id: FeatureId;
  status: FeatureStatus;
  owner: string;
  inspectedMainPath?: string;
  candidatePr?: number;
  proposedAction: IntegrationAction;
  note: string;
}

/** Single authority per concern: extend owners; never clone these domains. */
export const MIA_AUTHORITIES = Object.freeze({
  market: 'server/src/market/',
  indicators: 'server/src/features/indicators.ts',
  workers: 'server/src/workers/',
  consensus: 'server/src/qci/',
  decision: 'server/src/decision/engine.ts',
  risk: 'server/src/risk/gate.ts',
  mode: 'server/src/core/mode.ts',
  execution: 'server/src/exec/oms.ts',
  accounting: 'server/src/portfolio/ledger.ts',
  memory: 'server/src/ditas/memory.ts',
  eventBus: 'server/src/core/bus.ts',
  database: 'server/src/db/db.ts',
  release: 'server/src/qa/gates.ts',
  ownerAuth: 'server/src/api/auth.ts',
} as const);

export const MIA_FEATURES: readonly FeatureIdentification[] = [
  {id:'market_ingestion',status:'EXISTING_IN_MAIN',owner:'market',inspectedMainPath:'server/src/market/fabric.ts',proposedAction:'EXTEND_EXISTING',note:'Provider polling and normalization already exist; add new venues via adapters.'},
  {id:'market_state',status:'EXISTING_IN_MAIN',owner:'market',inspectedMainPath:'server/src/market/store.ts',proposedAction:'REUSE',note:'Do not create a second canonical quote/store service.'},
  {id:'market_quality',status:'EXISTING_IN_MAIN',owner:'market',inspectedMainPath:'server/src/market/quality.ts',proposedAction:'EXTEND_EXISTING',note:'Reuse freshness, candle and book validations.'},
  {id:'feature_calculations',status:'EXISTING_IN_MAIN',owner:'indicators',inspectedMainPath:'server/src/features/indicators.ts',proposedAction:'REUSE',note:'Workers should interpret features rather than calculate duplicate indicators.'},
  {id:'worker_evidence',status:'EXISTING_IN_MAIN',owner:'workers',inspectedMainPath:'server/src/workers/runtime.ts',proposedAction:'REUSE',note:'Deterministic evaluators produce evidence only.'},
  {id:'qci_consensus',status:'EXISTING_IN_MAIN',owner:'consensus',inspectedMainPath:'server/src/qci/coordinator.ts',proposedAction:'REUSE',note:'Consensus is evidence, not trading authorization.'},
  {id:'central_decision',status:'EXISTING_IN_MAIN',owner:'decision',inspectedMainPath:'server/src/decision/engine.ts',proposedAction:'EXTEND_EXISTING',note:'Live decisions require deliberate enhancement without new decision engine.'},
  {id:'risk_authority',status:'EXISTING_IN_MAIN',owner:'risk',inspectedMainPath:'server/src/risk/gate.ts',proposedAction:'EXTEND_EXISTING',note:'One deterministic fail-closed risk authority for demo and live.'},
  {id:'trading_modes',status:'EXISTING_IN_MAIN',owner:'mode',inspectedMainPath:'server/src/core/mode.ts',proposedAction:'EXTEND_EXISTING',note:'PAPER, APPROVAL and BOUNDED_LIVE are already defined; live activation is blocked.'},
  {id:'paper_oms',status:'EXISTING_IN_MAIN',owner:'execution',inspectedMainPath:'server/src/exec/oms.ts',proposedAction:'REUSE',note:'Paper execution persists orders, fills, protective state and ledger entries.'},
  {id:'financial_ledger',status:'EXISTING_IN_MAIN',owner:'accounting',inspectedMainPath:'server/src/portfolio/ledger.ts',proposedAction:'EXTEND_EXISTING',note:'Keep accounts and actual/simulated balances distinct.'},
  {id:'ditas_memory',status:'EXISTING_IN_MAIN',owner:'memory',inspectedMainPath:'server/src/ditas/memory.ts',proposedAction:'EXTEND_EXISTING',note:'Append-only decision/evidence lineage; do not replace it.'},
  {id:'event_bus',status:'EXISTING_IN_MAIN',owner:'eventBus',inspectedMainPath:'server/src/core/bus.ts',proposedAction:'EXTEND_EXISTING',note:'In-process EventEmitter; cross-process durability is not guaranteed.'},
  {id:'engine_lease',status:'EXISTING_IN_MAIN',owner:'operations',inspectedMainPath:'server/src/ops/lease.ts',proposedAction:'EXTEND_EXISTING',note:'DB lease exists; evaluate fencing for external live venue writes.'},
  {id:'release_gates',status:'EXISTING_IN_MAIN',owner:'release',inspectedMainPath:'server/src/qa/gates.ts',proposedAction:'REUSE',note:'G01–G14 are authoritative; missing gates must never be treated as passed.'},
  {id:'backups',status:'EXISTING_IN_MAIN',owner:'operations',inspectedMainPath:'server/src/ops/backup.ts',proposedAction:'EXTEND_EXISTING',note:'Snapshot/verify workflow exists; check operational restore evidence.'},
  {id:'frontend_api',status:'EXISTING_IN_MAIN',owner:'frontend',inspectedMainPath:'web/src/api.ts',proposedAction:'REUSE',note:'Central client API transport and SSE hooks.'},
  {id:'auth_session',status:'EXISTING_IN_MAIN',owner:'ownerAuth',inspectedMainPath:'server/src/api/auth.ts',proposedAction:'EXTEND_EXISTING',note:'Existing owner session and step-up remain authoritative pending verified migration.'},
  {id:'live_adapter',status:'GAP_OR_UNCERTIFIED',owner:'execution',proposedAction:'BUILD_ONLY_AFTER_GAP_PROVEN',note:'No certified live venue adapter is present in inspected main; do not infer from drafts.'},
  {id:'isolated_signer',status:'GAP_OR_UNCERTIFIED',owner:'security',proposedAction:'BUILD_ONLY_AFTER_GAP_PROVEN',note:'No production live isolated signer in inspected main.'},
  {id:'futures_risk',status:'GAP_OR_UNCERTIFIED',owner:'risk',proposedAction:'EXTEND_EXISTING',note:'Requires margin, funding, liquidation and derivative-specific controls.'},
  {id:'production_privy',status:'UNMERGED_CANDIDATE',owner:'ownerAuth',candidatePr:103,proposedAction:'REVIEW_UNMERGED',note:'PR #103 is draft; does not prove deployed wallet-authenticated production sign-in.'},
  {id:'three_environments',status:'UNMERGED_CANDIDATE',owner:'mode',candidatePr:92,proposedAction:'REVIEW_UNMERGED',note:'PR #92 proposes PAPER/TESTNET/LIVE; do not merge without base reconciliation.'},
  {id:'live_order_state',status:'UNMERGED_CANDIDATE',owner:'execution',candidatePr:97,proposedAction:'REVIEW_UNMERGED',note:'PR #97 proposes non-executing live-readiness and order-state evidence.'},
  {id:'durable_outbox',status:'UNMERGED_CANDIDATE',owner:'eventBus',candidatePr:43,proposedAction:'REVIEW_UNMERGED',note:'PR #43 addresses a scoped transactional outbox; verify adoption and coverage.'},
  {id:'typed_event_envelope',status:'UNMERGED_CANDIDATE',owner:'eventBus',candidatePr:41,proposedAction:'REVIEW_UNMERGED',note:'PR #41 proposes event contracts; avoid parallel event schemas.'},
  {id:'multimarket_adapters',status:'UNMERGED_CANDIDATE',owner:'market',candidatePr:95,proposedAction:'REVIEW_UNMERGED',note:'PR #95 adds provider research adapters; not certified for live execution.'},
  {id:'native_live_protection',status:'GAP_OR_UNCERTIFIED',owner:'execution',proposedAction:'BUILD_ONLY_AFTER_GAP_PROVEN',note:'Live protective order acknowledgment and monitor reconciliation required.'},
] as const;

export function identifyFeatures(mainTreePaths: ReadonlySet<string>): Array<FeatureIdentification & {presentOnScannedMain:boolean;reviewRequired:boolean}> {
  return MIA_FEATURES.map(f => {
    const presentOnScannedMain = f.inspectedMainPath ? mainTreePaths.has(f.inspectedMainPath) : false;
    return {
      ...f,
      presentOnScannedMain,
      reviewRequired: f.status !== 'EXISTING_IN_MAIN' || !presentOnScannedMain,
    };
  });
}

/** Fails if a manifest accidentally gives two independent owners to a feature ID. */
export function assertUniqueFeatureIds(entries: readonly FeatureIdentification[] = MIA_FEATURES): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`duplicate feature ID: ${entry.id}`);
    ids.add(entry.id);
    if (entry.status === 'UNMERGED_CANDIDATE' && !entry.candidatePr) throw new Error(`unmerged feature missing PR: ${entry.id}`);
  }
}

export function actionFor(id: FeatureId): IntegrationAction {
  const feature = MIA_FEATURES.find(f => f.id === id);
  if (!feature) throw new Error(`unknown MIA feature: ${id}`);
  return feature.proposedAction;
}