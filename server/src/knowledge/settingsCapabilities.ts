import { currentPolicy } from '../risk/policy.js';
import { listStrategies } from '../lab/lab.js';
import { latencyReport } from '../core/latency.js';
import { providers } from '../providers/http.js';
import { listNotifications } from '../notify/notify.js';
import { securityOverview } from '../security/security.js';
import { releaseGates } from '../qa/gates.js';

/**
 * The seven Settings screens are advisory capabilities of the existing MIA core.
 * All policy changes, credentials, strategy promotion, and LIVE authorization
 * continue to be owned by their existing, authenticated services.
 */
export const SETTINGS_CAPABILITIES = [
  { id: 'risk_center', owner: 'risk/gate.ts + risk/policy.ts', automation: 'AUTOMATIC_VETO_OWNER_POLICY' },
  { id: 'strategy_lab', owner: 'lab/lab.ts', automation: 'AUTOMATIC_HEALTH_SUSPENSION_OWNER_PROMOTION' },
  { id: 'qhef_performance', owner: 'qhef/qhef.ts + core/latency.ts', automation: 'AUTOMATIC_MEASUREMENT' },
  { id: 'connections_hub', owner: 'providers/http.ts', automation: 'AUTOMATIC_HEALTH_TRACKING' },
  { id: 'notifications', owner: 'notify/notify.ts', automation: 'AUTOMATIC_ALERT_ROUTING' },
  { id: 'security_center', owner: 'security/security.ts', automation: 'AUTOMATIC_CHECKS_OWNER_REMEDIATION' },
  { id: 'release_gates', owner: 'qa/gates.ts', automation: 'AUTOMATIC_EVALUATION_OWNER_RELEASE' },
] as const;

export type SettingsCapabilityId = typeof SETTINGS_CAPABILITIES[number]['id'];
export type SettingsCapabilityState =
  | 'OBSERVING' | 'EVIDENCE_AVAILABLE' | 'NEEDS_OWNER_ACTION' | 'DEGRADED' | 'BLOCKED' | 'UNAVAILABLE';

export interface SettingsEvidence {
  /** Null means the authoritative source failed, not "zero findings". */
  riskPolicyVersion: number | null;
  riskSourceAvailable: boolean;
  strategies: { id: string; status: string }[] | null;
  measuredLatencyStages: number | null;
  providerHealth: { total: number; live: number; unhealthy: number; waiting: number } | null;
  notificationRecords: number | null;
  securityChecks: { fail: number; warn: number } | null;
  release: { liveAllowed: boolean; passed: number; total: number } | null;
}

export interface SettingsCapabilityView {
  id: SettingsCapabilityId;
  owner: string;
  automation: string;
  state: SettingsCapabilityState;
  reason: string;
  tradingAuthority: false;
}

export interface SettingsCapabilitySnapshot {
  schemaVersion: 'mia.brain.settings.v1';
  capturedAt: number;
  tradingAuthority: false;
  capabilities: SettingsCapabilityView[];
  note: string;
}

/** An unavailable dependency must never be silently presented as healthy. */
function safelyRead<T>(read: () => T): { available: true; value: T } | { available: false; value: null } {
  try { return { available: true, value: read() }; }
  catch { return { available: false, value: null }; }
}

/**
 * Uses existing canonical data owners. No additional scheduler, risk engine,
 * notification, database authority, or external call is created here.
 */
export function collectSettingsEvidence(): SettingsEvidence {
  const risk = safelyRead(() => currentPolicy()?.version ?? null);
  const strategies = safelyRead(() => listStrategies().map((s) => ({ id: String(s.id), status: String(s.status) })));
  const latency = safelyRead(() => latencyReport().filter((s) => s.samples > 0).length);
  const sources = safelyRead(() => {
    const p = providers();
    return {
      total: p.length,
      live: p.filter((x) => x.status === 'LIVE').length,
      unhealthy: p.filter((x) => x.status === 'DOWN' || x.status === 'DEGRADED').length,
      waiting: p.filter((x) => x.status === 'IDLE' || x.status === 'PENDING_CREDENTIALS').length,
    };
  });
  const notifications = safelyRead(() => listNotifications(20).length);
  const security = safelyRead(() => {
    const s = securityOverview().summary;
    return { fail: s.fail, warn: s.warn };
  });
  const gates = safelyRead(() => {
    const g = releaseGates();
    return { liveAllowed: g.liveAllowed, passed: g.gates.filter((x) => x.status === 'PASS').length, total: g.gates.length };
  });
  return {
    riskPolicyVersion: risk.value,
    riskSourceAvailable: risk.available,
    strategies: strategies.value,
    measuredLatencyStages: latency.value,
    providerHealth: sources.value,
    notificationRecords: notifications.value,
    securityChecks: security.value,
    release: gates.value,
  };
}

