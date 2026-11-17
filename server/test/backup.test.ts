import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, getDb, openDb, run } from '../src/db/db.js';
import { config } from '../src/config.js';
import { audit, verifyAuditChain } from '../src/core/audit.js';
import { getSetting, setSetting } from '../src/core/settings.js';
import { SCHEMA_VERSION } from '../src/db/migrations.js';
import { buildApp } from '../src/index.js';
import { backupCheck, backupStatus, createBackup, listBackups, restoreTest, startBackups, stopBackups } from '../src/backup/backup.js';

const hash = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
let dir: string; const original = { ...config.backup };
const manifestPath = (id: string) => join(config.backup.dir, `mia-${id}.json`);
beforeEach(() => {
  closeDb(); dir = mkdtempSync(join(tmpdir(), 'mia-backup-test-'));
  Object.assign(config.backup, { dir: join(dir, 'backups'), intervalMs: 6 * 3600_000, keep: 14 });
  delete process.env.MIA_BACKUP_KEY;
  openDb(join(dir, 'mia.db')); audit('test', 'seed');
});
afterEach(() => {
  stopBackups(); vi.useRealTimers(); vi.restoreAllMocks(); closeDb(); delete process.env.MIA_BACKUP_KEY;
  Object.assign(config.backup, original); rmSync(dir, { recursive: true, force: true });
});

