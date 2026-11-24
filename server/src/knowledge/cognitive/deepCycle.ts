import { createHash } from 'node:crypto';
import type {
  BrainAgentContract, BrainDecisionContext, BrainKnowledgeClaim,
  BrainSkillContract, MarketVenueClass,
} from './contracts.js';
import { resolveRoleReadiness, isFreshVerified, type ReadinessEnvironment } from './readiness.js';
import { resolveClaimWeight, type ClaimDriftSignal } from './claims.js';

export interface FrozenMarketSnapshot {
  snapshotId: string;
  symbol: string;
  venueClass: MarketVenueClass;
  timeframe: string;
  closedCandleTimestampMs: number;
  capturedAtMs: number;
  markPrice?: number;
  indexPrice?: number;
  lastPrice?: number;
  fundingRate?: number;
  openInterestUsd?: number;
  spreadBps?: number;
  executableDepthUsd?: number;
  liquidationBufferPct?: number;
  estimatedTotalCostBps: number;
  expectedGrossEdgeBps: number;
  regime: string;
  featureSlots?: Readonly<Record<string,number>>;
}
export interface SpecialistFinding {
  roleId: string;
  domain: string;
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'ABSTAIN';
  /** Research score, explicitly NOT a win probability. */
  confidence: number;
  calibrationBrierEstimate?: number;
  vetoTriggered?: boolean;
  vetoReason?: string;
  usedSkillIds: readonly string[];
  notes: string;
}
export interface CalibratedOutcomeEvidence {
  verified: boolean;
  sampleCount: number;
  cohort: string;
  asOf: number;
  calibratedProbability: number;
  brierScore: number;
}
export interface DeepCycleDependencies {
  roles: readonly BrainAgentContract[];
  skillsById: Readonly<Record<string,BrainSkillContract>>;
  retrieveCandidateClaims(params:{
    symbol:string; venueClass:MarketVenueClass; regime:string; timeframe:string;
  }):Promise<BrainKnowledgeClaim[]>|BrainKnowledgeClaim[];
  getClaimDriftSignal(id:string):ClaimDriftSignal|undefined;
  evaluateRole(params:{
    role:BrainAgentContract; snapshot:Readonly<FrozenMarketSnapshot>;
    relevantClaims:readonly BrainKnowledgeClaim[];
  }):Promise<SpecialistFinding>|SpecialistFinding;
  calibratedOutcome?:CalibratedOutcomeEvidence|null;
  minClaimWeightThreshold?:number;
  minNetEdgeBps?:number;
  maxRoles?:number;
  contextTtlMs?:number;
}
export interface DeepCycleInput {
  traceId:string;
  fencingEpoch:number;
  snapshot:FrozenMarketSnapshot;
  readinessEnv:ReadinessEnvironment;
  preferredRoleIds?:readonly string[];
  strategyGenomeId?:string;
}
export interface DeepCycleAuditRecord {
  traceId:string;
  snapshotId:string;
  selectedRoleIds:string[];
  excludedRoleIds:string[];
  activeSkillIds:string[];
  weightedClaimIds:string[];
  droppedClaimIds:string[];
  findings:SpecialistFinding[];
  missingPrerequisites:string[];
  netExpectedEdgeBps:number|null;
  decisionReason:string;
  financialAuthority:false;
}
export interface DeepCycleResult {
  context:BrainDecisionContext;
  audit:DeepCycleAuditRecord;
}
const REQUIRED_FUTURES_SOURCES = [
  'mark_price','index_price','futures_funding','open_interest',
  'executable_depth','maintenance_margin_tier','liquidation_scenario',
] as const;
const good = (n:unknown):n is number => typeof n==='number' && Number.isFinite(n);
const digest = (value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function frozen(raw:FrozenMarketSnapshot):Readonly<FrozenMarketSnapshot> {
  const features = raw.featureSlots ? Object.freeze({...raw.featureSlots}) : undefined;
  const canonical={...raw,featureSlots:features};
  return Object.freeze({...canonical,snapshotId:raw.snapshotId ||
    'snap_'+digest(canonical).slice(0,32)});
}

/**
 * Auditable non-executing warm-lane research. The result may request canonical
 * QCI/risk REVIEW, but never creates an order, a position or a calibrated model.
 * Missing/stale data and uncited book passages yield NO_TRADE, not a guess.
 */
export async function runDeepCognitiveCycle(
  input:DeepCycleInput,deps:DeepCycleDependencies,
):Promise<DeepCycleResult> {
  if (!input.traceId || !Number.isSafeInteger(input.fencingEpoch) || input.fencingEpoch < 0)
    throw new Error('INVALID_DEEP_CYCLE_IDENTITY');
  const snapshot=frozen(input.snapshot);
  const ttl=deps.contextTtlMs??30_000;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 300_000) throw new Error('INVALID_CONTEXT_TTL');
  const asOf=snapshot.capturedAtMs;
  const expired=!Number.isSafeInteger(asOf)||asOf<=0
    || asOf>input.readinessEnv.nowMs
    || input.readinessEnv.nowMs-asOf>ttl
    || !Number.isSafeInteger(snapshot.closedCandleTimestampMs)
    || snapshot.closedCandleTimestampMs>asOf;
  const missingPrerequisites:string[]=[];
  if (expired) missingPrerequisites.push('INVALID_OR_STALE_SNAPSHOT');
  if (snapshot.venueClass!=='FUTURES' || !input.readinessEnv.verifiedVenues.has('FUTURES'))
    missingPrerequisites.push('FUTURES_VENUE_NOT_CERTIFIED');
  if (!input.readinessEnv.verifiedTimeframes.has(snapshot.timeframe))
    missingPrerequisites.push('UNSUPPORTED_TIMEFRAME');
  for (const source of REQUIRED_FUTURES_SOURCES) {
    if (!isFreshVerified(input.readinessEnv.observationsBySource[source],
      input.readinessEnv.nowMs,ttl)) missingPrerequisites.push('SOURCE_UNVERIFIED:'+source);
  }
  for(const field of ['markPrice','indexPrice','lastPrice','fundingRate','openInterestUsd',
    'spreadBps','executableDepthUsd','liquidationBufferPct',
    'estimatedTotalCostBps','expectedGrossEdgeBps'] as const) {
    if (!good(snapshot[field])) missingPrerequisites.push('MISSING_FINITE_VALUE:'+field);
  }
  if (good(snapshot.executableDepthUsd) && snapshot.executableDepthUsd<=0)
    missingPrerequisites.push('NO_EXECUTABLE_DEPTH');
  if (good(snapshot.liquidationBufferPct) && snapshot.liquidationBufferPct<10)
    missingPrerequisites.push('INSUFFICIENT_LIQUIDATION_BUFFER');
  if (good(snapshot.spreadBps) && snapshot.spreadBps<0) missingPrerequisites.push('NEGATIVE_SPREAD');
  const net=good(snapshot.estimatedTotalCostBps)&&good(snapshot.expectedGrossEdgeBps)
    ? snapshot.expectedGrossEdgeBps-snapshot.estimatedTotalCostBps : null;
  if (net===null || net<=Math.max(0,deps.minNetEdgeBps??3))
    missingPrerequisites.push('NET_EDGE_NOT_DEMONSTRATED');
  const calibration=deps.calibratedOutcome;
  if (!calibration?.verified || !calibration.cohort || calibration.sampleCount<100
    || !good(calibration.calibratedProbability)||calibration.calibratedProbability<0.55
    || calibration.calibratedProbability>1
    || !good(calibration.brierScore)||calibration.brierScore<0||calibration.brierScore>0.3
    || !Number.isSafeInteger(calibration.asOf)||calibration.asOf>asOf)
    missingPrerequisites.push('CALIBRATION_NOT_INDEPENDENTLY_VERIFIED');

  const maxRoles=deps.maxRoles??16;
  if (!Number.isInteger(maxRoles)||maxRoles<1||maxRoles>32)throw new Error('INVALID_ROLE_BUDGET');
  const selected:BrainAgentContract[]=[],excluded:string[]=[],skills=new Set<string>();
  const available=input.preferredRoleIds?.length
    ? deps.roles.filter(r=>input.preferredRoleIds!.includes(r.id)) : deps.roles;
  for(const role of available) {
    const readiness=resolveRoleReadiness(role,deps.skillsById,input.readinessEnv,'FUTURES');
    if (readiness.status==='READY'&&selected.length<maxRoles
        && role.skills.every(id=>deps.skillsById[id]?.lane!=='COLD')) {
      selected.push(role);role.skills.forEach(id=>skills.add(id));
    } else excluded.push(role.id);
  }
  const findings:SpecialistFinding[]=[],weightedClaimIds:string[]=[],droppedClaimIds:string[]=[];
  let claims:BrainKnowledgeClaim[]=[];
  if (!expired) {
    try {
      const response=await deps.retrieveCandidateClaims({
        symbol:snapshot.symbol,venueClass:snapshot.venueClass,
        regime:snapshot.regime,timeframe:snapshot.timeframe,
      });
      claims=response.map(c=>resolveClaimWeight(c,deps.getClaimDriftSignal(c.claimId)));
      const cutoff=deps.minClaimWeightThreshold??0.25;
      if (!Number.isFinite(cutoff)||cutoff<0||cutoff>1)throw new Error('INVALID_CLAIM_THRESHOLD');
      for(const c of claims) {
        if(c.effectiveWeight>=cutoff)weightedClaimIds.push(c.claimId);
        else droppedClaimIds.push(c.claimId);
      }
      claims=claims.filter(c=>c.effectiveWeight>=cutoff);
    } catch { missingPrerequisites.push('BOOK_PROVENANCE_OR_RETRIEVAL_UNVERIFIED');claims=[]; }
  }
  if (!weightedClaimIds.length) missingPrerequisites.push('NO_SOURCE_BACKED_KNOWLEDGE');
  if (!selected.length) missingPrerequisites.push('NO_READY_SPECIALISTS');
  // Do not call an expensive reasoning provider when futures hard prerequisites are missing.
  if (!missingPrerequisites.length) {
    for(const role of selected) {
      try {
        const f=await deps.evaluateRole({role,snapshot,relevantClaims:claims});
        if (f.roleId!==role.id || !good(f.confidence) || f.confidence<0||f.confidence>1
          || f.usedSkillIds.some(id=>!role.skills.includes(id)))
          throw new Error('UNTRUSTED_SPECIALIST_FINDING');
        findings.push(f);
      } catch {missingPrerequisites.push('SPECIALIST_UNAVAILABLE:'+role.id);}
    }
  }
  if (findings.some(f=>f.vetoTriggered)) missingPrerequisites.push('SPECIALIST_VETO');
  const supporters=new Set(findings.filter(f=>f.stance==='BULLISH'||f.stance==='BEARISH')
    .map(f=>f.domain));
  if (!missingPrerequisites.length&&supporters.size<2)
    missingPrerequisites.push('INSUFFICIENT_INDEPENDENT_DOMAINS');
  const result=missingPrerequisites.length?'NO_TRADE' as const:'RISK_REVIEW' as const;
  const context:BrainDecisionContext={
    traceId:input.traceId,mind:'DEEP',marketSnapshotId:snapshot.snapshotId,
    fencingEpoch:input.fencingEpoch,agentRoleIds:selected.map(r=>r.id),
    skillIds:[...skills],sourceClaimIds:weightedClaimIds,
    ...(input.strategyGenomeId?{strategyGenomeId:input.strategyGenomeId}:{}),
    evidenceAsOf:asOf,expiresAt:asOf+ttl,result,financialAuthority:false,
  };
  return {context,audit:{traceId:input.traceId,snapshotId:snapshot.snapshotId,
    selectedRoleIds:selected.map(r=>r.id),excludedRoleIds:excluded,
    activeSkillIds:[...skills],weightedClaimIds,droppedClaimIds,
    findings,missingPrerequisites,netExpectedEdgeBps:net,
    decisionReason:missingPrerequisites.join('|')||'ADVISORY_ONLY_CANONICAL_QCI_RISK_REQUIRED',
    financialAuthority:false,
  }};
}
