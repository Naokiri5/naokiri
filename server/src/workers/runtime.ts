import { WORKERS } from './registry.js';
import type { WorkerContext, WorkerDef, WorkerResult } from './types.js';
import { EVIDENCE_SCHEMA_VERSION, type SignedPacket } from '../qci/schemas.js';
import { sign } from '../core/signing.js';
import { uid, iso, withDeadline } from '../core/util.js';
import { run, get, tx } from '../db/db.js';
import { record } from '../core/latency.js';

/** Bounded elastic worker pool (Part 29.2): fixed concurrency, per-worker deadline, failures ⇒ ABSTAIN. */
export const POOL = { concurrency: 16, deadlineMs: 250, quarantineAfterFailures: 5 };
const failures = new Map<string, number>();
export const quarantined = new Set<string>();

export function isApplicable(w: WorkerDef, ctx: WorkerContext) {
  // Candidate-specific task graph (Part 33.7): on-chain workers are only relevant for DEX instruments.
  if (w.domain === 'onchain') return ctx.candidate.market === 'crypto-dex';
  return true;
}

async function runOne(w: WorkerDef, ctx: WorkerContext): Promise<SignedPacket | { failed: string; worker_id: string }> {
  let res: WorkerResult; let ms = 0;
  try {
    res = await withDeadline(Promise.resolve().then(() => { const t0 = performance.now(); const r = w.evaluate(ctx); ms = performance.now() - t0; return r; }), POOL.deadlineMs);
    failures.set(w.id, 0);
  } catch (e: any) {
    const n = (failures.get(w.id) ?? 0) + 1; failures.set(w.id, n);
    if (n >= POOL.quarantineAfterFailures) quarantined.add(w.id);
    bumpStat(w.id, 'failed');
    return { failed: e?.message === 'DEADLINE' ? 'DEADLINE' : 'EXCEPTION', worker_id: w.id };
  }
  record('qci.worker.compute', ms);
  const ageMs = ctx.quality.quoteAgeMs;
  const packet = {
    schema_version: EVIDENCE_SCHEMA_VERSION as '1.0', packet_id: uid('ev'), event_id: ctx.candidate.eventId, candidate_id: ctx.candidate.id,
    instrument_id: ctx.candidate.instrumentId, venue_or_chain: ctx.candidate.venue, worker_id: w.id, worker_version: w.version,
    model_or_algorithm_version: `${w.id}@${w.version}`, analysis_timestamp: iso(), source_ids: w.sourceIds,
    source_freshness_ms: ageMs == null ? null : Math.max(0, Math.round(ageMs)), stance: res.stance, evidence_domain: w.domain,
    dependency_group: w.dependencyGroup, features: sanitize(res.features), confidence: 'NOT_CALIBRATED' as const,
    uncertainty_notes: res.stance === 'ABSTAIN' ? res.reasons.slice(0, 3) : [], invalidation_conditions: [ctx.candidate.signal.invalidation],
    reason_codes: res.reasons.slice(0, 10).map((r) => r.slice(0, 300)), veto: !!(w.canVeto && res.veto), latency_ms: Math.round(ms * 1000) / 1000, trace_id: ctx.candidate.traceId,
  };
  bumpStat(w.id, res.stance === 'SUPPORT' ? 'support' : res.stance === 'OPPOSE' ? 'oppose' : 'abstain');
  return { packet, sig: sign(packet) };
}
function sanitize(f: WorkerResult['features']) {
  const o: Record<string, number | string | boolean | null> = {};
  for (const [k, v] of Object.entries(f)) o[k] = typeof v === 'number' && !Number.isFinite(v) ? null : v;
  return o;
}

export async function dispatch(ctx: WorkerContext) {
  const eligible = WORKERS.filter((w) => isApplicable(w, ctx));
  const active = eligible.filter((w) => !quarantined.has(w.id));
  const results: Awaited<ReturnType<typeof runOne>>[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(POOL.concurrency, active.length) }, async () => {
    while (i < active.length) { const w = active[i++]; results.push(await runOne(w, ctx)); }
  }));
  return { eligible: eligible.length, quarantined: eligible.length - active.length, results, activeIds: active.map((w) => w.id) };
}

type Col = 'support' | 'oppose' | 'abstain' | 'failed';
const pendingStats = new Map<string, Record<Col, number>>();
function bumpStat(id: string, col: Col) {
  const s = pendingStats.get(id) ?? { support: 0, oppose: 0, abstain: 0, failed: 0 }; s[col]++; pendingStats.set(id, s);
}
/** Flushed off the hot path (Part 33: no DB waits inside worker evaluation). */
export function flushWorkerStats() {
  if (!pendingStats.size) return;
  try {
    tx(() => { for (const [id, s] of pendingStats) {
      if (!get('SELECT 1 FROM worker_stats WHERE worker_id=?', id)) run('INSERT INTO worker_stats(worker_id, updated_at) VALUES (?,?)', id, Date.now());
      run('UPDATE worker_stats SET support=support+?, oppose=oppose+?, abstain=abstain+?, failed=failed+?, updated_at=? WHERE worker_id=?', s.support, s.oppose, s.abstain, s.failed, Date.now(), id);
    } });
    pendingStats.clear();
  } catch { /* best-effort stats */ }
}
export function releaseQuarantine(actor: string, id: string) {
  if (actor !== 'owner') throw new Error('only the owner may release a quarantined worker');
  quarantined.delete(id); failures.set(id, 0);
}
