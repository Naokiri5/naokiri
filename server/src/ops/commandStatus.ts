import { dualResearchStatus } from '../choice/dualRuntime.js';
import { latencyReport } from '../core/latency.js';
import { get } from '../db/db.js';
import { paperChoiceOutcomes } from '../ditas/execution.js';
import { recentChoiceShadows } from '../ditas/memory.js';
import { protectPositions } from '../exec/oms.js';
import { unreconciledPaperOrders } from '../exec/recovery.js';
import { reconcile } from '../portfolio/calendar.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { providers } from '../providers/http.js';
import { FUTURES_CONTEXT_MAX_AGE_MS } from '../providers/binanceFuturesResearch.js';
import { readiness, type EngineView } from './readiness.js';

/** Read-only operational view for the owner session. Existing services supply each reading. */
export function commandStatus(engine: EngineView, at = Date.now()) {
  const research = dualResearchStatus(at);
  const context = research.deep.result?.marketContext;
  const fresh = (stamp: number) => stamp <= at && at - stamp <= FUTURES_CONTEXT_MAX_AGE_MS;
  const protection = protectPositions().positions;
  const ledger = reconcile();
  const choice = recentChoiceShadows(1)[0];
  const selected = choice?.candidates.find((candidate) => candidate.decisionId === choice.selectedDecisionId);
  const observed = paperChoiceOutcomes(selected ? [selected.decisionId] : [])[0];
  const sourceHealth = providers().filter(({ requiresCredentials, status }) => !requiresCredentials && status !== 'DISABLED');
  const activity = get<{ count: number; denials: number }>(`
    SELECT COUNT(*) AS count, COUNT(CASE WHEN risk_decision='DENY' THEN 1 END) AS denials
    FROM (SELECT risk_decision FROM decisions ORDER BY created_at DESC LIMIT 100)
  `)!;
  const execution = get<{ fills: number; fees: number; lastFillAt: number | null }>(`
    SELECT COUNT(*) AS fills, COALESCE(SUM(f.fee),0) AS fees, MAX(f.ts) AS lastFillAt
    FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.account=?
  `, PAPER_ACCOUNT)!;
  return {
    readiness: readiness(engine, at),
    recovery: {
      unresolvedOrders: unreconciledPaperOrders(),
      positions: protection.length,
      verifiedPositions: protection.filter((position) => position.protected).length,
    },
    protection,
    ledger: { reconciled: ledger.ok, closedPositions: ledger.closedPositions, netPnl: ledger.positionsRealized },
    activity,
    execution,
    providers: { live: sourceHealth.filter((provider) => provider.status === 'LIVE').length, total: sourceHealth.length },
    research: {
      fast: { checkedAt: research.fast.checkedAt, stale: research.fast.stale, count: research.fast.result?.candidates.length ?? null },
      deep: { checkedAt: research.deep.attemptAt, stale: research.deep.stale, symbol: research.deep.symbol,
        error: research.deep.error !== null, state: research.deep.result?.state ?? null,
        fundingRate: context?.funding && fresh(context.funding.localAt) ? context.funding.rate : null,
        openInterest: context?.openInterest && fresh(context.openInterest.localAt) ? context.openInterest.quantity : null },
    },
    choice: choice ? {
      at: choice.completedAt, observed: choice.totalReportsObserved,
      reason: choice.noTradeReason, selected: selected?.instrumentId ?? null,
      outcome: observed ? { netPnl: observed.netPnl, fees: observed.fees, entrySlippageBps: observed.entrySlippageBps } : null,
    } : null,
    latency: latencyReport().filter(({ stage }) => stage === 'decision.engine' || stage === 'bot.protection'),
  };
}
