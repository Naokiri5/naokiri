import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { audit } from '../src/core/audit.js';
import { backupKey, createBackup, decrypt, encrypt, listBackups, pruneBackups, verifyBackup, verifyAndRecordBackup, backupVerificationStatus, maybeScheduledBackup, recordVerification } from '../src/ops/backup.js';
import * as settingsModule from '../src/core/settings.js';
import { getDb, run } from '../src/db/db.js';
import { getSetting } from '../src/core/settings.js';
import { config } from '../src/config.js';
import { buildApp } from '../src/index.js';
import { reconcile } from '../src/portfolio/calendar.js';

const KEY = Buffer.alloc(32, 7);
let dir: string;
describe('database backups', () => {
  beforeEach(() => { freshDb(); audit('test', 'seed', { n: 1 }); audit('test', 'seed', { n: 2 }); dir = mkdtempSync(join(tmpdir(), 'mia-bk-')); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it('writes a plaintext snapshot with a manifest that passes the restore check', () => {
    const m = createBackup({ dir, key: null, nowTs: 1_800_000_000_000 });
    expect(m).toMatchObject({ file: 'mia-20270115T080000Z.db', encrypted: false, format: 'sqlite' });
    const v = verifyBackup(join(dir, m.file), null);
    expect(v.ok).toBe(true);
    expect(v.checks.map((c) => c.name)).toEqual(['manifest', 'checksum', 'integrity', 'schema', 'audit chain', 'decision memory chain', 'ledger reconcile']);
    // No temporary or partial files left behind.
    expect(readdirSync(dir).sort()).toEqual([m.file, `${m.file}.json`]);
  });
  it('encrypts with AES-256-GCM; the file is not readable SQLite and verifies only with the key', () => {
    const m = createBackup({ dir, key: KEY, nowTs: 1_800_000_000_000 });
    const raw = readFileSync(join(dir, m.file));
    expect(raw.subarray(0, 16).toString('latin1')).not.toContain('SQLite format');
    expect(verifyBackup(join(dir, m.file), KEY).ok).toBe(true);
    const noKey = verifyBackup(join(dir, m.file), null);
    expect(noKey.ok).toBe(false); expect(noKey.checks.at(-1)!.name).toBe('key');
    const wrong = verifyBackup(join(dir, m.file), Buffer.alloc(32, 9));
    expect(wrong.ok).toBe(false); expect(wrong.checks.at(-1)).toMatchObject({ name: 'decrypt', ok: false });
  });
  it('detects a modified backup file (checksum), and GCM rejects tampered ciphertext even with a matching manifest', () => {
    const m = createBackup({ dir, key: KEY, nowTs: 1_800_000_000_000 }); const f = join(dir, m.file);
    const b = readFileSync(f); b[b.length - 40] ^= 1; writeFileSync(f, b);
    expect(verifyBackup(f, KEY).checks.find((c) => c.name === 'checksum')!.ok).toBe(false);
    expect(() => decrypt(b, KEY)).toThrow();
  });
  it('detects a broken audit chain inside an otherwise valid snapshot', () => {
    const m = createBackup({ dir, key: null, nowTs: 1_800_000_000_000 }); const f = join(dir, m.file);
    const db = new DatabaseSync(f); db.prepare("UPDATE audit_log SET action='forged' WHERE id=(SELECT MIN(id) FROM audit_log)").run(); db.close();
    // Re-seal the manifest so only the content check can catch it.
    const man = JSON.parse(readFileSync(`${f}.json`, 'utf8'));
    man.sha256 = sealHash(f); writeFileSync(`${f}.json`, JSON.stringify(man));
    const v = verifyBackup(f, null);
    expect(v.ok).toBe(false); expect(v.checks.find((c) => c.name === 'audit chain')).toMatchObject({ ok: false });
  });
  it.each(['ditas_twin_runs', 'ditas_blobs'])('fails restore verification when a required %s table is missing', (table) => {
    const m = createBackup({ dir, key: null, nowTs: 1_800_000_000_000 });
    const file = join(dir, m.file);
    const snapshot = new DatabaseSync(file);
    try { snapshot.exec(`DROP TABLE ${table}`); }
    finally { snapshot.close(); }
    writeFileSync(`${file}.json`, JSON.stringify({ ...m, sha256: sealHash(file) }));
    const result = verifyBackup(file, null);
    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({ name: 'open', ok: false, detail: expect.stringContaining(table) });
  });
  it('fails closed on an invalid key instead of writing plaintext', () => {
    expect(() => backupKey('too-short')).toThrow(/32 bytes/);
    expect(backupKey('')).toBeNull(); expect(backupKey(undefined)).toBeNull();
    expect(backupKey('07'.repeat(32))).toEqual(KEY); expect(backupKey(KEY.toString('base64'))).toEqual(KEY);
  });
  it('round-trips encryption and keeps only the newest N backups', () => {
    expect(decrypt(encrypt(Buffer.from('hello'), KEY), KEY).toString()).toBe('hello');
    for (let i = 0; i < 4; i++) createBackup({ dir, key: null, nowTs: 1_800_000_000_000 + i * 1000 });
    expect(pruneBackups(dir, 2)).toHaveLength(2);
    expect(listBackups(dir).map((m) => m.createdAt)).toEqual([1_800_000_003_000, 1_800_000_002_000]);
    expect(readdirSync(dir)).toHaveLength(4);
  });
  it('a missing manifest means no usable backup', () => {
    const m = createBackup({ dir, key: null, nowTs: 1_800_000_000_000 }); rmSync(join(dir, `${m.file}.json`));
    expect(listBackups(dir)).toEqual([]); expect(verifyBackup(join(dir, m.file), null).ok).toBe(false);
    expect(existsSync(join(dir, m.file))).toBe(true);
  });
  it('I-03: a plaintext backup file is owner-only (0600) even when the backup directory already existed', async () => {
    const { statSync, chmodSync } = await import('node:fs');
    chmodSync(dir, 0o755);
    const m = createBackup({ dir, key: null, nowTs: 1_800_000_000_000 });
    expect(statSync(join(dir, m.file)).mode & 0o777).toBe(0o600);
  });

  it('reconciles the snapshot, not the live handle, without changing live rows or default reconciliation', () => {
    const live = getDb(); const expected = reconcile(); const m = createBackup({ dir, key: null }); const file = join(dir, m.file);
    const snap = new DatabaseSync(file);
    snap.exec(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,planned_risk)
      VALUES ('p','paper-bot','test','crypto','LONG','test',1,1,0.9,0.9,'[]','CLOSED',1,2,5,0.1)`);
    snap.close();
    const manifest = JSON.parse(readFileSync(`${file}.json`, 'utf8')); manifest.sha256 = sealHash(file); writeFileSync(`${file}.json`, JSON.stringify(manifest));
    const v = verifyBackup(file, null);
    expect(v.ok).toBe(false); expect(v.checks.find((c) => c.name === 'ledger reconcile')).toMatchObject({ ok: false, detail: expect.stringContaining('1 closed positions') });
    expect(getDb()).toBe(live); expect(reconcile()).toEqual(expected);
    expect(live.prepare('SELECT count(*) n FROM positions').get()?.n).toBe(0);
    expect(live.prepare('SELECT count(*) n FROM orders').get()?.n).toBe(0);
    expect(live.prepare('SELECT count(*) n FROM ledger_entries').get()?.n).toBe(0);
    expect(getSetting('backup.lastVerify', null)).toBeNull();
  });

  it('never writes encrypted-backup plaintext in the destination, including during verification', () => {
    const prepare = DatabaseSync.prototype.prepare; const privatePaths: string[] = [];
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string) {
      const stmt = prepare.call(this, sql);
      if (sql === 'VACUUM INTO ?') {
        const execute = stmt.run.bind(stmt);
        vi.spyOn(stmt, 'run').mockImplementation((...args: Parameters<typeof stmt.run>) => {
          const raw = String(args[0]); privatePaths.push(raw);
          expect(relative(dir, raw).startsWith('..')).toBe(true); expect(statSync(dirname(raw)).mode & 0o777).toBe(0o700);
          const r = execute(...args); expect(readdirSync(dir).some((name) => name.endsWith('.partial'))).toBe(false); return r;
        });
      }
      if (sql === 'PRAGMA integrity_check') { const raw = String(prepare.call(this, 'PRAGMA database_list').get()!.file); privatePaths.push(raw); expect(relative(dir, raw).startsWith('..')).toBe(true); }
      return stmt;
    });
    const m = createBackup({ dir, key: KEY }); expect(verifyBackup(join(dir, m.file), KEY).ok).toBe(true);
    expect(privatePaths).toHaveLength(2); for (const file of privatePaths) expect(existsSync(dirname(file))).toBe(false);
    expect(readdirSync(dir).sort()).toEqual([m.file, `${m.file}.json`]);
  });

  it('cleans private plaintext when encrypted output cannot be written', () => {
    const prepare = DatabaseSync.prototype.prepare; let scratch = '';
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string) {
      const stmt = prepare.call(this, sql);
      if (sql === 'VACUUM INTO ?') {
        const execute = stmt.run.bind(stmt);
        vi.spyOn(stmt, 'run').mockImplementation((...args: Parameters<typeof stmt.run>) => {
          scratch = dirname(String(args[0])); expect(relative(dir, String(args[0])).startsWith('..')).toBe(true);
          const r = execute(...args); rmSync(dir, { recursive: true, force: true }); return r;
        });
      }
      return stmt;
    });
    expect(() => createBackup({ dir, key: KEY })).toThrow(); expect(scratch).not.toBe(''); expect(existsSync(scratch)).toBe(false);
  });

  it('persists scheduled verification, keeps a failed snapshot and does not prune after failure', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); vi.stubEnv('MIA_BACKUP_KEEP', '1');
    const now = Date.now(); const previous = createBackup({ dir, key: null, nowTs: now - 3 * 86400_000 });
    verifyAndRecordBackup(join(dir, previous.file), null, now - 3 * 86400_000);
    run("INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,planned_risk) VALUES ('p','paper-bot','test','crypto','LONG','test',1,1,0.9,0.9,'[]','CLOSED',1,2,5,0.1)");
    const failed = (await maybeScheduledBackup(now))!;
    expect(failed.verification.ok).toBe(false); expect(failed.verification.checks.at(-1)?.name).toBe('ledger reconcile');
    expect(getSetting<{ ok: boolean; file: string } | null>('backup.lastVerify', null)).toMatchObject({ ok: false, file: failed.file });
    expect(existsSync(join(dir, failed.file))).toBe(true); expect(existsSync(join(dir, previous.file))).toBe(true);
    expect(backupVerificationStatus(now).check.status).toBe('FAIL');
  });

  it('returns successful verification even when retention cannot remove an old backup', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    vi.stubEnv('MIA_BACKUP_KEEP', '1');
    const now = 1_800_000_000_000; // fixed clock (CodeRabbit #14): scheduling and status use the same reproducible time
    const old = createBackup({ dir, key: null, nowTs: now - 3 * 86400_000 });
    // A directory in place of the old snapshot makes the non-recursive retention deletion fail.
    const oldPath = join(dir, old.file);
    rmSync(oldPath);
    mkdirSync(oldPath);
    const result = (await maybeScheduledBackup(now))!;
    expect(result.verification.ok).toBe(true);
    expect(result.retentionWarning).toMatch(/could not be pruned/);
    expect(backupVerificationStatus(now).lastVerify).toMatchObject({ file: result.file, ok: true });
  });

  it('persists a passing scheduled verification and skips runs that are not due', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); const now = Date.now();
    const m = (await maybeScheduledBackup(now))!; expect(m.verification.ok).toBe(true);
    expect(backupVerificationStatus(now)).toMatchObject({ check: { status: 'PASS' }, lastVerify: { at: now, file: m.file, ok: true } });
    expect(await maybeScheduledBackup(now + 1_000)).toBeNull();
  });

  it('bounds repeated scheduled failures while protecting the last local good backup from off-site verification', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); vi.stubEnv('MIA_BACKUP_KEEP', '2');
    const start = Date.now() - 6 * 86400_000; const good = (await maybeScheduledBackup(start))!;
    const offsite = join(dir, 'offsite'); const external = createBackup({ dir: offsite, key: null, nowTs: start + 3600_000 });
    expect(verifyAndRecordBackup(join(offsite, external.file), null, start + 3600_000).ok).toBe(true);
    expect(getSetting<{ file: string } | null>('backup.lastGoodVerify', null)?.file).toBe(good.file);
    run("UPDATE audit_log SET actor='forged' WHERE id=(SELECT MIN(id) FROM audit_log)");
    let latest = good;
    for (let i = 1; i <= 5; i++) { latest = (await maybeScheduledBackup(start + i * 25 * 3600_000))!; expect(latest.verification.ok).toBe(false); }
    expect(listBackups(dir)).toHaveLength(3); expect(listBackups(dir).map((m) => m.file)).toContain(good.file);
    expect(listBackups(dir)[0].file).toBe(latest.file); expect(getSetting<{ ok: boolean } | null>('backup.lastVerify', null)?.ok).toBe(false);
  });

  it('verifies and records encrypted scheduled snapshots with the existing MIAB1 format', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); vi.stubEnv('MIA_BACKUP_KEY', KEY.toString('hex'));
    const m = (await maybeScheduledBackup())!;
    expect(m.encrypted).toBe(true); expect(readFileSync(join(dir, m.file)).subarray(0, 5).toString()).toBe('MIAB1');
    expect(m.verification.ok).toBe(true); expect(m.verification.checks.find((c) => c.name === 'ledger reconcile')?.ok).toBe(true);
    expect(getSetting<{ ok: boolean } | null>('backup.lastVerify', null)?.ok).toBe(true);
  });

  it('labels encrypted verification storage failures without claiming the key is necessarily wrong', () => {
    const m = createBackup({ dir, key: KEY }); const bad = join(dir, 'missing-temp-parent');
    vi.stubEnv('TMPDIR', bad); vi.stubEnv('TEMP', bad); vi.stubEnv('TMP', bad);
    const v = verifyBackup(join(dir, m.file), KEY);
    expect(v.ok).toBe(false); expect(v.checks.at(-1)).toMatchObject({ name: 'decrypt', ok: false, detail: expect.stringContaining('temporary storage') });
  });

  it('reports missing, stale, deleted and failed verification without treating a recent recheck of an old file as fresh', () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); const now = Date.now();
    expect(backupVerificationStatus(now).check.status).toBe('WARN');
    const old = createBackup({ dir, key: null, nowTs: now - 3 * 86400_000 });
    verifyAndRecordBackup(join(dir, old.file), null, now); expect(backupVerificationStatus(now).check.status).toBe('WARN');
    const m = createBackup({ dir, key: null, nowTs: now }); verifyAndRecordBackup(join(dir, m.file), null, now);
    expect(backupVerificationStatus(now).check.status).toBe('PASS'); expect(backupVerificationStatus(now + 3 * 86400_000).check.status).toBe('WARN');
    rmSync(join(dir, m.file)); expect(backupVerificationStatus(now).check.status).toBe('WARN');
    expect(verifyAndRecordBackup(join(dir, m.file), null, now).ok).toBe(false); expect(backupVerificationStatus(now).check.status).toBe('FAIL');
  });

  it('persists CLI verify results in the existing settings table, including failed checks', () => {
    const m = createBackup({ dir, key: null }); const file = join(dir, m.file); const dataDir = join(dir, 'cli-data');
    const cli = () => spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/ops/backup-cli.ts', import.meta.url)), 'verify', file], { cwd: process.cwd(), env: { ...process.env, MIA_OFFLINE: '1', MIA_DATA_DIR: dataDir, MIA_BACKUP_DIR: dir }, encoding: 'utf8' });
    expect(cli().status).toBe(0);
    let db = new DatabaseSync(join(dataDir, 'mia.db'), { readOnly: true });
    try { expect(JSON.parse(String(db.prepare("SELECT value FROM settings WHERE key='backup.lastVerify'").get()!.value))).toMatchObject({ ok: true, file: m.file }); } finally { db.close(); }
    rmSync(`${file}.json`); expect(cli().status).toBe(1);
    db = new DatabaseSync(join(dataDir, 'mia.db'), { readOnly: true });
    try { expect(JSON.parse(String(db.prepare("SELECT value FROM settings WHERE key='backup.lastVerify'").get()!.value))).toMatchObject({ ok: false, file: m.file }); } finally { db.close(); }
  });

  it('a PASS is bound to the verified bytes: a backup changed after verification warns (CodeRabbit #14)', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    const now = 1_800_000_000_000;
    const m = createBackup({ dir, key: null, nowTs: now }); const file = join(dir, m.file);
    expect(verifyAndRecordBackup(file, null, now).ok).toBe(true);
    expect(backupVerificationStatus(now).check.status).toBe('PASS');
    const { appendFileSync } = await import('node:fs');
    appendFileSync(file, Buffer.from('tampered')); // same name and manifest, different bytes
    expect(backupVerificationStatus(now).check).toMatchObject({ status: 'WARN', detail: expect.stringMatching(/changed since it was verified/) });
  });
  it('detects same-size backup corruption even when the modification time is preserved (CodeRabbit #14)', () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    const now = 1_800_000_000_000;
    const m = createBackup({ dir, key: null, nowTs: now }); const file = join(dir, m.file);
    utimesSync(file, now / 1000, now / 1000);
    expect(verifyAndRecordBackup(file, null, now).ok).toBe(true);
    const original = statSync(file); const bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 1; writeFileSync(file, bytes);
    utimesSync(file, now / 1000, now / 1000);
    expect(statSync(file).size).toBe(original.size);
    expect(statSync(file).mtimeMs).toBe(original.mtimeMs);
    expect(backupVerificationStatus(now).check).toMatchObject({ status: 'WARN', detail: expect.stringMatching(/changed since it was verified/) });
  });
  it('does not use an off-site verification as a PASS for an identically named local copy (CodeRabbit #14)', () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    const now = 1_800_000_000_000;
    const m = createBackup({ dir, key: null, nowTs: now }); const local = join(dir, m.file);
    const offsite = join(dir, 'offsite'); mkdirSync(offsite);
    const external = join(offsite, m.file);
    copyFileSync(local, external); copyFileSync(`${local}.json`, `${external}.json`);
    for (const path of [local, external]) utimesSync(path, now / 1000, now / 1000);
    expect(verifyAndRecordBackup(external, null, now).ok).toBe(true);
    expect(backupVerificationStatus(now).check).toMatchObject({ status: 'WARN', detail: expect.stringMatching(/directory/) });
  });
  it('returns a completed backup without pruning when recording its last-good status fails (CodeRabbit #14)', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); vi.stubEnv('MIA_BACKUP_KEEP', '1');
    const now = 1_800_000_000_000;
    const previous = createBackup({ dir, key: null, nowTs: now - 3 * 86400_000 });
    const save = settingsModule.setSetting;
    vi.spyOn(settingsModule, 'setSetting').mockImplementation((key, value) => {
      if (key === 'backup.lastGoodVerify') throw new Error('disk full');
      return save(key, value);
    });
    const result = (await maybeScheduledBackup(now))!;
    expect(result.verification.ok).toBe(true);
    expect(result.verification.recordError).toMatch(/could not be recorded: disk full/);
    expect(result.retentionWarning).toMatch(/skipped/i);
    expect(existsSync(join(dir, previous.file))).toBe(true);
    expect(existsSync(join(dir, result.file))).toBe(true);
  });
  it('a verification result is returned even when recording it fails (CodeRabbit #14)', () => {
    const m = createBackup({ dir, key: null }); const file = join(dir, m.file);
    vi.spyOn(settingsModule, 'setSetting').mockImplementation(() => { throw new Error('disk full'); });
    const r = recordVerification(file, verifyBackup(file, null));
    expect(r.ok).toBe(true); expect(r.recordError).toMatch(/could not be recorded: disk full/);
  });
  it('exposes last verification and DATA-3 through the existing authenticated Security Center endpoint', async () => {
    vi.stubEnv('MIA_BACKUP_DIR', dir); const app = await buildApp();
    try {
      expect((await app.inject({ url: '/api/security' })).statusCode).toBe(401);
      const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('backup owner test passphrase') });
      const cookie = String(setup.headers['set-cookie']).split(';')[0];
      const status = async () => (await app.inject({ url: '/api/security', headers: { cookie } })).json();
      expect((await status()).checks.find((c: { id: string }) => c.id === 'DATA-3').status).toBe('WARN');
      const m = createBackup({ dir, key: null }); verifyAndRecordBackup(join(dir, m.file), null);
      const s = await status(); expect(s.backup.lastVerify).toMatchObject({ ok: true, file: m.file });
      expect(s.checks.find((c: { id: string }) => c.id === 'DATA-3').status).toBe('PASS'); expect(JSON.stringify(s.backup)).not.toContain(dir);
      rmSync(`${join(dir, m.file)}.json`); verifyAndRecordBackup(join(dir, m.file), null);
      expect((await status()).checks.find((c: { id: string }) => c.id === 'DATA-3').status).toBe('FAIL');
    } finally { await app.close(); }
  });
});
function sealHash(f: string) { return createHash('sha256').update(readFileSync(f)).digest('hex'); }