/** Pure deterministic projection; no automatic approval, promotion or live unlock. */
export function buildSettingsCapabilitySnapshot(
  evidence: SettingsEvidence,
  now = Date.now(),
): SettingsCapabilitySnapshot {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_SETTINGS_SNAPSHOT_TIME');
  const state = (id: SettingsCapabilityId): [SettingsCapabilityState, string] => {
    switch (id) {
      case 'risk_center':
        if (!evidence.riskSourceAvailable) return ['UNAVAILABLE', 'Authoritative risk policy store could not be read'];
        return evidence.riskPolicyVersion != null
          ? ['EVIDENCE_AVAILABLE', 'Versioned owner-accepted policy exists; deterministic risk gate remains the authority']
          : ['NEEDS_OWNER_ACTION', 'No owner-accepted risk policy; paper entries remain blocked until owner approval'];
      case 'strategy_lab':
        if (!evidence.strategies) return ['UNAVAILABLE', 'Strategy registry could not be read'];
        return evidence.strategies.length
          ? ['EVIDENCE_AVAILABLE', 'Strategy registry available; existing health monitor may auto-suspend deteriorating PAPER strategies, never promote them']
          : ['OBSERVING', 'No registered strategies; strategy promotion is never automatic'];
      case 'qhef_performance':
        if (evidence.measuredLatencyStages == null) return ['UNAVAILABLE', 'Canonical latency telemetry unavailable'];
        return evidence.measuredLatencyStages > 0
          ? ['EVIDENCE_AVAILABLE', 'Recorded latency samples available; QHEF budget evaluation remains in its canonical service']
          : ['OBSERVING', 'Telemetry collection ready; no measured latency stages yet'];
      case 'connections_hub': {
        const p = evidence.providerHealth;
        if (!p) return ['UNAVAILABLE', 'Provider registry could not be read'];
        if (p.unhealthy) return ['DEGRADED', 'At least one provider reports DOWN or DEGRADED; no automatic credential changes'];
        return p.live
          ? ['EVIDENCE_AVAILABLE', 'Some providers report LIVE; unavailable or unconfigured integrations are not promoted to operational']
          : ['OBSERVING', 'No provider currently reports LIVE; connection health remains under monitoring'];
      }
      case 'notifications':
        if (evidence.notificationRecords == null) return ['UNAVAILABLE', 'Notification history unavailable'];
        return evidence.notificationRecords > 0
          ? ['EVIDENCE_AVAILABLE', 'Canonical notification records exist; individual delivery statuses must be checked separately']
          : ['OBSERVING', 'Notification subsystem registered; no recent notification records'];
      case 'security_center':
        if (!evidence.securityChecks) return ['UNAVAILABLE', 'Canonical security checks unavailable'];
        if (evidence.securityChecks.fail > 0) return ['DEGRADED', 'Security checks report failures; owner remediation required for sensitive settings'];
        return evidence.securityChecks.warn > 0
          ? ['OBSERVING', 'Security checks report warnings; no automatic weakening of protection']
          : ['EVIDENCE_AVAILABLE', 'Current security checks report no failures or warnings; not an independent audit certificate'];
      case 'release_gates':
        if (!evidence.release) return ['UNAVAILABLE', 'Release-gate evaluator unavailable'];
        return evidence.release.liveAllowed
          ? ['EVIDENCE_AVAILABLE', 'Release evaluator reports eligibility; live execution still requires owner authorization and venue readiness']
          : ['BLOCKED', `Live execution locked: ${evidence.release.passed}/${evidence.release.total} existing release gates passed`];
    }
  };
  return {
    schemaVersion: 'mia.brain.settings.v1',
    capturedAt: now,
    tradingAuthority: false,
    capabilities: SETTINGS_CAPABILITIES.map((c) => {
      const [capabilityState, reason] = state(c.id);
      return {
        id: c.id, owner: c.owner, automation: c.automation, state: capabilityState, reason,
        tradingAuthority: false as const,
      };
    }),
    note: 'Settings engines self-monitor inside MIA. Owner still approves risk policy, account permissions, strategy promotion, live trading and recovery from critical security states.',
  };
}

let latest: SettingsCapabilitySnapshot | null = null;

/** Read-only sampling during the existing leader-owned background pass. */
export function refreshSettingsCapabilitySnapshot(now = Date.now()): SettingsCapabilitySnapshot {
  latest = buildSettingsCapabilitySnapshot(collectSettingsEvidence(), now);
  return latest;
}

export function settingsCapabilityOverview() {
  return {
    registry: SETTINGS_CAPABILITIES,
    latest,
    status: latest ? 'REFRESHED' as const : 'NOT_YET_REFRESHED' as const,
  };
}

/** Test isolation only. */
export function _resetSettingsCapabilitySnapshotForTests() { latest = null; }
