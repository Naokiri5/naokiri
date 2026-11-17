import { get, run, tx } from '../db/db.js';

/**
 * Renewable database lease (singleton scheduler). A holder acquires `name` if it is free, already its own, or expired;
 * otherwise it stays on standby. Acquire/renew is one transaction (BEGIN IMMEDIATE), so two processes sharing the
 * SQLite file cannot both win. The TTL must exceed the renewal interval with margin; a crashed holder is replaced only
 * after its lease expires, never while it may still be acting.
 */
export interface Lease { name: string; holder: string; acquired_at: number; renewed_at: number; expires_at: number }
export const currentLease = (name: string) => get<Lease>('SELECT * FROM runtime_leases WHERE name=?', name) ?? null;

export function tryAcquireLease(name: string, holder: string, ttlMs: number, nowTs = Date.now()): boolean {
  if (!(ttlMs > 0)) throw new Error('lease ttl must be positive');
  return tx(() => {
    const cur = currentLease(name);
    if (!cur) { run('INSERT INTO runtime_leases(name,holder,acquired_at,renewed_at,expires_at) VALUES (?,?,?,?,?)', name, holder, nowTs, nowTs, nowTs + ttlMs); return true; }
    if (cur.holder === holder) { run('UPDATE runtime_leases SET renewed_at=?, expires_at=? WHERE name=? AND holder=?', nowTs, nowTs + ttlMs, name, holder); return true; }
    if (cur.expires_at < nowTs) { run('UPDATE runtime_leases SET holder=?, acquired_at=?, renewed_at=?, expires_at=? WHERE name=? AND holder=?', holder, nowTs, nowTs, nowTs + ttlMs, name, cur.holder); return true; }
    return false;
  });
}
/** Release only our own lease (graceful shutdown), so a successor can start immediately instead of waiting for expiry. */
export function releaseLease(name: string, holder: string) { return Number(run('DELETE FROM runtime_leases WHERE name=? AND holder=?', name, holder).changes) > 0; }
