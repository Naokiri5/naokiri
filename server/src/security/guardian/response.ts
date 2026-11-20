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
import { tx } from '../../db/db.js';
import { assessSecurityEvent, type GuardianAssessment, type GuardianEvent } from './assess.js';
import { collectEvents } from './events.js';

export const autoPauseEnabled = () => process.env.MIA_GUARDIAN_AUTOPAUSE === '1';
export const GUARDIAN_ACTIONS = ['PAUSE_NEW_ORDERS'] as const;

export interface Assessed { event: GuardianEvent; assessment: GuardianAssessment }
export function assessAll(nowMs = Date.now()): Assessed[] {
  return collectEvents(nowMs).map((event) => ({ event, assessment: assessSecurityEvent(event, nowMs) }));
}

/** Pauses new orders for the newest unhandled P0 that asks for it, if auto-pause is enabled. Idempotent. */
export function autoContain(items: Assessed[] = assessAll()): { action: 'NONE' | 'PAUSED' | 'ALREADY_PAUSED' | 'DISABLED'; evidenceId?: string } {
  const wantsPause = (i: Assessed) => i.assessment.severity === 'P0' && i.assessment.suggestions.includes('PAUSE_NEW_EXPOSURE_REQUEST');
  if (!items.some(wantsPause)) return { action: 'NONE' };
  if (!autoPauseEnabled()) return { action: 'DISABLED', evidenceId: items.find(wantsPause)!.event.evidenceId };
  const handled = getSetting<string[]>('guardian_handled_evidence', []);
  // Skip evidence already handled, so an older unhandled P0 is still contained when a newer one was (CodeRabbit #45).
  const target = items.find((i) => wantsPause(i) && !handled.includes(i.event.evidenceId));
  if (!target) return { action: 'NONE' };
  const evidence = target.event.evidenceId;
  // One transaction: if the pause write fails, the handled marker rolls back and the next tick retries (CodeRabbit #45).
  return tx(() => {
    setSetting('guardian_handled_evidence', [evidence, ...handled].slice(0, 200));
    if (getControl().pausedNewOrders) {
      audit('guardian', 'security.guardian.p0_already_paused', { kind: target.event.kind, evidence });
      return { action: 'ALREADY_PAUSED' as const, evidenceId: evidence };
    }
    updateControl('guardian', { pausedNewOrders: true }); // risk-reducing; only the owner can resume
    audit('guardian', 'security.guardian.pause', { kind: target.event.kind, evidence });
    return { action: 'PAUSED' as const, evidenceId: evidence };
  });
}

let timer: NodeJS.Timeout | null = null;
/** Background check every minute, only when auto-pause is enabled. */
export function startGuardian(intervalMs = 60_000) {
  if (timer || !autoPauseEnabled()) return;
  timer = setInterval(() => { try { autoContain(); } catch { /* a Guardian fault must never affect trading or the server */ } }, intervalMs);
  timer.unref();
}
export function stopGuardian() { if (timer) clearInterval(timer); timer = null; }
