import { get, inTransaction, run, tx } from '../db/db.js';

/**
 * Renewable database lease (singleton scheduler). A holder acquires `name` if it is free, already its own, or expired;
 * otherwise it stays on standby. Acquire/renew is one transaction (BEGIN IMMEDIATE), so two processes sharing the
 * SQLite file cannot both win. The TTL must exceed the renewal interval with margin; a crashed holder is replaced only
 * after its lease expires. Write fences stop an in-flight pass from committing after expiry or takeover.
 */
export interface Lease { name: string; holder: string; acquired_at: number; renewed_at: number; expires_at: number }
export type LeaseFence = Pick<Lease, 'name' | 'holder' | 'acquired_at'>;
export const currentLease = (name: string) => get<Lease>('SELECT * FROM runtime_leases WHERE name=?', name) ?? null;

export function acquireOrRenewLease(name: string, holder: string, ttlMs: number, clock?: number): Lease | null {
  if (!(ttlMs > 0)) throw new Error('lease ttl must be positive');
  return tx(() => {
    const nowTs = clock ?? Date.now();
    const cur = currentLease(name);
    const stillValid = !!cur && cur.expires_at >= nowTs;
    if (stillValid && cur.holder !== holder) return null;
    const lease: Lease = { name, holder, acquired_at: stillValid ? cur.acquired_at : nowTs, renewed_at: nowTs, expires_at: nowTs + ttlMs };
    run(
      'INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(name) DO UPDATE SET holder=excluded.holder, acquired_at=excluded.acquired_at, renewed_at=excluded.renewed_at, expires_at=excluded.expires_at',
      lease.name, lease.holder, lease.acquired_at, lease.renewed_at, lease.expires_at,
    );
    return lease;
  });
}
export const tryAcquireLease = (name: string, holder: string, ttlMs: number, nowTs?: number) =>
  acquireOrRenewLease(name, holder, ttlMs, nowTs) !== null;

export function ownsLease(fence: LeaseFence, nowTs = Date.now()) {
  const current = currentLease(fence.name);
  return current?.holder === fence.holder && current.acquired_at === fence.acquired_at && current.expires_at >= nowTs;
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
