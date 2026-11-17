import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { getDb } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { audit, verifyAuditChain } from '../core/audit.js';
import { getSetting, setSetting } from '../core/settings.js';
import { notify } from '../notify/notify.js';
import { reconcile } from '../portfolio/calendar.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';

const messages = {
  IO: 'Backup storage operation failed', BUSY: 'A backup operation is already running', CHECKSUM: 'Stored backup checksum does not match',
  DECRYPT: 'Backup decryption failed; check the encryption key', SCHEMA: 'Backup schema version is missing, unsupported or mismatched',
  INTEGRITY: 'Backup SQLite integrity or foreign-key check failed', AUDIT: 'Backup audit chain verification failed',
  RECONCILE: 'Backup paper ledger reconciliation failed', KEY: 'MIA_BACKUP_KEY must contain exactly 64 hexadecimal characters',
};
type Code = keyof typeof messages;
interface Problem { code: Code; message: string }
interface LastError extends Problem { at: number }
export interface RestoreTest {
  at: number; ok: boolean; integrity: string; schemaVersion: number | null; auditEntries: number; auditOk: boolean;
  reconcileOk: boolean; reconcileDetail: string; error: Problem | null;
}
export interface Manifest {
  version: 1; id: string; seq: number; file: string; createdAt: number; schemaVersion: number; bytes: number;
  checksum: string; encrypted: boolean; restoreTestedAt: number | null; restoreTest: RestoreTest;
}
class BackupError extends Error {
  statusCode: number;
  constructor(public code: Code) { super(messages[code]); this.statusCode = code === 'BUSY' ? 409 : 500; }
}
const problem = (e: unknown): Problem => { const code = e instanceof BackupError ? e.code : 'IO'; return { code, message: messages[code] }; };
const digest = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const idPattern = /^\d{6}-[0-9a-f]{4}$/;
const manifestPattern = /^mia-(\d{6}-[0-9a-f]{4})\.json$/;
const snapshotPattern = /^mia-(\d{6}-[0-9a-f]{4})\.db(?:\.enc)?$/;
const header = Buffer.from('MIABAK1\0');
const manifestPath = (id: string) => join(config.backup.dir, `mia-${id}.json`);
let running = false;
let bootTimer: ReturnType<typeof setTimeout> | undefined;
let intervalTimer: ReturnType<typeof setInterval> | undefined;

