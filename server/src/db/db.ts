import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join, resolve } from 'node:path';
import { ensureDataDir } from '../config.js';
import { createPrivateSqliteFile, ensureStorageDirectory, prepareSqliteFile, privateStorageFileExists } from '../ops/storagePaths.js';
import { migrate } from './migrations.js';

let db: DatabaseSync | null = null;
let dbPath: string | null = null;
/** File backing the open database; null when closed or in memory (no disk capacity applies). */
export const dbFilePath = () => (dbPath && dbPath !== ':memory:' ? dbPath : null);
const BUSY_TIMEOUT_MS = 5_000;
const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'];

function enableWal(connection: DatabaseSync) {
  const until = Date.now() + BUSY_TIMEOUT_MS;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      connection.exec('PRAGMA journal_mode=WAL');
      return;
    } catch (error) {
      // A concurrent first open can hit SQLITE_BUSY during the journal-mode upgrade even with a busy handler.
      if (!(error instanceof Error) || !('errcode' in error) || error.errcode !== 5 || Date.now() >= until) throw error;
      Atomics.wait(wait, 0, 0, Math.min(25, Math.max(0, until - Date.now())));
    }
  }
}

export function openDb(file?: string) {
  if (db) return db;
  const explicit = file ? resolve(file) : undefined;
  const path = file === ':memory:' ? file : explicit
    ? join(ensureStorageDirectory(dirname(explicit)), basename(explicit))
    : join(ensureDataDir(), 'mia.db');
  const sidecars = path === ':memory:' ? [] : SIDECAR_SUFFIXES.map(suffix => path + suffix);
  if (path !== ':memory:') {
    // Inspect each sidecar even when an earlier one existed. SQLite may access these before its first statement.
    const existingSidecars = sidecars.map(prepareSqliteFile);
    if (!prepareSqliteFile(path)) {
      if (existingSidecars.some(Boolean)) throw new Error('SQLite database is missing while sidecar files remain. Preserve the files and verify the original database before restarting.');
      createPrivateSqliteFile(path);
    }
  }
  const connection = new DatabaseSync(path);
  try {
    connection.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys=ON;`);
    enableWal(connection);
    // Financial commits must survive process loss: use the existing WAL, not a second ledger.
    // Explicitly select FULL rather than relying on the SQLite build's default synchronous mode.
    connection.exec('PRAGMA synchronous=FULL');
    migrate(connection);
    if (path !== ':memory:') {
      if (!privateStorageFileExists(path)) throw new Error('SQLite database disappeared during startup. Verify the storage volume before restarting.');
      for (const sidecar of sidecars) privateStorageFileExists(sidecar);
    }
    // Track the path only once the connection is usable; a failed setup must not leave a path for a closed database.
    db = connection; dbPath = path;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
export function getDb() { return db ?? openDb(); }
/** Non-opening probe for optional background research; keeps isolated tests and offline tasks file-free. */
export function isDbOpen() { return db !== null; }
export function closeDb() { db?.close(); db = null; dbPath = null; }

export function all<T = any>(sql: string, ...p: any[]): T[] { return getDb().prepare(sql).all(...p) as T[]; }
export function get<T = any>(sql: string, ...p: any[]): T | undefined { return getDb().prepare(sql).get(...p) as T | undefined; }
export function run(sql: string, ...p: any[]) { return getDb().prepare(sql).run(...p); }
/** Transaction depth tracked here, not via DatabaseSync.isTransaction (that property needs Node >= 22.16; we support 22.13). */
let txDepth = 0;
/** What kind of transaction is open: write guards (OMS fills, engine fence) must not pass inside a read snapshot. */
let txKind: 'read' | 'write' | null = null;
/** True only inside a write transaction (tx). A read snapshot does not count: it holds no write lock. */
export const inTransaction = () => txDepth > 0 && txKind === 'write';
/** Atomic block. Nested calls join the outer transaction, so an inner failure still rolls back everything. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) {
    // Joining a deferred read snapshot would write without the IMMEDIATE lock (and can fail with BUSY_SNAPSHOT).
    if (txKind === 'read') throw new Error('WRITE_TRANSACTION_INSIDE_READ_SNAPSHOT');
    return fn();
  }
  const d = getDb();
  d.exec('BEGIN IMMEDIATE'); txDepth = 1; txKind = 'write';
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } finally { txDepth = 0; txKind = null; }
}
/**
 * Run read-only queries against one consistent database snapshot. A deferred transaction in WAL mode reads every
 * statement from the snapshot taken at its first read, so a commit by another process cannot land between them.
 * Inside an existing transaction it just runs (that transaction already gives one snapshot). Never write inside it.
 */
export function readSnapshot<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  const d = getDb();
  d.exec('BEGIN DEFERRED'); txDepth = 1; txKind = 'read';
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } finally { txDepth = 0; txKind = null; }
}
export const J = (v: unknown) => JSON.stringify(v);
export const P = <T = any>(s: string | null | undefined, d: T = null as T): T => (s ? JSON.parse(s) : d);
