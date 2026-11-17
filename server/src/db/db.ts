import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config, ensureDataDir } from '../config.js';
import { migrate } from './migrations.js';

let db: DatabaseSync | null = null;

export function openDb(file?: string) {
  if (db) return db;
  let path = file;
  if (!path) { ensureDataDir(); path = join(config.dataDir, 'mia.db'); }
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}
export function getDb() { return db ?? openDb(); }
export function closeDb() { db?.close(); db = null; }

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
