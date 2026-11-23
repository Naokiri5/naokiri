import { describe, expect, it } from 'vitest';
import { BRAIN_CAPABILITIES, buildBrainSnapshot, type BrainSignals } from '../src/knowledge/brain.js';
import { SETTINGS_CAPABILITIES, buildSettingsCapabilitySnapshot, type SettingsEvidence } from '../src/knowledge/settingsCapabilities.js';
import { buildCapabilityNetwork, CAPABILITY_DEPENDENCIES, isReadEvidenceReady } from '../src/knowledge/capabilityGraph.js';

const NOW = 1_800_000_000_000;
const signals: BrainSignals = {
  now: NOW, tickerAt: NOW - 2_000, scanAt: NOW - 1_000,
  dexAt: NOW - 2_000, tickerCount: 250, dexPairCount: 10,
  newsCount: 2, lastNewsAt: NOW - 10_000,
  largePrintCount: 1, lastLargePrintAt: NOW - 10_000,
};
const evidence: SettingsEvidence = {
  riskPolicyVersion: 1, riskSourceAvailable: true,
  strategies: [{ id: 'existing', status: 'RESEARCH' }],
  measuredLatencyStages: 1,
  providerHealth: { total: 3, live: 2, waiting: 1, unhealthy: 0 },
  notificationRecords: 1,
  securityChecks: { warn: 0, fail: 0 },
  release: { liveAllowed: false, passed: 0, total: 14 },
};
const autopilot = buildBrainSnapshot(signals);
const settings = buildSettingsCapabilitySnapshot(evidence, NOW);
const run = (changes: Partial<Parameters<typeof buildCapabilityNetwork>[0]> = {}) =>
  buildCapabilityNetwork({
    at: NOW, autopilot, settings,
    autopilotRegistry: BRAIN_CAPABILITIES,
    settingsRegistry: SETTINGS_CAPABILITIES,
    ...changes,
  });
const byId = (network: ReturnType<typeof run>, id: string) => {
  const node = network.capabilities.find(c => c.id === id);
  if (!node) throw new Error('missing node ' + id);
  return node;
};

describe('BrainOS canonical capability dependency graph', () => {
  it('unifies exactly 18 real capability owners without a second executor', () => {
    const network = run();
    expect(network.capabilities).toHaveLength(18);
    expect(new Set(network.capabilities.map(c => c.id)).size).toBe(18);
    expect(Object.keys(CAPABILITY_DEPENDENCIES)).toHaveLength(18);
    expect(network.tradingAuthority).toBe(false);
    expect(network.capabilities.every(c => c.tradingAuthority === false)).toBe(true);
    expect(byId(network, 'autopilot.ai_scanner').owner).toBe('market/scanner.ts');
    expect(byId(network, 'settings.risk_center').owner).toContain('risk/gate.ts');
    expect(network.blocked).toContain('autopilot.holder_map');
    expect(network.blocked).toContain('autopilot.copy_trading');
    expect(network.blocked).toContain('settings.release_gates');
  });

  it('fails closed when the leader has not refreshed either evidence group', () => {
    const network = run({ autopilot: null, settings: null });
    expect(network.evidenceReady).toEqual([]);
    expect(network.blocked).toHaveLength(18);
    expect(network.capabilities.every(c => c.readiness === 'UNAVAILABLE')).toBe(true);
    expect(byId(network, 'autopilot.market_terminal').observedAt).toBeNull();
  });

  it('rejects stale and future evidence instead of carrying forward a green state', () => {
    for (const capturedAt of [NOW + 1, NOW - 180_001]) {
      const network = run({ autopilot: { ...autopilot, capturedAt } });
      expect(byId(network, 'autopilot.market_terminal').readiness).toBe('UNAVAILABLE');
      expect(byId(network, 'autopilot.ai_scanner').readiness).toBe('UNAVAILABLE');
    }
  });

  it('propagates dependency failure before a ready-looking downstream probe is usable', () => {
    const altered = {
      ...autopilot,
      capabilities: autopilot.capabilities.map(c =>
        c.id === 'market_terminal' ? { ...c, state: 'WAITING_FOR_DATA' as const } : c),
    };
    const network = run({ autopilot: altered });
    expect(byId(network, 'autopilot.market_terminal').readiness).toBe('UNAVAILABLE');
    expect(byId(network, 'autopilot.ai_scanner').readiness).toBe('BLOCKED');
    expect(byId(network, 'autopilot.ai_intelligence').readiness).toBe('BLOCKED');
    expect(byId(network, 'autopilot.ai_scanner').reason).toContain('autopilot.market_terminal');
  });

  it('does not convert missing owner consent into LIVE release readiness', () => {
    const unlocked = buildSettingsCapabilitySnapshot({ ...evidence,
      riskPolicyVersion: null, release: { liveAllowed: true, passed: 14, total: 14 },
    }, NOW);
    const network = run({ settings: unlocked });
    expect(byId(network, 'settings.risk_center').readiness).toBe('OWNER_ACTION');
    expect(byId(network, 'settings.release_gates').readiness).toBe('BLOCKED');
    expect(isReadEvidenceReady(network, 'settings.release_gates', 'DEEP')).toBe(false);
  });

  it('does not treat PAPER_ONLY, PARTIAL, or unsupported mind evidence as executable', () => {
    const network = run();
    expect(byId(network, 'autopilot.bot_account').readiness).toBe('PAPER_ONLY');
    expect(byId(network, 'autopilot.whale_launch_monitor').readiness).toBe('PARTIAL');
    expect(isReadEvidenceReady(network, 'autopilot.bot_account', 'FAST')).toBe(false);
    expect(isReadEvidenceReady(network, 'autopilot.whale_launch_monitor', 'FAST')).toBe(false);
    expect(isReadEvidenceReady(network, 'autopilot.market_terminal', 'FAST')).toBe(true);
    expect(isReadEvidenceReady(network, 'autopilot.market_bubble_map', 'FAST')).toBe(false);
    expect(isReadEvidenceReady(network, 'autopilot.market_bubble_map', 'DEEP')).toBe(true);
  });

  it('rejects missing, duplicate, and unexpected registry entries', () => {
    expect(() => run({ autopilotRegistry: BRAIN_CAPABILITIES.slice(1) })).toThrow('CAPABILITY_GRAPH_REGISTRY_MISMATCH');
    expect(() => run({ autopilotRegistry: [...BRAIN_CAPABILITIES, BRAIN_CAPABILITIES[0]] })).toThrow('CAPABILITY_GRAPH_REGISTRY_MISMATCH');
    expect(() => run({ at: Number.NaN })).toThrow('INVALID_CAPABILITY_GRAPH_TIME');
    expect(() => run({ at: 0 })).toThrow('INVALID_CAPABILITY_GRAPH_TIME');
  });
});
