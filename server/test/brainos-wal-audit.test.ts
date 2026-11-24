import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { all, closeDb, openDb, run } from '../src/db/db.js';
import { audit, verifyAuditChain } from '../src/core/audit.js';
import { acquireOrRenewLease, currentLease, ownsLease } from '../src/ops/lease.js';
import { cashBalance, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
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

  it('recovers committed canonical WAL state and rolls back an interrupted financial transaction after process death', () => {
    // Use an actual child process, not closeDb() as a substitute for a crash.
    // The child uses the canonical DB, audit, lease and PAPER ledger only.
    closeDb();
    const script = `
      import { writeSync } from 'node:fs';
      import { openDb, tx } from './src/db/db.ts';
      import { audit } from './src/core/audit.ts';
      import { acquireOrRenewLease } from './src/ops/lease.ts';
      import { ledger, PAPER_ACCOUNT } from './src/portfolio/ledger.ts';
      const file = process.argv[1];
      const now = Number(process.argv[2]);
      const db = openDb(file);
      db.exec('PRAGMA wal_autocheckpoint=0');
      acquireOrRenewLease('engine', 'crashed-fixture', 1000, now);
      tx(() => {
        ledger(PAPER_ACCOUNT, 'DEPOSIT', 5000, 'committed-fixture');
        audit('fixture', 'CRASH_COMMITTED');
      });
      tx(() => {
        ledger(PAPER_ACCOUNT, 'BUY', -800, 'interrupted-fixture');
        audit('fixture', 'CRASH_UNCOMMITTED');
        writeSync(1, 'CRASH_BOUNDARY_REACHED');
        process.kill(process.pid, 'SIGKILL');
        throw new Error('process termination unexpectedly returned');
      });
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, file, String(T)], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, MIA_OFFLINE: '1', MIA_AUTH_MODE: 'passphrase' },
      encoding: 'utf8', timeout: 20_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stdout).toContain('CRASH_BOUNDARY_REACHED');
    if (process.platform !== 'win32') expect(child.signal).toBe('SIGKILL');
    else expect(child.status !== 0 || child.signal !== null).toBe(true);
    expect(existsSync(file + '-wal')).toBe(true);

    const recoveredDb = openDb(file);
    expect(recoveredDb.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    expect(recoveredDb.prepare('PRAGMA synchronous').get()).toMatchObject({ synchronous: 2 });
    expect(cashBalance()).toBe(5000);
    expect(all('SELECT ref FROM ledger_entries WHERE account=? ORDER BY ref', PAPER_ACCOUNT))
      .toEqual([{ ref: 'committed-fixture' }]);
    expect(all('SELECT action FROM audit_log WHERE actor=? ORDER BY id', 'fixture'))
      .toEqual([{ action: 'CRASH_COMMITTED' }]);
    expect(verifyAuditChain().ok).toBe(true);
    const crashed = currentLease('engine')!;
    expect(crashed).toMatchObject({ holder: 'crashed-fixture', acquired_at: T, expires_at: T + 1000 });
    expect(acquireOrRenewLease('engine', 'successor-fixture', 1000, T + 1000)).toBeNull();
    const successor = acquireOrRenewLease('engine', 'successor-fixture', 1000, T + 1001)!;
    expect(successor.holder).toBe('successor-fixture');
    expect(ownsLease(crashed, T + 1001)).toBe(false);
    expect(ownsLease(successor, T + 1001)).toBe(true);
    expect(inspectLeaseWitness(file, T + 1001)).toMatchObject({ lease: 'CURRENT', tradingAuthority: false });

    closeDb();
    openDb(file);
    expect(cashBalance()).toBe(5000);
    expect(currentLease('engine')).toEqual(successor);
    expect(verifyAuditChain().ok).toBe(true);
  });

});
