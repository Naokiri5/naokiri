/**
 * Guardian containment dispatcher: a strict allowlist of NEGATIVE actions only.
 *
 * The only action it can take by itself is "pause new orders" (the same risk-reducing control as the Pause button and
 * Trader Joe's pause tool), and only when the owner opted in with MIA_GUARDIAN_AUTOPAUSE=1. It:
 *  - never resumes trading, clears an emergency, changes a limit or mode, or touches positions (exits stay protected);
 *  - never signs, withdraws, moves funds or revokes anything on its own;
 *  - acts once per piece of evidence, so an owner who reviewed and resumed is not paused again for the same event;
 *  - writes every action to the audit log.
 * Static imports: this module may use core/mode only — never the OMS, wallet, signer or any network client.
 */
import { getSetting, setSetting } from '../../core/settings.js';
import { getControl, updateControl } from '../../core/mode.js';
import { audit } from '../../core/audit.js';
import { all, inTransaction, tx } from '../../db/db.js';
import { assessSecurityEvent, type GuardianAssessment, type GuardianEvent } from './assess.js';
import { collectEvents } from './events.js';

export const autoPauseEnabled = () => process.env.MIA_GUARDIAN_AUTOPAUSE === '1';
export const GUARDIAN_ACTIONS = ['PAUSE_NEW_ORDERS'] as const;
const HANDLED_CACHE_SIZE = 200;

export interface Assessed { event: GuardianEvent; assessment: GuardianAssessment }
export function assessAll(nowMs = Date.now()): Assessed[] {
  return collectEvents(nowMs).map((event) => ({ event, assessment: assessSecurityEvent(event, nowMs) }));
}

/** Pauses new orders for the newest unhandled P0 that asks for it, if auto-pause is enabled. Idempotent. */
type Containment = { action: 'NONE' | 'PAUSED' | 'ALREADY_PAUSED' | 'DISABLED'; evidenceId?: string };
export function autoContain(items: Assessed[] = assessAll()): Containment {
  const targets = items.filter(i => i.assessment.severity === 'P0' && i.assessment.suggestions.includes('PAUSE_NEW_EXPOSURE_REQUEST'));
  if (!targets.length) return { action: 'NONE' };
  if (!autoPauseEnabled()) return { action: 'DISABLED', evidenceId: targets[0].event.evidenceId };
  // A joined transaction would publish before its caller commits.
  if (inTransaction()) throw new Error('Guardian containment requires its own transaction');

  const deferred: { publish?: () => void } = {};
  const deferPublish = (publish: () => void) => { deferred.publish = publish; };
  const result = tx<Containment>(() => {
    const handled = getSetting<string[]>('guardian_handled_evidence', []);
    const handledIds = new Set(handled);
    if (handled.length >= HANDLED_CACHE_SIZE) {
      // A handled event can still be in the scan after it falls out of the settings cache.
      const audited = all<{ evidence: string | null }>(`
        SELECT json_extract(CASE WHEN json_valid(detail) THEN detail ELSE '{}' END, '$.evidence') AS evidence
        FROM audit_log WHERE actor='guardian' AND action IN ('security.guardian.pause', 'security.guardian.p0_already_paused')
      `);
      for (const row of audited) if (row.evidence) handledIds.add(row.evidence);
    }
    const target = targets.find(i => !handledIds.has(i.event.evidenceId));
    if (!target) return { action: 'NONE' };
    const { evidenceId, kind } = target.event;
    const alreadyPaused = getControl().pausedNewOrders;
    if (!alreadyPaused) {
      updateControl('guardian', { pausedNewOrders: true }, undefined, deferPublish);
    }
    audit('guardian', alreadyPaused ? 'security.guardian.p0_already_paused' : 'security.guardian.pause', { kind, evidence: evidenceId });
    setSetting('guardian_handled_evidence', [evidenceId, ...handled].slice(0, HANDLED_CACHE_SIZE));
    return { action: alreadyPaused ? 'ALREADY_PAUSED' : 'PAUSED', evidenceId };
  });
  deferred.publish?.();
  return result;
}

let timer: NodeJS.Timeout | null = null;
/** Background check every minute, only when auto-pause is enabled. */
export function startGuardian(intervalMs = 60_000) {
  if (timer || !autoPauseEnabled()) return;
  timer = setInterval(() => { try { autoContain(); } catch { /* a Guardian fault must never affect trading or the server */ } }, intervalMs);
  timer.unref();
}
export function stopGuardian() { if (timer) clearInterval(timer); timer = null; }
