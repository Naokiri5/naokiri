import { get, inTransaction, run, tx } from '../db/db.js';

/**
 * Renewable database lease (singleton scheduler). A holder acquires `name` if it is free, already its own, or expired;
 * otherwise it stays on standby. Acquire/renew is one transaction (BEGIN IMMEDIATE), so two processes sharing the
 * SQLite file cannot both win. The TTL must exceed the renewal interval with margin; a crashed holder is replaced only
 * after its lease expires. Write fences stop an in-flight pass from committing after expiry or takeover.
 */
/**
 * `epoch` is a never-reused fencing counter, bumped on every new acquisition or takeover. holder + acquired_at alone is
 * not enough: a ms timestamp is not guaranteed unique or monotonic, and release deletes the row, so the counter is
 * persisted separately in runtime_lease_epochs.
 */
export interface Lease { name: string; holder: string; acquired_at: number; renewed_at: number; expires_at: number; epoch: number }
export type LeaseFence = Pick<Lease, 'name' | 'holder' | 'acquired_at' | 'epoch'>;
export const currentLease = (name: string) => get<Lease>('SELECT * FROM runtime_leases WHERE name=?', name) ?? null;

/** Reject malformed persisted leases and backward observations, not just expired ones.
 * SQLite is a single-host clock domain; this is not distributed-clock certification.
 */
export function validLeaseAt(lease: Lease, at: number): boolean {
  return Number.isSafeInteger(at) && at >= 0 &&
    typeof lease.name === 'string' && lease.name.length > 0 &&
    typeof lease.holder === 'string' && lease.holder.length > 0 &&
    [lease.acquired_at, lease.renewed_at, lease.expires_at, lease.epoch].every(Number.isSafeInteger) && lease.epoch >= 0 &&
    lease.acquired_at >= 0 && lease.acquired_at <= lease.renewed_at &&
    lease.renewed_at <= at && lease.expires_at > lease.renewed_at;
}

function nextEpoch(name: string, rowEpoch: number): number {
  const stored = get<{ epoch: number }>('SELECT epoch FROM runtime_lease_epochs WHERE name=?', name)?.epoch ?? 0;
  const epoch = Math.max(stored, rowEpoch) + 1;
  run('INSERT INTO runtime_lease_epochs(name,epoch) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET epoch=excluded.epoch', name, epoch);
  return epoch;
}

export function acquireOrRenewLease(name: string, holder: string, ttlMs: number, clock?: number): Lease | null {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('lease ttl must be a positive safe integer');
  if (!name || !holder) throw new Error('lease identity must not be empty');
  return tx(() => {
    const nowTs = clock ?? Date.now();
    if (!Number.isSafeInteger(nowTs) || nowTs < 0 || !Number.isSafeInteger(nowTs + ttlMs))
      throw new Error('invalid lease clock or expiry');
    const cur = currentLease(name);
    if (cur && !validLeaseAt(cur, nowTs)) return null;
    const stillValid = !!cur && cur.expires_at >= nowTs;
    if (stillValid && cur.holder !== holder) return null;
    // A plain renewal keeps its generation; a new acquisition or takeover takes the next epoch (same transaction).
    const epoch = stillValid ? cur.epoch : nextEpoch(name, cur?.epoch ?? 0);
    const lease: Lease = { name, holder, acquired_at: stillValid ? cur.acquired_at : nowTs, renewed_at: nowTs, expires_at: nowTs + ttlMs, epoch };
    run(
      'INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at,epoch) VALUES (?,?,?,?,?,?) ' +
      'ON CONFLICT(name) DO UPDATE SET holder=excluded.holder, acquired_at=excluded.acquired_at, renewed_at=excluded.renewed_at, expires_at=excluded.expires_at, epoch=excluded.epoch',
      lease.name, lease.holder, lease.acquired_at, lease.renewed_at, lease.expires_at, lease.epoch,
    );
    return lease;
  });
}
export const tryAcquireLease = (name: string, holder: string, ttlMs: number, nowTs?: number) =>
  acquireOrRenewLease(name, holder, ttlMs, nowTs) !== null;

export function ownsLease(fence: LeaseFence, nowTs = Date.now()) {
  const current = currentLease(fence.name);
  return !!current && validLeaseAt(current, nowTs) && current.holder === fence.holder && current.acquired_at === fence.acquired_at && current.epoch === fence.epoch && current.expires_at >= nowTs;
}

export class LeaseLostError extends Error {
  constructor() { super('engine lease lost'); }
}

export function assertWriteFence(fence?: LeaseFence) {
  if (!fence) return;
  if (!inTransaction()) throw new Error('engine write fence requires a transaction');
  if (!ownsLease(fence)) throw new LeaseLostError();
}

/** Release only our own lease (graceful shutdown), so a successor can start immediately instead of waiting for expiry. */
export function releaseLease(name: string, holder: string, acquiredAt?: number) {
  const result = acquiredAt === undefined ? run('DELETE FROM runtime_leases WHERE name=? AND holder=?', name, holder) :
    run('DELETE FROM runtime_leases WHERE name=? AND holder=? AND acquired_at=?', name, holder, acquiredAt);
  return Number(result.changes) > 0;
}
