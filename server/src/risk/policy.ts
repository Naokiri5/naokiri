import { z } from 'zod';
import { all, get, run, J, P, tx } from '../db/db.js';
import { audit } from '../core/audit.js';

/**
 * Part 17.2 configurable risk policy. HARD bounds below are system safety constraints that no
 * user setting, agent, or QCI result can exceed. Defaults are the spec's illustrative paper values.
 */
export const RiskPolicy = z.object({
  riskPerTradePct: z.number().min(0.05).max(2),
  maxOpenRiskPct: z.number().min(0.1).max(6),
  dailyLossPct: z.number().min(0.5).max(10),
  weeklyLossPct: z.number().min(1).max(20),
  drawdownWarnPct: z.number().min(1).max(30),
  drawdownHaltPct: z.number().min(2).max(40),
  maxConsecutiveLosses: z.number().int().min(1).max(10),
  cooldownMinutesAfterLossStreak: z.number().int().min(0).max(10_080),
  postExitCooldownMs: z.number().int().min(0).max(604_800_000).optional(),
  stopLossCooldownMs: z.number().int().min(0).max(604_800_000).optional(),
  entryFrequencyWindowMs: z.number().int().min(1000).max(86_400_000).optional(),
  maxEntriesPerWindow: z.number().int().min(1).max(1000).optional(),
  adaptiveDrawdownSizing: z.boolean().optional(),
  maxConcurrentPositions: z.number().int().min(1).max(20),
  maxPositionNotionalPct: z.number().min(1).max(50),
  // Optional logical cash reserves. Existing accepted policies keep their prior behavior.
  // Both are disjoint portions of the same PAPER cash balance, not separate wallets.
  minUnallocatedReservePct: z.number().min(0).max(100).optional(),
  minSettlementReservePct: z.number().min(0).max(100).optional(),
  maxSpreadBps: z.number().min(1).max(50),
  maxSlippageBps: z.number().min(1).max(100),
  maxCostR: z.number().min(0.01).max(0.5),
  maxPriceDeviationPct: z.number().min(0.05).max(3),
  stopFillBufferPct: z.number().min(0.1).max(5),
  feeRate: z.number().min(0).max(0.005),
  maxCorrelatedPositions: z.number().int().min(1).max(10),
  correlationThreshold: z.number().min(0.3).max(0.99),
  leverage: z.literal(1),
  minOpportunityScore: z.number().min(40).max(95),
  approvedMarkets: z.array(z.enum(['crypto'])).min(1),
  approvedVenues: z.array(z.enum(['binance-paper'])).min(1),
});
export type RiskPolicy = z.infer<typeof RiskPolicy>;
export const DEFAULT_POLICY: RiskPolicy = {
  riskPerTradePct: 0.5, maxOpenRiskPct: 2, dailyLossPct: 2, weeklyLossPct: 4, drawdownWarnPct: 5, drawdownHaltPct: 8,
  maxConsecutiveLosses: 3, cooldownMinutesAfterLossStreak: 240, maxConcurrentPositions: 4, maxPositionNotionalPct: 25,
  maxSpreadBps: 15, maxSlippageBps: 20, maxCostR: 0.25, maxPriceDeviationPct: 0.5, stopFillBufferPct: 0.5, feeRate: 0.001,
  maxCorrelatedPositions: 2, correlationThreshold: 0.8, leverage: 1, minOpportunityScore: 60, approvedMarkets: ['crypto'], approvedVenues: ['binance-paper'],
};

export interface PolicyVersion { version: number; policy: RiskPolicy; created_at: number; accepted_by: string }
export function currentPolicy(): PolicyVersion | null {
  const r = get<any>('SELECT * FROM risk_policy_versions ORDER BY version DESC LIMIT 1');
  return r ? { version: r.version, policy: P(r.policy), created_at: r.created_at, accepted_by: r.accepted_by } : null;
}
/** Only the authenticated owner may accept/change limits (Part 17.1). Changes are versioned + audited. */
export function acceptPolicy(actor: string, input: unknown): PolicyVersion {
  if (actor !== 'owner') throw new Error('only the authenticated owner may change risk limits');
  const policy = RiskPolicy.parse(input);
  if (policy.drawdownHaltPct < policy.drawdownWarnPct) throw new Error('drawdownHaltPct must be ≥ drawdownWarnPct');
  if (policy.weeklyLossPct < policy.dailyLossPct) throw new Error('weeklyLossPct must be ≥ dailyLossPct');
  if ((policy.minUnallocatedReservePct ?? 0) + (policy.minSettlementReservePct ?? 0) > 100) throw new Error('combined cash reserve percentages must not exceed 100');
  if (policy.maxOpenRiskPct < policy.riskPerTradePct) throw new Error('maxOpenRiskPct must be ≥ riskPerTradePct');
  if ((policy.entryFrequencyWindowMs === undefined) !== (policy.maxEntriesPerWindow === undefined)) throw new Error('entry frequency window and cap must be configured together');
  return tx(() => {
    const cur = currentPolicy(); const version = (cur?.version ?? 0) + 1;
    run('INSERT INTO risk_policy_versions(version, policy, created_at, accepted_by) VALUES (?,?,?,?)', version, J(policy), Date.now(), actor);
    audit(actor, 'risk.policy.accept', { version, policy, previous: cur?.version ?? null });
    return currentPolicy()!;
  });
}
export const policyHistory = () => all<any>('SELECT version, created_at, accepted_by, policy FROM risk_policy_versions ORDER BY version DESC').map((r) => ({ ...r, policy: P(r.policy) }));
