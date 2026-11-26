import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config, ensureDataDir } from '../config.js';
import { migrate } from './migrations.js';

let db: DatabaseSync | null = null;
let dbPath: string | null = null;
/** File backing the open database; null when closed or in memory (no disk capacity applies). */
export const dbFilePath = () => (dbPath && dbPath !== ':memory:' ? dbPath : null);
const BUSY_TIMEOUT_MS = 5_000;

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
  let path = file;
  if (!path) { ensureDataDir(); path = join(config.dataDir, 'mia.db'); }
  const connection = new DatabaseSync(path);
  dbPath = path;
  try {
    connection.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}; PRAGMA foreign_keys=ON;`);
    enableWal(connection);
    // Financial commits must survive process loss: use the existing WAL, not a second ledger.
    // Explicitly select FULL rather than relying on the SQLite build's default synchronous mode.
    connection.exec('PRAGMA synchronous=FULL');
    migrate(connection);
    db = connection;
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
export const inTransaction = () => txDepth > 0;
/** Atomic block. Nested calls join the outer transaction, so an inner failure still rolls back everything. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  const d = getDb();
  d.exec('BEGIN IMMEDIATE'); txDepth = 1;
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; } finally { txDepth = 0; }
}
export const J = (v: unknown) => JSON.stringify(v);
export const P = <T = any>(s: string | null | undefined, d: T = null as T): T => (s ? JSON.parse(s) : d);