function key() {
  const value = process.env.MIA_BACKUP_KEY;
  if (value === undefined) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new BackupError('KEY');
  return Buffer.from(value, 'hex');
}
function recordError(e: unknown) {
  try {
    const p = problem(e); const prev = getSetting<LastError | null>('backup.lastError', null);
    setSetting('backup.lastError', { at: Date.now(), ...p });
    if (!prev || prev.code !== p.code) notify('CRITICAL', 'Backup failed', p.code, 'backups');
  } catch {}
}
function saveManifest(m: Manifest) {
  const tmp = `${manifestPath(m.id)}.${randomBytes(4).toString('hex')}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(m), { mode: 0o600, flag: 'wx' }); renameSync(tmp, manifestPath(m.id)); }
  finally { rmSync(tmp, { force: true }); }
}

export function listBackups(): Manifest[] {
  try {
    if (!existsSync(config.backup.dir)) return [];
    const found: Manifest[] = [];
    for (const name of readdirSync(config.backup.dir)) {
      const match = manifestPattern.exec(name); if (!match) continue;
      let m: Manifest;
      try { m = JSON.parse(readFileSync(join(config.backup.dir, name), 'utf8')); } catch (e: any) { if (e instanceof SyntaxError || e.code === 'ENOENT') continue; throw e; }
      if (!m || m.version !== 1 || m.id !== match[1] || m.seq !== Number(match[1].slice(0, 6)) || !Number.isInteger(m.seq) || m.seq < 1
        || typeof m.encrypted !== 'boolean' || m.file !== `mia-${m.id}.db${m.encrypted ? '.enc' : ''}` || !Number.isFinite(m.createdAt)
        || !Number.isInteger(m.schemaVersion) || !Number.isInteger(m.bytes) || m.bytes < 1 || !/^sha256:[0-9a-f]{64}$/.test(m.checksum)
        || !m.restoreTest || typeof m.restoreTest.ok !== 'boolean' || !Number.isFinite(m.restoreTest.at)) continue;
      try { if (!lstatSync(join(config.backup.dir, m.file)).isFile()) continue; } catch (e: any) { if (e.code === 'ENOENT') continue; throw e; }
      found.push(m);
    }
    return found.sort((a, b) => b.seq - a.seq);
  } catch { const e = new BackupError('IO'); recordError(e); throw e; }
}

function sweep() {
  for (const name of readdirSync(config.backup.dir)) {
    const file = join(config.backup.dir, name);
    try {
      const st = lstatSync(file);
      if (Date.now() - st.mtimeMs <= 10 * 60_000) continue;
      const orphan = snapshotPattern.exec(name);
      if ((st.isFile() && (name.endsWith('.tmp') || (orphan && !existsSync(manifestPath(orphan[1])))))
        || (st.isDirectory() && /^\.(staging|verify)-[A-Za-z0-9]+$/.test(name))) rmSync(file, { recursive: st.isDirectory(), force: true });
    } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  }
}
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (running) { const e = new BackupError('BUSY'); recordError(e); throw e; }
  running = true; let mutex: DatabaseSync | undefined; let locked = false;
  try {
    mkdirSync(config.backup.dir, { recursive: true, mode: 0o700 }); chmodSync(config.backup.dir, 0o700);
    mutex = new DatabaseSync(join(config.backup.dir, 'mutex.sqlite')); chmodSync(join(config.backup.dir, 'mutex.sqlite'), 0o600);
    mutex.exec('PRAGMA busy_timeout=0');
    try { mutex.exec('BEGIN IMMEDIATE'); locked = true; } catch (e: any) { if (e.errcode === 5 || e.code === 'SQLITE_BUSY' || e.message?.includes('database is locked')) throw new BackupError('BUSY'); throw e; }
    sweep(); return await fn();
  } catch (e) { if ((e as any)?.statusCode === 404) throw e; recordError(e); throw e instanceof BackupError ? e : new BackupError('IO'); }
  finally { try { if (locked) mutex!.exec('ROLLBACK'); } finally { try { mutex?.close(); } finally { running = false; } } }
}

function verify(file: string, m: Pick<Manifest, 'checksum' | 'bytes' | 'encrypted'> & { schemaVersion?: number }): RestoreTest {
  const result: RestoreTest = { at: Date.now(), ok: false, integrity: 'not checked', schemaVersion: null, auditEntries: 0, auditOk: false, reconcileOk: false, reconcileDetail: 'not checked', error: null };
  let scratch: string | undefined; let copy: DatabaseSync | undefined;
  try {
    const stored = readFileSync(file);
    if (digest(stored) !== m.checksum || stored.length !== m.bytes) throw new BackupError('CHECKSUM');
    const k = key(); let bytes = stored;
    if (m.encrypted) {
      if (!k) throw new BackupError('DECRYPT');
      try {
        if (stored.length < 36 || !stored.subarray(0, 8).equals(header)) throw new BackupError('DECRYPT');
        const decipher = createDecipheriv('aes-256-gcm', k, stored.subarray(8, 20)); decipher.setAuthTag(stored.subarray(-16));
        bytes = Buffer.concat([decipher.update(stored.subarray(20, -16)), decipher.final()]);
      } catch { throw new BackupError('DECRYPT'); }
    }
    scratch = mkdtempSync(join(config.backup.dir, '.verify-')); chmodSync(scratch, 0o700);
    const path = join(scratch, 'copy.db'); writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
    try {
      copy = new DatabaseSync(path, { readOnly: true });
      const rows = copy.prepare('PRAGMA integrity_check').all();
      result.integrity = rows.length === 1 && rows[0].integrity_check === 'ok' ? 'ok' : 'failed';
      if (result.integrity !== 'ok') throw new BackupError('INTEGRITY');
      if (copy.prepare('PRAGMA foreign_key_check').all().length) { result.integrity = 'foreign_key_check failed'; throw new BackupError('INTEGRITY'); }
    } catch { throw new BackupError('INTEGRITY'); }
    try { result.schemaVersion = (copy.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number }).v; } catch { throw new BackupError('SCHEMA'); }
    if (!Number.isInteger(result.schemaVersion) || result.schemaVersion! < 1 || result.schemaVersion! > SCHEMA_VERSION || (m.schemaVersion !== undefined && result.schemaVersion !== m.schemaVersion)) throw new BackupError('SCHEMA');
    try { const chain = verifyAuditChain(copy); result.auditEntries = chain.entries; result.auditOk = chain.ok; } catch { throw new BackupError('AUDIT'); }
    if (!result.auditOk) throw new BackupError('AUDIT');
    try { const rec = reconcile(PAPER_ACCOUNT, copy); result.reconcileOk = rec.ok; result.reconcileDetail = rec.detail; } catch { throw new BackupError('RECONCILE'); }
    if (!result.reconcileOk) throw new BackupError('RECONCILE');
    result.ok = true;
  } catch (e) { result.error = problem(e); }
  finally { try { copy?.close(); } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); } }
  return result;
}

export async function createBackup() {
  let k: Buffer | null;
  try { k = key(); } catch (e) { recordError(e); throw e; }
  return exclusive(async () => {
    const createdAt = Date.now();
    const backups = listBackups(); const seq = (backups[0]?.seq ?? 0) + 1;
    if (seq > 999999) throw new BackupError('IO');
    let id: string;
    do { id = `${String(seq).padStart(6, '0')}-${randomBytes(2).toString('hex')}`; } while (existsSync(manifestPath(id)) || existsSync(join(config.backup.dir, `mia-${id}.db`)) || existsSync(join(config.backup.dir, `mia-${id}.db.enc`)));
    const staging = mkdtempSync(join(config.backup.dir, '.staging-')); chmodSync(staging, 0o700);
    let ro: DatabaseSync | undefined;
    try {
      const plain = join(staging, 'snapshot.db.tmp'); const db = getDb(); const location = db.location();
      const source = location && location !== ':memory:' ? (ro = new DatabaseSync(location, { readOnly: true })) : db;
      await backup(source, plain, { rate: 1 << 20 }); chmodSync(plain, 0o600); ro?.close(); ro = undefined;
      let stored = plain;
      if (k) {
        const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', k, iv);
        const bytes = Buffer.concat([header, iv, cipher.update(readFileSync(plain)), cipher.final(), cipher.getAuthTag()]);
        stored = join(staging, 'encrypted.tmp'); writeFileSync(stored, bytes, { mode: 0o600, flag: 'wx' }); rmSync(plain);
      }
      const bytes = readFileSync(stored); const checksum = digest(bytes); const encrypted = k !== null;
      const test = verify(stored, { checksum, bytes: bytes.length, encrypted });
      if (!test.ok) throw new BackupError(test.error!.code);
      const m: Manifest = { version: 1, id, seq, file: `mia-${id}.db${encrypted ? '.enc' : ''}`, createdAt, schemaVersion: test.schemaVersion!, bytes: bytes.length, checksum, encrypted, restoreTestedAt: test.at, restoreTest: test };
      renameSync(stored, join(config.backup.dir, m.file)); saveManifest(m);
      setSetting('backup.lastError', null); audit('system', 'backup.created', { id, seq, encrypted, bytes: m.bytes, schemaVersion: m.schemaVersion });
      for (const old of listBackups().slice(config.backup.keep)) {
        if (snapshotPattern.test(old.file)) { rmSync(manifestPath(old.id), { force: true }); rmSync(join(config.backup.dir, old.file), { force: true }); }
      }
      return m;
    } finally { try { ro?.close(); } finally { rmSync(staging, { recursive: true, force: true }); } }
  });
}

export async function restoreTest(id: string) {
  if (!idPattern.test(id)) throw Object.assign(new Error('Invalid backup id'), { statusCode: 400 });
  if (!listBackups().some((m) => m.id === id)) throw Object.assign(new Error('Backup not found'), { statusCode: 404 });
  return exclusive(async () => {
    const m = listBackups().find((b) => b.id === id);
    if (!m) throw Object.assign(new Error('Backup not found'), { statusCode: 404 });
    m.restoreTest = verify(join(config.backup.dir, m.file), m);
    if (m.restoreTest.ok) m.restoreTestedAt = m.restoreTest.at;
    saveManifest(m);
    if (m.restoreTest.ok) setSetting('backup.lastError', null); else recordError(new BackupError(m.restoreTest.error!.code));
    audit('system', 'backup.restoreTest', { id, ok: m.restoreTest.ok, code: m.restoreTest.error?.code ?? null });
    return m;
  });
}

export function backupCheck(backups = listBackups(), lastError = getSetting<LastError | null>('backup.lastError', null)): { status: 'PASS' | 'WARN' | 'FAIL'; detail: string } {
  const latest = backups[0]; const success = Math.max(0, ...backups.map((b) => b.restoreTestedAt ?? 0));
  if (latest?.restoreTest.ok === false || (lastError && lastError.at >= success)) return { status: 'FAIL', detail: lastError ? `${lastError.code}: ${lastError.message}` : 'Newest backup restore test failed' };
  if (!latest) return { status: 'WARN', detail: 'No verified backup yet' };
  const warnings: string[] = [];
  if (!latest.encrypted) warnings.push('backup is unencrypted');
  if (latest.createdAt > Date.now()) warnings.push('backup timestamp is in the future (clock skew)');
  if (config.backup.intervalMs > 0 && Date.now() - latest.createdAt > 2 * config.backup.intervalMs) warnings.push('newest backup is older than two backup intervals');
  return warnings.length ? { status: 'WARN', detail: warnings.join('; ') } : { status: 'PASS', detail: 'Encrypted backup verified: SQLite integrity, schema, audit chain and paper ledger reconciliation passed' };
}
export function backupStatus() {
  const backups = listBackups(); const lastError = getSetting<LastError | null>('backup.lastError', null);
  return { enabled: config.backup.intervalMs > 0, intervalMs: config.backup.intervalMs, keep: config.backup.keep, encryptionKeyConfigured: process.env.MIA_BACKUP_KEY !== undefined, running, lastError, latest: backups[0] ?? null, backups, check: backupCheck(backups, lastError) };
}
export function startBackups() {
  stopBackups(); if (!(config.backup.intervalMs > 0)) return;
  const tick = async () => {
    try { const latest = listBackups()[0]; if (!latest || Date.now() - latest.createdAt >= config.backup.intervalMs) await createBackup(); }
    catch (e) { try { recordError(e); } catch {} }
  };
  bootTimer = setTimeout(() => { void tick(); intervalTimer = setInterval(() => void tick(), Math.min(config.backup.intervalMs, 15 * 60_000)); intervalTimer.unref(); }, 30_000);
  bootTimer.unref();
}
export function stopBackups() { clearTimeout(bootTimer); clearInterval(intervalTimer); bootTimer = undefined; intervalTimer = undefined; }
