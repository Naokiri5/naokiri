import { get, run } from '../db/db.js';
export function getSetting<T>(key: string, dflt: T): T {
  const r = get<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
  return r ? (JSON.parse(r.value) as T) : dflt;
}
export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    key, JSON.stringify(value), Date.now());
}

/**
 * Reads a validated setting without throwing: malformed JSON or a wrong shape are reported as invalid, never as absent,
 * so callers that gate on stored state can fail closed. A missing key is { value: null, invalid: false }.
 */
export function readValidatedSetting<T>(key: string, valid: (v: unknown) => v is T): { value: T | null; invalid: boolean } {
  let raw: unknown;
  try { raw = getSetting<unknown>(key, null); } catch { return { value: null, invalid: true }; }
  if (raw === null) return { value: null, invalid: false };
  return valid(raw) ? { value: raw, invalid: false } : { value: null, invalid: true };
}
