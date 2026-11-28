import { SignedPacket, type EvidencePacket, type ConsensusRecord, type ConsensusState } from './schemas.js';
import { verify } from '../core/signing.js';
import { DOMAINS, REQUIRED_DOMAINS } from '../workers/registry.js';
import { dispatch, flushWorkerStats } from '../workers/runtime.js';
import { challengePanel } from './challenge.js';
import { discountSupport, storedSupportDiscounts } from './supportDiscount.js';
import type { WorkerContext } from '../workers/types.js';
import { uid, iso } from '../core/util.js';
import { record } from '../core/latency.js';
import { run, J } from '../db/db.js';

/**
 * Part 29 L3 consensus coordinator. Not a majority vote:
 *  - packets authenticated (HMAC), schema-validated, replay-checked, candidate-scoped;
 *  - same dependency group ⇒ one vote (mean stance); each domain capped at its weight;
 *  - quorum needs response ratio AND coverage of every required domain;
 *  - any veto ⇒ VETOED; critical challenge ⇒ VETOED; timeouts are ABSTAIN.
 * Thresholds are research defaults, NOT calibrated — labeled as such in every record.
 */
export const QCI_POLICY = { supportThreshold: 0.5, maxOpposition: 0.25, minResponseRatio: 0.6, validityMs: 5 * 60_000 };
export const DOMAIN_WEIGHTS: Record<string, number> = { trend: 0.16, momentum: 0.1, volatility: 0.08, flow: 0.1, liquidity: 0.12, structure: 0.1, regime: 0.1, news: 0.06, onchain: 0.04, risk: 0.08, execution: 0.06 };
const COORDINATOR_VERSION = 'qci-coordinator@1.1.0';
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

export function aggregate(packets: EvidencePacket[], applicableDomains: Set<string>) {
  const byDomain = new Map<string, Map<string, EvidencePacket[]>>();
  for (const p of packets) {
    const d = byDomain.get(p.evidence_domain) ?? new Map(); byDomain.set(p.evidence_domain, d);
    const g = d.get(p.dependency_group) ?? []; g.push(p); d.set(p.dependency_group, g);
  }
  let ws = 0, wo = 0, wTotal = 0; let groups = 0;
  const domains: ConsensusRecord['domains'] = [];
  for (const dom of DOMAINS) {
    if (!applicableDomains.has(dom)) continue;
    const weight = DOMAIN_WEIGHTS[dom]; wTotal += weight;
    const gm: Map<string, EvidencePacket[]> = byDomain.get(dom) ?? new Map();
    let s = 0, o = 0, a = 0; const groupScores: number[] = [];
    for (const ps of gm.values()) {
      groups++;
      const voting = ps.filter((p) => p.stance !== 'ABSTAIN');
      s += ps.filter((p) => p.stance === 'SUPPORT').length; o += ps.filter((p) => p.stance === 'OPPOSE').length; a += ps.filter((p) => p.stance === 'ABSTAIN').length;
      if (voting.length) groupScores.push(voting.reduce((acc, p) => acc + (p.stance === 'SUPPORT' ? 1 : -1), 0) / voting.length);
    }
    const score = groupScores.length ? groupScores.reduce((x, y) => x + y, 0) / groupScores.length : null;
    if (score != null) { ws += weight * Math.max(0, score); wo += weight * Math.max(0, -score); }
    domains.push({ domain: dom, groups: gm.size, support: s, oppose: o, abstain: a, score, weight, required: REQUIRED_DOMAINS.includes(dom as any) });
  }
  return { domains, weightedSupport: wTotal ? ws / wTotal : 0, weightedOpposition: wTotal ? wo / wTotal : 0, groups };
}

