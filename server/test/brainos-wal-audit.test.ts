import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { all, closeDb, openDb, run } from '../src/db/db.js';
import { audit, verifyAuditChain } from '../src/core/audit.js';
import { acquireOrRenewLease } from '../src/ops/lease.js';
import { requirePaperSpotSession } from '../src/ops/durableSession.js';
import { inspectLeaseWitness } from '../src/ops/leaseWitness.js';

const T = 1_800_000_000_000;
let dir: string;
let file: string;
beforeEach(() => {
  closeDb();
  dir = mkdtempSync(join(tmpdir(), 'mia-lease-witness-'));
  file = join(dir, 'mia.db');
  openDb(file);
});
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('BrainOS canonical WAL audit evidence (Q42/Q48 partial coverage)', () => {
  it('verifies persisted audit links and detects a modified predecessor after restart', () => {
    audit('fixture', 'FIRST');
    audit('fixture', 'SECOND', { source: 'offline test' });
    closeDb();
    openDb(file);
    expect(verifyAuditChain().ok).toBe(true);
    const rows = all<{ id: number; prev_hash: string | null; hash: string }>('SELECT * FROM audit_log ORDER BY id');
    const last = rows.at(-1)!;
    expect(last.prev_hash).not.toBeNull();
    // Alter only the stored link, not the hash or hashed payload.
    run('UPDATE audit_log SET prev_hash=NULL WHERE id=?', last.id);
    expect(verifyAuditChain()).toMatchObject({ ok: false, brokenAt: last.id });
    expect(inspectLeaseWitness(file, T).audit).toMatchObject({ ok: false, brokenAt: last.id });
  });

  it('detects a tampered genesis link and preserves a valid legacy chain', () => {
    audit('fixture', 'FIRST');
    const rows = all<any>('SELECT * FROM audit_log ORDER BY id');
    expect(verifyAuditChain(rows).ok).toBe(true);
    expect(verifyAuditChain([{ ...rows[0], prev_hash: 'not-genesis' }, ...rows.slice(1)]))
      .toMatchObject({ ok: false, brokenAt: rows[0].id });
  });

  it('observes canonical lease expiry, renewal and takeover without writing authority state', () => {
    expect(inspectLeaseWitness(file, T)).toMatchObject({ lease: 'ABSENT', session: 'ABSENT', tradingAuthority: false });
    acquireOrRenewLease('engine', 'fixture-a', 1000, T);
    requirePaperSpotSession(T);
    const snapshot = () => ['runtime_leases', 'brainos_sessions', 'brainos_session_events', 'audit_log', 'orders', 'fills', 'positions', 'ledger_entries']
      .map(table => all('SELECT * FROM ' + table));
    const before = snapshot();
    expect(inspectLeaseWitness(file, T + 1000)).toMatchObject({ lease: 'CURRENT', session: 'NOT_RUNNING', tradingAuthority: false });
    expect(inspectLeaseWitness(file, T + 1001)).toMatchObject({ lease: 'EXPIRED', tradingAuthority: false });
    expect(snapshot()).toEqual(before);
    acquireOrRenewLease('engine', 'fixture-b', 1000, T + 1001);
    expect(inspectLeaseWitness(file, T + 1002).lease).toBe('CURRENT');
    expect(inspectLeaseWitness(file, T).lease).toBe('INVALID');
  });

  it('reports an inconsistent running checkpoint as unbound without repairing or closing anything', () => {
    requirePaperSpotSession(T);
    acquireOrRenewLease('engine', 'fixture-a', 1000, T);
    // Inject a stale checkpoint to exercise the observer, not an owner-authorized session.
    run("UPDATE brainos_sessions SET state='RUNNING', lease_holder=?, lease_acquired_at=? WHERE session_id='brainos-autopilot'", 'fixture-old', T - 1);
    const before = all('SELECT * FROM brainos_sessions');
    expect(inspectLeaseWitness(file, T)).toMatchObject({ lease: 'CURRENT', session: 'UNBOUND', tradingAuthority: false });
    expect(all('SELECT * FROM brainos_sessions')).toEqual(before);
  });

  it('fails closed without creating a new database or accepting an invalid clock', () => {
    const missing = join(dir, 'missing.db');
    expect(() => inspectLeaseWitness(missing, T)).toThrow();
    expect(existsSync(missing)).toBe(false);
    expect(() => inspectLeaseWitness(file, Number.NaN)).toThrow('INVALID_LEASE_WITNESS_INPUT');
  });
});
