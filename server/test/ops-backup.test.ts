import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { freshDb } from './helpers.js';
import { audit } from '../src/core/audit.js';
import { backupKey, createBackup, decrypt, encrypt, listBackups, pruneBackups, verifyBackup } from '../src/ops/backup.js';

const KEY = Buffer.alloc(32, 7);
let dir: string;
describe('database backups', () => {
  beforeEach(() => { freshDb(); audit('test', 'seed', { n: 1 }); audit('test', 'seed', { n: 2 }); dir = mkdtempSync(join(tmpdir(), 'mia-bk-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
});
function sealHash(f: string) { return createHash('sha256').update(readFileSync(f)).digest('hex'); }