describe('verified backups', () => {
  it('includes committed WAL rows, records schema/checksum and verifies without replacing or changing the live DB', async () => {
    const live = getDb(); live.exec('PRAGMA wal_autocheckpoint=0');
    setSetting('wal-marker', 'committed in WAL');
    expect(statSync(join(dir, 'mia.db-wal')).size).toBeGreaterThan(0);
    const b = await createBackup(); const stored = readFileSync(join(config.backup.dir, b.file));
    expect(b).toMatchObject({ version: 1, seq: 1, schemaVersion: SCHEMA_VERSION, bytes: stored.length, checksum: hash(stored), encrypted: false });
    expect(b.id).toMatch(/^000001-[0-9a-f]{4}$/); expect(b.restoreTestedAt).toBeGreaterThan(0);
    expect(b.restoreTest).toMatchObject({ ok: true, integrity: 'ok', auditEntries: 1, auditOk: true, reconcileOk: true, error: null });
    const copy = new DatabaseSync(join(config.backup.dir, b.file), { readOnly: true });
    try { expect(copy.prepare('SELECT value FROM settings WHERE key=?').get('wal-marker')?.value).toBe(JSON.stringify('committed in WAL')); } finally { copy.close(); }
    expect(getDb()).toBe(live);
    const before = hash(readFileSync(join(dir, 'mia.db')));
    const r = await restoreTest(b.id);
    expect(r.restoreTest.ok).toBe(true); expect(r.restoreTestedAt).toBeGreaterThanOrEqual(b.restoreTestedAt!);
    expect(hash(readFileSync(join(dir, 'mia.db')))).toBe(before); expect(getDb()).toBe(live);
    expect(JSON.parse(readFileSync(manifestPath(b.id), 'utf8'))).toEqual(r);
    expect(statSync(config.backup.dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(config.backup.dir, b.file)).mode & 0o777).toBe(0o600);
    expect(backupCheck()).toMatchObject({ status: 'WARN', detail: expect.stringMatching(/unencrypted/i) });
  });

  it('detects a tampered stored byte as CHECKSUM and keeps the prior successful test timestamp', async () => {
    const b = await createBackup(); const file = join(config.backup.dir, b.file); const bytes = readFileSync(file); bytes[100] ^= 1; writeFileSync(file, bytes);
    const r = await restoreTest(b.id);
    expect(r.restoreTest).toMatchObject({ ok: false, error: { code: 'CHECKSUM' } }); expect(r.restoreTestedAt).toBe(b.restoreTestedAt);
    expect(backupStatus().lastError?.code).toBe('CHECKSUM'); expect(backupCheck().status).toBe('FAIL');
  });

  it('does not promote or prune a snapshot with a broken audit chain', async () => {
    config.backup.keep = 1; const b = await createBackup(); run("UPDATE audit_log SET actor='tampered' WHERE id=1");
    await expect(createBackup()).rejects.toMatchObject({ code: 'AUDIT' });
    expect(listBackups().map((x) => x.id)).toEqual([b.id]);
    expect(readdirSync(config.backup.dir).filter((x) => /\.db(?:\.enc)?$/.test(x))).toEqual([b.file]);
    expect(getSetting<any>('backup.lastError', null).code).toBe('AUDIT');
  });

  it('does not promote a snapshot whose closed-position ledger does not reconcile', async () => {
    run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,planned_risk)
      VALUES ('p','paper-bot','test','crypto','LONG','test',1,1,0.9,0.9,'[]','CLOSED',1,2,5,0.1)`);
    run("INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,position_id,created_at,updated_at) VALUES ('o','o','paper-bot','test','test','SELL','MARKET',1,'FILLED','EXIT','p',1,2)");
    run("INSERT INTO ledger_entries(id,account,ts,kind,amount,ref) VALUES ('l','paper-bot',2,'SELL',5,'o')");
    const b = await createBackup(); run("UPDATE ledger_entries SET amount=4 WHERE id='l'");
    await expect(createBackup()).rejects.toMatchObject({ code: 'RECONCILE' }); expect(listBackups().map((x) => x.id)).toEqual([b.id]);
  });

  it('rejects an unsupported schema without promoting or pruning snapshots', async () => {
    config.backup.keep = 1; const b = await createBackup(); run('UPDATE schema_migrations SET version=?', SCHEMA_VERSION + 1);
    await expect(createBackup()).rejects.toMatchObject({ code: 'SCHEMA' }); expect(listBackups().map((x) => x.id)).toEqual([b.id]);
  });

  it('rejects a foreign-key violation even when SQLite integrity_check is ok', async () => {
    getDb().exec("PRAGMA foreign_keys=OFF; INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES ('f','missing',1,1,0,'TAKER',1); PRAGMA foreign_keys=ON");
    expect(getDb().prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    await expect(createBackup()).rejects.toMatchObject({ code: 'INTEGRITY' }); expect(listBackups()).toEqual([]);
  });

  it('backs up in-memory handles without opening a second global database', async () => {
    closeDb(); const live = openDb(':memory:'); audit('test', 'memory');
    const b = await createBackup(); expect(b.restoreTest).toMatchObject({ ok: true, auditEntries: 1 }); expect(getDb()).toBe(live);
  });

  it('encrypts and restore-tests AES-GCM bytes; a wrong key fails closed as DECRYPT', async () => {
    process.env.MIA_BACKUP_KEY = randomBytes(32).toString('hex');
    const b = await createBackup(); const bytes = readFileSync(join(config.backup.dir, b.file));
    expect(b.encrypted).toBe(true); expect(b.file).toMatch(/\.db\.enc$/); expect(bytes.subarray(0, 8).toString()).toBe('MIABAK1\0');
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false); expect(b.checksum).toBe(hash(bytes));
    expect((await restoreTest(b.id)).restoreTest.ok).toBe(true); expect(backupCheck().status).toBe('PASS');
    process.env.MIA_BACKUP_KEY = randomBytes(32).toString('hex');
    expect((await restoreTest(b.id)).restoreTest.error?.code).toBe('DECRYPT');
    expect(readdirSync(config.backup.dir).some((x) => /staging|verify|\.tmp$/.test(x))).toBe(false);
  });

  it('rejects malformed keys without creating snapshot files or leaking the value', async () => {
    process.env.MIA_BACKUP_KEY = 'invalid-backup-key';
    await expect(createBackup()).rejects.toMatchObject({ code: 'KEY' });
    expect(existsSync(config.backup.dir) ? readdirSync(config.backup.dir) : []).toEqual([]);
    expect(JSON.stringify(backupStatus())).not.toContain('invalid-backup-key');
  });

  it('records storage IO failures with a safe message and resets the running guard', async () => {
    config.backup.dir = join(dir, 'mia.db');
    await expect(createBackup()).rejects.toMatchObject({ code: 'IO', message: 'Backup storage operation failed' });
    expect(getSetting<any>('backup.lastError', null)).toMatchObject({ code: 'IO', message: 'Backup storage operation failed' });
    expect(() => listBackups()).toThrow('Backup storage operation failed');
    config.backup.dir = join(dir, 'backups'); expect(backupStatus().running).toBe(false);
    await createBackup(); expect(backupStatus().lastError).toBeNull();
  });

  it('fails encrypted restore tests on missing and malformed keys, then recovers with the original key', async () => {
    const originalKey = randomBytes(32).toString('hex'); process.env.MIA_BACKUP_KEY = originalKey; const b = await createBackup();
    delete process.env.MIA_BACKUP_KEY; expect((await restoreTest(b.id)).restoreTest.error?.code).toBe('DECRYPT');
    process.env.MIA_BACKUP_KEY = 'bad'; expect((await restoreTest(b.id)).restoreTest.error?.code).toBe('KEY');
    process.env.MIA_BACKUP_KEY = originalKey; expect((await restoreTest(b.id)).restoreTest.ok).toBe(true); expect(backupStatus().lastError).toBeNull();
  });

  it('retains newest N by sequence, ignores incomplete snapshots and sweeps old staging/tmp files only', async () => {
    config.backup.keep = 2; const first = await createBackup();
    const m = { ...first, createdAt: Date.now() + 3600_000 }; writeFileSync(manifestPath(first.id), JSON.stringify(m));
    const staging = join(config.backup.dir, '.staging-abandoned'); mkdirSync(staging); writeFileSync(join(staging, 'snapshot.db.tmp'), 'incomplete');
    const tmp = join(config.backup.dir, 'orphan.tmp'); writeFileSync(tmp, 'incomplete');
    const recent = join(config.backup.dir, 'recent.tmp'); writeFileSync(recent, 'incomplete');
    const incomplete = join(config.backup.dir, 'mia-999999-abcd.db'); writeFileSync(incomplete, 'not a completed backup');
    const oldOrphan = join(config.backup.dir, 'mia-000009-abcd.db.enc'); writeFileSync(oldOrphan, 'not a completed backup');
    const unrelated = join(config.backup.dir, 'important.txt'); writeFileSync(unrelated, 'keep');
    const old = new Date(Date.now() - 11 * 60_000); utimesSync(staging, old, old); utimesSync(tmp, old, old); utimesSync(oldOrphan, old, old);
    expect(listBackups()).toHaveLength(1); const second = await createBackup(); const third = await createBackup();
    expect(listBackups().map((x) => x.seq)).toEqual([3, 2]);
    expect(existsSync(join(config.backup.dir, first.file))).toBe(false); expect(existsSync(manifestPath(first.id))).toBe(false);
    expect(existsSync(join(config.backup.dir, second.file))).toBe(true); expect(existsSync(join(config.backup.dir, third.file))).toBe(true);
    expect(existsSync(staging)).toBe(false); expect(existsSync(tmp)).toBe(false); expect(existsSync(recent)).toBe(true);
    expect(existsSync(unrelated)).toBe(true); expect(existsSync(incomplete)).toBe(true); expect(existsSync(oldOrphan)).toBe(false);
  });

  it('ignores incomplete manifests and refuses manifest path traversal', async () => {
    const b = await createBackup();
    writeFileSync(join(config.backup.dir, 'mia-000002-abcd.json'), '{');
    writeFileSync(join(config.backup.dir, 'mia-000003-abcd.json'), JSON.stringify({ ...b, id: '000003-abcd', seq: 3, file: '../mia.db' }));
    writeFileSync(join(config.backup.dir, 'mia-000004-abcd.json'), JSON.stringify({ ...b, id: '000004-abcd', seq: 4, file: 'mia-000004-abcd.db' }));
    expect(listBackups().map((x) => x.id)).toEqual([b.id]);
    await expect(restoreTest('../mia.db')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects overlapping calls in process and a lock held by another connection', async () => {
    const one = createBackup(); expect(backupStatus().running).toBe(true);
    await expect(createBackup()).rejects.toMatchObject({ code: 'BUSY', statusCode: 409 }); await one;
    const mutex = new DatabaseSync(join(config.backup.dir, 'mutex.sqlite'));
    try {
      mutex.exec('BEGIN IMMEDIATE');
      await expect(createBackup()).rejects.toMatchObject({ code: 'BUSY', statusCode: 409 });
      mutex.exec('ROLLBACK');
    } finally { mutex.close(); }
    expect(backupStatus().running).toBe(false); await createBackup(); expect(backupStatus().lastError).toBeNull();
  });

  it('refuses a backup while a separate process holds the mutex transaction', async () => {
    await createBackup();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); process.stdout.write('locked');
      process.stdin.once('data', () => { db.exec('ROLLBACK'); db.close(); });`, join(config.backup.dir, 'mutex.sqlite')], { stdio: ['pipe', 'pipe', 'ignore'] });
    try { await once(child.stdout, 'data'); await expect(createBackup()).rejects.toMatchObject({ code: 'BUSY', statusCode: 409 }); }
    finally { const exit = once(child, 'exit'); child.stdin.end('release'); await exit; }
    expect(listBackups()).toHaveLength(1); expect(backupStatus().running).toBe(false);
  });

  it('warns on no backup, staleness and clock skew, but fails on an error after success', async () => {
    expect(backupCheck().status).toBe('WARN'); process.env.MIA_BACKUP_KEY = randomBytes(32).toString('hex');
    const b = await createBackup(); expect(backupCheck().status).toBe('PASS');
    writeFileSync(manifestPath(b.id), JSON.stringify({ ...b, createdAt: Date.now() - 3 * config.backup.intervalMs })); expect(backupCheck().status).toBe('WARN');
    writeFileSync(manifestPath(b.id), JSON.stringify({ ...b, createdAt: Date.now() + 3600_000 })); expect(backupCheck()).toMatchObject({ status: 'WARN', detail: expect.stringMatching(/clock/i) });
    setSetting('backup.lastError', { at: Date.now() + 1, code: 'IO', message: 'Backup storage failed' }); expect(backupCheck().status).toBe('FAIL');
  });

  it('only notifies once per failure transition, and again after a recovery', async () => {
    process.env.MIA_BACKUP_KEY = 'bad';
    await expect(createBackup()).rejects.toMatchObject({ code: 'KEY' }); await expect(createBackup()).rejects.toMatchObject({ code: 'KEY' });
    expect(getDb().prepare("SELECT count(*) n FROM notifications WHERE source='backups'").get()?.n).toBe(1);
    delete process.env.MIA_BACKUP_KEY; await createBackup(); process.env.MIA_BACKUP_KEY = 'bad';
    await expect(createBackup()).rejects.toMatchObject({ code: 'KEY' });
    expect(getDb().prepare("SELECT count(*) n FROM notifications WHERE source='backups'").get()?.n).toBe(2);
  });

  it('runs the scheduler after 30 seconds only when enabled and due, and stops cleanly', async () => {
    vi.useFakeTimers(); config.backup.intervalMs = 60_000;
    startBackups(); await vi.advanceTimersByTimeAsync(29_999); expect(listBackups()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); await vi.waitFor(() => expect(listBackups()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(60_000); await vi.waitFor(() => expect(listBackups()).toHaveLength(2));
    stopBackups(); await vi.advanceTimersByTimeAsync(120_000); expect(listBackups()).toHaveLength(2);
    config.backup.intervalMs = 0; startBackups(); await vi.advanceTimersByTimeAsync(120_000); expect(listBackups()).toHaveLength(2);
  });
});

