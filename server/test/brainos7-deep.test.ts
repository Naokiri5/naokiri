import { describe,expect,it,vi } from 'vitest';
import type { BrainAgentContract, BrainSkillContract, BrainKnowledgeClaim } from '../src/knowledge/cognitive/contracts.js';
import { runDeepCognitiveCycle,type FrozenMarketSnapshot,type SpecialistFinding } from '../src/knowledge/cognitive/deepCycle.js';

const NOW=Date.UTC(2026,10,23,18);
const proofSources=[
  'mark_price','index_price','futures_funding','open_interest','executable_depth',
  'maintenance_margin_tier','liquidation_scenario','candles_15m',
];
const env=()=>({
  nowMs:NOW,
  observationsBySource:Object.fromEntries(proofSources.map(id=>[id,{
    sourceId:id,available:true,verified:true,observedAtMs:NOW-100,maxAgeMs:10_000,
  }])),
  verifiedTimeframes:new Set(['15m']),
  verifiedVenues:new Set(['FUTURES' as const]),
});
const snapshot=(patch:Partial<FrozenMarketSnapshot>={}):FrozenMarketSnapshot=>({
  snapshotId:'',symbol:'BTCUSDT',venueClass:'FUTURES',timeframe:'15m',
  closedCandleTimestampMs:NOW-900_000,capturedAtMs:NOW,
  markPrice:120,indexPrice:119.9,lastPrice:120.1,fundingRate:0.0001,
  openInterestUsd:900_000_000,spreadBps:1.0,executableDepthUsd:1_000_000,
  liquidationBufferPct:18,estimatedTotalCostBps:4,expectedGrossEdgeBps:15,
  regime:'trend_expansion',featureSlots:{slot0:0.9},...patch,
});
const skill=(id:string):BrainSkillContract=>({
  id,name:'structure',version:'1',ownerModule:'chart/analysis.ts',lane:'WARM',
  requiredSources:['candles_15m'],requiredTimeframes:['15m'],
  executionClass:'DETERMINISTIC',maxEvidenceAgeMs:10_000,
  status:'READY',financialAuthority:false,
});
const roles:BrainAgentContract[]=[
  {id:'ROLE-001',workerId:'fixture-chart',division:'Chart',domain:'structure',
    dependencyGroup:'price',skills:['S01'],requiredEvidence:['candles_15m'],
    canAbstain:true,canRequestFinancialAction:false},
  {id:'ROLE-002',workerId:'fixture-exec',division:'Execution',domain:'execution',
    dependencyGroup:'book',skills:['S02'],requiredEvidence:['candles_15m'],
    canAbstain:true,canRequestFinancialAction:false},
];
const claim:BrainKnowledgeClaim={
  claimId:'source-claim',sourceDocumentId:'verified-book',sourcePage:18,sourceHash:'sha256-book',
  conceptId:'futures_basis',claim:'Source-backed research text.',evidenceClass:'EMPIRICAL_FINDING',
  contradictions:[],validationStatus:'TESTED',effectiveWeight:0,
};
function deps() {
  const evaluateRole=vi.fn(async({role,snapshot:s}:{
    role:BrainAgentContract;snapshot:Readonly<FrozenMarketSnapshot>;
    relevantClaims:readonly BrainKnowledgeClaim[];
  }):Promise<SpecialistFinding>=>{
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.featureSlots)).toBe(true);
    return {roleId:role.id,domain:role.domain,stance:'BULLISH',
      confidence:0.8,usedSkillIds:role.skills,notes:'Research only'};
  });
  return {
    roles,skillsById:{S01:skill('S01'),S02:skill('S02')},
    retrieveCandidateClaims:vi.fn(async()=>[claim]),
    getClaimDriftSignal:()=>undefined,
    evaluateRole,
    calibratedOutcome:{
      verified:true,sampleCount:120,cohort:'btc-15m-v1',asOf:NOW,
      calibratedProbability:0.62,brierScore:0.2,
    },
  };
}
const input=()=>({traceId:'cycle-1',fencingEpoch:4,snapshot:snapshot(),readinessEnv:env()});

