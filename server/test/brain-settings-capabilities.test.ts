import { describe, expect, it } from 'vitest';
import {
  SETTINGS_CAPABILITIES,
  buildSettingsCapabilitySnapshot,
  type SettingsEvidence,
} from '../src/knowledge/settingsCapabilities.js';

const NOW = 1_800_000_000_000;
const baseline: SettingsEvidence = {
  riskPolicyVersion: null,
  riskSourceAvailable: true,
  strategies: [{ id: 'trend_pullback', status: 'RESEARCH' }],
  measuredLatencyStages: 4,
  providerHealth: { total: 7, live: 3, unhealthy: 0, waiting: 4 },
  notificationRecords: 2,
  securityChecks: { fail: 0, warn: 1 },
  release: { liveAllowed: false, passed: 4, total: 14 },
};

const byId = (s: SettingsEvidence, id: string) => {
  const result = buildSettingsCapabilitySnapshot(s, NOW).capabilities.find((x) => x.id === id);
  if (!result) throw new Error('Unknown Settings capability ' + id);
  return result;
};

describe('MIA BrainOS seven Settings capabilities', () => {
  it('maps exactly seven unique settings tools without a second trading authority', () => {
    expect(SETTINGS_CAPABILITIES).toHaveLength(7);
    expect(new Set(SETTINGS_CAPABILITIES.map((c) => c.id)).size).toBe(7);
    const s = buildSettingsCapabilitySnapshot(baseline, NOW);
    expect(s.capabilities).toHaveLength(7);
    expect(s.tradingAuthority).toBe(false);
    expect(s.capabilities.every((x) => x.tradingAuthority === false)).toBe(true);
    expect(s.capabilities.map((x) => x.id)).toEqual([
      'risk_center', 'strategy_lab', 'qhef_performance', 'connections_hub',
      'notifications', 'security_center', 'release_gates',
    ]);
  });

  it('never silently accepts missing risk policy or unlocks live execution', () => {
    expect(byId(baseline, 'risk_center').state).toBe('NEEDS_OWNER_ACTION');
    expect(byId(baseline, 'release_gates').state).toBe('BLOCKED');
    expect(byId(baseline, 'release_gates').reason).toContain('4/14');
    expect(byId({ ...baseline, riskPolicyVersion: 3 }, 'risk_center').state).toBe('EVIDENCE_AVAILABLE');
    expect(byId({ ...baseline, riskSourceAvailable: false }, 'risk_center').state).toBe('UNAVAILABLE');
  });

  it('reports available strategies, performance, and notifications without promoting or sending anything', () => {
    expect(byId(baseline, 'strategy_lab').state).toBe('EVIDENCE_AVAILABLE');
    expect(byId(baseline, 'strategy_lab').reason).toContain('never promote');
    expect(byId(baseline, 'qhef_performance').state).toBe('EVIDENCE_AVAILABLE');
    expect(byId(baseline, 'notifications').state).toBe('EVIDENCE_AVAILABLE');
    expect(byId({ ...baseline, strategies: [] }, 'strategy_lab').state).toBe('OBSERVING');
    expect(byId({ ...baseline, measuredLatencyStages: 0 }, 'qhef_performance').state).toBe('OBSERVING');
    expect(byId({ ...baseline, notificationRecords: 0 }, 'notifications').state).toBe('OBSERVING');
  });

  it('surfaces broken providers and security checks rather than granting more permissions', () => {
    expect(byId(baseline, 'connections_hub').state).toBe('EVIDENCE_AVAILABLE');
    expect(byId({ ...baseline, providerHealth: { total: 7, live: 2, unhealthy: 1, waiting: 4 } }, 'connections_hub').state).toBe('DEGRADED');
    expect(byId({ ...baseline, securityChecks: { fail: 1, warn: 0 } }, 'security_center').state).toBe('DEGRADED');
    expect(byId(baseline, 'security_center').state).toBe('OBSERVING');
  });

  it('fails to unavailable for missing sources and rejects malformed clocks', () => {
    const missing: SettingsEvidence = {
      riskPolicyVersion: null, riskSourceAvailable: false,
      strategies: null, measuredLatencyStages: null, providerHealth: null,
      notificationRecords: null, securityChecks: null, release: null,
    };
    const result = buildSettingsCapabilitySnapshot(missing, NOW);
    expect(result.capabilities.every((x) => x.state === 'UNAVAILABLE')).toBe(true);
    expect(() => buildSettingsCapabilitySnapshot(baseline, 0)).toThrow('INVALID_SETTINGS_SNAPSHOT_TIME');
    expect(() => buildSettingsCapabilitySnapshot(baseline, Number.NaN)).toThrow('INVALID_SETTINGS_SNAPSHOT_TIME');
  });
});
