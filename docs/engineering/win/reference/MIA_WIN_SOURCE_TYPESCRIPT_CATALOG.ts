/**
 * SOURCE FIDELITY CATALOG — NOT RUNTIME CODE.
 * Types and declarations transcribed from the uploaded 26-page PDF, Document 2.
 * PDF artifacts (page boundaries and zero-width characters) have been removed.
 * The supplied PDF names 18 implementation artifacts but only declares APIs
 * for 10 grouped sections; no executable implementations are in this catalog.
 * Preserve these declarations as historical source requirements; integrate only
 * after architecture reconciliation and owner review.
 */
// ============================================================================
     // MIA WHALE INTELLIGENCE NETWORK (WIN-01..WIN-06) — TYPESCRIPT API CATALOG
     // ============================================================================

     // ----------------------------------------------------------------------------
     // 1. server/src/whales/observations.ts (WIN-01)
     // ----------------------------------------------------------------------------
     export type WhaleSource =
         | "SOLANA_WALLET_SWAP"
         | "CEX_LARGE_PRINT"
         | "FUTURES_POSITIONING"
         | "INSTITUTIONAL_FILING";

     export type WhaleLane = "FAST" | "DEEP";

export interface WhaleObservation {
 id: string;
  source: WhaleSource;
  sourceId: string;
  instrumentId: string;
  observedAt: number;
  receivedAt: number;
  walletAddress?: string;
  transactionSignature?: string;
  slotOrBlock?: number;
  confirmed: boolean;
  side: "BUY" | "SELL" | "UNKNOWN";
  baseAmount: number;
  quoteAmount: number;
  effectivePrice: number;
  feeQuote: number;
  sourceSnapshotId: string;
  rawPayloadHash: string;
}

export type WhaleAssessment =
  | { status: "RESEARCH_ONLY"; reason: string }
  | { status: "REJECTED"; reason: string }
  | { status: "CANDIDATE"; observationId: string };

export interface SolanaTokenBalanceDelta {
  mint: string;
  owner: string;
  preAmountUi: number;
  postAmountUi: number;
}

export declare function normalizeSolanaSwapFromBalances(params: {
 walletAddress: string;
 signature: string;
 slot: number;
 confirmed: boolean;
 observedAt: number;
 receivedAt: number;
 solFeeLamports: number;
 solPriceUsd: number;
 tokenDeltas: SolanaTokenBalanceDelta[];
 nativeSolDeltaUi: number;
 sourceSnapshotId: string;
}): WhaleObservation | null;

export declare function assessWhaleObservation(
  event: WhaleObservation,
  lane: WhaleLane,
  now: number,
  maxAgeMs: number
): WhaleAssessment;

// ----------------------------------------------------------------------------
// 2. server/src/whales/walletProfiler.ts (WIN-02)
// ----------------------------------------------------------------------------
export interface ReconstructedLot {
    instrumentId: string;
  openTime: number;
  closeTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  delayedCopyPnlUsd: number;
  holdingMs: number;
}

export interface WhaleProfileMetrics {
  walletAddress: string;
  verifiedTradeCount: number;
  orphanSellCount: number;
  coverageRatio: number;
  realizedNetPnlUsd: number;
  unrealizedBagPnlUsd: number;
  totalAdjustedPnlUsd: number;
  maxDrawdownPct: number;
  medianHoldingMs: number;
  delayedCopyNetPnlUsd: number;
  lagResilienceRatio: number;
  status: "INSUFFICIENT_EVIDENCE" | "CALIBRATED" | "QUARANTINED";
  qualityScore: number | null;
  disqualificationReason?: string;
}

export interface MarkPriceLookup {
  getMarkPrice(instrumentId: string): number | null;
  getDelayedQuotePrice(
    instrumentId: string,
    observedAt: number,
    lagMs: number,
    side: "BUY" | "SELL"
  ): number | null;
}

export declare function profileWhaleWallet(
  walletAddress: string,
  chronologicalSwaps: readonly WhaleObservation[],
  marketLookup: MarkPriceLookup,
  now: number
): WhaleProfileMetrics;

// ----------------------------------------------------------------------------
// 3. server/src/safety/safety.ts (WIN-03 · Reconciled with PR #50)
// ----------------------------------------------------------------------------
export interface SolanaMintSecuritySnapshot {
    mintAddress: string;
  programId: "TOKEN_LEGACY" | "TOKEN_2022" | "UNKNOWN";
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  transferFeeBps: number;
  hasPermanentDelegate: boolean;
  hasNonTransferableExtension: boolean;
  poolLiquidityUsd: number;
  top10HoldersPct: number;
  creatorRemainingPct: number;
  creatorSoldRecently: boolean;
  sellSimulationSuccess: boolean;
  simulatedSellTaxBps: number;
  fetchedAt: number;
}

