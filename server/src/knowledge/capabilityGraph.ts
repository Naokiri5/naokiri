// MIA-ID: BRAINOS-CAPABILITY-DEPENDENCY-GRAPH-V6
// Read-only projection over the EXISTING 11+7 capability owners.
// This graph coordinates evidence readiness; it cannot approve orders or grant permissions.
import { CAPABILITY_REFRESH_INTERVAL_MS } from './capabilitySnapshot.js';
import type { BrainCapabilityId, BrainSnapshot } from './brain.js';
import type { SettingsCapabilityId, SettingsCapabilitySnapshot } from './settingsCapabilities.js';

export type CapabilityGraphId = `autopilot.${BrainCapabilityId}` | `settings.${SettingsCapabilityId}`;
export type CapabilityReadiness =
  | 'EVIDENCE_READY' | 'PARTIAL' | 'PAPER_ONLY' | 'OWNER_ACTION'
  | 'DEGRADED' | 'BLOCKED' | 'UNAVAILABLE';

type Mind = 'FAST' | 'DEEP';
type RegistryEntry = { readonly id: string; readonly owner: string; readonly modes?: readonly Mind[] };
export interface CapabilityGraphNode {
  id: CapabilityGraphId;
  group: 'AUTOPILOT' | 'SETTINGS';
  owner: string;
  modes: readonly Mind[];
  dependencies: readonly CapabilityGraphId[];
  readiness: CapabilityReadiness;
  sourceState: string | null;
  observedAt: number | null;
  reason: string;
  tradingAuthority: false;
}
export interface CapabilityNetwork {
  schemaVersion: 'mia.brain.network.v1';
  evaluatedAt: number;
  capabilities: CapabilityGraphNode[];
  blocked: CapabilityGraphId[];
  evidenceReady: CapabilityGraphId[];
  tradingAuthority: false;
  note: string;
}

/** References to existing owners, not additional feature implementations. */
export const CAPABILITY_DEPENDENCIES = {
  'autopilot.overview': [],
  'autopilot.market_terminal': [],
  'autopilot.ai_scanner': ['autopilot.market_terminal'],
  'autopilot.asset_discovery': [],
  'autopilot.market_bubble_map': ['autopilot.market_terminal'],
  'autopilot.whale_launch_monitor': [],
  'autopilot.holder_map': [],
  'autopilot.copy_trading': ['autopilot.holder_map'],
  'autopilot.news_events': [],
  'autopilot.bot_account': [],
  'autopilot.ai_intelligence': ['autopilot.ai_scanner'],
  'settings.risk_center': [],
  'settings.strategy_lab': [],
  'settings.qhef_performance': [],
  'settings.connections_hub': [],
  'settings.notifications': [],
  'settings.security_center': [],
  'settings.release_gates': ['settings.risk_center', 'settings.security_center', 'settings.connections_hub'],
} as const satisfies Record<CapabilityGraphId, readonly CapabilityGraphId[]>;

function asReadiness(state: string | null): CapabilityReadiness {
  switch (state) {
    case 'EVIDENCE_AVAILABLE': return 'EVIDENCE_READY';
    case 'PARTIAL': return 'PARTIAL';
    case 'PAPER_ONLY': return 'PAPER_ONLY';
    case 'NEEDS_OWNER_ACTION': return 'OWNER_ACTION';
    case 'DEGRADED': return 'DEGRADED';
    case 'BLOCKED': return 'BLOCKED';
    default: return 'UNAVAILABLE';
  }
}

function fresh(capturedAt: number | undefined, now: number): boolean {
  return capturedAt !== undefined && Number.isSafeInteger(capturedAt) &&
    capturedAt > 0 && capturedAt <= now &&
    now - capturedAt <= CAPABILITY_REFRESH_INTERVAL_MS * 3;
}

/**
 * Deterministically resolve evidence from the existing leader-refreshed snapshots.
 * Missing, stale, future-dated or dependency-blocked evidence always fails closed.
 */
