import { get, run } from '../db/db.js';
export function getSetting<T>(key: string, dflt: T): T {
  const r = get<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
  return r ? (JSON.parse(r.value) as T) : dflt;
}
export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    key, JSON.stringify(value), Date.now());
}