export interface SolanaSafetyPolicy {
  minPoolLiquidityUsd: number;
  maxTop10HoldersPct: number;
  maxTransferFeeBps: number;
  maxSimulatedSellTaxBps: number;
  maxSnapshotAgeMs: number;
}

export interface MintSafetyVerdict {
    safe: boolean;
  vetoReasons: string[];
  snapshot: SolanaMintSecuritySnapshot | null;
}

export interface SolanaMintInspector {
  fetchMintSecuritySnapshot(
    mintAddress: string,
    timeoutMs: number
  ): Promise<SolanaMintSecuritySnapshot | null>;
}

export declare const DEFAULT_SOLANA_SAFETY_POLICY: SolanaSafetyPolicy;

export declare function screenSolanaMint(
  mintAddress: string,
  inspector: SolanaMintInspector,
  now: number,
  policy?: SolanaSafetyPolicy
): Promise<MintSafetyVerdict>;

// ----------------------------------------------------------------------------
// 4. server/src/whales/fastSignals.ts (WIN-03)
// ----------------------------------------------------------------------------
export interface WhaleFollowConfig {
    configId: string;
  whaleId: string;
  walletAddress: string;
  lane: "FAST";
  selectionMode: "USER_SELECTED" | "MIA_PROPOSED";
  executionMode: "READ_ONLY" | "PAPER" | "LIVE_LOCKED";
  maxEntryDriftBps: number;
  maxSignalAgeMs: number;
  minPoolLiquidityUsd: number;
  targetNotionalUsd: number;
  active: boolean;
}

export interface ObtainableDexQuote {
  mintAddress: string;
  side: "BUY" | "SELL";
  notionalUsd: number;
  obtainablePriceUsd: number;
  priceImpactBps: number;
  estimatedPriorityFeeUsd: number;
  routeHopCount: number;
  quoteExpiresAt: number;
}

export interface JupiterQuoteProvider {
  getObtainableQuote(params: {
    mintAddress: string;
    side: "BUY" | "SELL";
    notionalUsd: number;
    maxSlippageBps: number;
  }): Promise<ObtainableDexQuote | null>;
}

export interface QciWhaleEvidencePacket {
  packetId: string;
  sourceDomain: "WHALE_FAST";
  sleeve: "memecoin";
  observationId: string;
  whaleId: string;
  walletAddress: string;
  instrumentId: string;
  mintAddress: string;
  side: "BUY" | "SELL";
  whaleEffectivePrice: number;
  miaObtainablePrice: number;
  entryDriftBps: number;
  priceImpactBps: number;
  estimatedPriorityFeeUsd: number;
  whaleQualityScore: number;
  lagResilienceRatio: number;
  safetySnapshotFetchedAt: number;
  quoteExpiresAt: number;
  createdAt: number;
}

export type FastSignalEvaluationResult =
  | {
      outcome: "REJECTED";
      observationId: string;
        reasons: string[];
        whaleEntryPrice: number;
        miaObtainablePrice: number | null;
        entryDriftBps: number | null;
      }
    | {
        outcome: "READ_ONLY_LOGGED";
        observationId: string;
        packet: QciWhaleEvidencePacket;
      }
    | {
        outcome: "QCI_CANDIDATE_READY";
        observationId: string;
        packet: QciWhaleEvidencePacket;
      };

export interface FastSignalDependencies {
    mintInspector: SolanaMintInspector;
  quoteProvider: JupiterQuoteProvider;
  hasProcessedSignature: (signature: string) => boolean;
}

export declare function evaluateFastWhaleSignal(
  observation: WhaleObservation,
  followConfig: WhaleFollowConfig,
  whaleProfile: WhaleProfileMetrics,
  deps: FastSignalDependencies,
  now: number
): Promise<FastSignalEvaluationResult>;

// ----------------------------------------------------------------------------
// 5. server/src/workers/whaleFastEvidenceWorker.ts (WIN-03)
// ----------------------------------------------------------------------------
export interface QciEvidenceVote {
    workerId: string;
    sourceDomain: string;
    instrumentId: string;
    sleeve: "memecoin";
    direction: "LONG" | "SHORT" | "ABSTAIN";
    confidence: number;
    weight: number;
    evidenceRefId: string;
    rationale: string;
    expiresAt: number;
}