export function buildCapabilityNetwork(input: {
  at: number;
  autopilot: BrainSnapshot | null;
  settings: SettingsCapabilitySnapshot | null;
  autopilotRegistry: readonly RegistryEntry[];
  settingsRegistry: readonly RegistryEntry[];
}): CapabilityNetwork {
  if (!Number.isSafeInteger(input.at) || input.at <= 0) throw new Error('INVALID_CAPABILITY_GRAPH_TIME');
  const registry = [
    ...input.autopilotRegistry.map(c => ({ ...c, id: `autopilot.${c.id}` as CapabilityGraphId, group: 'AUTOPILOT' as const })),
    ...input.settingsRegistry.map(c => ({ ...c, id: `settings.${c.id}` as CapabilityGraphId, group: 'SETTINGS' as const })),
  ];
  const ids = new Set(registry.map(c => c.id));
  const required = Object.keys(CAPABILITY_DEPENDENCIES);
  if (registry.length !== required.length || ids.size !== required.length ||
      required.some(id => !ids.has(id as CapabilityGraphId))) {
    throw new Error('CAPABILITY_GRAPH_REGISTRY_MISMATCH');
  }

  const autoFresh = fresh(input.autopilot?.capturedAt, input.at);
  const settingsFresh = fresh(input.settings?.capturedAt, input.at);
  const source = new Map<CapabilityGraphId, {
    state: string; reason: string; observedAt: number;
  }>();
  if (autoFresh && input.autopilot) for (const c of input.autopilot.capabilities) {
    source.set(`autopilot.${c.id}`, { state: c.state, reason: c.reason, observedAt: input.autopilot.capturedAt });
  }
  if (settingsFresh && input.settings) for (const c of input.settings.capabilities) {
    source.set(`settings.${c.id}`, { state: c.state, reason: c.reason, observedAt: input.settings.capturedAt });
  }

  const entryById = new Map(registry.map(c => [c.id, c]));
  const nodes = new Map<CapabilityGraphId, CapabilityGraphNode>();
  const visiting = new Set<CapabilityGraphId>();
  const resolve = (id: CapabilityGraphId): CapabilityGraphNode => {
    const existing = nodes.get(id);
    if (existing) return existing;
    if (visiting.has(id)) throw new Error('CAPABILITY_GRAPH_CYCLE');
    const entry = entryById.get(id);
    if (!entry) throw new Error('CAPABILITY_GRAPH_MISSING_DEPENDENCY');
    visiting.add(id);
    const dependencies: readonly CapabilityGraphId[] = CAPABILITY_DEPENDENCIES[id];
    const failed = dependencies.map(resolve).filter(c => c.readiness !== 'EVIDENCE_READY');
    const s = source.get(id);
    let readiness = asReadiness(s?.state ?? null);
    let reason = s?.reason ?? 'Authoritative capability evidence is missing or expired';
    if (readiness === 'EVIDENCE_READY' && failed.length) {
      readiness = 'BLOCKED';
      reason = `Dependency evidence not ready: ${failed.map(c => `${c.id} (${c.readiness})`).join(', ')}`;
    }
    const node: CapabilityGraphNode = {
      id, group: entry.group, owner: entry.owner,
      modes: entry.modes ?? ['FAST', 'DEEP'],
      dependencies, readiness,
      sourceState: s?.state ?? null,
      observedAt: s?.observedAt ?? null,
      reason, tradingAuthority: false,
    };
    visiting.delete(id);
    nodes.set(id, node);
    return node;
  };
  const capabilities = registry.map(c => resolve(c.id));
  return {
    schemaVersion: 'mia.brain.network.v1',
    evaluatedAt: input.at, capabilities,
    blocked: capabilities.filter(c => c.readiness !== 'EVIDENCE_READY').map(c => c.id),
    evidenceReady: capabilities.filter(c => c.readiness === 'EVIDENCE_READY').map(c => c.id),
    tradingAuthority: false,
    note: 'Evidence readiness is NOT execution eligibility. Existing risk, OMS, ledger, exits and LIVE release gates remain authoritative.',
  };
}

/** For autonomous readers only. Never use this as an execution authorization check. */
export function isReadEvidenceReady(network: CapabilityNetwork, id: CapabilityGraphId, mind: Mind): boolean {
  const node = network.capabilities.find(c => c.id === id);
  return !!node && node.modes.includes(mind) && node.readiness === 'EVIDENCE_READY' &&
    !node.tradingAuthority && !network.tradingAuthority;
}
