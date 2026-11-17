import { all, get } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from './audit.js';
import { reconcile } from '../portfolio/calendar.js';

export interface StartupCheck { id: string; status: 'PASS' | 'FAIL'; detail: string }
export interface StartupReport { ok: boolean; checks: StartupCheck[] }

/** Database schema version this process sees (null when unreadable). */
export function schemaVersion() {
  try { return get<{ v: number | null }>('SELECT MAX(version) v FROM schema_migrations')?.v ?? null; } catch { return null; }
}

const CHECKS: [string, () => string | null][] = [
  ['db_integrity', () => {
    const q = all<any>('PRAGMA quick_check').map((r) => Object.values(r)[0]);
    if (q.length !== 1 || q[0] !== 'ok') return `quick_check: ${q.slice(0, 3).join('; ')}`;
    const fk = all('PRAGMA foreign_key_check');
    return fk.length ? `${fk.length} foreign key violation(s)` : null;
  }],
  ['schema', () => {
    const v = schemaVersion();
    return v === SCHEMA_VERSION ? null : v != null && v > SCHEMA_VERSION ? `database is newer than this build (${v} > ${SCHEMA_VERSION})` : `schema version ${v} != ${SCHEMA_VERSION}`;
  }],
  ['audit_chain', () => { const a = verifyAuditChain(); return a.ok ? null : `hash chain broken at entry ${a.brokenAt}`; }],
  ['ledger_reconcile', () => { const r = reconcile(); return r.ok ? null : r.detail; }],
  ['protective_stops', () => {
    const bad = all<{ id: string; n: number }>(`SELECT p.id, COUNT(o.id) n FROM positions p LEFT JOIN orders o ON o.position_id=p.id AND o.purpose='PROTECTIVE_STOP' AND o.status='ACTIVE'
      AND ABS(o.qty-p.qty) < 1e-9 AND o.stop_price=p.stop_price WHERE p.status='OPEN' GROUP BY p.id HAVING n != 1`);
    const extra = all<{ id: string }>(`SELECT p.id FROM positions p JOIN orders o ON o.position_id=p.id AND o.purpose='PROTECTIVE_STOP' AND o.status='ACTIVE' WHERE p.status='OPEN' GROUP BY p.id HAVING COUNT(*) > 1`);
    const ids = [...new Set([...bad, ...extra].map((r) => r.id))];
    return ids.length ? `${ids.length} open position(s) without exactly one matching active protective stop: ${ids.slice(0, 5).join(', ')}` : null;
  }],
];

let report: StartupReport | null = null;
/** Ticket 013: verify the database before the engine may schedule anything. Nothing is auto-repaired. */
export function runStartupChecks(): StartupReport {
  const checks = CHECKS.map(([id, fn]): StartupCheck => {
    try { const err = fn(); return { id, status: err ? 'FAIL' : 'PASS', detail: err ?? 'ok' }; }
    catch (e: any) { return { id, status: 'FAIL', detail: String(e?.message ?? e).slice(0, 200) }; }
  });
  return (report = { ok: checks.every((c) => c.status === 'PASS'), checks });
}
export const startupReport = () => report;
