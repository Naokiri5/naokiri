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
import { get, tx } from '../../db/db.js';
import { getSetting, setSetting } from '../../core/settings.js';
import { audit } from '../../core/audit.js';
import { notify } from '../../notify/notify.js';
import type { Assessed } from './response.js';

export const MAX_ALERTS_PER_HOUR = 5;
export interface AlertSettings { telegram: boolean; enabledAt: number | null }
export const alertSettings = (): AlertSettings => getSetting<AlertSettings>('guardian_alerts', { telegram: false, enabledAt: null });
export const alertsEnabled = () => alertSettings().telegram === true;

/** Turn alerts on or off (audited). Turning on starts from now: older events are not replayed as alerts. */
export function setAlerts(on: boolean, nowMs = Date.now()) {
  const before = alertSettings();
  const next: AlertSettings = on ? { telegram: true, enabledAt: before.telegram ? before.enabledAt : nowMs } : { telegram: false, enabledAt: null };
  setSetting('guardian_alerts', next);
  audit('owner', 'security.guardian.alerts', { telegram: on });
  return next;
}

/** Sends at most one alert per P0/P1 evidence id, oldest first, within the hourly cap. Returns the evidence ids alerted. */
export function alertOnce(items: Assessed[], nowMs = Date.now()): string[] {
  const s = alertSettings();
  if (!s.telegram || s.enabledAt == null) return [];
  const sent: string[] = [];
  for (const i of items) {
    if (i.assessment.severity !== 'P0' && i.assessment.severity !== 'P1') continue;
    if (i.event.timestampMs < s.enabledAt) continue;
    const alerted = getSetting<string[]>('guardian_alerted_evidence', []);
    if (alerted.includes(i.event.evidenceId)) continue;
    const lastHour = get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE source='guardian' AND ts > ?", nowMs - 3600_000)!.n;
    if (lastHour >= MAX_ALERTS_PER_HOUR) break;
    const sev = i.assessment.severity;
    // The marker and the notification row commit together, so an alert is neither lost nor sent twice.
    tx(() => {
      setSetting('guardian_alerted_evidence', [i.event.evidenceId, ...alerted].slice(0, 200));
      notify(sev === 'P0' ? 'CRITICAL' : 'WARNING', `Guardian ${sev}: ${i.event.kind.replace(/_/g, ' ').toLowerCase()}`,
        `${i.event.sanitizedSummary}\nEvidence: ${i.event.evidenceId}. Review it in Security Center, Guardian Shield. Guardian can only pause new orders; it never trades, signs or withdraws.`,
        'guardian');
    });
    sent.push(i.event.evidenceId);
  }
  return sent;
}
