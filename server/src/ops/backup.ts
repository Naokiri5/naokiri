import { backupSpaceDenial, storageStatus } from './storage.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from '../core/audit.js';
import { verifyMemory } from '../ditas/memory.js';
import { config } from '../config.js';
import { ensureStorageDirectory, privateStorageFileExists, readPrivateStorageFile } from './storagePaths.js';

/**
 * Database backups for the always-on paper server.
 *  - Snapshot: `VACUUM INTO` (a consistent copy taken inside a read transaction, safe while the engine runs).
 *  - Online and production writes require AES-256-GCM with MIA_BACKUP_KEY (32 bytes, hex or base64).
 *    Encrypted backups and restores use private temporary storage for their plaintext work files.
 *  - Manifest: `<file>.json` with the stored file's sha256, size, schema version and whether it is encrypted.
 *  - Verification ("can I restore from this?"): manifest hash, decrypt, SQLite integrity and foreign keys, schema
 *    version, and the audit-log and DITAS hash chains — all on the snapshot, never on the live database.
 *  - Retention: keep the newest N backups.
 */
const MAGIC = Buffer.from('MIAB1');
const PREFIX = 'mia-';
export interface BackupManifest { file: string; createdAt: number; schema: number; bytes: number; sha256: string; encrypted: boolean; format: 'sqlite' | 'MIAB1-aes-256-gcm' }
export interface VerifyResult { ok: boolean; file: string; checks: { name: string; ok: boolean; detail: string }[] }

export const backupDir = () => process.env.MIA_BACKUP_DIR || join(config.dataDir, 'backups');
export const backupKeep = () => { const n = Number(process.env.MIA_BACKUP_KEEP ?? 14); return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 14; };
/** Hours between automatic backups by the engine leader; 0 disables. */
export const backupIntervalMs = () => { const h = Number(process.env.MIA_BACKUP_INTERVAL_H ?? 24); return Number.isFinite(h) && h >= 0 && h <= 24 * 30 ? h * 3_600_000 : 24 * 3_600_000; };
const encryptionRequired = () => !config.offline || process.env.NODE_ENV === 'production';

/** Parse MIA_BACKUP_KEY. Unset → null (plaintext backups). Set but not exactly 32 bytes → throw (fail closed). */
export function backupKey(value = process.env.MIA_BACKUP_KEY): Buffer | null {
  if (value === undefined || value.trim() === '') return null;
  const v = value.trim();
  const k = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : /^[A-Za-z0-9+/]{43}=?$/.test(v) ? Buffer.from(v, 'base64') : null;
  if (!k || k.length !== 32) throw new Error('MIA_BACKUP_KEY must be 32 bytes as 64 hex characters or base64');
  return k;
}
const sha256File = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, body, c.getAuthTag()]);
}
export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < MAGIC.length + 12 + 16 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an MIA encrypted backup');
  const iv = blob.subarray(MAGIC.length, MAGIC.length + 12); const tag = blob.subarray(blob.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAAD(MAGIC); d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(MAGIC.length + 12, blob.length - 16)), d.final()]); // throws on tamper / wrong key
}

interface BackupOptions { dir?: string; key?: Buffer | null; nowTs?: number }

/** Return the manifest for a verified snapshot. */
export function createBackup(opts: BackupOptions = {}): BackupManifest {
  return createVerifiedBackup(opts).manifest;
}

