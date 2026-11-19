import { SignedPacket, type EvidencePacket, type ConsensusRecord, type ConsensusState } from './schemas.js';
import { verify } from '../core/signing.js';
import { DOMAINS, REQUIRED_DOMAINS, WORKERS } from '../workers/registry.js';
import { dispatch, flushWorkerStats } from '../workers/runtime.js';
import { challengePanel } from './challenge.js';
import type { WorkerContext } from '../workers/types.js';
import { uid, iso, expiredAt } from '../core/util.js';
import { record } from '../core/latency.js';
import { run, J } from '../db/db.js';

/**
 * Part 29 L3 consensus coordinator. Not a majority vote:
 *  - packets authenticated (HMAC), schema-validated, replay-checked, candidate-scoped;
 *  - same dependency group ⇒ ONE vote in total (mean stance), counted in its primary domain — the first domain, in
 *    DOMAINS order, where it has evidence. An input shared by several domains (e.g. the 24h ticker) no longer votes in
 *    each of them (R-12, owner-approved 2026-11-18). Each domain is capped at its weight;
 *  - only DATA_DRIVEN workers are evidence: constant-rule workers (always the same verdict) and provider-blocked workers
 *    (no data source) are shown but never counted toward scores, required-domain coverage or the response ratio;
 *  - quorum needs the response ratio of data-driven workers AND data-driven coverage of every required domain;
 *  - any veto ⇒ VETOED; critical challenge ⇒ VETOED; timeouts are ABSTAIN.
 * Thresholds are research defaults, NOT calibrated — labeled as such in every record.
 */
export const QCI_POLICY = { supportThreshold: 0.5, maxOpposition: 0.25, minResponseRatio: 0.6, validityMs: 5 * 60_000 };
export const DOMAIN_WEIGHTS: Record<string, number> = { trend: 0.16, momentum: 0.1, volatility: 0.08, flow: 0.1, liquidity: 0.12, structure: 0.1, regime: 0.1, news: 0.06, onchain: 0.04, risk: 0.08, execution: 0.06 };
const COORDINATOR_VERSION = 'qci-coordinator@1.2.0';
const CAPABILITY = new Map(WORKERS.map((w) => [w.id, w.capability]));
/** Authenticated packets from an unknown worker id (test fixtures) are treated as data-driven. */
const isEvidence = (p: EvidencePacket) => (CAPABILITY.get(p.worker_id) ?? 'DATA_DRIVEN') === 'DATA_DRIVEN';
const seen = new Set<string>(); // replay protection
const SEEN_MAX = 200_000;

export function validatePacket(raw: unknown, candidateId: string): EvidencePacket | string {
  const p = SignedPacket.safeParse(raw);
  if (!p.success) return 'SCHEMA_INVALID';
  if (!verify(p.data.packet, p.data.sig)) return 'SIGNATURE_INVALID';
  if (p.data.packet.candidate_id !== candidateId) return 'SCOPE_MISMATCH';
  if (seen.has(p.data.packet.packet_id)) return 'REPLAY';
  seen.add(p.data.packet.packet_id); if (seen.size > SEEN_MAX) seen.clear();
  return p.data.packet;
}

/**
 * R-12 v3 (MA-03/MA-12). Two separate questions:
 *  - VOTE: each dependency group votes once. It is credited to the first domain (DOMAINS order) that has a non-abstaining
 *    packet in it, and its score comes ONLY from that domain's packets — never an average across domains.
 *  - COVERAGE: a domain's support/oppose/abstain are its OWN data-driven packets, wherever the group's vote went. A required
 *    domain is covered only by its own non-abstaining evidence; another domain's worker can never satisfy it.
 */
