import { get, run, tx } from '../db/db.js';

/**
 * Renewable database lease (singleton scheduler). A holder acquires `name` if it is free, already its own, or expired;
 * otherwise it stays on standby. Acquire/renew is one transaction (BEGIN IMMEDIATE), so two processes sharing the
 * SQLite file cannot both win. The TTL must exceed the renewal interval with margin; a crashed holder is replaced only
 * after its lease expires, never while it may still be acting.
 */
export interface Lease { name: string; holder: string; acquired_at: number; renewed_at: number; expires_at: number }
export const currentLease = (name: string) => get<Lease>('SELECT * FROM runtime_leases WHERE name=?', name) ?? null;

/**
 * Acquire or renew. The outcome is decided from the PERSISTED row (CodeRabbit PR #12): 'RENEWED' only when this holder
 * still owns an unexpired lease; taking over a free or expired lease — including one this same holder lost earlier —
 * is 'ACQUIRED', so callers can run their takeover checks after every acquisition, whatever their cached role says.
 */
export function acquireOrRenewLease(name: string, holder: string, ttlMs: number, nowTs = Date.now()): 'ACQUIRED' | 'RENEWED' | 'HELD_ELSEWHERE' {
  if (!(ttlMs > 0)) throw new Error('lease ttl must be positive');
  return tx(() => {
    const cur = currentLease(name);
    if (!cur) { run('INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at) VALUES (?,?,?,?,?)', name, holder, nowTs, nowTs, nowTs + ttlMs); return 'ACQUIRED'; }
    if (cur.holder === holder && cur.expires_at >= nowTs) { run('UPDATE runtime_leases SET renewed_at=?, expires_at=? WHERE name=? AND holder=?', nowTs, nowTs + ttlMs, name, holder); return 'RENEWED'; }
    if (cur.expires_at < nowTs) { run('UPDATE runtime_leases SET holder=?, acquired_at=?, renewed_at=?, expires_at=? WHERE name=? AND holder=?', holder, nowTs, nowTs, nowTs + ttlMs, name, cur.holder); return 'ACQUIRED'; }
    return 'HELD_ELSEWHERE';
  });
}
export function tryAcquireLease(name: string, holder: string, ttlMs: number, nowTs = Date.now()): boolean {
  return acquireOrRenewLease(name, holder, ttlMs, nowTs) !== 'HELD_ELSEWHERE';
}

/**
 * Write fence (CodeRabbit PR #12). While the engine runs a lane write it sets the fence; OMS write paths call
 * assertWriteFence() INSIDE their own BEGIN IMMEDIATE transaction, so the lease is checked atomically with the write.
 * A process that was paused past its lease TTL (another instance took over) aborts the write instead of committing.
 * Owner actions from the API run without a fence. The calls are synchronous, so the fence cannot leak to other work.
 */
export class LeaseLostError extends Error { constructor(name: string) { super(`engine lease '${name}' is no longer held by this instance; write aborted`); } }
let fence: { name: string; holder: string } | null = null;
export function withWriteFence<T>(name: string, holder: string, fn: () => T): T {
  const prev = fence; fence = { name, holder };
  try { return fn(); } finally { fence = prev; }
}
export function assertWriteFence(nowTs = Date.now()) {
  if (!fence) return;
  const cur = currentLease(fence.name);
  if (!cur || cur.holder !== fence.holder || cur.expires_at < nowTs) throw new LeaseLostError(fence.name);
}
/** Release only our own lease (graceful shutdown), so a successor can start immediately instead of waiting for expiry. */
export function releaseLease(name: string, holder: string) { return Number(run('DELETE FROM runtime_leases WHERE name=? AND holder=?', name, holder).changes) > 0; }
