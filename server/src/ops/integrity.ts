import { all, get } from '../db/db.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { verifyAuditChain } from '../core/audit.js';
import { reconcile } from '../portfolio/calendar.js';
import { protectPositions } from '../exec/oms.js';
import { verifyMemory } from '../ditas/memory.js';
import type { VerifyResult } from './backup.js';

type IntegrityCheck = VerifyResult['checks'][number];

/**
 * Live-database checks run before this process takes over the engine (holdEngine in bot/bot.ts). Same check shape as
 * verifyBackup, but on the open database and built from the existing verifiers. Nothing is repaired: a failure means
 * no scheduler runs until the owner investigates. Protective stops are checked as records only (present, matching
 * qty and stop); price and book freshness belong to the position monitor and are usually cold at takeover.
 */
export function takeoverIntegrity(): { ok: boolean; checks: IntegrityCheck[] } {
  const checks: IntegrityCheck[] = [];
  const add = (name: string, fn: () => [boolean, string]) => {
    try { const [ok, detail] = fn(); checks.push({ name, ok, detail }); }
    catch (e: any) { checks.push({ name, ok: false, detail: `check failed: ${String(e?.message ?? e).slice(0, 200)}` }); }
  };
  add('quick_check', () => {
    const r = all<{ quick_check: string }>('PRAGMA quick_check').map((x) => x.quick_check);
    return [r.length === 1 && r[0] === 'ok', r.slice(0, 3).join('; ')];
  });
  add('schema', () => {
    const v = get<{ v: number | null }>('SELECT MAX(version) v FROM schema_migrations')?.v ?? 0;
    return [v === SCHEMA_VERSION, `v${v} (code v${SCHEMA_VERSION})`];
  });
  add('audit chain', () => { const a = verifyAuditChain(); return [a.ok, a.ok ? `${a.entries} entries` : `broken at entry ${a.brokenAt}`]; });
  add('decision memory chain', () => { const d = verifyMemory(); return [d.ok, d.ok ? `${d.entries} events` : `broken at ${d.brokenAt}`]; });
  add('ledger reconcile', () => { const r = reconcile(); return [r.ok, r.detail]; });
  add('protective stops', () => {
    const bad = protectPositions().positions.filter((p) => p.issue === 'no active protective stop' || p.issue === 'stop/qty mismatch');
    return [bad.length === 0, bad.length ? `${bad.length} open position(s) without a matching active stop: ${bad.slice(0, 5).map((p) => p.positionId).join(', ')}` : 'every open position has a matching active stop'];
  });
  return { ok: checks.every((c) => c.ok), checks };
}