describe('backup API', () => {
  it('requires session/CSRF, validates ids, exposes no paths or key, and leaves release gates unchanged', async () => {
    const app = await buildApp();
    try {
      expect((await app.inject({ url: '/api/backups' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/backups' })).statusCode).toBe(401);
      const auth = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'backup test owner passphrase' } });
      const cookie = String(auth.headers['set-cookie']).split(';')[0]; const h = { cookie, 'x-mia-csrf': '1' };
      expect((await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/backups/%2e%2e%2fx/restore-test', headers: h })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/backups/000001-abcd/restore-test', headers: h })).statusCode).toBe(404);
      const qaBefore = (await app.inject({ url: '/api/qa', headers: h })).json();
      expect((await app.inject({ url: '/api/security', headers: h })).json().checks.find((c: any) => c.id === 'DATA-3').status).toBe('WARN');
      process.env.MIA_BACKUP_KEY = randomBytes(32).toString('hex');
      const created = await app.inject({ method: 'POST', url: '/api/backups', headers: h }); expect(created.statusCode).toBe(200);
      const b = created.json(); expect(b.restoreTest.ok).toBe(true);
      expect((await app.inject({ method: 'POST', url: `/api/backups/${b.id}/restore-test`, headers: { cookie } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/api/backups/${b.id}/restore-test`, headers: h })).json().restoreTest.ok).toBe(true);
      const status = await app.inject({ url: '/api/backups', headers: h }); expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ enabled: true, encryptionKeyConfigured: true, running: false, latest: { id: b.id }, check: { status: 'PASS' } });
      expect(status.body).not.toContain(dir); expect(status.body).not.toContain(process.env.MIA_BACKUP_KEY);
      expect((await app.inject({ url: '/api/security', headers: h })).json().checks.find((c: any) => c.id === 'DATA-3').status).toBe('PASS');
      const qaAfter = (await app.inject({ url: '/api/qa', headers: h })).json();
      expect(qaAfter.gates.map((g: any) => [g.id, g.status])).toEqual(qaBefore.gates.map((g: any) => [g.id, g.status])); expect(qaAfter.liveAllowed).toBe(false);
      const mutex = new DatabaseSync(join(config.backup.dir, 'mutex.sqlite')); mutex.exec('BEGIN IMMEDIATE');
      try { expect((await app.inject({ method: 'POST', url: '/api/backups', headers: h })).statusCode).toBe(409); } finally { mutex.exec('ROLLBACK'); mutex.close(); }
      const bytes = readFileSync(join(config.backup.dir, b.file)); bytes[30] ^= 1; writeFileSync(join(config.backup.dir, b.file), bytes);
      const failed = await app.inject({ method: 'POST', url: `/api/backups/${b.id}/restore-test`, headers: h });
      expect(failed.statusCode).toBe(200); expect(failed.json().restoreTest).toMatchObject({ ok: false, error: { code: 'CHECKSUM' } });
      expect(verifyAuditChain().ok).toBe(true);
    } finally { await app.close(); }
  });
});
