/**
 * Worker reliability (performance memory): did each worker's stance agree with the verified outcome of the trades it
 * evaluated? Extends workers/effectiveness.ts, which measures participation only.
 *
 * Source: the QCI evidence packets stored with each consensus record (qci/coordinator.ts) for decisions that became
 * ledger-verified closed trades (ditas/tradeOutcomes.ts). Retention keeps packets for every decision that led to an
 * order (qci/retention.ts), so nothing here needs new storage.
 *
 * Evidence, with one owner-approved effect (26 Nov 2026): a worker version whose SUPPORT win rate is measured as
 * significantly below the base win rate is stored as a support discount, which QCI applies (qci/supportDiscount.ts).
 * Nothing else changes a worker, a weight, a QCI threshold or a strategy; below the minimum sample a worker is
 * NEEDS_EVIDENCE. Only hash-intact outcome records and votes cast by the worker's current version are counted. Constant-rule workers are reported as policy confirmations, never as predictive evidence,
 * and dependency groups are reported as the independent units they are.
 */
import { all, tx, P } from '../db/db.js';
import { setSetting } from '../core/settings.js';
import { assertWriteFence, type LeaseFence } from '../ops/lease.js';
import { SUPPORT_DISCOUNT_KEY, type StoredSupportDiscounts, type SupportDiscount } from '../qci/supportDiscount.js';
import { WORKERS } from './registry.js';
import { wilsonInterval } from '../ditas/evaluation.js';
import { MIN_OUTCOME_SAMPLE, verifyTradeOutcomes } from '../ditas/tradeOutcomes.js';

interface StoredPacket { worker_id: string; worker_version?: string; stance: 'SUPPORT' | 'OPPOSE' | 'ABSTAIN'; dependency_group: string }
interface Vote { trade: number; workerId: string; workerVersion: string | null; group: string; stance: 'SUPPORT' | 'OPPOSE'; won: boolean }

type Interval = ReturnType<typeof wilsonInterval>;
const interval = (hits: number, n: number): Interval | null => (n > 0 ? wilsonInterval(hits, n) : null);

/** Directional votes on verified closed trades. A stance is "correct" when SUPPORT met a net win or OPPOSE a net loss. */
function verifiedVotes() {
  const rows = all<{ position_id: string; net_pnl: number; record: string | null }>(`SELECT t.position_id, t.net_pnl, c.record FROM ditas_trade_outcomes t
    JOIN decisions d ON d.id=t.decision_id LEFT JOIN consensus_records c ON c.id=d.consensus_id
    WHERE t.settlement='VERIFIED' ORDER BY t.closed_at, t.position_id`);
  const tampered = new Set(verifyTradeOutcomes().tampered);
  const votes: Vote[] = [];
  let tradesWithPackets = 0, tradesWithoutPackets = 0, wins = 0;
  for (const row of rows) {
    if (tampered.has(row.position_id)) continue; // an altered record is never evidence
    const packets = row.record ? P<{ packets?: StoredPacket[] }>(row.record).packets : undefined;
    if (!Array.isArray(packets)) { tradesWithoutPackets++; continue; }
    const trade = tradesWithPackets++;
    const won = row.net_pnl > 0; if (won) wins++;
    for (const p of packets) if (p.stance === 'SUPPORT' || p.stance === 'OPPOSE') votes.push({ trade, workerId: p.worker_id, workerVersion: p.worker_version ?? null, group: p.dependency_group, stance: p.stance, won });
  }
  return { votes, tradesWithPackets, tradesWithoutPackets, wins };
}