describe('MIA BrainOS 7 DEEP bounded cognitive research',()=>{
  it('freezes real inputs, retains source lineage and can only refer to canonical risk review',async()=>{
    const d=deps();
    const result=await runDeepCognitiveCycle(input(),d);
    expect(result.context).toMatchObject({
      result:'RISK_REVIEW',financialAuthority:false,sourceClaimIds:['source-claim'],
      skillIds:['S01','S02'],fencingEpoch:4,
    });
    expect(result.audit).toMatchObject({
      missingPrerequisites:[],financialAuthority:false,
      netExpectedEdgeBps:11,
    });
    expect(d.evaluateRole).toHaveBeenCalledTimes(2);
    expect(d.retrieveCandidateClaims).toHaveBeenCalledTimes(1);
  });
  it('fails closed on unverified liquidation, missing mark/index and unreliable calibration',async()=>{
    const d=deps(),a=input();
    delete (a.readinessEnv.observationsBySource as Record<string,unknown>).maintenance_margin_tier;
    a.snapshot=snapshot({indexPrice:undefined,liquidationBufferPct:2});
    d.calibratedOutcome.verified=false;
    const result=await runDeepCognitiveCycle(a,d);
    expect(result.context.result).toBe('NO_TRADE');
    expect(result.context.financialAuthority).toBe(false);
    expect(result.audit.missingPrerequisites).toContain('SOURCE_UNVERIFIED:maintenance_margin_tier');
    expect(result.audit.missingPrerequisites).toContain('MISSING_FINITE_VALUE:indexPrice');
    expect(result.audit.missingPrerequisites).toContain('INSUFFICIENT_LIQUIDATION_BUFFER');
    expect(result.audit.missingPrerequisites).toContain('CALIBRATION_NOT_INDEPENDENTLY_VERIFIED');
    expect(d.evaluateRole).not.toHaveBeenCalled();
  });
  it('never reuses a future-dated or expired frozen snapshot',async()=>{
    const d=deps(),a=input();
    a.snapshot=snapshot({capturedAtMs:NOW+1_000});
    expect((await runDeepCognitiveCycle(a,d)).audit.missingPrerequisites)
      .toContain('INVALID_OR_STALE_SNAPSHOT');
    a.snapshot=snapshot({capturedAtMs:NOW-60_000});
    expect((await runDeepCognitiveCycle(a,d)).context.result).toBe('NO_TRADE');
  });
  it('excludes blocked or cold-lane roles and never counts correlated evidence as two domains',async()=>{
    const d=deps();
    d.skillsById.S02={...skill('S02'),lane:'COLD'};
    const r=await runDeepCognitiveCycle(input(),d);
    expect(r.context.result).toBe('NO_TRADE');
    expect(r.audit.excludedRoleIds).toContain('ROLE-002');
    expect(r.audit.missingPrerequisites).toContain('INSUFFICIENT_INDEPENDENT_DOMAINS');
  });
  it('rejected book provenance, low weighting and vetoes cannot create trade authority',async()=>{
    const d=deps();
    d.getClaimDriftSignal=()=>({
      claimId:'source-claim',observedDriftScore:0.98,
      contradictingClaimIds:['c1','c2','c3'],
    });
    const low=await runDeepCognitiveCycle(input(),d);
    expect(low.context.result).toBe('NO_TRADE');
    expect(low.audit.droppedClaimIds).toContain('source-claim');
    const e=deps();
    e.evaluateRole=vi.fn(async({role}:{
      role:BrainAgentContract;snapshot:Readonly<FrozenMarketSnapshot>;
      relevantClaims:readonly BrainKnowledgeClaim[];
    }):Promise<SpecialistFinding>=>({
      roleId:role.id,domain:role.domain,stance:'BEARISH',confidence:0.9,
      usedSkillIds:role.skills,notes:'veto',vetoTriggered:true,vetoReason:'unsafe',
    }));
    const veto=await runDeepCognitiveCycle(input(),e);
    expect(veto.context.result).toBe('NO_TRADE');
    expect(veto.audit.missingPrerequisites).toContain('SPECIALIST_VETO');
  });
});
