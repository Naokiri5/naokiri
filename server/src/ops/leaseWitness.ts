import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { verifyAuditChain } from '../core/audit.js';
import { validLeaseAt, type Lease } from './lease.js';
import { sessionBoundToLease, type DurableBrainosSession } from './paperSpotEntry.js';

export type LeaseObservation = 'ABSENT' | 'CURRENT' | 'EXPIRED' | 'INVALID';
export interface LeaseWitness {
  observedAt: number;
  lease: LeaseObservation;
  session: 'ABSENT' | 'NOT_RUNNING' | 'BOUND' | 'UNBOUND';
  audit: { ok: boolean; entries: number; brokenAt?: number };
  /** An observation is not a fencing token or permission to trade. */
  tradingAuthority: false;
}

/**
 * Independent read-only witness over the canonical WAL database.
 * Never acquires/renews/releases a lease, kills a PID, writes an order, or certifies a live gate.
 * A single read transaction provides a consistent snapshot; absent/malformed schema throws.
 * Run in a separate process on a host that can safely read the same database directory.
 */
export function inspectLeaseWitness(file: string, at = Date.now()): LeaseWitness {
  if (!file || file === ':memory:' || !Number.isSafeInteger(at) || at <= 0)
    throw new Error('INVALID_LEASE_WITNESS_INPUT');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
    // SELECT * so the fencing epoch is read when present; a database from before schema 12 has none (epoch 0).
    const raw = db.prepare("SELECT * FROM runtime_leases WHERE name='engine'").get() as (Omit<Lease, 'epoch'> & { epoch?: number }) | undefined;
    const row: Lease | undefined = raw ? { name: raw.name, holder: raw.holder, acquired_at: raw.acquired_at, renewed_at: raw.renewed_at, expires_at: raw.expires_at, epoch: raw.epoch ?? 0 } : undefined;
    const checkpoint = db.prepare("SELECT * FROM brainos_sessions WHERE session_id='brainos-autopilot'").get() as DurableBrainosSession | undefined;
    const lease: LeaseObservation = !row ? 'ABSENT' : !validLeaseAt(row, at) ? 'INVALID' :
      row.expires_at < at ? 'EXPIRED' : 'CURRENT';
    const session = !checkpoint ? 'ABSENT' : checkpoint.state !== 'RUNNING' ? 'NOT_RUNNING' :
      lease === 'CURRENT' && row && sessionBoundToLease(checkpoint, row) ? 'BOUND' : 'UNBOUND';
    const audit = verifyAuditChain(db.prepare('SELECT * FROM audit_log ORDER BY id').all());
    db.exec('COMMIT');
    return { observedAt: at, lease, session, audit, tradingAuthority: false };
  } finally { db.close(); }
}

// An explicit CLI probe, not an auto-started watchdog or order executor.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Database path required');
    const result = inspectLeaseWitness(file);
    console.log(JSON.stringify(result));
    if (result.lease !== 'CURRENT' || result.session === 'UNBOUND' || !result.audit.ok) process.exitCode = 1;
  } catch {
    // Do not print private database paths, row values, or secrets in operational logs.
    console.error('LEASE_WITNESS_UNAVAILABLE');
    process.exitCode = 2;
  }
}