export function workerReliability() {
  const { votes, tradesWithPackets, tradesWithoutPackets, wins } = verifiedVotes();
  const min = MIN_OUTCOME_SAMPLE;
  const byWorker = new Map<string, Vote[]>();
  const current = new Map(WORKERS.map((w) => [w.id, w.version]));
  // A worker's record belongs to the version that cast it; a new version starts with no history.
  for (const v of votes) if (v.workerVersion === current.get(v.workerId)) byWorker.set(v.workerId, [...(byWorker.get(v.workerId) ?? []), v]);
  const baseWinRate = interval(wins, tradesWithPackets);
  const correct = (vs: Vote[]) => vs.filter((v) => (v.stance === 'SUPPORT') === v.won).length;

  const workers = WORKERS.map((w) => {
    const vs = byWorker.get(w.id) ?? [];
    const supports = vs.filter((v) => v.stance === 'SUPPORT');
    const measured = vs.length >= min && w.capability === 'DATA_DRIVEN';
    const winRateWhenSupporting = measured && supports.length ? interval(supports.filter((v) => v.won).length, supports.length) : null;
    return {
      id: w.id, name: w.name, domain: w.domain, version: w.version, dependencyGroup: w.dependencyGroup, capability: w.capability,
      role: w.capability === 'CONSTANT_RULE' ? 'POLICY_CONFIRMATION' as const : w.capability === 'PROVIDER_BLOCKED' ? 'PROVIDER_BLOCKED' as const : 'PREDICTIVE_EVIDENCE' as const,
      status: measured ? 'MEASURED' as const : 'NEEDS_EVIDENCE' as const,
      votes: vs.length, supports: supports.length, opposes: vs.length - supports.length,
      stanceAccuracy: measured ? interval(correct(vs), vs.length) : null,
      /** Win rate of trades this worker supported, to compare with the base win rate of all evaluated trades. */
      winRateWhenSupporting,
      /** Its SUPPORT is scored as ABSTAIN by QCI: enough supports, and the win-rate interval lies wholly below the base. */
      supportDiscounted: !!(winRateWhenSupporting && baseWinRate && supports.length >= min && winRateWhenSupporting.upper < baseWinRate.lower),
    };
  });

  // Workers in one dependency group share an upstream input: measure the group once per trade, by majority stance.
  const groups = [...new Set(WORKERS.map((w) => w.dependencyGroup))].map((group) => {
    const members = WORKERS.filter((w) => w.dependencyGroup === group);
    // One vote per trade: the majority stance of the group's members (ties count as no vote).
    const perTrade = new Map<number, Vote[]>();
    for (const v of votes) if (v.group === group) perTrade.set(v.trade, [...(perTrade.get(v.trade) ?? []), v]);
    const groupVotes: Vote[] = [];
    for (const [trade, vs] of perTrade) {
      const support = vs.filter((v) => v.stance === 'SUPPORT').length, oppose = vs.length - support;
      if (support !== oppose) groupVotes.push({ trade, workerId: group, workerVersion: null, group, stance: support > oppose ? 'SUPPORT' : 'OPPOSE', won: vs[0].won });
    }
    return { dependencyGroup: group, workers: members.length, domains: [...new Set(members.map((w) => w.domain))], votes: groupVotes.length,
      status: groupVotes.length >= min ? 'MEASURED' as const : 'NEEDS_EVIDENCE' as const,
      stanceAccuracy: groupVotes.length >= min ? interval(correct(groupVotes), groupVotes.length) : null };
  });

  return {
    label: 'PAPER' as const, minimumSample: min,
    sample: { verifiedTradesWithEvidence: tradesWithPackets, verifiedTradesWithoutEvidence: tradesWithoutPackets,
      baseWinRate },
    workers, dependencyGroups: groups,
    summary: {
      registered: WORKERS.length,
      measured: workers.filter((w) => w.status === 'MEASURED').length,
      policyConfirmations: workers.filter((w) => w.role === 'POLICY_CONFIRMATION').length,
      providerBlocked: workers.filter((w) => w.role === 'PROVIDER_BLOCKED').length,
    },
    supportDiscountRule: 'SUPPORT is scored as ABSTAIN when at least the minimum sample of supports has a 95% win-rate upper bound below the base win-rate lower bound. OPPOSE and vetoes are never discounted.',
    automaticWeightChange: false as const, tradingAuthority: false as const,
    limitations: [
      'Only trades that were executed are evaluated, so every vote comes from decisions QCI allowed; accuracy on rejected opportunities is not measured.',
      'A worker stance is long-only evidence scored against the net paper result, after costs.',
      'Workers in one dependency group share an input and are not independent confirmations; compare groups, not worker counts.',
    ],
  };
}

/** Background lane: store the measured support discounts QCI reads, under the engine write fence. */
export function refreshSupportDiscounts(nowTs = Date.now(), fence?: LeaseFence): StoredSupportDiscounts {
  const r = workerReliability();
  const workers: SupportDiscount[] = r.workers.filter((w) => w.supportDiscounted).map((w) => ({
    workerId: w.id, workerVersion: w.version, supports: w.supports, winRateUpper: w.winRateWhenSupporting!.upper, baseWinRateLower: r.sample.baseWinRate!.lower }));
  const stored = { computedAt: nowTs, workers };
  tx(() => { assertWriteFence(fence); setSetting(SUPPORT_DISCOUNT_KEY, stored); });
  return stored;
}
