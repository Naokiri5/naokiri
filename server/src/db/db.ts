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
let depth = 0;
/** BEGIN IMMEDIATE transaction; a tx() opened inside another becomes a savepoint, so the outer one commits or rolls back all of it. */
export function tx<T>(fn: () => T): T {
  const d = getDb(); const sp = `sp${depth}`; const nested = depth > 0;
  d.exec(nested ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE'); depth++;
  try { const r = fn(); d.exec(nested ? `RELEASE ${sp}` : 'COMMIT'); return r; }
  catch (e) { try { d.exec(nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK'); } catch { /* already rolled back by SQLite */ } throw e; }
  finally { depth--; }
}
export const J = (v: unknown) => JSON.stringify(v);
export const P = <T = any>(s: string | null | undefined, d: T = null as T): T => (s ? JSON.parse(s) : d);
