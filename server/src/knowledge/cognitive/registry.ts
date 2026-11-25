import { WORKERS } from '../../workers/registry.js';
import type { BrainAgentContract, BrainSkillContract, ComputationalLane, ReadinessStatus } from './contracts.js';

/**
 * One internal skill manifest: never a second implementation of market/risk/OMS.
 * READY describes the presence of an existing deterministic research primitive,
 * NOT a source-certified executable trading permission.
 */
type Spec = readonly [string, string, ComputationalLane, readonly string[], ReadinessStatus];
const SPECS: readonly Spec[] = [
  ['Closed-candle integrity','market/quality.ts','HOT',['closed_candles'],'READY'],
  ['Market structure','chart/analysis.ts','WARM',['closed_candles'],'READY'],
  ['Breakout validation','chart/analysis.ts','WARM',['closed_candles'],'READY'],
  ['Multi-timeframe fusion','choice/dualResearch.ts','WARM',['candles_15m','candles_1h','candles_4h'],'READY'],
  ['Regime recognition','regime/regime.ts','WARM',['closed_candles'],'READY'],
  ['Funding research','providers/binanceFuturesResearch.ts','WARM',['futures_funding'],'DEGRADED'],
  ['Open-interest research','providers/binanceFuturesResearch.ts','WARM',['open_interest'],'DEGRADED'],
  ['Basis evaluation','UNIMPLEMENTED','WARM',['futures_basis'],'BLOCKED'],
  ['Margin/liquidation stress','UNIMPLEMENTED','WARM',['margin_tiers','collateral_ledger'],'BLOCKED'],
  ['Mark/index and position-mode verification','UNIMPLEMENTED','HOT',['mark_price','position_mode'],'BLOCKED'],
  ['Macro news classification','news/news.ts','WARM',['news_articles'],'DEGRADED'],
  ['Monetary-policy transmission','UNIMPLEMENTED','COLD',['monetary_policy_series'],'BLOCKED'],
  ['Economic surprise analysis','UNIMPLEMENTED','WARM',['economic_calendar'],'BLOCKED'],
  ['Asset fundamentals','UNIMPLEMENTED','COLD',['verified_fundamentals'],'BLOCKED'],
  ['Cross-market transmission','UNIMPLEMENTED','WARM',['cross_asset_prices'],'BLOCKED'],
  ['Scenario reconstruction','chart/scenarios.ts','WARM',['candles_15m','candles_1h','candles_4h'],'READY'],
  ['Proper probability scoring','ditas/calibration.ts','COLD',['settled_forecasts'],'READY'],
  ['Uncertainty assessment','ditas/calibration.ts','COLD',['settled_forecasts'],'DEGRADED'],
  ['Forecast drift detection','ditas/calibration.ts','COLD',['settled_forecasts'],'DEGRADED'],
  ['Scenario invalidation','chart/scenarios.ts','WARM',['closed_candles'],'READY'],
  ['Hypothesis compilation','lab/strategies.ts','COLD',['research_candles'],'DEGRADED'],
  ['Strategy parameterization','lab/strategies.ts','COLD',['research_candles'],'DEGRADED'],
  ['Strategy duplicate detection','knowledge/cognitive/genomes.ts','COLD',[],'READY'],
  ['Walk-forward validation','knowledge/research.ts','COLD',['research_candles'],'READY'],
  ['Robustness stress tests','lab/backtest.ts','COLD',['research_candles'],'DEGRADED'],
  ['Exposure-budget evaluation','risk/gate.ts','HOT',['risk_policy'],'READY'],
  ['Correlated-exposure assessment','portfolio/correlation.ts','HOT',['portfolio_exposure'],'READY'],
  ['Tail-risk stress','UNIMPLEMENTED','COLD',['tail_risk_scenarios'],'BLOCKED'],
  ['Position-sizing research','risk/gate.ts','HOT',['risk_policy','portfolio_exposure'],'READY'],
  ['Drawdown assessment','portfolio/ledger.ts','HOT',['portfolio_exposure'],'READY'],
  ['Fee estimation','market/quality.ts','HOT',['orderbook'],'DEGRADED'],
  ['Executable-depth assessment','market/quality.ts','HOT',['orderbook'],'READY'],
  ['Order simulation','exec/oms.ts','HOT',['paper_execution'],'DEGRADED'],
  ['Fill reconciliation','exec/recovery.ts','HOT',['paper_orders'],'READY'],
  ['Protective-exit verification','exec/oms.ts','HOT',['paper_positions'],'READY'],
  ['DEX launch-profile observations','market/flinQueue.ts','HOT',['dex_profiles'],'DEGRADED'],
  ['On-chain token permissions','UNIMPLEMENTED','HOT',['solana_rpc_mint'],'BLOCKED'],
  ['Holder concentration','UNIMPLEMENTED','HOT',['solana_rpc_holders'],'BLOCKED'],
  ['Round-trip sell feasibility','market/flinQueue.ts','HOT',['verified_sell_simulation'],'BLOCKED'],
  ['Transaction-route quality','UNIMPLEMENTED','HOT',['jupiter_quote'],'BLOCKED'],
  ['Book ingestion','knowledge/store.ts','COLD',['authorized_book_file'],'READY'],
  ['Source claim extraction','knowledge/concepts.ts','COLD',['indexed_book_passages'],'DEGRADED'],
  ['Contradiction weighting','knowledge/cognitive/claims.ts','COLD',['indexed_book_passages'],'READY'],
  ['Citation-grounded retrieval','knowledge/search.ts','WARM',['indexed_book_passages'],'READY'],
  ['Research outcome attribution','ditas/execution.ts','COLD',['settled_outcomes'],'DEGRADED'],
  ['Capability dependency resolution','knowledge/capabilityGraph.ts','WARM',['brain_snapshot'],'READY'],
  ['Bounded task coordination','workers/runtime.ts','HOT',['worker_inputs'],'READY'],
  ['Leader lease verification','ops/lease.ts','HOT',['runtime_lease'],'READY'],
  ['Audit/evidence record','ditas/memory.ts','WARM',['market_snapshot'],'READY'],
  ['Model promotion review','ditas/calibration.ts','COLD',['holdout_evidence'],'DEGRADED'],
];
if (SPECS.length !== 50) throw new Error('BRAINOS_SKILL_MANIFEST_COUNT_MISMATCH');
export const BRAIN_SKILLS: readonly BrainSkillContract[] = Object.freeze(SPECS.map((s, i) => {
  const id = 'S' + String(i + 1).padStart(2,'0');
  return Object.freeze({
    id, name: s[0], version: '1.0.0', ownerModule: s[1], lane: s[2],
    requiredSources: s[3], status: s[4], maxEvidenceAgeMs: s[2] === 'HOT' ? 15_000 : 300_000,
    supportedMarkets: i >= 5 && i < 10 ? ['FUTURES'] as const :
      i >= 35 && i < 40 ? ['MEMECOIN'] as const : undefined,
    executionClass: 'DETERMINISTIC' as const, financialAuthority: false as const,
  });
}));
export const BRAIN_SKILLS_BY_ID: Readonly<Record<string, BrainSkillContract>> = Object.freeze(
  Object.fromEntries(BRAIN_SKILLS.map(skill=>[skill.id,skill])),
);

