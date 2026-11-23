import { createHash } from 'node:crypto';
import type {
  BrainSkillId, MarketVenueClass, MiaStrategyGenome, ReadinessStatus, RejectionReasonCode,
} from './contracts.js';

export const SIGNAL_FAMILIES = [
  'trend_following', 'pullback_continuation', 'momentum_breakout','mean_reversion',
  'volatility_expansion','volatility_compression','funding_carry','basis_reversion',
  'cross_asset_relative_strength','event_driven_trading',
] as const;
export const REGIMES = [
  'trend_expansion','trend_exhaustion','range_compression',
  'high_volatility_shock','low_liquidity_chop',
] as const;
export const RESEARCH_TIMEFRAMES = ['1m','5m','15m','1h','4h'] as const;
export const EXIT_VARIANTS = [
  { id:'v1_atr_bracket',entry:'confirm_close',invalid:'structure_break',exit:'atr_trail_tp' },
  { id:'v2_vol_scaled',entry:'pullback_limit',invalid:'vol_spike',exit:'partial_scale_out' },
  { id:'v3_time_stop',entry:'breakout_retest',invalid:'failed_retest',exit:'horizon_or_stop' },
  { id:'v4_regime_tight',entry:'mean_revert_band',invalid:'regime_shift',exit:'midline_or_hard_stop' },
] as const;
export interface GenomeGenerationConfig {
  lineageId: string;
  version: string;
  market: MarketVenueClass;
  datasetHash: string;
  costModelVersion: string;
  knowledgeSources: readonly string[];
  requiredSkills: readonly BrainSkillId[];
  requiredAgentRoles: readonly string[];
  signalFamilies?: readonly string[];
  regimes?: readonly string[];
  timeframes?: readonly string[];
  maxCandidates?: number;
}
const hash = (s:string)=>createHash('sha256').update(s).digest('hex');
export function genomeSignature(genome: Pick<MiaStrategyGenome,
  'market' | 'signalFamily' | 'eligibleRegimes' | 'timeframes' | 'entryRuleId' |
  'invalidationRuleId' | 'exitPolicyId' | 'costModelVersion' | 'datasetHash'>): string {
  return hash(JSON.stringify([
    genome.market,genome.signalFamily,[...genome.eligibleRegimes].sort(),
    [...genome.timeframes].sort(),genome.entryRuleId,genome.invalidationRuleId,
    genome.exitPolicyId,genome.costModelVersion,genome.datasetHash,
  ]));
}
/** Generate exactly 1000 default research hypotheses, never deploy 1000 strategies. */
export function generateCandidateGenomes(cfg: GenomeGenerationConfig): MiaStrategyGenome[] {
  if (!cfg.lineageId || !cfg.version || !cfg.datasetHash || !cfg.costModelVersion)
    throw new Error('GENOME_RESEARCH_PROVENANCE_REQUIRED');
  const cap = cfg.maxCandidates ?? 1000;
  if (!Number.isInteger(cap) || cap < 1 || cap > 1000) throw new Error('INVALID_GENOME_BUDGET');
  const out: MiaStrategyGenome[] = [], seen = new Set<string>();
  for(const family of cfg.signalFamilies ?? SIGNAL_FAMILIES)
    for(const regime of cfg.regimes ?? REGIMES)
      for(const timeframe of cfg.timeframes ?? RESEARCH_TIMEFRAMES)
        for(const variant of EXIT_VARIANTS) {
          if(out.length >= cap) return out;
          const draft: MiaStrategyGenome = {
            genomeId: '', lineageId: cfg.lineageId, version: cfg.version, market: cfg.market,
            signalFamily: family, eligibleRegimes: [regime], timeframes: [timeframe],
            hypothesis: family+' under '+regime+' at '+timeframe+' ('+variant.id+')',
            knowledgeSources: [...cfg.knowledgeSources],
            requiredSkills: [...cfg.requiredSkills],
            requiredAgentRoles: [...cfg.requiredAgentRoles],
            entryRuleId: variant.entry,invalidationRuleId: variant.invalid,
            exitPolicyId:variant.exit,costModelVersion:cfg.costModelVersion,
            datasetHash:cfg.datasetHash,state:'HYPOTHESIS',executionAuthority:false,
          };
          const signature = genomeSignature(draft);
          if (seen.has(signature)) continue;
          seen.add(signature);out.push({ ...draft,genomeId:'genome_'+signature.slice(0,24) });
        }
  return out;
}

