/**
 * Guardian Shield background pass, once a minute: the opt-in auto-pause (response.ts) and the opt-in alerts (alerts.ts).
 * The timer always runs (unref'd) so either option can be switched on without a restart; a pass reads the audit log
 * only when at least one option is on. A Guardian fault must never affect trading or the server.
 */
import { assessAll, autoContain, autoPauseEnabled } from './response.js';
import { alertOnce, alertsEnabled } from './alerts.js';

export function guardianPass(nowMs = Date.now()) {
  const pause = autoPauseEnabled();
  let alerts = false;
  try { alerts = alertsEnabled(); }
  catch { process.emitWarning('Guardian alert settings could not be read', { code: 'MIA_GUARDIAN_ALERT_SETTINGS' }); }
  if (!pause && !alerts) return { containment: null, alerted: [] as string[] };
  const items = assessAll(nowMs);
  let containment: ReturnType<typeof autoContain> | null = null;
  let alerted: string[] = [];
  if (pause) {
    try { containment = autoContain(items); }
    catch { process.emitWarning('Guardian containment failed and will retry', { code: 'MIA_GUARDIAN_CONTAINMENT' }); }
  }
  if (alerts) {
    try { alerted = alertOnce(items, nowMs); }
    catch { process.emitWarning('Guardian alerts failed and will retry', { code: 'MIA_GUARDIAN_ALERTS' }); }
  }
  return { containment, alerted };
}

let timer: NodeJS.Timeout | null = null;
export function startGuardian(intervalMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    try { guardianPass(); }
    catch { process.emitWarning('Guardian evidence pass failed and will retry', { code: 'MIA_GUARDIAN_SCAN' }); }
  }, intervalMs);
  timer.unref();
}
export function stopGuardian() { if (timer) clearInterval(timer); timer = null; }
