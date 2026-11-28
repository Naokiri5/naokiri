import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';
import type { BrainAgentContract, BrainKnowledgeClaim, BrainSkillContract } from '../src/knowledge/cognitive/contracts.js';
import { brainRegistryOverview, BRAIN_ROLES, BRAIN_SKILLS } from '../src/knowledge/cognitive/registry.js';
import { WORKERS } from '../src/workers/registry.js';
import { resolveRoleReadiness, resolveSkillReadiness } from '../src/knowledge/cognitive/readiness.js';
import { resolveClaimWeight } from '../src/knowledge/cognitive/claims.js';
import { generateCandidateGenomes, runStrategyGenomeFunnel } from '../src/knowledge/cognitive/genomes.js';
import { runBoundedSgeColdLane } from '../src/knowledge/cognitive/coldLane.js';
import { brainBookCoverage, retrieveBrainBookClaims } from '../src/knowledge/cognitive/books.js';

const NOW=Date.UTC(2026,10,23,18);
const skill = (patch:Partial<BrainSkillContract>={}):BrainSkillContract=>({
  id:'S09',name:'Futures maintenance',version:'1',ownerModule:'test-only',lane:'WARM',
  requiredSources:['mark_price','margin_tier'],optionalSources:['funding'],
  requiredTimeframes:['15m'],supportedMarkets:['FUTURES'],
  maxEvidenceAgeMs:10_000,executionClass:'DETERMINISTIC',status:'READY',
  financialAuthority:false,...patch,
});
const obs=(id:string,t=NOW-100)=>({
  sourceId:id,available:true,observedAtMs:t,maxAgeMs:10_000,verified:true,
});
const env=()=>({
  nowMs:NOW,
  observationsBySource:{mark_price:obs('mark_price'),margin_tier:obs('margin_tier'),
    funding:obs('funding'),liquidity:obs('liquidity')},
  verifiedTimeframes:new Set(['15m']),
  verifiedVenues:new Set(['FUTURES' as const]),
});
const claim=(patch:Partial<BrainKnowledgeClaim>={}):BrainKnowledgeClaim=>({
  claimId:'claim1',sourceDocumentId:'uploaded-doc-1',sourcePage:30,sourceHash:'real-sha',
  conceptId:'basis',claim:'An authored financial hypothesis.',evidenceClass:'EMPIRICAL_FINDING',
  contradictions:[],validationStatus:'TESTED',effectiveWeight:0,...patch,
});
const genomes=()=>generateCandidateGenomes({
  lineageId:'research-1',version:'1',market:'FUTURES',datasetHash:'history-sha',
  costModelVersion:'cost-v1',knowledgeSources:['uploaded-doc-1'],requiredSkills:['S09'],
  requiredAgentRoles:['ROLE-001'],
});
const metrics=()=>({
  datasetHash:'history-sha',independentHoldoutHash:'untouched-holdout-sha',
  walkForwardWindows:5,holdoutSampleCount:100,verifiedHistoricalData:true,
  walkForwardNetSharpe:1.4,holdoutNetSharpe:1.1,maxDrawdownPct:8,
  walkForwardSampleCount:200,returnSkewness:0,returnKurtosis:3,
  calibrationBrierScore:0.19,costMismatchPct:0.04,
  correlationCreepScore:0.22,driftScore:0.09,experimentId:'experiment-real-001',
});