/** Verify in private staging before the snapshot becomes visible to retention or other processes. */
export function createVerifiedBackup(opts: BackupOptions = {}): { manifest: BackupManifest; verification: VerifyResult } {
  const key = opts.key === undefined ? backupKey() : opts.key; const t = opts.nowTs ?? Date.now();
  if (!key && encryptionRequired()) throw new Error('MIA_BACKUP_KEY is required for online or production backups');
  if (key && key.length !== 32) throw new Error('MIA_BACKUP_KEY must be 32 bytes as 64 hex characters or base64');
  const dir = ensureStorageDirectory(opts.dir ?? backupDir());
  const name = `${PREFIX}${stamp(t)}${key ? '.db.enc' : '.db'}`; const final = join(dir, name);
  if (existsSync(final)) throw new Error(`backup ${name} already exists`);
  const staging = mkdtempSync(join(dir, '.mia-backup-'));
  const candidate = join(staging, name);
  let privateWorkspace: string | undefined;
  let published = false;
  try {
    if (key) privateWorkspace = mkdtempSync(join(tmpdir(), 'mia-backup-'));
    const raw = privateWorkspace ? join(privateWorkspace, 'snapshot.db') : candidate;
    getDb().prepare('VACUUM INTO ?').run(raw);
    chmodSync(raw, 0o600);
    if (key) writeFileSync(candidate, encrypt(readFileSync(raw), key), { mode: 0o600, flag: 'wx', flush: true });
    const manifest: BackupManifest = { file: name, createdAt: t, schema: SCHEMA_VERSION, bytes: statSync(candidate).size, sha256: sha256File(candidate), encrypted: !!key, format: key ? 'MIAB1-aes-256-gcm' : 'sqlite' };
    const manifestTemp = `${candidate}.json`;
    writeFileSync(manifestTemp, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx', flush: true });
    const verification = verifyBackup(candidate, key);
    if (!verification.ok) throw new Error(`backup restore check failed: ${verification.checks.filter(check => !check.ok).map(check => check.name).join(', ')}`);
    // Publish the manifest last. An interruption before then leaves an ineligible snapshot.
    linkSync(candidate, final);
    published = true;
    unlinkSync(candidate);
    renameSync(manifestTemp, `${final}.json`);
    return { manifest, verification };
  } catch (error) {
    if (published) rmSync(final, { force: true });
    throw error;
  } finally {
    if (privateWorkspace) rmSync(privateWorkspace, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Backups in a directory, newest first (only files that have a manifest count as complete). */
export function listBackups(dir = backupDir()): BackupManifest[] {
  if (!existsSync(dir)) return [];
  const directory = ensureStorageDirectory(dir);
  const out: BackupManifest[] = [];
  for (const f of readdirSync(directory)) {
    if (!f.startsWith(PREFIX) || !f.endsWith('.json')) continue;
    try {
      const m = JSON.parse(readPrivateStorageFile(join(directory, f))) as BackupManifest;
      if (m?.file === f.slice(0, -5) && privateStorageFileExists(join(directory, m.file))) out.push(m);
    } catch { /* An unreadable or unsafe pair is not a usable backup. */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
/** Delete backups beyond the newest `keep`. Returns the removed file names. */
export function pruneBackups(dir = backupDir(), keep = backupKeep(), cutoff = Infinity): string[] {
  const old = listBackups(dir).filter(backup => backup.createdAt <= cutoff).slice(keep);
  for (const m of old) { rmSync(join(dir, m.file), { force: true }); rmSync(join(dir, `${m.file}.json`), { force: true }); }
  return old.map((m) => m.file);
}

/** Restore check on a backup file (its manifest must sit beside it). Never modifies the backup or the live database. */
export function verifyBackup(file: string, key: Buffer | null = backupKey()): VerifyResult {
  const checks: VerifyResult['checks'] = []; const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const done = () => ({ ok: checks.every((c) => c.ok), file: basename(file), checks });
  let m: BackupManifest;
  try { m = JSON.parse(readPrivateStorageFile(`${file}.json`)); } catch { add('manifest', false, 'manifest missing, unreadable or unsafe'); return done(); }
  if (!add('manifest', m?.file === basename(file), m?.file === basename(file) ? 'present' : 'manifest names a different file')) return done();
  let checksum: string;
  try {
    if (!privateStorageFileExists(file)) throw new Error('snapshot missing');
    checksum = sha256File(file);
  } catch { add('checksum', false, 'stored file missing, unreadable or unsafe'); return done(); }
  if (!add('checksum', checksum === m.sha256, 'sha256 of stored file')) return done();
  let plainPath = file;
  let workspace: string | undefined;
  try {
    if (m.encrypted) {
      if (!add('key', !!key, key ? 'MIA_BACKUP_KEY present' : 'encrypted backup but MIA_BACKUP_KEY is not set')) return done();
      try {
        workspace = mkdtempSync(join(tmpdir(), 'mia-restore-check-'));
        plainPath = join(workspace, 'snapshot.db');
        writeFileSync(plainPath, decrypt(readFileSync(file), key!), { mode: 0o600, flag: 'wx' });
        add('decrypt', true, 'authenticated (AES-256-GCM)');
      }
      catch { add('decrypt', false, 'decryption failed: wrong key or modified file'); return done(); }
    }
    let snap: DatabaseSync | null = null;
    try {
      snap = new DatabaseSync(plainPath, { readOnly: true });
      const ic = (snap.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check);
      add('integrity', ic.length === 1 && ic[0] === 'ok', ic.slice(0, 3).join('; '));
      // integrity_check omits foreign keys. Read at most one violation, without exposing row identifiers.
      const foreignKeyViolation = snap.prepare('PRAGMA foreign_key_check').get();
      add('foreign keys', foreignKeyViolation === undefined, foreignKeyViolation ? 'referential integrity violation' : 'valid');
      const v = (snap.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
      add('schema', v === m.schema && v <= SCHEMA_VERSION, `v${v} (manifest v${m.schema}, code v${SCHEMA_VERSION})`);
      const a = verifyAuditChain(snap.prepare('SELECT * FROM audit_log ORDER BY id').all());
      add('audit chain', a.ok, a.ok ? `${a.entries} entries` : `broken at entry ${a.brokenAt}`);
      const d = verifyMemory(snap.prepare('SELECT * FROM ditas_events ORDER BY seq').all(), snap.prepare('SELECT * FROM ditas_snapshots').all());
      add('decision memory chain', d.ok, d.ok ? `${d.entries} events` : `broken at ${d.brokenAt}`);
    } catch (e: any) { add('open', false, `cannot read snapshot: ${String(e?.message ?? e).slice(0, 200)}`); }
    finally { snap?.close(); }
  } finally { if (workspace) rmSync(workspace, { recursive: true, force: true }); }
  return done();
}

/** Scheduled run (engine leader only). Only a verified new backup can trigger retention. */
export function maybeScheduledBackup(nowTs = Date.now()): BackupManifest | null {
  const every = backupIntervalMs(); if (every <= 0) return null;
  const requireEncryption = encryptionRequired();
  const last = listBackups().find(backup => backup.createdAt <= nowTs && (!requireEncryption || backup.encrypted));
  if (last && nowTs - last.createdAt < every) return null;
  // Never start a full-database copy that could fill the volume the live database needs.
  const space = backupSpaceDenial(storageStatus(nowTs)); if (space) throw new Error(space);
  const { manifest } = createVerifiedBackup({ nowTs }); pruneBackups(undefined, undefined, nowTs); return manifest;
}
