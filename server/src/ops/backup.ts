import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from '../core/audit.js';
import { verifyMemory } from '../ditas/memory.js';
import { config } from '../config.js';

/**
 * Database backups for the always-on paper server.
 *  - Snapshot: `VACUUM INTO` (a consistent copy taken inside a read transaction, safe while the engine runs).
 *  - Optional encryption: AES-256-GCM with MIA_BACKUP_KEY (32 bytes, hex or base64). A key that is set but invalid fails
 *    the backup instead of silently writing plaintext. The key is never written to the manifest or logs.
 *  - Manifest: `<file>.json` with the stored file's sha256, size, schema version and whether it is encrypted.
 *  - Verification ("can I restore from this?"): manifest hash, decrypt, PRAGMA integrity_check, schema version, and the
 *    audit-log and DITAS hash chains — all on the snapshot, never on the live database.
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

/**
 * The live database a manual backup must read. Refuses (throws) when it does not exist: opening it would CREATE a new,
 * empty database whose backup verifies fine — e.g. a shell without MIA_DATA_DIR=/var/lib/mia (MA-09).
 */
export function liveDatabasePath(dataDir = config.dataDir): string {
  const file = join(dataDir, 'mia.db');
  if (!existsSync(file)) throw new Error(`no MIA database at ${file}. Set MIA_DATA_DIR to the server's data directory (the systemd unit uses /var/lib/mia) and run as the service user`);
  return file;
}
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

/** Create a backup of the open database. Writes are atomic (temp file + rename); a failed run leaves no partial backup. */
export function createBackup(opts: { dir?: string; key?: Buffer | null; nowTs?: number } = {}): BackupManifest {
  const dir = opts.dir ?? backupDir(); const key = opts.key === undefined ? backupKey() : opts.key; const t = opts.nowTs ?? Date.now();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${PREFIX}${stamp(t)}${key ? '.db.enc' : '.db'}`; const final = join(dir, name);
  if (existsSync(final)) throw new Error(`backup ${name} already exists`);
  const raw = join(dir, `.${name}.partial`);
  try {
    rmSync(raw, { force: true });
    getDb().prepare('VACUUM INTO ?').run(raw);
    if (key) { writeFileSync(`${raw}.enc`, encrypt(readFileSync(raw), key), { mode: 0o600 }); rmSync(raw); renameSync(`${raw}.enc`, final); }
    else renameSync(raw, final);
  } finally { rmSync(raw, { force: true }); rmSync(`${raw}.enc`, { force: true }); }
  const m: BackupManifest = { file: name, createdAt: t, schema: SCHEMA_VERSION, bytes: statSync(final).size, sha256: sha256File(final), encrypted: !!key, format: key ? 'MIAB1-aes-256-gcm' : 'sqlite' };
  writeFileSync(`${final}.json.partial`, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 }); renameSync(`${final}.json.partial`, `${final}.json`);
  return m;
}

/** Backups in a directory, newest first (only files that have a manifest count as complete). */
export function listBackups(dir = backupDir()): BackupManifest[] {
  if (!existsSync(dir)) return [];
  const out: BackupManifest[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(PREFIX) || !f.endsWith('.json')) continue;
    try { const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as BackupManifest; if (m.file === f.slice(0, -5) && existsSync(join(dir, m.file))) out.push(m); } catch { /* unreadable manifest: not a usable backup */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}
/** Delete backups beyond the newest `keep`. Returns the removed file names. */
export function pruneBackups(dir = backupDir(), keep = backupKeep()): string[] {
  const old = listBackups(dir).slice(keep);
  for (const m of old) { rmSync(join(dir, m.file), { force: true }); rmSync(join(dir, `${m.file}.json`), { force: true }); }
  return old.map((m) => m.file);
}

/** Restore check on a backup file (its manifest must sit beside it). Never modifies the backup or the live database. */
export function verifyBackup(file: string, key: Buffer | null = backupKey()): VerifyResult {
  const checks: VerifyResult['checks'] = []; const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const done = () => ({ ok: checks.every((c) => c.ok), file: basename(file), checks });
  let m: BackupManifest;
  try { m = JSON.parse(readFileSync(`${file}.json`, 'utf8')); } catch { add('manifest', false, 'manifest missing or unreadable'); return done(); }
  if (!add('manifest', m.file === basename(file), m.file === basename(file) ? 'present' : 'manifest names a different file')) return done();
  if (!add('checksum', sha256File(file) === m.sha256, 'sha256 of stored file')) return done();
  let plainPath = file; const tmp = join(dirname(file), `.verify-${process.pid}-${randomBytes(4).toString('hex')}.db`);
  try {
    if (m.encrypted) {
      if (!add('key', !!key, key ? 'MIA_BACKUP_KEY present' : 'encrypted backup but MIA_BACKUP_KEY is not set')) return done();
      try { writeFileSync(tmp, decrypt(readFileSync(file), key!), { mode: 0o600 }); plainPath = tmp; add('decrypt', true, 'authenticated (AES-256-GCM)'); }
      catch { add('decrypt', false, 'decryption failed: wrong key or modified file'); return done(); }
    }
    let snap: DatabaseSync | null = null;
    try {
      snap = new DatabaseSync(plainPath, { readOnly: true });
      const ic = (snap.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check);
      add('integrity', ic.length === 1 && ic[0] === 'ok', ic.slice(0, 3).join('; '));
      const v = (snap.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
      add('schema', v === m.schema && v <= SCHEMA_VERSION, `v${v} (manifest v${m.schema}, code v${SCHEMA_VERSION})`);
      const a = verifyAuditChain(snap.prepare('SELECT * FROM audit_log ORDER BY id').all());
      add('audit chain', a.ok, a.ok ? `${a.entries} entries` : `broken at entry ${a.brokenAt}`);
      const blobs = (() => { try { return snap.prepare('SELECT * FROM ditas_blobs').all(); } catch { return []; } })(); // absent before schema v6
      const d = verifyMemory(snap.prepare('SELECT * FROM ditas_events ORDER BY seq').all(), snap.prepare('SELECT * FROM ditas_snapshots').all(), blobs);
      add('decision memory chain', d.ok, d.ok ? `${d.entries} events` : `broken at ${d.brokenAt}`);
    } catch (e: any) { add('open', false, `cannot read snapshot: ${String(e?.message ?? e).slice(0, 200)}`); }
    finally { snap?.close(); }
  } finally { rmSync(tmp, { force: true }); }
  return done();
}

/** Scheduled run (engine leader only): back up when the newest backup is older than the interval, then prune. */
export function maybeScheduledBackup(nowTs = Date.now()): BackupManifest | null {
  const every = backupIntervalMs(); if (every <= 0) return null;
  const last = listBackups()[0];
  if (last && nowTs - last.createdAt < every) return null;
  const m = createBackup({ nowTs }); pruneBackups(); return m;
}
