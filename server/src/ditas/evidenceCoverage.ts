/**
 * EVIDENCE Omega coverage: how much of what BrainOS actually decided and traded is backed by complete, classified
 * evidence. Answers "is the evidence lifecycle working?" across all recent records, where evidenceChain.ts answers it
 * for one trade.
 *
 * Reads existing records only (decisions, DITAS decision events and snapshots, QCI consensus records, risk decisions,
 * closed paper positions and their outcome records). Each item gets one quality class from the EVIDENCE Omega
 * vocabulary; nothing missing is inferred, and stored records are classified when read, never trusted as a stored PASS.
 * Read-only; no authority.
 */
import { all, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { reconstructTradeChain } from './evidenceChain.js';

/** EVIDENCE Omega quality classes (section 06) used here. */
export type EvidenceQuality = 'UNAVAILABLE' | 'OBSERVED' | 'VALIDATED' | 'RECONCILED' | 'REJECTED' | 'STALE';
export type DecisionEvidenceKind = 'MARKET_SNAPSHOT' | 'QCI_FINDINGS' | 'RISK_DECISION' | 'DECISION_RECORD';

interface DecisionRow { id: string; created_at: number; risk_decision: string | null; report: string; snapshot_id: string | null; ditas_event: string | null; record: string | null }

/** Classify the evidence behind one stored decision. */
export function classifyDecisionEvidence(row: DecisionRow): Record<DecisionEvidenceKind, EvidenceQuality> {
  let report: any = null; try { report = P(row.report); } catch { report = null; }
  let consensus: any = null; try { consensus = row.record ? P(row.record) : null; } catch { consensus = null; }
  return {
    // A frozen DITAS snapshot captured at decision time is observed market evidence; its absence is explicit.
    MARKET_SNAPSHOT: row.ditas_event && row.snapshot_id ? 'OBSERVED' : 'UNAVAILABLE',
    // Worker packets kept with the consensus record; compaction (older, never traded) leaves them unavailable.
    QCI_FINDINGS: !consensus ? 'UNAVAILABLE' : Array.isArray(consensus.packets) ? 'OBSERVED' : consensus.packetsCompactedAt ? 'STALE' : 'UNAVAILABLE',
    RISK_DECISION: row.risk_decision ? 'VALIDATED' : 'UNAVAILABLE',
    // A decision record that parses and carries strategy and trace identity is structurally validated.
    DECISION_RECORD: report?.strategy?.id && report?.traceId ? 'VALIDATED' : 'REJECTED',
  };
}

const tally = <K extends string>(items: readonly Record<K, EvidenceQuality>[], kinds: readonly K[]) =>
  Object.fromEntries(kinds.map((k) => [k, items.reduce<Partial<Record<EvidenceQuality, number>>>((acc, i) => ({ ...acc, [i[k]]: (acc[i[k]] ?? 0) + 1 }), {})])) as Record<K, Partial<Record<EvidenceQuality, number>>>;

export function evidenceCoverage(options: { decisions?: number; trades?: number } = {}) {
  const decisionLimit = options.decisions ?? 200, tradeLimit = options.trades ?? 200;
  for (const [name, v] of [['decisions', decisionLimit], ['trades', tradeLimit]] as const)
    if (!Number.isInteger(v) || v < 1 || v > 1000) throw new Error(`${name} must be an integer from 1 to 1000`);

  // Decisions: newest first, each with its DITAS decision event and QCI consensus record (if any).
  const decisions = all<DecisionRow>(`SELECT d.id, d.created_at, d.risk_decision, d.report, e.snapshot_id, e.id ditas_event, c.record
    FROM decisions d
    LEFT JOIN ditas_events e ON e.id = (SELECT id FROM ditas_events WHERE decision_id=d.id AND kind='DECISION' ORDER BY seq LIMIT 1)
    LEFT JOIN consensus_records c ON c.id=d.consensus_id
    ORDER BY d.created_at DESC, d.id LIMIT ?`, decisionLimit);
  const decisionKinds: DecisionEvidenceKind[] = ['MARKET_SNAPSHOT', 'QCI_FINDINGS', 'RISK_DECISION', 'DECISION_RECORD'];
  const classified = decisions.map(classifyDecisionEvidence);
  const fullyEvidenced = classified.filter((c) => c.MARKET_SNAPSHOT === 'OBSERVED' && c.QCI_FINDINGS === 'OBSERVED' && c.RISK_DECISION === 'VALIDATED' && c.DECISION_RECORD === 'VALIDATED').length;

  // Closed trades: the full chain must reconstruct; gaps are counted by name.
  const positions = all<{ id: string }>("SELECT id FROM positions WHERE account=? AND status='CLOSED' ORDER BY closed_at DESC, id LIMIT ?", PAPER_ACCOUNT, tradeLimit);
  const gaps: Record<string, number> = {};
  let complete = 0, reconciled = 0, rejected = 0;
  for (const { id } of positions) {
    const chain = reconstructTradeChain(id);
    if (!chain) continue;
    if (chain.complete) complete++;
    for (const g of chain.gaps) gaps[g] = (gaps[g] ?? 0) + 1;
    if (chain.settledOutcome?.settlement === 'VERIFIED' && chain.settledOutcome.hashVerified) reconciled++;
    else if (chain.settledOutcome) rejected++;
  }

  return {
    label: 'PAPER' as const,
    decisions: { sample: decisions.length, fullyEvidenced, byKind: tally(classified, decisionKinds) },
    closedTrades: {
      sample: positions.length, completeChains: complete,
      settlement: { RECONCILED: reconciled, REJECTED: rejected, UNAVAILABLE: positions.length - reconciled - rejected },
      gaps: Object.entries(gaps).sort((a, b) => b[1] - a[1]).map(([gap, count]) => ({ gap, count })),
    },
    tradingAuthority: false as const,
    limitations: [
      'Covers the newest records within the sample limits, not the full history.',
      'OBSERVED market evidence means a frozen snapshot exists; it does not prove the provider data was correct.',
      'QCI findings older than the retention window are compacted unless the decision led to an order (reported as STALE).',
    ],
  };
}