export interface QciConsensusSnapshot {
    instrumentId: string;
  verdict: "TRADE" | "WAIT" | "REJECT";
  aggregatedConfidence: number;
  supportingWorkerCount: number;
  adversarialVetoTriggered: boolean;
  vetoReason?: string;
}

export declare function buildWhaleFastQciVote(
  packet: QciWhaleEvidencePacket,
  now: number
): QciEvidenceVote;

// ----------------------------------------------------------------------------
// 6. server/src/risk/whaleRiskBridge.ts (WIN-03)
// ----------------------------------------------------------------------------
export interface SleeveRiskState {
    sleeve: "memecoin";
  allocatedCapitalUsd: number;
  currentExposureUsd: number;
  dailyRealizedPnlUsd: number;
  dailyDrawdownLimitUsd: number;
  rolling30TradeExpectancyUsd: number;
  circuitBreakerTripped: boolean;
}

export interface RiskAuthorizationDecision {
  approved: boolean;
  canonicalDecisionId: string;
  authorizedNotionalUsd: number;
  executionMode: "PAPER";
  vetoReason?: string;
}

export interface PaperOrderIntent {
  intentId: string;
  canonicalDecisionId: string;
  sleeve: "memecoin";
  instrumentId: string;
  side: "BUY" | "SELL";
  notionalUsd: number;
  limitPriceUsd: number;
  maxSlippageBps: number;
  stopLossPct: number;
  takeProfitPct: number;
  metadata: {
    lane: "FAST";
    observationId: string;
    whaleId: string;
    whaleEntryPrice: number;
    entryDriftBps: number;
  };
}

export interface PaperOmsExecutor {
  submitPaperShadowOrder(intent: PaperOrderIntent): Promise<{
    accepted: boolean;
    simulatedFillPriceUsd: number | null;
    rejectReason?: string;
  }>;
}

export interface WhaleOutcomeRepository {
  recordWhaleOutcome(record: {
    outcomeId: string;
    observationId: string;
    canonicalDecisionId: string;
    lane: "FAST";
    decisionVerdict: "TRADE" | "WAIT" | "MONITOR" | "REJECT";
    vetoReason: string | null;
    whaleEntryPrice: number;
    miaObtainablePrice: number | null;
    entryDriftBps: number | null;
    recordedAt: number;
  }): void;
}

export declare function authorizeWhaleFastRisk(params: {
 packet: QciWhaleEvidencePacket;
 qciConsensus: QciConsensusSnapshot;
 sleeveRisk: SleeveRiskState;
 requestedNotionalUsd: number;
 requestedExecutionMode: "READ_ONLY" | "PAPER" | "LIVE_LOCKED";
 now: number;
}): RiskAuthorizationDecision;

export declare function executeWhaleFastPaperShadow(params: {
 packet: QciWhaleEvidencePacket;
 riskDecision: RiskAuthorizationDecision;
 paperOms: PaperOmsExecutor;
 outcomeRepo: WhaleOutcomeRepository;
 now: number;
}): Promise<void>;

// ----------------------------------------------------------------------------
// 7. server/src/whales/institutional.ts (WIN-04)
// ----------------------------------------------------------------------------
export type DeepMarketClass = "FUTURES" | "FOREX" | "EQUITIES";

export interface InstitutionalFootprintRecord {
    footprintId: string;
  source: Exclude<WhaleSource, "SOLANA_WALLET_SWAP">;
  marketClass: DeepMarketClass;
  instrumentId: string;
  attributionClass: "INFERRED_ENTITY";
  eventPeriodEndAt: number;
  availableAt: number;
  directionalBias: "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
  footprintIntensity: number;
  structuralContextOnly: boolean;
  metrics: {
    notionalUsd?: number;
    volumeZScore?: number;
    openInterestDeltaPct?: number;
    fundingRateBps?: number;
    liquidationImbalanceUsd?: number;
    cotLeveragedNetZScore?: number;
    sec13fQuarterShareDeltaPct?: number;
    darkPoolBlockRatio?: number;
  };
  sourceSnapshotId: string;
}

export interface AggregatedInstitutionalContext {
  instrumentId: string;
  marketClass: DeepMarketClass;
  asOfTime: number;
  netDirectionalScore: number;
  impulseIntensity: number;
  structuralBiasScore: number;
  supportingRecordIds: string[];
  discardedLookaheadCount: number;
  staleRecordCount: number;
}

export declare function isPointInTimeAvailable(
  record: InstitutionalFootprintRecord,
  asOfTime: number
): { valid: boolean; reason?: string };

export declare function buildInstitutionalFootprintFromObservation(params: {
 observation: WhaleObservation;
 marketClass: DeepMarketClass;
 availableAt: number;
 metrics: InstitutionalFootprintRecord["metrics"];
}): InstitutionalFootprintRecord | null;

