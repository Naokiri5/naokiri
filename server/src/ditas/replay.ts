/**
 * THINK track A (MIA-THINK-003, 010, 075): deterministic EVIDENCE replay of a recorded decision from its frozen DITAS
 * snapshot, compared with the stored consensus record.
 *
 * What it does: verifies the snapshot hash, rebuilds the WorkerContext exactly as captured at decision time (as-known-at
 * data only: nothing from the live market store), evaluates every applicable worker with the RECORDED evaluation clock,
 * and passes the results through the canonical `aggregate` (no second consensus engine). It then compares domain
 * coverage, scores, weighted support/opposition and vetoes with what was stored.
 *
 * What it does not do: it does not re-run the decision engine or the risk gate (those depend on account state and
 * policy at decision time, which are recorded in the report, not re-derived), and it has no side effects: no packet
 * signing, no worker stats, no quarantine changes, no database writes.
 */
import { get, P } from '../db/db.js';
import { sha256 } from '../core/util.js';
import { hashEvent, workerRegistryHash } from './memory.js';
import { WORKERS } from '../workers/registry.js';
import { isApplicable } from '../workers/runtime.js';
import { aggregate, applicableDomains } from '../qci/coordinator.js';
import type { WorkerContext, Candidate } from '../workers/types.js';
import type { ConsensusRecord, EvidencePacket } from '../qci/schemas.js';

export const REPLAY_VERSION = 'think-replay-v1';
export interface DomainDiff { domain: string; field: 'support' | 'oppose' | 'abstain' | 'score' | 'groups'; recorded: number | null; replayed: number | null }
export interface ReplayReport {
  version: typeof REPLAY_VERSION; decisionId: string; eventId: string; snapshotId: string; snapshotVerified: boolean;
  recordedAt: number; evaluationClock: number | null;
  status: 'REPRODUCED' | 'DIVERGED' | 'NOT_REPLAYABLE';
  reasons: string[];
  compared: { domains: number; workersEvaluated: number; workersFailed: number };
  differences: DomainDiff[];
  weighted: { recordedSupport: number; replayedSupport: number; recordedOpposition: number; replayedOpposition: number };
  vetoes: { recorded: string[]; replayed: string[] };
  scope: string;
}
export class ReplayError extends Error { statusCode = 404; }

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const EPS = 1e-9;

/** Rebuild the worker context from a stored (expanded) snapshot and the recorded candidate. As-known-at only. */
function contextFromSnapshot(snap: any, candidate: Candidate): { ctx: WorkerContext | null; missing: string[] } {
  const c = snap?.context; const missing: string[] = [];
  if (!c) return { ctx: null, missing: ['snapshot has no worker context (recorded before context capture)'] };
  if (c.asOf == null) missing.push('evaluation clock not recorded (snapshot predates THINK replay); time-dependent checks use snapshot time');
  if (!('breadth' in c)) missing.push('market breadth not recorded (snapshot predates THINK replay)');
  const ctx: WorkerContext = {
    asOf: c.asOf ?? snap.asOf, candidate, f: snap.features ?? {}, frameQuality: c.frameQuality ?? undefined,
    btc1h: c.btc1h ?? null, btc4h: c.btc4h ?? null, ticker: c.ticker ?? null, impact: c.impact ?? null,
    intendedNotional: c.intendedNotional, feeRate: c.feeRate, quality: snap.quality, safety: c.safety,
    news: c.news ?? null, prints: c.prints ?? null, corrToBtc: c.corrToBtc ?? null, breadth: c.breadth ?? null, strategyStats: c.strategyStats ?? null,
  };
  return { ctx, missing };
}

