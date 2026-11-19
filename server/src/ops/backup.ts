import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { getDb } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from '../core/audit.js';
import { verifyMemory, type BlobHashRow, type TwinRunHashRow } from '../ditas/memory.js';
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
const restoreWorkspace = () => mkdtempSync(join(tmpdir(), 'mia-verify-'));

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
  const name = `${PREFIX}${stamp(t)}${key ? '.db.enc' : '.db'}`;
  const final = join(dir, name);
  const finalManifest = `${final}.json`;
  // Keep staging on the destination filesystem for atomic renames. Exclusive creation also prevents another writer
  // from publishing a different backup with the same timestamp between the two renames.
  const staging = join(dir, `.${name}.staging`);
  try { mkdirSync(staging, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`backup ${name} is already being created`);
    throw error;
  }
  try {
    if (existsSync(final) || existsSync(finalManifest)) throw new Error(`backup ${name} already exists`);
    const raw = join(staging, 'snapshot.db');
    // SQLite accepts an empty output file and preserves its mode. Restrict it before the first plaintext write.
    writeFileSync(raw, '', { flag: 'wx', mode: 0o600 });
    getDb().prepare('VACUUM INTO ?').run(raw);
    chmodSync(raw, 0o600);
    const payload = key ? `${raw}.enc` : raw;
    if (key) {
      writeFileSync(payload, encrypt(readFileSync(raw), key), { flag: 'wx', mode: 0o600 });
      rmSync(raw);
    }
    const m: BackupManifest = { file: name, createdAt: t, schema: SCHEMA_VERSION, bytes: statSync(payload).size, sha256: sha256File(payload), encrypted: !!key, format: key ? 'MIAB1-aes-256-gcm' : 'sqlite' };
    const manifest = join(staging, 'manifest.json');
    writeFileSync(manifest, JSON.stringify(m, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(payload, final);
    try { renameSync(manifest, finalManifest); }
    catch (error) { rmSync(final, { force: true }); throw error; }
    return m;
  } finally { rmSync(staging, { recursive: true, force: true }); }
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
export function verifyBackup(file: string, key: Buffer | null = backupKey(), workerWorkspace?: string): VerifyResult {
  const checks: VerifyResult['checks'] = []; const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  const done = () => ({ ok: checks.every((c) => c.ok), file: basename(file), checks });
  let m: BackupManifest;
  try { m = JSON.parse(readFileSync(`${file}.json`, 'utf8')); } catch { add('manifest', false, 'manifest missing or unreadable'); return done(); }
  if (!add('manifest', m.file === basename(file), m.file === basename(file) ? 'present' : 'manifest names a different file')) return done();
  if (!add('checksum', sha256File(file) === m.sha256, 'sha256 of stored file')) return done();
  let plainPath = file;
  let workspace = workerWorkspace;
  try {
    if (m.encrypted) {
      if (!add('key', !!key, key ? 'MIA_BACKUP_KEY present' : 'encrypted backup but MIA_BACKUP_KEY is not set')) return done();
      try {
        workspace ??= restoreWorkspace();
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
      const v = (snap.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
      add('schema', v === m.schema && v <= SCHEMA_VERSION, `v${v} (manifest v${m.schema}, code v${SCHEMA_VERSION})`);
      const a = verifyAuditChain(snap.prepare('SELECT * FROM audit_log ORDER BY id').all());
      add('audit chain', a.ok, a.ok ? `${a.entries} entries` : `broken at entry ${a.brokenAt}`);
      const blobs = v >= 6 ? snap.prepare('SELECT hash, payload FROM ditas_blobs').all() as BlobHashRow[] : [];
      const twins = snap.prepare('SELECT id, hash, result FROM ditas_twin_runs').all() as TwinRunHashRow[];
      const d = verifyMemory(snap.prepare('SELECT * FROM ditas_events ORDER BY seq').all(), snap.prepare('SELECT * FROM ditas_snapshots').all(), blobs, twins);
      add('decision memory chain', d.ok, d.ok ? `${d.entries} events` : `broken at ${d.brokenAt}`);
    } catch (e: any) { add('open', false, `cannot read snapshot: ${String(e?.message ?? e).slice(0, 200)}`); }
    finally { snap?.close(); }
  } finally {
    if (workspace && !workerWorkspace) rmSync(workspace, { recursive: true, force: true });
  }
  return done();
}

function restoreWorkerEntry(): URL {
  if (!import.meta.url.endsWith('.ts')) return new URL('./verify-worker.js', import.meta.url);
  const entry = new URL('./verify-worker.ts', import.meta.url);
  // Source mode needs to register tsx inside the worker on the minimum supported Node version.
  const bootstrap = `const { tsImport } = await import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))});\n`
    + `await tsImport(${JSON.stringify(entry.href)}, ${JSON.stringify(import.meta.url)});`;
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`);
}

/**
 * verifyBackup in a worker thread, so a large restore check never blocks the engine's event loop (MA-14). Falls back
 * to the in-thread check if the worker cannot start, so a backup is never left unverified. Times out after `timeoutMs`
 * (reported as a failed check, never as a pass).
 */
export async function verifyBackupInWorker(file: string, key: Buffer | null = backupKey(), timeoutMs = 10 * 60_000): Promise<VerifyResult> {
  const failed = (detail: string): VerifyResult => ({ ok: false, file: basename(file), checks: [{ name: 'worker', ok: false, detail }] });
  let workspace: string;
  try { workspace = restoreWorkspace(); }
  catch { return failed('cannot create private restore workspace'); }
  let worker: Worker | undefined;
  let result: VerifyResult;
  try {
    try { worker = new Worker(restoreWorkerEntry(), { workerData: { file, keyHex: key?.toString('hex') ?? null, workspace }, execArgv: [] }); }
    catch { /* If the worker cannot start, verify in this process using the same workspace. */ }
    if (!worker) result = verifyBackup(file, key, workspace);
    else {
      const activeWorker = worker;
      result = await new Promise<VerifyResult>((resolve) => {
        const finish = (verdict: VerifyResult) => { clearTimeout(timer); resolve(verdict); };
        const timer = setTimeout(() => finish(failed(`restore check timed out after ${timeoutMs} ms`)), timeoutMs);
        activeWorker.once('message', (m: { ok: boolean; result?: VerifyResult; error?: string }) => finish(m.ok && m.result ? m.result : failed(m.error ?? 'worker failed')));
        activeWorker.once('error', (e: Error) => finish(failed(`restore check worker error: ${e.message.slice(0, 200)}`)));
        activeWorker.once('exit', (code) => finish(failed(`restore check worker exited (${code}) without a result`)));
      });
    }
  } catch { result = failed('restore check could not run'); }
  // Terminate before deleting so a worker cannot write another plaintext copy after cleanup or hold the file open.
  try { await worker?.terminate(); }
  catch { result = failed('could not stop restore check worker'); }
  try { rmSync(workspace, { recursive: true, force: true }); }
  catch { return failed('could not remove private restore workspace'); }
  return result;
}

/** Scheduled run (engine leader only): back up when the newest backup is older than the interval, then prune. */
export function maybeScheduledBackup(nowTs = Date.now()): BackupManifest | null {
  const every = backupIntervalMs(); if (every <= 0) return null;
  const last = listBackups()[0];
  if (last && nowTs - last.createdAt < every) return null;
  const m = createBackup({ nowTs }); pruneBackups(); return m;
}