export async function runConsensus(ctx: WorkerContext): Promise<ConsensusRecord> {
  const t0 = performance.now();
  const { eligible, quarantined, results } = await dispatch(ctx);
  const packets: EvidencePacket[] = []; let failed = 0; let rejected = 0;
  for (const r of results) {
    if ('failed' in r) { failed++; continue; }
    const v = validatePacket(r, ctx.candidate.id);
    if (typeof v === 'string') { rejected++; continue; }
    packets.push(v);
  }
  const applicable = new Set(DOMAINS.filter((d) => d !== 'onchain' || ctx.candidate.market === 'crypto-dex'));
  // Measured-unreliable SUPPORT is scored as ABSTAIN on a copy; vetoes, challenge and storage use the signed originals.
  const { scored, discounted } = discountSupport(packets, storedSupportDiscounts());
  const agg = aggregate(scored, applicable);
  const challenge = challengePanel(ctx, packets);
  const responding = packets.filter((p) => p.stance !== 'ABSTAIN').length;
  const abstaining = packets.length - responding;
  const vetoes = packets.filter((p) => p.veto).map((p) => ({ worker_id: p.worker_id, reasons: p.reason_codes }));
  const missingRequired = agg.domains.filter((d) => d.required && (d.support + d.oppose) === 0).map((d) => d.domain);
  const missing = [...missingRequired.map((d) => `required domain without evidence: ${d}`), ...agg.domains.filter((d) => !d.required && d.score == null).map((d) => `no evidence: ${d.domain}`)];
  const reasons: string[] = [];
  let state: ConsensusState;
  const criticalChallenges = challenge.filter((c) => c.critical);
  const respRatio = (eligible - quarantined) ? (packets.length) / (eligible - quarantined) : 0;
  if (vetoes.length || criticalChallenges.length) {
    state = 'VETOED';
    vetoes.forEach((v) => reasons.push(`VETO ${v.worker_id}: ${v.reasons.join('; ')}`));
    criticalChallenges.forEach((c) => reasons.push(`CRITICAL ${c.reviewer}: ${c.findings.join('; ')}`));
  } else if (respRatio < QCI_POLICY.minResponseRatio || missingRequired.length) {
    state = 'NO_QUORUM';
    if (respRatio < QCI_POLICY.minResponseRatio) reasons.push(`response ratio ${(respRatio * 100).toFixed(0)}% < ${QCI_POLICY.minResponseRatio * 100}%`);
    missingRequired.forEach((d) => reasons.push(`required domain ${d} has no non-abstaining evidence`));
  } else if (agg.weightedSupport >= QCI_POLICY.supportThreshold && agg.weightedOpposition <= QCI_POLICY.maxOpposition) {
    state = 'STRONG_CONSENSUS';
    reasons.push(`weighted support ${agg.weightedSupport.toFixed(3)} ≥ ${QCI_POLICY.supportThreshold}`, `weighted opposition ${agg.weightedOpposition.toFixed(3)} ≤ ${QCI_POLICY.maxOpposition}`);
  } else {
    state = 'MIXED_CONSENSUS';
    reasons.push(`weighted support ${agg.weightedSupport.toFixed(3)}, opposition ${agg.weightedOpposition.toFixed(3)}`);
  }
  if (discounted.length) reasons.push(`support discounted (measured below base win rate): ${discounted.map((d) => d.worker_id).join(', ')}`);
  const ms = performance.now() - t0; record('qci.consensus', ms);
  flushWorkerStats();
  const created = Date.now();
  const rec: ConsensusRecord = {
    schema_version: '1.0', consensus_id: uid('qci'), candidate_id: ctx.candidate.id, event_id: ctx.candidate.eventId, instrument_id: ctx.candidate.instrumentId,
    strategy_id: ctx.candidate.strategyId, state, reason_codes: reasons, created_at: iso(created), expires_at: iso(created + QCI_POLICY.validityMs), analysis_ms: Math.round(ms * 100) / 100,
    method: { id: 'domain-capped-weighted-v2', support_threshold: QCI_POLICY.supportThreshold, max_opposition: QCI_POLICY.maxOpposition, min_response_ratio: QCI_POLICY.minResponseRatio, calibration: 'NOT_CALIBRATED' },
    workers: { eligible, responding, abstaining, failed, quarantined, rejected_packets: rejected },
    domains: agg.domains, dependency_groups: agg.groups, weighted_support: round3(agg.weightedSupport), weighted_opposition: round3(agg.weightedOpposition),
    vetoes, challenge, support_discounts: discounted, missing_inputs: missing, coordinator_version: COORDINATOR_VERSION, trace_id: ctx.candidate.traceId,
  };
  try { run('INSERT INTO consensus_records(id,candidate_id,instrument,state,created_at,expires_at,record) VALUES (?,?,?,?,?,?,?)', rec.consensus_id, rec.candidate_id, rec.instrument_id, rec.state, created, created + QCI_POLICY.validityMs, J({ ...rec, packets })); } catch { /* persistence failure doesn't create approval */ }
  return rec;
}
export const isExpired = (r: ConsensusRecord, nowTs = Date.now()) => Date.parse(r.expires_at) <= nowTs;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
