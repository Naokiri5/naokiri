/**
 * THINK Reason-to-Trade Certificate (MIA-THINK-010, 028, 032, 034, 038, 041, 091, 099).
 *
 * A deterministic, read-only explanation derived from ONE stored decision report and its consensus record. It adds no
 * engine and no authority: the central decision engine decided, the independent risk gate approved or denied, and the
 * paper OMS (only) executes. The certificate says what was known, what supported and contradicted the idea, which
 * evidence was missing, why MIA did not trade (reason codes), and what hypothetical outcomes would cost or earn.
 *
 * It never presents a score as a probability. Win probability stays NO_VALID_FORECAST until a calibrated,
 * out-of-sample cohort exists (ditas/calibration.ts). Provenance hashes commit to the exact stored inputs, so the same
 * report always yields the same certificate (version-pinned).
 */
import { createHash } from 'node:crypto';
import type { DecisionReport } from './engine.js';
import type { ConsensusRecord } from '../qci/schemas.js';
import { scenarioTable, expectancy, type ScenarioReport, type ExpectancyReport } from './profitLab.js';
import { DEFAULT_POLICY } from '../risk/policy.js';

export const CERTIFICATE_VERSION = 'think-certificate-v1';

/** NO_TRADE reason codes: a first-class, explained outcome (MIA-THINK-038). */
export type NoTradeCode =
  | 'STALE_OR_MISSING_MARKET_DATA' | 'INSUFFICIENT_DATA' | 'ASSET_NOT_ELIGIBLE' | 'INSUFFICIENT_LIQUIDITY'
  | 'QCI_VETO' | 'QCI_NO_QUORUM' | 'QCI_MIXED_EVIDENCE' | 'CONSENSUS_EXPIRED' | 'REQUIRED_DOMAIN_MISSING'
  | 'BELOW_OPPORTUNITY_THRESHOLD' | 'OBSERVE_MODE' | 'RISK_DENIED' | 'NEEDS_OWNER_REVIEW' | 'COSTS_TOO_HIGH'
  | 'NEGATIVE_OUT_OF_SAMPLE_EXPECTANCY' | 'NO_POSITIVE_EDGE_LOWER_BOUND';

