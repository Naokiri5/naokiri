import type { DatabaseSync } from 'node:sqlite';
import { all, get, getDb, run } from '../db/db.js';
import { sha256, now } from './util.js';

/** Append-only, hash-chained audit log (tamper-evident; Part 24.8 / 29.8). */
export function audit(actor: string, action: string, detail?: unknown) {
  const prev = get<{ hash: string }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const ts = now();
  const d = detail === undefined ? null : JSON.stringify(detail);
  const hash = sha256(`${prev?.hash ?? 'GENESIS'}|${ts}|${actor}|${action}|${d ?? ''}`);
  run('INSERT INTO audit_log(ts, actor, action, detail, prev_hash, hash) VALUES (?,?,?,?,?,?)', ts, actor, action, d, prev?.hash ?? null, hash);
}
export function verifyAuditChain(db: DatabaseSync = getDb()) {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  let prev = 'GENESIS';
  for (const r of rows) {
    const h = sha256(`${prev}|${r.ts}|${r.actor}|${r.action}|${r.detail ?? ''}`);
    if (h !== r.hash) return { ok: false, brokenAt: r.id, entries: rows.length };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
}
export function recentAudit(limit = 100) {
  return all('SELECT id, ts, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?', limit);
}
