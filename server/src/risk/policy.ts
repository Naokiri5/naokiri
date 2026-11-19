import { z } from 'zod';
import { all, get, run, tx, J } from '../db/db.js';
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
  maxConcurrentPositions: z.number().int().min(1).max(20),
  maxPositionNotionalPct: z.number().min(1).max(50),
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

interface PolicyVersionMeta { version: number; created_at: number; accepted_by: string }
type ValidPolicy = { policy: RiskPolicy; invalid?: never; rawPolicy?: never };
type InvalidPolicy = { policy?: never; invalid: string; rawPolicy?: unknown };
type DecodedPolicy = ValidPolicy | InvalidPolicy;
export type PolicyVersion = PolicyVersionMeta & DecodedPolicy;
type PolicyRow = PolicyVersionMeta & { policy: string };
/** Schema + relational rules. The ONE validator for accepted and stored policies (MA-16). Throws on the first problem. */
export function validatePolicy(input: unknown): RiskPolicy {
  const policy = RiskPolicy.parse(input);
  if (policy.drawdownHaltPct < policy.drawdownWarnPct) throw new Error('drawdownHaltPct must be ≥ drawdownWarnPct');
  if (policy.weeklyLossPct < policy.dailyLossPct) throw new Error('weeklyLossPct must be ≥ dailyLossPct');
  if (policy.maxOpenRiskPct < policy.riskPerTradePct) throw new Error('maxOpenRiskPct must be ≥ riskPerTradePct');
  return policy;
}
const problem = (e: unknown) => e instanceof z.ZodError
  ? e.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'policy'}: ${i.message}`).join('; ')
  : String((e as Error)?.message ?? e);
function readStoredPolicy(raw: string): DecodedPolicy {
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { invalid: 'stored policy is not valid JSON' };
  }
  try { return { policy: validatePolicy(decoded) }; }
  catch (error) { return { invalid: problem(error), rawPolicy: decoded }; }
}

const versionFromRow = ({ policy, ...meta }: PolicyRow): PolicyVersion => ({ ...meta, ...readStoredPolicy(policy) });

/**
 * MIA-RISK-006: the stored policy is re-validated on every read. A row missing a field (written by an older schema) or
 * holding NaN-turned-null would make comparisons like `costR > pol.maxCostR` false, i.e. the check silently passes.
 * An invalid stored policy is reported as `invalid` and the gate denies (POLICY_INVALID) until the owner re-accepts.
 * Invalid rows have no typed `policy`. Consumers may display `rawPolicy`; existing positions use exitPolicy() (MA-01).
 */
export function currentPolicy(): PolicyVersion | null {
  const r = get<PolicyRow>('SELECT version, created_at, accepted_by, policy FROM risk_policy_versions ORDER BY version DESC LIMIT 1');
  return r ? versionFromRow(r) : null;
}
/**
 * The policy used to MANAGE EXISTING positions (exit fees, stop-fill buffer, open-risk accounting). Always validated:
 * the current policy if valid, else the newest valid stored version, else DEFAULT_POLICY. An invalid stored policy must
 * deny new entries (gate) but must never block or corrupt a risk-reducing exit (MA-01/MA-02).
 */
export function exitPolicy(): RiskPolicy {
  for (const r of all<Pick<PolicyRow, 'policy'>>('SELECT policy FROM risk_policy_versions ORDER BY version DESC LIMIT 50')) {
    const decoded = readStoredPolicy(r.policy);
    if (decoded.policy) return decoded.policy;
  }
  return DEFAULT_POLICY;
}
/** Only the authenticated owner may accept/change limits (Part 17.1). Changes are versioned + audited. */
export function acceptPolicy(actor: string, input: unknown): PolicyVersionMeta & ValidPolicy {
  if (actor !== 'owner') throw new Error('only the authenticated owner may change risk limits');
  const policy = validatePolicy(input);
  return tx(() => {
    const previous = get<Pick<PolicyRow, 'version'>>('SELECT version FROM risk_policy_versions ORDER BY version DESC LIMIT 1')?.version ?? null;
    const version = (previous ?? 0) + 1;
    const created_at = Date.now();
    run('INSERT INTO risk_policy_versions(version, policy, created_at, accepted_by) VALUES (?,?,?,?)', version, J(policy), created_at, actor);
    audit(actor, 'risk.policy.accept', { version, policy, previous });
    return { version, policy, created_at, accepted_by: actor };
  });
}
export const policyHistory = () => all<PolicyRow>('SELECT version, created_at, accepted_by, policy FROM risk_policy_versions ORDER BY version DESC').map(versionFromRow);
