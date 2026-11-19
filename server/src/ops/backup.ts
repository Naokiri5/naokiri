import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { getDb } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from '../core/audit.js';
import { verifyMemory, type BlobHashRow, type TwinRunHashRow } from '../ditas/memory.js';
import { config } from '../config.js';
import { reconcile } from '../portfolio/calendar.js';
import { PAPER_ACCOUNT } from '../core/accounts.js';
import { getSetting, setSetting } from '../core/settings.js';

/**
 * Database backups for the always-on paper server.
 *  - Snapshot: `VACUUM INTO` (a consistent copy taken inside a read transaction, safe while the engine runs).
 *  - Optional encryption: AES-256-GCM with MIA_BACKUP_KEY (32 bytes, hex or base64). A key that is set but invalid fails
 *    the backup instead of silently writing plaintext. The key is never written to the manifest or logs.
 *  - Manifest: `<file>.json` with the stored file's sha256, size, schema version and whether it is encrypted.
 *  - Verification ("can I restore from this?"): manifest hash, decrypt, PRAGMA integrity_check, schema version, and the
 *    audit-log and DITAS hash chains plus ledger reconciliation — all on the snapshot, never on the live database.
 *  - Encrypted backups never stage plaintext in the backup directory (private temp workspace only).
 *  - Retention: keep the newest N backups plus the last verified good one, including after a failed verification.
 *  - Verification results are recorded (DATA-3) and bound to the verified file's bytes (sha256, size, mtime).
 */
const MAGIC = Buffer.from('MIAB1');
const PREFIX = 'mia-';
export interface BackupManifest { file: string; createdAt: number; schema: number; bytes: number; sha256: string; encrypted: boolean; format: 'sqlite' | 'MIAB1-aes-256-gcm' }
export interface VerifyResult { ok: boolean; file: string; createdAt: number | null; checks: { name: string; ok: boolean; detail: string }[]; sha256?: string }
/** A recorded verification, bound to the exact bytes that were verified (CodeRabbit #14: a PASS must not survive a changed file). */
export interface RecordedVerification extends Omit<VerifyResult, 'sha256'> { at: number; sha256: string | null; bytes: number | null; mtimeMs: number | null; recordError?: string }
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
  const name = `${PREFIX}${stamp(t)}${key ? '.db.enc' : '.db'}`; const final = join(dir, name);
  if (existsSync(final)) throw new Error(`backup ${name} already exists`);
  // Capy #14: an encrypted backup's plaintext snapshot lives only in a private temp workspace, never in the backup directory.
  const scratch = key ? mkdtempSync(join(tmpdir(), 'mia-backup-')) : null;
  const raw = scratch ? join(scratch, 'snapshot.db') : join(dir, `.${name}.partial`);
  const encoded = join(dir, `.${name}.partial.enc`);
  try {
    rmSync(raw, { force: true });
    getDb().prepare('VACUUM INTO ?').run(raw);
    chmodSync(raw, 0o600); // I-03: VACUUM INTO creates the file with the process umask; a backup holds credentials and the ledger
    if (key) { writeFileSync(encoded, encrypt(readFileSync(raw), key), { mode: 0o600 }); rmSync(raw); renameSync(encoded, final); }
    else renameSync(raw, final);
  } finally {
    try { rmSync(raw, { force: true }); rmSync(encoded, { force: true }); }
    finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
  }
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
/** Delete backups beyond the newest `keep`, protecting the last verified good configured backup. */
export function pruneBackups(dir = backupDir(), keep = backupKeep()): string[] {
  const good = resolve(dir) === resolve(backupDir()) ? getSetting<{ file: string; createdAt: number | null } | null>('backup.lastGoodVerify', null) : null;
  const old = listBackups(dir).slice(keep).filter((m) => m.file !== good?.file || m.createdAt !== good.createdAt);
  for (const m of old) { rmSync(join(dir, m.file), { force: true }); rmSync(join(dir, `${m.file}.json`), { force: true }); }
  return old.map((m) => m.file);
}

/** Restore check on a backup file (its manifest must sit beside it). Never modifies the backup or the live database. */
export function verifyBackup(file: string, key: Buffer | null = backupKey(), workerWorkspace?: string): VerifyResult {
  const checks: VerifyResult['checks'] = []; const add = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };
  let createdAt: number | null = null;
  let verifiedSha: string | undefined;
  const done = () => ({ ok: checks.every((c) => c.ok), file: basename(file), createdAt, checks, ...(verifiedSha ? { sha256: verifiedSha } : {}) });
  let m: BackupManifest;
  try { m = JSON.parse(readFileSync(`${file}.json`, 'utf8')); } catch { add('manifest', false, 'manifest missing or unreadable'); return done(); }
  if (!add('manifest', m.file === basename(file), m.file === basename(file) ? 'present' : 'manifest names a different file')) return done();
  createdAt = Number.isFinite(m.createdAt) ? m.createdAt : null;
  try { const h = sha256File(file); if (!add('checksum', h === m.sha256, 'sha256 of stored file')) return done(); verifiedSha = h; }
  catch { add('checksum', false, 'backup file missing or unreadable'); return done(); }
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
      catch { add('decrypt', false, 'encrypted backup could not be opened: check key, file and temporary storage'); return done(); }
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
      const r = reconcile(PAPER_ACCOUNT, snap); // Capy #14: the snapshot's ledger must reconcile, checked on the snapshot handle
      add('ledger reconcile', r.ok, r.detail);
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
  const failed = (detail: string): VerifyResult => ({ ok: false, file: basename(file), createdAt: null, checks: [{ name: 'worker', ok: false, detail }] });
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
export async function maybeScheduledBackup(nowTs = Date.now()): Promise<(BackupManifest & { verification: RecordedVerification; retentionWarning?: string }) | null> {
  const every = backupIntervalMs(); if (every <= 0) return null;
  const last = listBackups()[0];
  if (last && nowTs - last.createdAt < every) return null;
  const m = createBackup({ nowTs }); const file = join(backupDir(), m.file);
  // Verify off the event loop (MA-14), record it (DATA-3), and only then prune, so the new backup is checked before
  // anything older is removed. A pruning error never hides the completed backup or its verification (CodeRabbit #14).
  const verification = recordVerification(file, await verifyBackupInWorker(file), nowTs);
  try { pruneBackups(); }
  catch { return { ...m, verification, retentionWarning: 'The new backup is stored, but older backups could not be pruned.' }; }
  return { ...m, verification };
}