describe('BrainOS 7 uses existing workers and truthful internal skills',()=>{
  it('wraps canonical workers without creating duplicate evaluators or a second finance engine',()=>{
    expect(BRAIN_ROLES).toHaveLength(WORKERS.length);
    expect(BRAIN_SKILLS).toHaveLength(50);
    expect(new Set(BRAIN_ROLES.map(r=>r.workerId)).size).toBe(WORKERS.length);
    expect(new Set(BRAIN_SKILLS.map(s=>s.id)).size).toBe(50);
    expect(BRAIN_ROLES.every(r=>r.canRequestFinancialAction===false)).toBe(true);
    expect(BRAIN_SKILLS.every(s=>s.financialAuthority===false)).toBe(true);
    expect(BRAIN_SKILLS.find(s=>s.id==='S09')?.status).toBe('BLOCKED');
    expect(brainRegistryOverview()).toMatchObject({
      registeredWorkers:WORKERS.length,roles:WORKERS.length,skills:50,tradingAuthority:false,
    });
  });
  it('fails closed on absent, future, unverified or stale required source',()=>{
    const s=skill();
    expect(resolveSkillReadiness(s,env(),'FUTURES').status).toBe('READY');
    const e=env();
    e.observationsBySource.margin_tier=obs('margin_tier',NOW-20_000);
    expect(resolveSkillReadiness(s,e,'FUTURES')).toMatchObject({
      status:'BLOCKED',staleRequiredSources:['margin_tier'],
    });
    e.observationsBySource.margin_tier=obs('margin_tier',NOW+100);
    expect(resolveSkillReadiness(s,e,'FUTURES').status).toBe('BLOCKED');
    e.observationsBySource.margin_tier={...obs('margin_tier'),verified:false};
    expect(resolveSkillReadiness(s,e,'FUTURES').status).toBe('BLOCKED');
    expect(resolveSkillReadiness(s,env(),'SPOT').status).toBe('BLOCKED');
    expect(resolveSkillReadiness(skill({requiredTimeframes:['1m']}),env(),'FUTURES').status).toBe('BLOCKED');
  });
  it('never dispatches a role with missing required source evidence',()=>{
    const role:BrainAgentContract={id:'ROLE-017',workerId:'fixture',division:'Futures',
      domain:'liquidation',dependencyGroup:'margin',skills:['S09'],
      requiredEvidence:['liquidity'],canAbstain:true,canRequestFinancialAction:false};
    expect(resolveRoleReadiness(role,{S09:skill()},env(),'FUTURES').eligibleToDispatch).toBe(true);
    const e=env();delete (e.observationsBySource as Record<string,any>).liquidity;
    expect(resolveRoleReadiness(role,{S09:skill()},e,'FUTURES')).toMatchObject({
      eligibleToDispatch:false,status:'BLOCKED',missingEvidence:['liquidity'],
    });
  });
});
describe('Cognitive book claims and research weights',()=>{
  beforeEach(()=>freshDb(false));afterEach(()=>closeDb());
  it('shows an empty real book library instead of pretending to have absorbed 100 books',()=>{
    expect(brainBookCoverage()).toMatchObject({
      targetBooks:100,uploadedDocuments:0,indexedDocuments:0,
      citedPassages:0,readyCatalogBooks:0,memorySource:'EXISTING_KB_TABLES',
    });
    expect(retrieveBrainBookClaims('perpetual futures')).toEqual([]);
  });
  it('demotes contradicted and drifting claims; rejects mismatched drift provenance',()=>{
    expect(resolveClaimWeight(claim()).effectiveWeight).toBe(0.85);
    const risk=resolveClaimWeight(claim({contradictions:['a','b']}),{
      claimId:'claim1',observedDriftScore:0.9,contradictingClaimIds:['c'],
    });
    expect(risk.validationStatus).toBe('REVIEWED');
    expect(risk.effectiveWeight).toBeLessThan(0.3);
    expect(()=>resolveClaimWeight(claim(),{
      claimId:'another-claim',observedDriftScore:0,contradictingClaimIds:[],
    })).toThrow('INVALID_CLAIM_DRIFT_EVIDENCE');
    expect(()=>resolveClaimWeight(claim(),{
      claimId:'claim1',observedDriftScore:Number.NaN,contradictingClaimIds:[],
    })).toThrow();
  });
});
describe('Strategy genomes stay research-only',()=>{
  it('generates precisely 1000 unique research hypotheses with no order authority',()=>{
    const candidates=genomes();
    expect(candidates).toHaveLength(1000);
    expect(new Set(candidates.map(g=>g.genomeId)).size).toBe(1000);
    expect(candidates.every(g=>g.state==='HYPOTHESIS'&&g.executionAuthority===false)).toBe(true);
  });
  it('rejects unsupported futures source, timeframe, duplicate signatures and absent evaluators',async()=>{
    const g=genomes()[0];
    const evaluate=vi.fn(async()=>metrics());
    const base={getSkillStatus:()=> 'READY' as const,
      verifiedTimeframes:new Set(['1m']),verifiedVenues:new Set(['FUTURES' as const]),
      runWalkForwardAndHoldout:evaluate};
    const wrong=await runStrategyGenomeFunnel([g],{...base,verifiedVenues:new Set(['SPOT' as const])});
    expect(wrong.rejected[0].rejectionReason).toBe('UNSUPPORTED_VENUE_MECHANICS');
    const missing=await runStrategyGenomeFunnel([g],{...base,verifiedTimeframes:new Set(['15m'])});
    expect(missing.rejected[0].rejectionReason).toBe('UNSUPPORTED_TIMEFRAME');
    const duplicate=await runStrategyGenomeFunnel([g,g],base);
    expect(duplicate.rejected.some(x=>x.rejectionReason==='DUPLICATE_GENOME_SIGNATURE')).toBe(true);
    expect(duplicate.verified).toHaveLength(1);
    expect(duplicate.verified[0]).toMatchObject({
      state:'OUT_OF_SAMPLE_VERIFIED',executionAuthority:false,experimentId:'experiment-real-001',
    });
    expect((await runStrategyGenomeFunnel([g],{
      ...base,runWalkForwardAndHoldout:async()=>null,
    })).rejected[0].rejectionReason).toBe('INVALID_EVIDENCE');
    expect((await runStrategyGenomeFunnel([g],{
      ...base,runWalkForwardAndHoldout:async()=>({...metrics(),independentHoldoutHash:'history-sha'}),
    })).rejected[0].rejectionReason).toBe('INVALID_EVIDENCE');
  });
  it('rejects a genome whose edge does not survive the number of trials (deflated Sharpe)',async()=>{
    const [g1,g2,g3]=genomes();
    const hooks=(sharpe:(id:string)=>number)=>({getSkillStatus:()=> 'READY' as const,
      verifiedTimeframes:new Set(['1m','5m','15m','1h','4h']),verifiedVenues:new Set(['FUTURES' as const]),
      runWalkForwardAndHoldout:async(g:any)=>({...metrics(),walkForwardNetSharpe:sharpe(g.genomeId),walkForwardSampleCount:60})});
    // A modest per-trade Sharpe from one trial is verified ...
    expect((await runStrategyGenomeFunnel([g1],hooks(()=>0.3))).verified).toHaveLength(1);
    // ... but the same Sharpe picked from a 1,000-hypothesis programme is what noise alone would produce.
    const deflated=await runStrategyGenomeFunnel([g1],hooks(()=>0.3),undefined,{totalTrials:1000});
    expect(deflated.verified).toHaveLength(0);
    expect(deflated.rejected[0]).toMatchObject({rejectionReason:'SELECTION_BIAS_UNCONTROLLED',executionAuthority:false});
    // Cross-trial dispersion in one call raises the bar for the best of the batch.
    const spread=await runStrategyGenomeFunnel([g1,g2,g3],hooks(id=>id===g1.genomeId?0.35:id===g2.genomeId?-0.4:0.05));
    expect(spread.verified).toHaveLength(0);
    expect(spread.rejected.map(x=>x.rejectionReason)).toContain('SELECTION_BIAS_UNCONTROLLED');
    await expect(runStrategyGenomeFunnel([g1],hooks(()=>0.3),undefined,{totalTrials:0})).rejects.toThrow('INVALID_TOTAL_TRIALS');
    // Evidence without the sample size or moments needed to deflate is invalid.
    expect((await runStrategyGenomeFunnel([g1],{...hooks(()=>0.3),runWalkForwardAndHoldout:async()=>({...metrics(),walkForwardSampleCount:10})})).rejected[0].rejectionReason).toBe('INVALID_EVIDENCE');
  });
  it('never evaluates more hypotheses than allowed by a cold lane budget or abort signal',async()=>{
    const g=genomes().slice(0,7);
    const runner=vi.fn(async()=>metrics());
    const hooks={getSkillStatus:()=> 'READY' as const,
      verifiedTimeframes:new Set(['1m','5m','15m','1h','4h']),
      verifiedVenues:new Set(['FUTURES' as const]),runWalkForwardAndHoldout:runner};
    const result=await runBoundedSgeColdLane(g,hooks,{batchSize:2,maxDurationMs:10_000});
    expect(result).toMatchObject({
      processedCount:7,remainingCount:0,abortedByBudget:false,tradingAuthority:false,
    });
    const abort=new AbortController();abort.abort();
    const cancelled=await runBoundedSgeColdLane(g,hooks,{
      batchSize:2,maxDurationMs:100,signal:abort.signal,
    });
    expect(cancelled.processedCount).toBe(0);
    expect(cancelled.remainingCount).toBe(7);
    await expect(runBoundedSgeColdLane(g,hooks,{batchSize:0,maxDurationMs:100}))
      .rejects.toThrow('COLD_BATCH_SIZE_OUT_OF_RANGE');
  });
});