export function aggregate(packets: EvidencePacket[], applicableDomains: Set<string>) {
  const evidence = packets.filter((p) => isEvidence(p) && applicableDomains.has(p.evidence_domain));
  const primary = new Map<string, string>();
  for (const dom of DOMAINS) for (const p of evidence) if (p.evidence_domain === dom && p.stance !== 'ABSTAIN' && !primary.has(p.dependency_group)) primary.set(p.dependency_group, dom);
  for (const dom of DOMAINS) for (const p of evidence) if (p.evidence_domain === dom && !primary.has(p.dependency_group)) primary.set(p.dependency_group, dom); // abstain-only groups
  const votesByDomain = new Map<string, Map<string, EvidencePacket[]>>();
  for (const p of evidence) {
    const dom = primary.get(p.dependency_group)!;
    if (p.evidence_domain !== dom) continue; // other domains' packets in this group: coverage only, no vote
    const d = votesByDomain.get(dom) ?? new Map(); votesByDomain.set(dom, d);
    const g = d.get(p.dependency_group) ?? []; g.push(p); d.set(p.dependency_group, g);
  }
  let ws = 0, wo = 0, wTotal = 0; let groups = 0;
  const domains: ConsensusRecord['domains'] = [];
  for (const dom of DOMAINS) {
    if (!applicableDomains.has(dom)) continue;
    const weight = DOMAIN_WEIGHTS[dom]; wTotal += weight;
    const gm: Map<string, EvidencePacket[]> = votesByDomain.get(dom) ?? new Map();
    const own = evidence.filter((p) => p.evidence_domain === dom);
    const sharedGroups = new Set(own.filter((p) => primary.get(p.dependency_group) !== dom).map((p) => p.dependency_group)).size;
    const constantRule = packets.filter((p) => p.evidence_domain === dom && !isEvidence(p)).length;
    const s = own.filter((p) => p.stance === 'SUPPORT').length, o = own.filter((p) => p.stance === 'OPPOSE').length, a = own.filter((p) => p.stance === 'ABSTAIN').length;
    const groupScores: number[] = [];
    for (const ps of gm.values()) {
      groups++;
      const voting = ps.filter((p) => p.stance !== 'ABSTAIN');
      if (voting.length) groupScores.push(voting.reduce((acc, p) => acc + (p.stance === 'SUPPORT' ? 1 : -1), 0) / voting.length);
    }
    let score = groupScores.length ? groupScores.reduce((x, y) => x + y, 0) / groupScores.length : null;
    if (score != null) { ws += weight * Math.max(0, score); wo += weight * Math.max(0, -score); }
    // D-01 (100-agent audit): this domain's own packets in groups whose single vote went to ANOTHER domain must not
    // disappear. Their ADVERSE balance still counts as this domain's opposition (support is never double-counted).
    const shadowVoting = own.filter((p) => p.stance !== 'ABSTAIN' && primary.get(p.dependency_group) !== dom);
    if (shadowVoting.length) {
      const shadow = shadowVoting.reduce((acc, p) => acc + (p.stance === 'SUPPORT' ? 1 : -1), 0) / shadowVoting.length;
      // R-02 (independent review): count this domain's adverse evidence ONCE (max of its own vote and its shadow readings)
      // and keep the domain's support + opposition within its weight, so weighted opposition stays in [0, 1].
      if (shadow < 0) {
        const counted = score != null ? Math.max(0, -score) : 0;
        const room = Math.max(0, 1 - Math.max(0, score ?? 0) - counted);
        wo += weight * Math.min(room, Math.max(0, -shadow - counted));
        if (score == null) score = shadow;
      }
    }
    domains.push({ domain: dom, groups: gm.size, support: s, oppose: o, abstain: a, score, weight, required: REQUIRED_DOMAINS.includes(dom as any), sharedGroups, constantRule });
  }
  return { domains, weightedSupport: wTotal ? ws / wTotal : 0, weightedOpposition: wTotal ? wo / wTotal : 0, groups };
}

/** Share of active DATA-DRIVEN workers that returned a valid packet (ABSTAIN counts as an answer; failures do not). */
export function responseRatio(activeIds: string[], packets: EvidencePacket[]) {
  const dataDrivenActive = activeIds.filter((id) => (CAPABILITY.get(id) ?? 'DATA_DRIVEN') === 'DATA_DRIVEN').length;
  const answered = new Set(packets.filter(isEvidence).map((p) => p.worker_id)).size; // distinct workers (D-03)
  return dataDrivenActive ? Math.min(1, answered / dataDrivenActive) : 0;
}

