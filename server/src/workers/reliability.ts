/**
 * Worker reliability (performance memory): did each worker's stance agree with the verified outcome of the trades it
 * evaluated? Extends workers/effectiveness.ts, which measures participation only.
 *
 * Source: the QCI evidence packets stored with each consensus record (qci/coordinator.ts) for decisions that became
 * ledger-verified closed trades (ditas/tradeOutcomes.ts). Retention keeps packets for every decision that led to an
 * order (qci/retention.ts), so nothing here needs new storage.
 *
 * Read-only evidence. Nothing changes a worker, a weight, a QCI threshold or a strategy; below the minimum sample a
 * worker is NEEDS_EVIDENCE. Constant-rule workers are reported as policy confirmations, never as predictive evidence,
 * and dependency groups are reported as the independent units they are.
 */
import { all, P } from '../db/db.js';
import { WORKERS } from './registry.js';
import { wilsonInterval } from '../ditas/evaluation.js';
import { MIN_OUTCOME_SAMPLE } from '../ditas/tradeOutcomes.js';

interface StoredPacket { worker_id: string; stance: 'SUPPORT' | 'OPPOSE' | 'ABSTAIN'; dependency_group: string }
interface Vote { trade: number; workerId: string; group: string; stance: 'SUPPORT' | 'OPPOSE'; won: boolean }

type Interval = ReturnType<typeof wilsonInterval>;
const interval = (hits: number, n: number): Interval | null => (n > 0 ? wilsonInterval(hits, n) : null);

/** Directional votes on verified closed trades. A stance is "correct" when SUPPORT met a net win or OPPOSE a net loss. */
function verifiedVotes() {
  const rows = all<{ net_pnl: number; record: string | null }>(`SELECT t.net_pnl, c.record FROM ditas_trade_outcomes t
    JOIN decisions d ON d.id=t.decision_id LEFT JOIN consensus_records c ON c.id=d.consensus_id
    WHERE t.settlement='VERIFIED' ORDER BY t.closed_at, t.position_id`);
  const votes: Vote[] = [];
  let tradesWithPackets = 0, tradesWithoutPackets = 0, wins = 0;
  for (const row of rows) {
    const packets = row.record ? P<{ packets?: StoredPacket[] }>(row.record).packets : undefined;
    if (!Array.isArray(packets)) { tradesWithoutPackets++; continue; }
    const trade = tradesWithPackets++;
    const won = row.net_pnl > 0; if (won) wins++;
    for (const p of packets) if (p.stance === 'SUPPORT' || p.stance === 'OPPOSE') votes.push({ trade, workerId: p.worker_id, group: p.dependency_group, stance: p.stance, won });
  }
  return { votes, tradesWithPackets, tradesWithoutPackets, wins };
}

export function workerReliability() {
  const { votes, tradesWithPackets, tradesWithoutPackets, wins } = verifiedVotes();
  const min = MIN_OUTCOME_SAMPLE;
  const byWorker = new Map<string, Vote[]>();
  for (const v of votes) byWorker.set(v.workerId, [...(byWorker.get(v.workerId) ?? []), v]);
  const correct = (vs: Vote[]) => vs.filter((v) => (v.stance === 'SUPPORT') === v.won).length;

  const workers = WORKERS.map((w) => {
    const vs = byWorker.get(w.id) ?? [];
    const supports = vs.filter((v) => v.stance === 'SUPPORT');
    const measured = vs.length >= min && w.capability === 'DATA_DRIVEN';
    return {
      id: w.id, name: w.name, domain: w.domain, version: w.version, dependencyGroup: w.dependencyGroup, capability: w.capability,
      role: w.capability === 'CONSTANT_RULE' ? 'POLICY_CONFIRMATION' as const : w.capability === 'PROVIDER_BLOCKED' ? 'PROVIDER_BLOCKED' as const : 'PREDICTIVE_EVIDENCE' as const,
      status: measured ? 'MEASURED' as const : 'NEEDS_EVIDENCE' as const,
      votes: vs.length, supports: supports.length, opposes: vs.length - supports.length,
      stanceAccuracy: measured ? interval(correct(vs), vs.length) : null,
      /** Win rate of trades this worker supported, to compare with the base win rate of all evaluated trades. */
      winRateWhenSupporting: measured && supports.length ? interval(supports.filter((v) => v.won).length, supports.length) : null,
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
      if (support !== oppose) groupVotes.push({ trade, workerId: group, group, stance: support > oppose ? 'SUPPORT' : 'OPPOSE', won: vs[0].won });
    }
    return { dependencyGroup: group, workers: members.length, domains: [...new Set(members.map((w) => w.domain))], votes: groupVotes.length,
      status: groupVotes.length >= min ? 'MEASURED' as const : 'NEEDS_EVIDENCE' as const,
      stanceAccuracy: groupVotes.length >= min ? interval(correct(groupVotes), groupVotes.length) : null };
  });

  return {
    label: 'PAPER' as const, minimumSample: min,
    sample: { verifiedTradesWithEvidence: tradesWithPackets, verifiedTradesWithoutEvidence: tradesWithoutPackets,
      baseWinRate: interval(wins, tradesWithPackets) },
    workers, dependencyGroups: groups,
    summary: {
      registered: WORKERS.length,
      measured: workers.filter((w) => w.status === 'MEASURED').length,
      policyConfirmations: workers.filter((w) => w.role === 'POLICY_CONFIRMATION').length,
      providerBlocked: workers.filter((w) => w.role === 'PROVIDER_BLOCKED').length,
    },
    automaticWeightChange: false as const, tradingAuthority: false as const,
    limitations: [
      'Only trades that were executed are evaluated, so every vote comes from decisions QCI allowed; accuracy on rejected opportunities is not measured.',
      'A worker stance is long-only evidence scored against the net paper result, after costs.',
      'Workers in one dependency group share an input and are not independent confirmations; compare groups, not worker counts.',
    ],
  };
}