/** External backtest hooks MUST provide verifiable, independent, real-data experiment metadata. */
export interface ValidationMetrics {
  datasetHash: string;
  independentHoldoutHash: string;
  walkForwardWindows: number;
  holdoutSampleCount: number;
  verifiedHistoricalData: boolean;
  walkForwardNetSharpe: number;
  holdoutNetSharpe: number;
  maxDrawdownPct: number;
  calibrationBrierScore: number;
  costMismatchPct: number;
  correlationCreepScore: number;
  driftScore: number;
  experimentId: string;
}
export interface StrategyEvaluatorHooks {
  getSkillStatus(id: BrainSkillId): ReadinessStatus;
  verifiedTimeframes: ReadonlySet<string>;
  verifiedVenues: ReadonlySet<MarketVenueClass>;
  /** Returns null for unavailable data; no mock fallback is permitted in production. */
  runWalkForwardAndHoldout(genome: MiaStrategyGenome, signal?: AbortSignal): Promise<ValidationMetrics|null>;
}
export interface GenomeFunnelResult {
  verified: MiaStrategyGenome[];
  rejected: MiaStrategyGenome[];
}
const rejected = (g: MiaStrategyGenome, code: RejectionReasonCode): MiaStrategyGenome =>
  ({ ...g, state: 'REJECTED', rejectionReason: code, executionAuthority: false });
const valid = (m:ValidationMetrics,g:MiaStrategyGenome) => Boolean(
  m.verifiedHistoricalData && m.datasetHash === g.datasetHash
  && m.independentHoldoutHash && m.independentHoldoutHash !== m.datasetHash
  && m.experimentId && m.walkForwardWindows >= 4 && m.holdoutSampleCount >= 50
  && [m.walkForwardNetSharpe,m.holdoutNetSharpe,m.maxDrawdownPct,m.calibrationBrierScore,
      m.costMismatchPct,m.correlationCreepScore,m.driftScore].every(Number.isFinite)
  && m.maxDrawdownPct >= 0 && m.calibrationBrierScore >= 0
  && m.calibrationBrierScore <= 1
);
/**
 * Research-only validation; no mutation of the existing strategy registry,
 * no portfolio exposure, no promotions, and no fabricated test outcomes.
 */
export async function runStrategyGenomeFunnel(
  candidates: readonly MiaStrategyGenome[], hooks: StrategyEvaluatorHooks,
  signal?: AbortSignal,
): Promise<GenomeFunnelResult> {
  const verified: MiaStrategyGenome[] = [], rejects: MiaStrategyGenome[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (signal?.aborted) break;
    const g = { ...raw, executionAuthority: false as const };
    const signature = genomeSignature(g);
    if (seen.has(signature)) { rejects.push(rejected(g,'DUPLICATE_GENOME_SIGNATURE'));continue; }
    seen.add(signature);
    if (!hooks.verifiedVenues.has(g.market)) {rejects.push(rejected(g,'UNSUPPORTED_VENUE_MECHANICS'));continue;}
    if (!g.timeframes.length || g.timeframes.some(tf=>!hooks.verifiedTimeframes.has(tf))) {
      rejects.push(rejected(g,'UNSUPPORTED_TIMEFRAME'));continue;
    }
    if (g.requiredSkills.some(id=>hooks.getSkillStatus(id)!=='READY')) {
      rejects.push(rejected(g,'MISSING_REQUIRED_CAPABILITY'));continue;
    }
    let m: ValidationMetrics | null = null;
    try {
      m=await hooks.runWalkForwardAndHoldout({...g,state:'BACKTESTING'},signal);
    } catch {rejects.push(rejected(g,'EVALUATOR_UNAVAILABLE'));continue;}
    if (signal?.aborted) break;
    if (!m || !valid(m,g)) {rejects.push(rejected(g,'INVALID_EVIDENCE'));continue;}
    if (m.costMismatchPct > 0.25) {rejects.push(rejected(g,'COST_OR_FILL_MISMATCH'));continue;}
    if (m.calibrationBrierScore > 0.30) {rejects.push(rejected(g,'PROBABILITY_MISCALIBRATION'));continue;}
    if (m.correlationCreepScore > 0.75) {rejects.push(rejected(g,'CORRELATED_EXPOSURE_CREEP'));continue;}
    if (m.driftScore > 0.50) {rejects.push(rejected(g,'MODEL_OR_REGIME_DRIFT'));continue;}
    if (m.walkForwardNetSharpe <= 0 || m.holdoutNetSharpe <= 0) {
      rejects.push(rejected(g,'INSUFFICIENT_HOLDOUT_EVIDENCE'));continue;
    }
    verified.push({...g,experimentId:m.experimentId,state:'OUT_OF_SAMPLE_VERIFIED',executionAuthority:false});
  }
  return {verified,rejected:rejects};
}