export declare function synthesizeInstitutionalContext(
  instrumentId: string,
  marketClass: DeepMarketClass,
  records: readonly InstitutionalFootprintRecord[],
  asOfTime: number
): AggregatedInstitutionalContext;

// ----------------------------------------------------------------------------
// 8. server/src/whales/strategyDna.ts (WIN-04)
// ----------------------------------------------------------------------------
export interface OhlcvBar {
    timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  atr14: number;
  bidAskSpreadBps: number;
}

export interface MarketFrictionModel {
  marketClass: DeepMarketClass;
  takerFeeBps: number;
  makerFeeBps: number;
  slippageBps: number;
  carryCostBpsPerHour: number;
  signalToFillLatencyMs: number;
  enforceRegularTradingHours: boolean;
}

export declare const DEFAULT_FRICTION_MODELS: Record<DeepMarketClass,
MarketFrictionModel>;

export interface LiquiditySweepZone {
  direction: "LONG" | "SHORT";
  sweptLevel: number;
  sweepExtremePrice: number;
  entryZone: { low: number; high: number };
  invalidationPrice: number;
  targetPrice: number;
  vwapAnchor: number;
  detectedAt: number;
}

export interface HistoricalSetupSample {
  setupId: string;
  strategyId: string;
  marketClass: DeepMarketClass;
  instrumentId: string;
  decisionTime: number;
  resolvedAt: number;
  rawModelScore: number;
  netReturnBps: number;
  profitableAfterCosts: boolean;
}

export interface WalkForwardCalibrationReport {
  strategyId: string;
  marketClass: DeepMarketClass;
  status: "CALIBRATED" | "INSUFFICIENT_EVIDENCE";
  sampleSize: number;
  brierScore: number | null;
  logLoss: number | null;
  calibratedProbability: number | null;
  uncertaintyInterval: { low: number; high: number } | null;
  expectedNetReturnBps: number | null;
  disqualificationReason?: string;
}

export interface DeepStrategyHypothesis {
  hypothesisId: string;
  observationId: string;
  lane: "DEEP";
  marketClass: DeepMarketClass;
  instrumentId: string;
  direction: "LONG" | "SHORT" | "NONE";
  strategyId: string;
  strategyVersion: string;
  evidenceSnapshotId: string;
  entryZone: { low: number; high: number } | null;
  invalidationPrice: number | null;
  targetPrice: number | null;
  maxHoldingMs: number;
  calibratedProbability: number | null;
  uncertaintyLow: number | null;
  uncertaintyHigh: number | null;
  probabilitySampleSize: number;
  expectedNetEdgeBps: number | null;
  status: "RESEARCH_ONLY" | "CANDIDATE";
  rejectionReason?: string;
  expiresAt: number;
  createdAt: number;
}

export interface NoLookaheadReplayTrade {
  hypothesisId: string;
  marketClass: DeepMarketClass;
  instrumentId: string;
  direction: "LONG" | "SHORT";
  decisionTime: number;
  fillTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  exitReason: "TARGET_HIT" | "INVALIDATION_STOP" | "MAX_HOLDING_EXPIRY";
  grossReturnBps: number;
  totalFrictionBps: number;
  netReturnBps: number;
}

export interface NoLookaheadReplaySummary {
    marketClass: DeepMarketClass;
  totalBarsEvaluated: number;
  candidateCount: number;
  executedTradeCount: number;
  winRatePct: number;
  meanNetReturnBps: number;
  cumulativeNetReturnBps: number;
  maxDrawdownBps: number;
  trades: NoLookaheadReplayTrade[];
}

export declare function detectLiquiditySweepZone(
  bars: readonly OhlcvBar[],
  institutionalNetScore: number,
  now: number
): LiquiditySweepZone | null;

export declare function calibrateWalkForwardProbability(params: {
 strategyId: string;
 marketClass: DeepMarketClass;
 historicalSamples: readonly HistoricalSetupSample[];
 currentRawScore: number;
 asOfTime: number;
}): WalkForwardCalibrationReport;

export declare function isUsEquitiesRegularSession(timestampMs: number): boolean;

export declare function evaluateDeepStrategyHypothesis(params: {
 observationId: string;
 instrumentId: string;
 marketClass: DeepMarketClass;
 bars: readonly OhlcvBar[];
 institutionalRecords: readonly InstitutionalFootprintRecord[];
 historicalSamples: readonly HistoricalSetupSample[];
 now: number;
 maxHoldingMs?: number;
 frictionModel?: MarketFrictionModel;
}): DeepStrategyHypothesis;

