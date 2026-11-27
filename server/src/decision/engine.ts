import type { Candidate, WorkerContext } from '../workers/types.js';
import type { ConsensusRecord } from '../qci/schemas.js';
import { isExpired } from '../qci/coordinator.js';
import { scoreOpportunity, type OpportunityScore } from './scoring.js';
import { evaluateRisk, type RiskDecision } from '../risk/gate.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';
import { controlAuthority } from '../core/mode.js';
import { recordOpportunity } from '../ditas/memory.js';
import { run, J, tx } from '../db/db.js';
import { uid, iso } from '../core/util.js';
import { record } from '../core/latency.js';
import { bus } from '../core/bus.js';
import { readIndicators } from '../workers/indicators.js';
import { strategyKnowledge, type KnowledgeRef } from '../knowledge/integration.js';
import { routeThinking, type ThinkRoutingResult } from './think-router.js';

/** Part 8 central decision engine — the only component that can produce a trade decision. */
export type DecisionState = 'APPROVED_FOR_MONITORING' | 'WAIT_FOR_CONFIRMATION' | 'PAPER_TRADE' | 'APPROVED_FOR_USER_CONFIRMATION' | 'APPROVED_FOR_BOUNDED_EXECUTION' | 'REJECTED' | 'INSUFFICIENT_DATA';
export interface PipelineStep { step: number; name: string; result: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'; detail: string }
export interface DecisionReport {
  id: string; createdAt: string; candidateId: string; traceId: string;
  asset: string; instrumentId: string; market: string; venue: string; direction: 'LONG' | 'NO_POSITION';
  strategy: { id: string; version: string }; regime: string;
  reason: string; supportingEvidence: string[]; opposingEvidence: string[];
  entryCondition: string; invalidation: string; entryRef: number; stopLoss: number; takeProfit: { price: number; fraction: number; r: number }[];
  positionSize: { qty: number; notional: number; plannedMaxLoss: number } | null;
  expectedCosts: { feesUsd: number | null; spreadBps: number | null; slippageBps: number | null; costR: number | null; funding: 'N/A (spot)' };
  riskAssessment: string[]; missingInformation: string[]; dataFreshness: { quoteAgeMs: number | null; candleAgeMs: number | null; bookAgeMs: number | null; status: string };
  opportunity: OpportunityScore; consensus: { id: string; state: string; support: number; opposition: number; expiresAt: string };
  risk: RiskDecision | null; decision: DecisionState; finalDecision: 'ENTER' | 'WAIT' | 'REJECT' | 'MONITOR';
  steps: PipelineStep[]; indicators: ReturnType<typeof readIndicators>;
  /** Explanatory knowledge references (Academy). Never read by the risk gate or OMS. */
  knowledge?: { refs: KnowledgeRef[]; authority: string };
  thinking?: ThinkRoutingResult;
  disclaimer: string;
  source?: 'MANUAL';
}

export function decide(cand: Candidate, ctx: WorkerContext, qci: ConsensusRecord, stratStats: { trades: number; expectancyR: number } | null, correlatedOpen: number, source?: DecisionReport['source']): DecisionReport {
  const t0 = performance.now();
  const steps: PipelineStep[] = []; let n = 0;
  const step = (name: string, result: PipelineStep['result'], detail: string) => steps.push({ step: ++n, name, result, detail });
  const q = ctx.quality; const s = cand.signal;
  step('Market data freshness', q.status === 'FAIL' ? 'FAIL' : q.status === 'WARN' ? 'WARN' : 'PASS', q.issues.join('; ') || `quote ${(q.quoteAgeMs ?? 0) / 1000}s old`);
  step('Instrument availability', ctx.ticker ? 'PASS' : 'FAIL', ctx.ticker ? 'listed & trading on Binance spot' : 'no ticker');
  step('Asset eligibility / safety', ctx.safety.eligibleForAutomation ? (ctx.safety.status === 'CAUTION' ? 'WARN' : 'PASS') : 'FAIL', `${ctx.safety.status}${ctx.safety.reasons.length ? ': ' + ctx.safety.reasons.join('; ') : ''}`);
  step('Liquidity & volume', ctx.impact && ctx.impact.filledFully ? 'PASS' : 'FAIL', ctx.impact ? `spread ${ctx.impact.spreadBps.toFixed(1)}bps, depth±1% $${Math.round(ctx.impact.depth1pct).toLocaleString()}` : 'no book');
  const dom = (d: string) => qci.domains.find((x) => x.domain === d);
  for (const [name, d] of [['Technical conditions', 'trend'], ['Order flow', 'flow'], ['Whale / large-print activity', 'flow'], ['News & source credibility', 'news']] as const) {
    const x = dom(d); step(name, x?.score == null ? 'SKIP' : x.score > 0 ? 'PASS' : 'WARN', x?.score == null ? 'no non-abstaining evidence' : `domain score ${x.score.toFixed(2)} (${x.support}↑ ${x.oppose}↓ ${x.abstain}○)`);
  }
  const expired = isExpired(qci);
  step('QCI consensus record', qci.state === 'STRONG_CONSENSUS' && !expired ? 'PASS' : qci.state === 'VETOED' ? 'FAIL' : 'WARN', `${expired ? 'EXPIRED' : qci.state}: ${qci.reason_codes.slice(0, 3).join('; ')}`);
  step('Strategy performance & regime suitability', stratStats && stratStats.trades >= 20 ? (stratStats.expectancyR > 0 ? 'PASS' : 'FAIL') : 'WARN', stratStats ? `OOS ${stratStats.trades} trades, ${stratStats.expectancyR.toFixed(3)}R expectancy; regime ${cand.regime}` : `no out-of-sample record; regime ${cand.regime}`);
  const opp = scoreOpportunity(qci, stratStats, correlatedOpen);
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;

  let decision: DecisionState; let risk: RiskDecision | null = null;
  const authority = controlAuthority(), mode = authority.control.mode;
  if (authority.unavailableMode) decision = 'REJECTED';
  else if (q.status === 'FAIL' || !ctx.ticker) decision = 'INSUFFICIENT_DATA';
  else if (!ctx.safety.eligibleForAutomation || qci.state === 'VETOED') decision = 'REJECTED';
  else if (expired) decision = 'WAIT_FOR_CONFIRMATION';
  else if (qci.state === 'NO_QUORUM' || qci.state === 'MIXED_CONSENSUS') decision = 'WAIT_FOR_CONFIRMATION';
  else if (opp.score < pol.minOpportunityScore) decision = 'APPROVED_FOR_MONITORING';
  else if (mode === 'OBSERVE') decision = 'APPROVED_FOR_MONITORING';
  // Defense in depth: a stale or directly persisted LIVE mode must never produce a
  // PAPER_TRADE decision. PR #117 also protects the lower-level mode authority;
  // this decision engine remains non-executing until a certified LIVE path exists.
  else if (mode !== 'PAPER' && mode !== 'APPROVAL') decision = 'REJECTED';
  else {
    risk = evaluateRisk({ instrumentId: cand.instrumentId, strategyId: cand.strategyId, strategyVersion: cand.strategyVersion, side: 'buy', entryPrice: s.entryRef, stopPrice: s.stop, idempotencyKey: `entry-${cand.id}`, traceId: cand.traceId });
    decision = risk.decision === 'DENY' ? 'REJECTED' : risk.decision === 'NEEDS_REVIEW' ? 'APPROVED_FOR_USER_CONFIRMATION' : mode === 'APPROVAL' ? 'APPROVED_FOR_USER_CONFIRMATION' : 'PAPER_TRADE';
  }
  step('Expected fees / slippage / impact', risk?.evaluated.costR != null ? (Number(risk.evaluated.costR) <= pol.maxCostR ? 'PASS' : 'FAIL') : 'SKIP', risk ? `cost ${risk.evaluated.costR}R, spread ${risk.evaluated.spreadBps}bps, impact ${risk.evaluated.impactBps}bps` : 'computed by risk engine when eligible');
  step('Position size', risk?.sizing ? 'PASS' : 'SKIP', risk?.sizing ? `qty ${risk.sizing.qty} ($${risk.sizing.notional}), planned max loss $${risk.sizing.plannedMaxLoss}` : '—');
  step('Portfolio correlation & exposure', correlatedOpen > 0 ? 'WARN' : 'PASS', `${correlatedOpen} correlated open positions`);
  step('Independent deterministic risk approval (Part 17)', risk ? (risk.decision === 'ALLOW' ? 'PASS' : risk.decision === 'NEEDS_REVIEW' ? 'WARN' : 'FAIL') : 'SKIP', risk ? `${risk.decision} ${risk.reasonCodes.join('; ')}` : 'not reached');
  step('Execution permission (Part 9)', mode === 'PAPER' || mode === 'APPROVAL' ? 'PASS' : 'FAIL', `mode ${mode}; only PAPER or APPROVAL is currently eligible`);
  step('Last-moment revalidation', 'SKIP', 'performed by OMS immediately before submission');

  const sup = qci.challenge.find((c) => c.reviewer === 'BULL')?.findings ?? [];
  const opp2 = [...(qci.challenge.find((c) => c.reviewer === 'BEAR')?.findings ?? []), ...(qci.challenge.find((c) => c.reviewer === 'CONTRARIAN' && c.stance === 'OPPOSE')?.findings ?? [])];
  const R = s.entryRef - s.stop;
  const final = decision === 'PAPER_TRADE' || decision === 'APPROVED_FOR_USER_CONFIRMATION' ? 'ENTER' : decision === 'REJECTED' || decision === 'INSUFFICIENT_DATA' ? 'REJECT' : decision === 'WAIT_FOR_CONFIRMATION' ? 'WAIT' : 'MONITOR';
  const report: DecisionReport = {
    ...(source ? { source } : {}),
    id: uid('dec'), createdAt: iso(), candidateId: cand.id, traceId: cand.traceId, asset: cand.symbol, instrumentId: cand.instrumentId, market: cand.market, venue: cand.venue,
    direction: final === 'ENTER' ? 'LONG' : 'NO_POSITION', strategy: { id: cand.strategyId, version: cand.strategyVersion }, regime: cand.regime,
    reason: s.reasons.join('; '), supportingEvidence: sup, opposingEvidence: opp2, entryCondition: s.trigger, invalidation: s.invalidation, entryRef: s.entryRef, stopLoss: s.stop,
    takeProfit: s.targets.map((t) => ({ price: s.entryRef + t.r * R, fraction: t.fraction, r: t.r })),
    positionSize: risk?.sizing ? { qty: risk.sizing.qty, notional: risk.sizing.notional, plannedMaxLoss: risk.sizing.plannedMaxLoss } : null,
    expectedCosts: { feesUsd: risk?.sizing?.estFees ?? null, spreadBps: (risk?.evaluated.spreadBps as number) ?? ctx.impact?.spreadBps ?? null, slippageBps: (risk?.evaluated.impactBps as number) ?? ctx.impact?.impactBps ?? null, costR: (risk?.evaluated.costR as number) ?? null, funding: 'N/A (spot)' },
    riskAssessment: [...ctx.safety.reasons, ...(risk?.reasonCodes ?? []), 'Stop trigger is not a guaranteed fill; gaps and thin liquidity can exceed planned loss.'],
    missingInformation: [...qci.missing_inputs, ...opp.missing.map((m) => `score factor missing: ${m}`)],
    dataFreshness: { quoteAgeMs: q.quoteAgeMs, candleAgeMs: q.candleAgeMs, bookAgeMs: q.bookAgeMs, status: q.status },
    opportunity: opp, consensus: { id: qci.consensus_id, state: expired ? 'EXPIRED' : qci.state, support: qci.weighted_support, opposition: qci.weighted_opposition, expiresAt: qci.expires_at },
    risk, decision, finalDecision: final, steps, indicators: readIndicators(ctx.f), knowledge: strategyKnowledge(cand.strategyId),
    thinking: routeThinking({
      preference: 'AUTO',
      marketDataValid: q.status !== 'FAIL',
      mandatoryCoverageComplete: qci.state !== 'NO_QUORUM',
      hardVetoPresent: qci.state === 'VETOED' || risk?.decision === 'DENY',
      consensusExpired: expired,
      conflictingEvidence: qci.state === 'MIXED_CONSENSUS',
      unusualRegime: cand.regime === 'HIGH_VOLATILITY' || cand.regime === 'UNKNOWN',
      executionUncertain: !ctx.impact?.filledFully,
      portfolioExposureElevated: correlatedOpen > 0,
      // This is an advisory route label. It schedules no work in the entry pipeline.
      deepReviewBudgetAvailable: true,
    }),
    disclaimer: 'Opportunity score and consensus are evidence summaries, not probabilities of profit. Paper trading only.',
  };
  record('decision.engine', performance.now() - t0);
  tx(() => {
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,risk_decision,consensus_id,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      report.id, cand.id, cand.instrumentId, cand.market, report.direction, cand.strategyId, decision, opp.score, risk?.decision ?? null, qci.consensus_id, Date.now(), J(report));
    recordOpportunity({ kind: 'DECISION', instrumentId: cand.instrumentId, strategyId: cand.strategyId, interval: cand.interval, dedupeKey: `decision:${report.id}`, reason: report.reason, candidate: cand, ctx, report });
  });
  bus.publish('decision', { id: report.id, asset: report.asset, decision, score: opp.score, strategy: cand.strategyId });
  return report;
}