export interface ThinkCertificate {
  version: typeof CERTIFICATE_VERSION; kind: 'EXPLANATION_ONLY';
  decisionId: string; asset: string; instrumentId: string; strategy: { id: string; version: string }; regime: string;
  asOf: string;
  provenance: { reportSha256: string; consensusId: string; consensusSha256: string | null; traceId: string; coordinatorVersion: string | null;
    scoreVersion: string; dataFreshness: DecisionReport['dataFreshness'] };
  verdict: { decision: DecisionReport['decision']; finalDecision: DecisionReport['finalDecision']; tradeTaken: boolean; noTradeReasons: NoTradeCode[]; riskReasonCodes: string[] };
  coverage: { workers: ConsensusRecord['workers'] | null; dependencyGroups: number | null; requiredDomainsMissing: string[]; domains: { domain: string; required: boolean; support: number; oppose: number; abstain: number; score: number | null }[] };
  dissent: { weightedSupport: number; weightedOpposition: number; vetoes: { workerId: string; reasons: string[] }[] };
  bullCase: string[]; bearCase: string[]; missingInformation: string[];
  calibration: { opportunityScore: { value: number; meaning: 'HEURISTIC_SCORE_NOT_A_PROBABILITY' }; consensus: 'NOT_CALIBRATED'; winProbability: null; expectancy: ExpectancyReport };
  costs: DecisionReport['expectedCosts'];
  scenarios: ScenarioReport;
  uncertainty: string[];
  authority: { canAuthorizeTrade: false; finalApproval: 'INDEPENDENT_RISK_GATE'; execution: 'PAPER_OMS_ONLY'; liveTrading: 'LOCKED' };
  disclaimer: string;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function noTradeReasons(r: DecisionReport, c: ConsensusRecord | null, missingRequired: string[], exp: ExpectancyReport): NoTradeCode[] {
  if (r.finalDecision === 'ENTER') return [];
  const out = new Set<NoTradeCode>();
  const step = (prefix: string) => r.steps.find((s) => s.name.startsWith(prefix));
  if (r.dataFreshness.status === 'FAIL' || step('Market data freshness')?.result === 'FAIL') out.add('STALE_OR_MISSING_MARKET_DATA');
  if (r.decision === 'INSUFFICIENT_DATA') out.add('INSUFFICIENT_DATA');
  if (step('Asset eligibility')?.result === 'FAIL') out.add('ASSET_NOT_ELIGIBLE');
  if (step('Liquidity')?.result === 'FAIL') out.add('INSUFFICIENT_LIQUIDITY');
  const state = r.consensus.state;
  if (state === 'VETOED') out.add('QCI_VETO');
  if (state === 'NO_QUORUM') out.add('QCI_NO_QUORUM');
  if (state === 'MIXED_CONSENSUS') out.add('QCI_MIXED_EVIDENCE');
  if (state === 'EXPIRED') out.add('CONSENSUS_EXPIRED');
  if (missingRequired.length) out.add('REQUIRED_DOMAIN_MISSING');
  if (r.decision === 'APPROVED_FOR_MONITORING') out.add(step('Execution permission')?.result === 'FAIL' ? 'OBSERVE_MODE' : 'BELOW_OPPORTUNITY_THRESHOLD');
  if (r.risk?.decision === 'DENY') out.add('RISK_DENIED');
  if (r.risk?.decision === 'NEEDS_REVIEW') out.add('NEEDS_OWNER_REVIEW');
  if (step('Expected fees')?.result === 'FAIL') out.add('COSTS_TOO_HIGH');
  if (step('Strategy performance')?.result === 'FAIL') out.add('NEGATIVE_OUT_OF_SAMPLE_EXPECTANCY');
  if (exp.verdict === 'NEGATIVE' || exp.verdict === 'UNCERTAIN_EDGE') out.add('NO_POSITIVE_EDGE_LOWER_BOUND');
  void c;
  return [...out];
}

/**
 * Build the certificate from the exact stored texts (as persisted in `decisions.report` / `consensus_records.record`),
 * so the provenance hashes match the database byte for byte.
 */
export function buildCertificate(reportText: string, consensusText: string | null): ThinkCertificate {
  const r = JSON.parse(reportText) as DecisionReport;
  const c = consensusText ? (JSON.parse(consensusText) as ConsensusRecord) : null;
  const domains = (c?.domains ?? []).map((d) => ({ domain: d.domain, required: d.required, support: d.support, oppose: d.oppose, abstain: d.abstain, score: d.score }));
  const requiredDomainsMissing = domains.filter((d) => d.required && d.support + d.oppose === 0).map((d) => d.domain);

  const feeRate = r.risk?.sizing && r.positionSize?.notional ? (r.expectedCosts.feesUsd ?? 0) / (2 * r.positionSize.notional) : DEFAULT_POLICY.feeRate;
  const scenarios = scenarioTable({
    entry: r.risk?.sizing?.estEntry ?? r.entryRef, stop: r.stopLoss,
    targets: r.takeProfit.map((t) => ({ price: t.price, fraction: t.fraction })),
    qty: r.positionSize?.qty ?? null, feeRate: Number.isFinite(feeRate) && feeRate > 0 ? feeRate : DEFAULT_POLICY.feeRate,
    spreadBps: r.expectedCosts.spreadBps, slippageBps: r.expectedCosts.slippageBps,
  });
  const exp = expectancy(null, 0, 0, 0); // no calibrated cohort is wired yet: honest NO_VALID_FORECAST

  const uncertainty = [
    'Consensus thresholds and worker confidence are NOT_CALIBRATED; agreement is evidence, not a win probability.',
    'Scenario values are hypothetical exits, not predictions.',
  ];
  if (r.dataFreshness.status !== 'PASS') uncertainty.push(`Market data quality was ${r.dataFreshness.status} at decision time.`);
  if (requiredDomainsMissing.length) uncertainty.push(`Required evidence domains with no data-driven vote: ${requiredDomainsMissing.join(', ')}.`);
  if (c && c.workers.failed + c.workers.quarantined > 0) uncertainty.push(`${c.workers.failed} worker(s) failed and ${c.workers.quarantined} were quarantined for this decision.`);
  if (!c) uncertainty.push('Consensus record not found: coverage and dissent could not be verified.');

  return {
    version: CERTIFICATE_VERSION, kind: 'EXPLANATION_ONLY',
    decisionId: r.id, asset: r.asset, instrumentId: r.instrumentId, strategy: r.strategy, regime: r.regime, asOf: r.createdAt,
    provenance: { reportSha256: sha(reportText), consensusId: r.consensus.id, consensusSha256: consensusText ? sha(consensusText) : null, traceId: r.traceId,
      coordinatorVersion: c?.coordinator_version ?? null, scoreVersion: r.opportunity.version, dataFreshness: r.dataFreshness },
    verdict: { decision: r.decision, finalDecision: r.finalDecision, tradeTaken: r.finalDecision === 'ENTER', noTradeReasons: noTradeReasons(r, c, requiredDomainsMissing, exp), riskReasonCodes: r.risk?.reasonCodes ?? [] },
    coverage: { workers: c?.workers ?? null, dependencyGroups: c?.dependency_groups ?? null, requiredDomainsMissing, domains },
    dissent: { weightedSupport: r.consensus.support, weightedOpposition: r.consensus.opposition, vetoes: (c?.vetoes ?? []).map((v) => ({ workerId: v.worker_id, reasons: v.reasons })) },
    bullCase: r.supportingEvidence, bearCase: [...r.opposingEvidence, ...(c?.vetoes ?? []).flatMap((v) => v.reasons.map((x) => `veto ${v.worker_id}: ${x}`))],
    missingInformation: r.missingInformation,
    calibration: { opportunityScore: { value: r.opportunity.score, meaning: 'HEURISTIC_SCORE_NOT_A_PROBABILITY' }, consensus: 'NOT_CALIBRATED', winProbability: null, expectancy: exp },
    costs: r.expectedCosts, scenarios, uncertainty,
    authority: { canAuthorizeTrade: false, finalApproval: 'INDEPENDENT_RISK_GATE', execution: 'PAPER_OMS_ONLY', liveTrading: 'LOCKED' },
    disclaimer: 'Explanation of a past paper-trading decision. Estimates are hypothetical and market-conditional; not advice, not a promise of profit.',
  };
}