export declare function runNoLookaheadDeepReplay(params: {
 instrumentId: string;
 marketClass: DeepMarketClass;
 chronologicalBars: readonly OhlcvBar[];
 allInstitutionalRecords: readonly InstitutionalFootprintRecord[];
 seedCalibrationSamples: readonly HistoricalSetupSample[];
 maxHoldingBars?: number;
 frictionModel?: MarketFrictionModel;
}): NoLookaheadReplaySummary;

// ----------------------------------------------------------------------------
// 9. server/src/exec/whaleDurableOmsBridge.ts (WIN-05)
// ----------------------------------------------------------------------------
export type WhaleOmsSleeve = "memecoin" | "futures" | "forex" | "stocks_etf";

export type WhaleOmsState =
    | "RESERVED"
    | "SUBMITTED"
    | "PARTIAL_FILL"
    | "FILLED"
    | "CANCELLED"
    | "VETOED"
    | "RECONCILE_HALTED";

export interface UnifiedSleeveRiskSnapshot {
    accountId: string;
  sleeve: WhaleOmsSleeve;
  executionMode: "PAPER" | "LIVE_LOCKED";
  allocatedCapitalUsd: number;
  activeExposureUsd: number;
  reservedMarginUsd: number;
  dailyRealizedPnlUsd: number;
  dailyDrawdownLimitUsd: number;
  rolling30TradeCount: number;
  rolling30TradeExpectancyUsd: number;
  emergencyPauseActive: boolean;
  g01ToG14Certified: boolean;
  maxPermittedLeverage: number;
  maintenanceMarginRatio?: number;
  currentSpreadBps?: number;
  corporateActionHaltActive?: boolean;
}

export interface UnifiedWhaleTradeIntent {
  idempotencyKey: string;
  canonicalDecisionId: string;
  accountId: string;
  executionMode: "PAPER" | "LIVE_LOCKED";
  lane: "FAST" | "DEEP";
  sleeve: WhaleOmsSleeve;
  instrumentId: string;
  side: "BUY" | "SELL";
  requestedNotionalUsd: number;
  requestedLeverage: number;
  limitPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  expiresAt: number;
}

export interface VenueOrderAdapter {
  readonly accountId: string;
  readonly executionMode: "PAPER";
  placeOrder(intent: {
    intentId: string;
    idempotencyKey: string;
    instrumentId: string;
    side: "BUY" | "SELL";
    notionalUsd: number;
    leverage: number;
    limitPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
  }): Promise<{
    status: "FILLED" | "PARTIAL_FILL" | "OPEN" | "REJECTED";
    venueOrderId: string | null;
    filledNotionalUsd: number;
    avgFillPrice: number | null;
    rejectReason?: string;
  }>;
  queryOrderByClientKey(idempotencyKey: string): Promise<{
    found: boolean;
    status: "FILLED" | "PARTIAL_FILL" | "OPEN" | "CANCELLED" | "UNKNOWN";
    venueOrderId: string | null;
    filledNotionalUsd: number;
    avgFillPrice: number | null;
  }>;
}

export interface DurableExecutionReceipt {
        intentId: string;
      state: WhaleOmsState;
      reservedMarginUsd: number;
      filledNotionalUsd: number;
      avgFillPrice: number | null;
      vetoOrErrorReason: string | null;
    }

    export declare function evaluateCanonicalWhaleRisk(
      intent: UnifiedWhaleTradeIntent,
      risk: UnifiedSleeveRiskSnapshot,
      now: number
    ): { approved: boolean; requiredMarginUsd: number; vetoReason?: string };

    export declare class DurableWhaleOmsBridge {
        constructor(db: unknown);
      submitDurableIntent(
        intent: UnifiedWhaleTradeIntent,
        risk: UnifiedSleeveRiskSnapshot,
        adapter: VenueOrderAdapter,
        now: number
      ): Promise<DurableExecutionReceipt>;
      reconcileInFlightOnStartup(
        adaptersByAccount: ReadonlyMap<string, VenueOrderAdapter>,
        now: number
      ): Promise<{ reconciledCount: number; haltedCount: number }>;
    }

    // ----------------------------------------------------------------------------
    // 10. Routes & Barrel (server/src/routes/* & server/src/whales/index.ts)
    // ----------------------------------------------------------------------------
    export declare function registerCopyRoutes(app: unknown, db: unknown): void;
    export declare function registerWhaleDeepRoutes(app: unknown, db: unknown): void;
    export declare function registerWhaleIntelligenceRoutes(app: unknown, db: unknown): void;

