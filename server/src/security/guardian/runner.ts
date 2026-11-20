/**
 * Guardian Shield background pass, once a minute: the opt-in auto-pause (response.ts) and the opt-in alerts (alerts.ts).
 * The timer always runs (unref'd) so either option can be switched on without a restart; a pass reads the audit log
 * only when at least one option is on. A Guardian fault must never affect trading or the server.
 */
import { assessAll, autoContain, autoPauseEnabled } from './response.js';
import { alertOnce, alertsEnabled } from './alerts.js';

export function guardianPass(nowMs = Date.now()) {
  const pause = autoPauseEnabled(); const alerts = alertsEnabled();
  if (!pause && !alerts) return { containment: null, alerted: [] as string[] };
  const items = assessAll(nowMs);
  return { containment: pause ? autoContain(items) : null, alerted: alerts ? alertOnce(items, nowMs) : [] };
}

let timer: NodeJS.Timeout | null = null;
export function startGuardian(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => { try { guardianPass(); } catch { /* never affect trading or the server */ } }, intervalMs);
  timer.unref();
}
export function stopGuardian() { if (timer) clearInterval(timer); timer = null; }