/** Replay the evidence behind one stored decision. Read-only. */
export function replayDecision(decisionId: string): ReplayReport {
  const ev = get<any>("SELECT * FROM ditas_events WHERE decision_id=? AND kind='DECISION' ORDER BY seq LIMIT 1", decisionId);
  if (!ev) throw new ReplayError('no DITAS decision event for this decision');
  const snapRow = get<{ id: string; payload: string; hash: string }>('SELECT id, payload, hash FROM ditas_snapshots WHERE id=?', ev.snapshot_id);
  if (!snapRow) throw new ReplayError('snapshot missing');
  const payload = P<any>(ev.payload); const report = payload?.report; const candidate: Candidate | undefined = payload?.candidate;
  const base = { version: REPLAY_VERSION as typeof REPLAY_VERSION, decisionId, eventId: ev.id, snapshotId: snapRow.id, recordedAt: ev.created_at,
    compared: { domains: 0, workersEvaluated: 0, workersFailed: 0 }, differences: [] as DomainDiff[],
    weighted: { recordedSupport: 0, replayedSupport: 0, recordedOpposition: 0, replayedOpposition: 0 }, vetoes: { recorded: [] as string[], replayed: [] as string[] },
    scope: 'Evidence and consensus replay only. The decision engine and risk gate are not re-run; their inputs (account, policy) are in the stored report.' };

  // The candidate and consensus id come from the EVENT payload: verify its hash too, not only the snapshot's.
  if (hashEvent(ev) !== ev.hash) return { ...base, snapshotVerified: false, evaluationClock: null, status: 'NOT_REPLAYABLE', reasons: ['decision event hash does not match: stored event was altered, replay refused'] };
  const verified = sha256(snapRow.payload) === snapRow.hash && snapRow.id === `snap_${snapRow.hash}`;
  if (!verified) return { ...base, snapshotVerified: false, evaluationClock: null, status: 'NOT_REPLAYABLE', reasons: ['snapshot hash does not match: stored evidence was altered, replay refused'] };
  const consensusText = report?.consensus?.id ? get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', report.consensus.id)?.record : null;
  if (!candidate || !consensusText) return { ...base, snapshotVerified: true, evaluationClock: null, status: 'NOT_REPLAYABLE', reasons: [!candidate ? 'candidate not recorded' : 'consensus record not found'] };
  const rec = JSON.parse(consensusText) as ConsensusRecord;

  let snap: any;
  // Workers read only features and context, which are stored inline; candle/book blobs are not needed (no expansion).
  try { snap = P<any>(snapRow.payload); } catch (e) { return { ...base, snapshotVerified: true, evaluationClock: null, status: 'NOT_REPLAYABLE', reasons: [String((e as Error).message)] }; }
  const { ctx, missing } = contextFromSnapshot(snap, candidate);
  if (!ctx) return { ...base, snapshotVerified: true, evaluationClock: null, status: 'NOT_REPLAYABLE', reasons: missing };
  const reasons = [...missing];
  const recordedRegistry = snap?.lineage?.workerRegistry;
  if (recordedRegistry && recordedRegistry !== workerRegistryHash()) reasons.push('worker code versions differ from those at recording time: a difference may come from a code change, not from the data');
  else if (!recordedRegistry) reasons.push('worker code versions were not recorded (snapshot predates this check)');
  if (rec.workers.quarantined > 0 || rec.workers.failed > 0) reasons.push(`at decision time ${rec.workers.failed} worker(s) failed and ${rec.workers.quarantined} were quarantined; which ones is not recorded, so counts may differ`);

  // Evaluate each applicable worker purely (no signing, stats or quarantine side effects).
  const packets: EvidencePacket[] = []; let failed = 0; const vetoes: string[] = [];
  for (const w of WORKERS) {
    if (!isApplicable(w, ctx)) continue;
    try {
      const r = w.evaluate(ctx);
      packets.push({ worker_id: w.id, evidence_domain: w.domain, dependency_group: w.dependencyGroup, stance: r.stance, veto: !!(w.canVeto && r.veto) } as EvidencePacket);
      if (w.canVeto && r.veto) vetoes.push(w.id);
    } catch { failed++; }
  }
  const agg = aggregate(packets, applicableDomains(candidate));
  const differences: DomainDiff[] = [];
  for (const d of rec.domains) {
    const x = agg.domains.find((y) => y.domain === d.domain);
    for (const field of ['support', 'oppose', 'abstain', 'groups'] as const) {
      const a = d[field] as number, b = (x?.[field] as number | undefined) ?? null;
      if (b === null || Math.abs(a - b) > EPS) differences.push({ domain: d.domain, field, recorded: a, replayed: b });
    }
    const sa = d.score, sb = x?.score ?? null;
    if ((sa === null) !== (sb === null) || (sa !== null && sb !== null && Math.abs(sa - sb) > 1e-6)) differences.push({ domain: d.domain, field: 'score', recorded: sa, replayed: sb });
  }
  // Two-way: a domain present only in the replay is a difference too.
  for (const x of agg.domains) if (!rec.domains.some((d) => d.domain === x.domain)) differences.push({ domain: x.domain, field: 'groups', recorded: null, replayed: x.groups });
  const recordedVetoes = rec.vetoes.map((v) => v.worker_id).sort(); const replayedVetoes = [...vetoes].sort();
  const weighted = { recordedSupport: rec.weighted_support, replayedSupport: r3(agg.weightedSupport), recordedOpposition: rec.weighted_opposition, replayedOpposition: r3(agg.weightedOpposition) };
  const weightedSame = Math.abs(weighted.recordedSupport - weighted.replayedSupport) < 1e-6 && Math.abs(weighted.recordedOpposition - weighted.replayedOpposition) < 1e-6;
  const vetoSame = JSON.stringify(recordedVetoes) === JSON.stringify(replayedVetoes);
  const same = !differences.length && weightedSame && vetoSame && failed === 0;
  if (!vetoSame) reasons.push('veto set differs');
  if (!weightedSame) reasons.push('weighted support/opposition differs');
  return { ...base, snapshotVerified: true, evaluationClock: ctx.asOf ?? null, status: same ? 'REPRODUCED' : 'DIVERGED', reasons,
    compared: { domains: rec.domains.length, workersEvaluated: packets.length, workersFailed: failed }, differences, weighted, vetoes: { recorded: recordedVetoes, replayed: replayedVetoes } };
}
