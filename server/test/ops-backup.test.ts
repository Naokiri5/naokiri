import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { freshDb } from './helpers.js';
import { audit } from '../src/core/audit.js';
import * as auditModule from '../src/core/audit.js';
import { config } from '../src/config.js';
import { run } from '../src/db/db.js';
import { backupKey, createBackup, decrypt, encrypt, listBackups, maybeScheduledBackup, pruneBackups, verifyBackup } from '../src/ops/backup.js';

const KEY = Buffer.alloc(32, 7);
let dir: string;
describe('database backups', () => {
  const wasOffline = config.offline;
  beforeEach(() => { freshDb(); audit('test', 'seed', { n: 1 }); audit('test', 'seed', { n: 2 }); dir = mkdtempSync(join(tmpdir(), 'mia-bk-')); });
  afterEach(() => { config.offline = wasOffline; vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

  it('writes a plaintext snapshot with a manifest that passes the restore check', () => {
    const m = createBackup({ dir, key: null, nowTs: 1_800_000_000_000 });
    expect(m).toMatchObject({ file: 'mia-20270115T080000Z.db', encrypted: false, format: 'sqlite' });
    const v = verifyBackup(join(dir, m.file), null);
    expect(v.ok).toBe(true);
    expect(v.checks.map((c) => c.name)).toEqual(['manifest', 'checksum', 'integrity', 'schema', 'audit chain', 'decision memory chain']);
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
  it('fails closed on an invalid key instead of writing plaintext', () => {
    expect(() => backupKey('too-short')).toThrow(/32 bytes/);
    expect(backupKey('')).toBeNull(); expect(backupKey(undefined)).toBeNull();
    expect(backupKey('07'.repeat(32))).toEqual(KEY); expect(backupKey(KEY.toString('base64'))).toEqual(KEY);
  });
  it('requires encryption before writing a snapshot on an online or production instance', () => {
    vi.stubEnv('MIA_BACKUP_KEY', '');
    config.offline = false;
    expect(() => createBackup({ dir })).toThrow(/MIA_BACKUP_KEY is required/);
    expect(() => createBackup({ dir, key: null })).toThrow(/MIA_BACKUP_KEY is required/);
    config.offline = true;
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createBackup({ dir })).toThrow(/MIA_BACKUP_KEY is required/);
    expect(readdirSync(dir)).toEqual([]);
    vi.stubEnv('MIA_BACKUP_KEY', KEY.toString('hex'));
    const backup = createBackup({ dir, nowTs: 1_800_000_000_000 });
    expect(backup.encrypted).toBe(true);
    expect(verifyBackup(join(dir, backup.file), KEY).ok).toBe(true);
    expect(readdirSync(dir).sort()).toEqual([backup.file, `${backup.file}.json`]);
  });
  it('replaces a recent plaintext snapshot with a verified encrypted scheduled backup online', () => {
    const t = 1_800_000_000_000;
    const earlier = createBackup({ dir, key: null, nowTs: t });
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    vi.stubEnv('MIA_BACKUP_KEY', KEY.toString('hex'));
    vi.stubEnv('MIA_BACKUP_INTERVAL_H', '1');
    config.offline = false;
    const next = maybeScheduledBackup(t + 1000);
    expect(next).toMatchObject({ encrypted: true });
    expect(verifyBackup(join(dir, next!.file), KEY).ok).toBe(true);
    expect(existsSync(join(dir, earlier.file))).toBe(true);
  });
  it('preserves the last verified snapshot when a new scheduled snapshot fails its restore check', () => {
    const t = 1_800_000_000_000;
    const earlier = createBackup({ dir, key: KEY, nowTs: t });
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    vi.stubEnv('MIA_BACKUP_KEY', KEY.toString('hex'));
    vi.stubEnv('MIA_BACKUP_INTERVAL_H', '1');
    vi.stubEnv('MIA_BACKUP_KEEP', '1');
    run("UPDATE audit_log SET action='modified' WHERE id=(SELECT MIN(id) FROM audit_log)");
    expect(() => maybeScheduledBackup(t + 3_600_000)).toThrow(/restore check failed.*audit chain/i);
    expect(listBackups(dir).map(({ file }) => file)).toEqual([earlier.file]);
    expect(verifyBackup(join(dir, earlier.file), KEY).ok).toBe(true);
  });
  it('keeps a candidate out of retention until restore verification succeeds', () => {
    const first = createBackup({ dir, key: KEY, nowTs: 1_800_000_000_000 });
    const verifyAuditChain = auditModule.verifyAuditChain;
    const verify = vi.spyOn(auditModule, 'verifyAuditChain').mockImplementationOnce((entries) => {
      expect(listBackups(dir).map(({ file }) => file)).toEqual([first.file]);
      return verifyAuditChain(entries);
    });
    try {
      const second = createBackup({ dir, key: KEY, nowTs: first.createdAt + 1000 });
      expect(verify).toHaveBeenCalledOnce();
      expect(listBackups(dir).map(({ file }) => file)).toEqual([second.file, first.file]);
    } finally { verify.mockRestore(); }
  });
  it('keeps a due backup even if an existing manifest is future-dated', () => {
    const t = 1_800_000_000_000;
    const future = createBackup({ dir, key: KEY, nowTs: t + 3_600_000 });
    vi.stubEnv('MIA_BACKUP_DIR', dir);
    vi.stubEnv('MIA_BACKUP_KEY', KEY.toString('hex'));
    vi.stubEnv('MIA_BACKUP_INTERVAL_H', '1');
    vi.stubEnv('MIA_BACKUP_KEEP', '1');
    const current = maybeScheduledBackup(t);
    expect(current).not.toBeNull();
    expect(verifyBackup(join(dir, current!.file), KEY).ok).toBe(true);
    expect(listBackups(dir).map(({ file }) => file)).toEqual([future.file, current!.file]);
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
});
function sealHash(f: string) { return createHash('sha256').update(readFileSync(f)).digest('hex'); }