export async function runConsensus(ctx: WorkerContext): Promise<ConsensusRecord> {
  const t0 = performance.now();
  const { eligible, quarantined, results, activeIds } = await dispatch(ctx);
  const packets: EvidencePacket[] = []; let failed = 0; let rejected = 0;
  for (const r of results) {
    if ('failed' in r) { failed++; continue; }
    const v = validatePacket(r, ctx.candidate.id);
    if (typeof v === 'string') { rejected++; continue; }
    if (packets.some((p) => p.worker_id === v.worker_id)) { rejected++; continue; } // one packet per worker (D-03)
    packets.push(v);
  }
  const applicable = new Set(DOMAINS.filter((d) => d !== 'onchain' || ctx.candidate.market === 'crypto-dex'));
  const agg = aggregate(packets, applicable);
  const challenge = challengePanel(ctx, packets);
  const responding = packets.filter((p) => p.stance !== 'ABSTAIN').length;
  const abstaining = packets.length - responding;
  const vetoes = packets.filter((p) => p.veto).map((p) => ({ worker_id: p.worker_id, reasons: p.reason_codes }));
  const missingRequired = agg.domains.filter((d) => d.required && (d.support + d.oppose) === 0).map((d) => d.domain);
  // C-01 (100-agent audit): `mandatory` workers (spread, impact, cost, safety, data quality, regime fit) must each give a
  // non-abstaining answer; an abstaining, failed or quarantined mandatory check means no quorum.
  const missingMandatory = WORKERS.filter((w) => w.mandatory && applicable.has(w.domain) && !packets.some((p) => p.worker_id === w.id && p.stance !== 'ABSTAIN')).map((w) => `${w.id} ${w.name}`);
  const missing = [...missingRequired.map((d) => `required domain without evidence: ${d}`), ...agg.domains.filter((d) => !d.required && d.score == null).map((d) => `no evidence: ${d.domain}`)];
  const reasons: string[] = [];
  let state: ConsensusState;
  const criticalChallenges = challenge.filter((c) => c.critical);
  // Response ratio over DATA-DRIVEN workers only: provider-blocked workers always abstain and constant-rule workers always
  // answer, so neither may make a quorum. A data-driven ABSTAIN is a valid answer ("no signal"), a failure is not.
  const respRatio = responseRatio(activeIds, packets);
  if (vetoes.length || criticalChallenges.length) {
    state = 'VETOED';
    vetoes.forEach((v) => reasons.push(`VETO ${v.worker_id}: ${v.reasons.join('; ')}`));
    criticalChallenges.forEach((c) => reasons.push(`CRITICAL ${c.reviewer}: ${c.findings.join('; ')}`));
  } else if (respRatio < QCI_POLICY.minResponseRatio || missingRequired.length || missingMandatory.length) {
    state = 'NO_QUORUM';
    missingMandatory.forEach((w) => reasons.push(`mandatory check ${w} gave no answer`));
    if (respRatio < QCI_POLICY.minResponseRatio) reasons.push(`data-driven response ratio ${(respRatio * 100).toFixed(0)}% < ${QCI_POLICY.minResponseRatio * 100}%`);
    missingRequired.forEach((d) => reasons.push(`required domain ${d} has no non-abstaining evidence`));
  } else if (agg.weightedSupport >= QCI_POLICY.supportThreshold && agg.weightedOpposition <= QCI_POLICY.maxOpposition) {
    state = 'STRONG_CONSENSUS';
    reasons.push(`weighted support ${agg.weightedSupport.toFixed(3)} ≥ ${QCI_POLICY.supportThreshold}`, `weighted opposition ${agg.weightedOpposition.toFixed(3)} ≤ ${QCI_POLICY.maxOpposition}`);
  } else {
    state = 'MIXED_CONSENSUS';
    reasons.push(`weighted support ${agg.weightedSupport.toFixed(3)}, opposition ${agg.weightedOpposition.toFixed(3)}`);
  }
  const ms = performance.now() - t0; record('qci.consensus', ms);
  flushWorkerStats();
  const created = Date.now();
  const rec: ConsensusRecord = {
    schema_version: '1.0', consensus_id: uid('qci'), candidate_id: ctx.candidate.id, event_id: ctx.candidate.eventId, instrument_id: ctx.candidate.instrumentId,
    strategy_id: ctx.candidate.strategyId, state, reason_codes: reasons, created_at: iso(created), expires_at: iso(created + QCI_POLICY.validityMs), analysis_ms: Math.round(ms * 100) / 100,
    method: { id: 'domain-capped-weighted-v3', support_threshold: QCI_POLICY.supportThreshold, max_opposition: QCI_POLICY.maxOpposition, min_response_ratio: QCI_POLICY.minResponseRatio, calibration: 'NOT_CALIBRATED' },
    workers: { eligible, responding, abstaining, failed, quarantined, rejected_packets: rejected },
    domains: agg.domains, dependency_groups: agg.groups, weighted_support: round3(agg.weightedSupport), weighted_opposition: round3(agg.weightedOpposition),
    vetoes, challenge, missing_inputs: missing, coordinator_version: COORDINATOR_VERSION, trace_id: ctx.candidate.traceId,
  };
  try { run('INSERT INTO consensus_records(id,candidate_id,instrument,state,created_at,expires_at,record) VALUES (?,?,?,?,?,?,?)', rec.consensus_id, rec.candidate_id, rec.instrument_id, rec.state, created, created + QCI_POLICY.validityMs, J({ ...rec, packets })); }
  catch (e: any) {
    // D-06: a decision must never reference a consensus record that was not stored (it could not be reproduced).
    // Fail closed: the record no longer permits a trade.
    rec.state = 'NO_QUORUM';
    rec.reason_codes = [...rec.reason_codes, `CONSENSUS_NOT_PERSISTED: ${String(e?.message ?? e).slice(0, 120)}`];
  }
  return rec;
}
export const isExpired = (r: ConsensusRecord, nowTs = Date.now()) => expiredAt(r.expires_at, nowTs); // J-04: missing/garbage = expired
const round3 = (x: number) => Math.round(x * 1000) / 1000;
