/**
 * Guardian Shield: opt-in out-of-band alerts for serious security events (GUARD-097).
 *
 * Off by default. When the owner turns it on, each new P0 or P1 Guardian event (newer than the moment alerts were
 * enabled) produces ONE notification through MIA's existing notifier: in-app always, Telegram when configured (P0 is
 * CRITICAL, P1 is WARNING and follows the owner's minimum Telegram severity and quiet hours). At most
 * MAX_ALERTS_PER_HOUR are sent, counted from the stored notifications, so a restart does not reset the cap.
 *
 * Alerts carry the event kind, severity, the sanitized summary and the evidence id: never IPs, tokens or bodies.
 * This module cannot pause, resume, trade, sign or withdraw; it only tells the owner.
 */
import { get, inTransaction, tx } from '../../db/db.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { audit } from '../../core/audit.js';
import { notify } from '../../notify/notify.js';
import type { Assessed } from './response.js';

export const MAX_ALERTS_PER_HOUR = 5;
const ALERT_QUEUED = 'security.guardian.alert_queued';
export interface AlertSettings { telegram: boolean; enabledAt: number | null }
export const alertSettings = (): AlertSettings => getSetting<AlertSettings>('guardian_alerts', { telegram: false, enabledAt: null });
export const alertsEnabled = () => alertSettings().telegram === true;

/** Turn alerts on or off (audited). Turning on starts from now: older events are not replayed as alerts. */
export function setAlerts(on: boolean, nowMs = Date.now()) {
  return tx(() => {
    const before = alertSettings();
    const next: AlertSettings = on ? { telegram: true, enabledAt: before.telegram ? before.enabledAt : nowMs } : { telegram: false, enabledAt: null };
    setSetting('guardian_alerts', next);
    audit('owner', 'security.guardian.alerts', { telegram: on });
    return next;
  });
}

/** Prioritizes P0 over P1, then the oldest evidence, within the shared hourly cap. */
export function alertOnce(items: Assessed[], nowMs = Date.now()): string[] {
  // A nested tx joins the caller, so publishing after it returns would still be pre-commit.
  if (inTransaction()) throw new Error('Guardian alert delivery requires its own transaction');
  const sent: string[] = [];
  const ordered = items.slice().sort((a, b) =>
    a.assessment.severity.localeCompare(b.assessment.severity) || a.event.timestampMs - b.event.timestampMs);
  for (const { event, assessment: { severity } } of ordered) {
    if (severity !== 'P0' && severity !== 'P1') continue;
    const { evidenceId, kind, sanitizedSummary, timestampMs } = event;
    const deferred: { deliver?: () => void } = {};
    const result = tx(() => {
      const settings = alertSettings();
      if (!settings.telegram || settings.enabledAt == null) return 'STOP';
      if (timestampMs < settings.enabledAt) return 'SKIP';
      const lastHour = get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE source='guardian' AND ts > ?", nowMs - 3600_000)!.n;
      if (lastHour >= MAX_ALERTS_PER_HOUR) return 'STOP';

      const alerted = getSetting<string[]>('guardian_alerted_evidence', []);
      if (alerted.includes(evidenceId)) return 'SKIP';
      // The audit proof survives the bounded cache and remains scoped to the canonical evidence ID.
      if (get(`SELECT 1 FROM audit_log WHERE action=? AND actor='guardian'
        AND json_extract(CASE WHEN json_valid(detail) THEN detail END, '$.evidence')=? LIMIT 1`,
      ALERT_QUEUED, evidenceId)) return 'SKIP';

      const notificationId = notify(severity === 'P0' ? 'CRITICAL' : 'WARNING', `Guardian ${severity}: ${kind.replace(/_/g, ' ').toLowerCase()}`,
        `${sanitizedSummary}\nEvidence: ${evidenceId}. Review it in Security Center, Guardian Shield. Guardian can only pause new orders; it never trades, signs or withdraws.`,
        'guardian', (deliver) => { deferred.deliver = deliver; });
      audit('guardian', ALERT_QUEUED, { evidence: evidenceId, notificationId });
      setSetting('guardian_alerted_evidence', [evidenceId, ...alerted].slice(0, 200));
      return 'SENT';
    });
    if (result === 'STOP') break;
    if (result === 'SKIP') continue;
    sent.push(evidenceId);
    try { deferred.deliver?.(); }
    catch { process.emitWarning('Committed Guardian alert could not be broadcast', { code: 'MIA_GUARDIAN_ALERT_DELIVERY' }); }
  }
  return sent;
}