/**
 * Persist a verification attempt (DATA-3). The result is returned even if recording fails (CodeRabbit #14), and is bound
 * to the verified bytes so a later change to the file cannot keep a PASS.
 */
export function recordVerification(file: string, result: VerifyResult, nowTs = Date.now()): RecordedVerification {
  let sha256: string | null = null; let bytes: number | null = null; let mtimeMs: number | null = null;
  // Bind to the checksum the verification itself computed (no second read after the check), plus size and mtime.
  if (result.ok && result.sha256) { try { const st = statSync(file); sha256 = result.sha256; bytes = st.size; mtimeMs = st.mtimeMs; } catch { /* unreadable now: no binding, so status cannot PASS */ } }
  const lastVerify: RecordedVerification = { ...result, at: nowTs, sha256, bytes, mtimeMs, checks: result.checks.map((c) => c.name === 'open' ? { ...c, detail: 'cannot read snapshot' } : c) };
  try {
    setSetting('backup.lastVerify', lastVerify);
    if (lastVerify.ok && sha256 && resolve(dirname(file)) === resolve(backupDir())) setSetting('backup.lastGoodVerify', { file: lastVerify.file, createdAt: lastVerify.createdAt });
  } catch (e: any) { lastVerify.recordError = `verification result could not be recorded: ${String(e?.message ?? e).slice(0, 200)}`; }
  return lastVerify;
}
/** Verify in this thread and record the result (CLI and tests). The engine uses verifyBackupInWorker + recordVerification. */
export function verifyAndRecordBackup(file: string, key?: Buffer | null, nowTs = Date.now()): RecordedVerification {
  let result: VerifyResult;
  try { result = verifyBackup(file, key === undefined ? backupKey() : key); }
  catch { result = { ok: false, file: basename(file), createdAt: null, checks: [{ name: 'verification', ok: false, detail: 'backup could not be verified' }] }; }
  return recordVerification(file, result, nowTs);
}

/** Owner status derives from the recorded verification of the bytes still on disk, not merely from a backup file existing. */
export function backupVerificationStatus(nowTs = Date.now()): { lastVerify: RecordedVerification | null; check: { status: 'PASS' | 'WARN' | 'FAIL'; detail: string } } {
  let lastVerify: RecordedVerification | null = null;
  try {
    lastVerify = getSetting<RecordedVerification | null>('backup.lastVerify', null);
    if (!lastVerify) return { lastVerify, check: { status: 'WARN', detail: 'No recorded backup verification' } };
    if (!lastVerify.ok) return { lastVerify, check: { status: 'FAIL', detail: `Backup verification failed: ${lastVerify.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}` } };
    const maxAge = Math.min(7 * 86400_000, 2 * (backupIntervalMs() || 86400_000));
    if (!Number.isFinite(lastVerify.at) || lastVerify.createdAt === null || !Number.isFinite(lastVerify.createdAt)
      || lastVerify.at > nowTs || lastVerify.createdAt > nowTs || nowTs - lastVerify.at > maxAge || nowTs - lastVerify.createdAt > maxAge) {
      return { lastVerify, check: { status: 'WARN', detail: 'Backup verification is stale or its timestamp is unknown/future-dated' } };
    }
    const manifest = listBackups().find((m) => m.file === lastVerify!.file && m.createdAt === lastVerify!.createdAt);
    if (!manifest) return { lastVerify, check: { status: 'WARN', detail: 'Verified backup is not present in the configured backup directory' } };
    let st: { size: number; mtimeMs: number } | null = null;
    try { st = statSync(join(backupDir(), manifest.file)); } catch { st = null; }
    // Bound to the verified bytes: the manifest checksum, size and modification time must all still match.
    if (!lastVerify.sha256 || manifest.sha256 !== lastVerify.sha256 || !st || st.size !== lastVerify.bytes || st.mtimeMs !== lastVerify.mtimeMs) {
      return { lastVerify, check: { status: 'WARN', detail: 'The backup on disk changed since it was verified; verify it again' } };
    }
    return { lastVerify, check: { status: 'PASS', detail: `${lastVerify.file} verified ${new Date(lastVerify.at).toISOString()}; ledger reconciliation passed` } };
  } catch { return { lastVerify: null, check: { status: 'FAIL', detail: 'Backup verification status is unavailable' } }; }
}
