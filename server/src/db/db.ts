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
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(); d.exec('COMMIT'); return r; } catch (e) { d.exec('ROLLBACK'); throw e; }
}
export const J = (v: unknown) => JSON.stringify(v);
export const P = <T = any>(s: string | null | undefined, d: T = null as T): T => (s ? JSON.parse(s) : d);
