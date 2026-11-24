import { all, get, run, tx } from '../db/db.js';
import { sha256, now } from './util.js';

/** Append-only, hash-chained audit log (tamper-evident; Part 24.8 / 29.8). */
export function audit(actor: string, action: string, detail?: unknown) {
  tx(() => {
    const prev = get<{ hash: string }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const ts = now();
    const d = detail === undefined ? null : JSON.stringify(detail);
    const hash = sha256(`${prev?.hash ?? 'GENESIS'}|${ts}|${actor}|${action}|${d ?? ''}`);
    run('INSERT INTO audit_log(ts, actor, action, detail, prev_hash, hash) VALUES (?,?,?,?,?,?)', ts, actor, action, d, prev?.hash ?? null, hash);
  });
}
/** Verifies both stored predecessor links and recomputed hashes (legacy hash format preserved). `rows` lets a backup check verify a snapshot's rows without touching the live database. */
export function verifyAuditChain(rows: any[] = all<any>('SELECT * FROM audit_log ORDER BY id')) {
  let prev = 'GENESIS';
  for (const r of rows) {
    const h = sha256(`${prev}|${r.ts}|${r.actor}|${r.action}|${r.detail ?? ''}`);
    if (r.prev_hash !== (prev === 'GENESIS' ? null : prev) || h !== r.hash) return { ok: false, brokenAt: r.id, entries: rows.length };
    prev = r.hash;
  }
  return { ok: true, entries: rows.length };
}
export function recentAudit(limit = 100) {
  return all('SELECT id, ts, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?', limit);
}