const DOMAIN_SKILL: Readonly<Record<string, string>> = {
  trend:'S02', momentum:'S04', volatility:'S05', flow:'S32', liquidity:'S32',
  structure:'S02', regime:'S05', news:'S11', onchain:'S37', risk:'S26', execution:'S32',
};
const DIVISIONS: Readonly<Record<string, string>> = {
  trend:'Chart Perception', momentum:'Chart Perception', volatility:'Statistical Intelligence',
  flow:'Market Microstructure', liquidity:'Market Microstructure', structure:'Chart Perception',
  regime:'Statistical Intelligence', news:'Fundamental Intelligence',
  onchain:'FAST Launch', risk:'Risk and Portfolio', execution:'Execution Quality',
};
/** Role IDs reference existing market workers; no 100 cloned model processes. */
export const BRAIN_ROLES: readonly BrainAgentContract[] = Object.freeze(WORKERS.map((worker,i) =>
  Object.freeze({
    id: 'ROLE-' + String(i+1).padStart(3,'0'),
    workerId: worker.id,
    division: DIVISIONS[worker.domain] ?? 'Research',
    domain: worker.domain, dependencyGroup: worker.dependencyGroup,
    skills: [DOMAIN_SKILL[worker.domain] ?? 'S46'],
    requiredEvidence: [...worker.sourceIds],
    canAbstain: true as const, canRequestFinancialAction: false as const,
  }),
));
/**
 * An honest count: if the canonical registry changes, this observes the change
 * instead of inventing virtual agents to restore a marketing number.
 */
export function brainRegistryOverview() {
  return {
    registeredWorkers: WORKERS.length, roles: BRAIN_ROLES.length,
    skills: BRAIN_SKILLS.length, indicatorSpecialistsAreSeparate: true,
    readySkillDefinitions: BRAIN_SKILLS.filter(s=>s.status==='READY').length,
    blockedSkillDefinitions: BRAIN_SKILLS.filter(s=>s.status==='BLOCKED').length,
    tradingAuthority: false as const,
    note: 'Roles wrap the canonical worker registry. Skills describe canonical modules; source/evidence readiness is evaluated per request.',
  };
}
