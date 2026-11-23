/**
 * MIA NEXUS fabric topic catalog (N1). One entry per canonical topic from the NEXUS Ω V3 spec (V3-04.4), each with
 * its SOLE owner (the existing file that writes the authoritative state), consumers, priority, durability, retention,
 * access class and payload limit — and an honest implementation status:
 *  - ACTIVE_BEST_EFFORT     the owner already publishes it as an in-process bus notification (core/bus.ts topic);
 *  - ACTIVE_DURABLE        the owner records the event in the same transaction as the authoritative state;
 *  - STATE_EXISTS_NO_EVENT  the authoritative state already exists (OMS, ledger, DITAS tables, the in-memory book…);
 *                           no fabric event is emitted yet — a later phase (N2) records events ABOUT committed state;
 *  - RESERVED               no producer exists (e.g. QMC, whose 1,000-profile registry was not supplied). Validation
 *                           rejects RESERVED topics, so nothing can fake activity.
 * Read-only metadata: importing this file changes no behaviour.
 */
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type Durability = 'BEST_EFFORT' | 'DURABLE' | 'NEVER_COALESCE';
export type TopicStatus = 'ACTIVE_BEST_EFFORT' | 'ACTIVE_DURABLE' | 'STATE_EXISTS_NO_EVENT' | 'RESERVED';
export type SourceClass = 'MARKET' | 'PROVIDER' | 'STRATEGY' | 'QMC' | 'QCI' | 'RISK' | 'OMS' | 'LEDGER' | 'DITAS' | 'SYSTEM';
export type AccessClass = 'PUBLIC_MARKET' | 'OWNER_PRIVATE' | 'SYSTEM_RESTRICTED';

export interface TopicSpec {
  topic: string;
  /** Registered producer identity (= owner file, `/`→`:`, no extension). Only this producer may emit the topic. */
  producer: string;
  /** Existing source file that owns the authoritative state, relative to server/src. `null` while RESERVED. */
  ownerFile: string | null;
  sourceClass: SourceClass;
  consumers: string[];
  priority: Priority;
  durability: Durability;
  retention: 'HOT_ONLY' | '30D' | '1Y' | 'PERMANENT';
  accessClass: AccessClass;
  maxPayloadBytes: number;
  status: TopicStatus;
  /** core/bus.ts topic the owner already publishes today, if any. */
  busTopic: string | null;
  /** Where the authoritative record lives today (table/structure), or why the topic is reserved. */
  authority: string;
}

const t = (s: Omit<TopicSpec, 'producer'>): TopicSpec => ({ ...s, producer: s.ownerFile ? s.ownerFile.replace(/\.ts$/, '').replace(/\//g, ':') : `reserved:${s.topic.split('.')[0]}` });

export const CATALOG: readonly TopicSpec[] = Object.freeze([
  t({ topic: 'market.ticker.updated.v1', ownerFile: 'market/fabric.ts', sourceClass: 'MARKET', consumers: ['market/scanner', 'web'], priority: 'P2', durability: 'BEST_EFFORT', retention: 'HOT_ONLY', accessClass: 'PUBLIC_MARKET', maxPayloadBytes: 4_096, status: 'ACTIVE_BEST_EFFORT', busTopic: 'ticker', authority: 'market/store.ts hot state' }),
  t({ topic: 'market.book.synced.v1', ownerFile: 'market/fabric.ts', sourceClass: 'MARKET', consumers: ['exec/oms (fill depth)', 'risk/gate'], priority: 'P1', durability: 'BEST_EFFORT', retention: 'HOT_ONLY', accessClass: 'PUBLIC_MARKET', maxPayloadBytes: 65_536, status: 'STATE_EXISTS_NO_EVENT', busTopic: null, authority: 'validated REST order book in market/store.ts' }),
  t({ topic: 'market.candle.closed.v1', ownerFile: 'market/fabric.ts', sourceClass: 'MARKET', consumers: ['features', 'market/scanner', 'ditas'], priority: 'P2', durability: 'DURABLE', retention: '1Y', accessClass: 'PUBLIC_MARKET', maxPayloadBytes: 4_096, status: 'STATE_EXISTS_NO_EVENT', busTopic: null, authority: 'closed candles in the canonical market store' }),
  t({ topic: 'market.source.degraded.v1', ownerFile: 'market/quality.ts', sourceClass: 'PROVIDER', consumers: ['risk/gate', 'ops/readiness', 'web'], priority: 'P1', durability: 'DURABLE', retention: '1Y', accessClass: 'SYSTEM_RESTRICTED', maxPayloadBytes: 4_096, status: 'ACTIVE_BEST_EFFORT', busTopic: 'health', authority: 'data-quality flags + provider health registry' }),
  t({ topic: 'market.snapshot.frozen.v1', ownerFile: 'ditas/memory.ts', sourceClass: 'DITAS', consumers: ['workers', 'qci', 'replay'], priority: 'P2', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 2_048, status: 'STATE_EXISTS_NO_EVENT', busTopic: null, authority: 'ditas_snapshots (content-addressed snap_<sha256>) + ditas_blobs' }),
  t({ topic: 'hunt.candidate.researched.v1', ownerFile: null, sourceClass: 'STRATEGY', consumers: ['market/scanner', 'web'], priority: 'P3', durability: 'DURABLE', retention: '30D', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'RESERVED', busTopic: null, authority: 'TITAN HUNTER ranker lives on PR #19 (not on this base)' }),
  t({ topic: 'filter.candidate.evaluated.v1', ownerFile: 'market/scanner.ts', sourceClass: 'STRATEGY', consumers: ['decision/engine', 'web'], priority: 'P2', durability: 'DURABLE', retention: '1Y', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 16_384, status: 'ACTIVE_BEST_EFFORT', busTopic: 'scan', authority: 'scan results + decision steps' }),
  t({ topic: 'strategy.signal.proposed.v1', ownerFile: 'market/scanner.ts', sourceClass: 'STRATEGY', consumers: ['workers', 'decision/engine'], priority: 'P2', durability: 'DURABLE', retention: '1Y', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'ACTIVE_BEST_EFFORT', busTopic: 'scan', authority: 'strategy candidates from the scanner' }),
  t({ topic: 'qmc.assignment.created.v1', ownerFile: null, sourceClass: 'QMC', consumers: ['qmc runner'], priority: 'P3', durability: 'DURABLE', retention: '1Y', accessClass: 'SYSTEM_RESTRICTED', maxPayloadBytes: 4_096, status: 'RESERVED', busTopic: null, authority: 'QMC registry (1,000 profiles) not supplied; no scheduler exists' }),
  t({ topic: 'qmc.vote.sealed.v1', ownerFile: null, sourceClass: 'QMC', consumers: ['qci adapter (shadow)', 'ditas'], priority: 'P3', durability: 'NEVER_COALESCE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'RESERVED', busTopic: null, authority: 'no vote service exists' }),
  t({ topic: 'qmc.challenge.published.v1', ownerFile: null, sourceClass: 'QMC', consumers: ['web'], priority: 'P3', durability: 'DURABLE', retention: '1Y', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 16_384, status: 'RESERVED', busTopic: null, authority: 'no debate coordinator exists' }),
  t({ topic: 'qci.consensus.finalized.v1', ownerFile: 'qci/coordinator.ts', sourceClass: 'QCI', consumers: ['decision/engine', 'web'], priority: 'P2', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 32_768, status: 'ACTIVE_BEST_EFFORT', busTopic: 'consensus', authority: 'consensus stored inside the decision record' }),
  t({ topic: 'decision.certificate.issued.v1', ownerFile: 'decision/engine.ts', sourceClass: 'STRATEGY', consumers: ['risk/gate', 'ditas', 'web'], priority: 'P1', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 65_536, status: 'ACTIVE_BEST_EFFORT', busTopic: 'decision', authority: 'decisions table' }),
  t({ topic: 'risk.evaluated.v1', ownerFile: 'risk/gate.ts', sourceClass: 'RISK', consumers: ['exec/oms', 'web'], priority: 'P1', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 16_384, status: 'STATE_EXISTS_NO_EVENT', busTopic: null, authority: 'risk result stored in the decision record' }),
  t({ topic: 'risk.halt.activated.v1', ownerFile: 'core/mode.ts', sourceClass: 'RISK', consumers: ['bot/bot', 'exec/oms', 'notify'], priority: 'P0', durability: 'NEVER_COALESCE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 4_096, status: 'ACTIVE_BEST_EFFORT', busTopic: 'mode', authority: 'control state + audit_log control.update' }),
  t({ topic: 'order.intent.accepted.v1', ownerFile: 'exec/oms.ts', sourceClass: 'OMS', consumers: ['portfolio/ledger', 'web'], priority: 'P1', durability: 'NEVER_COALESCE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'STATE_EXISTS_NO_EVENT', busTopic: 'order', authority: 'orders table (paper)' }),
  t({ topic: 'order.state.changed.v1', ownerFile: 'exec/oms.ts', sourceClass: 'OMS', consumers: ['portfolio/ledger', 'web'], priority: 'P1', durability: 'NEVER_COALESCE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'STATE_EXISTS_NO_EVENT', busTopic: 'order', authority: 'orders table (paper)' }),
  t({ topic: 'fill.recorded.v1', ownerFile: 'exec/oms.ts', sourceClass: 'OMS', consumers: ['ditas', 'web'], priority: 'P1', durability: 'NEVER_COALESCE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'ACTIVE_DURABLE', busTopic: 'order', authority: 'fills table (paper), replay through the audit log' }),
  t({ topic: 'ledger.updated.v1', ownerFile: 'portfolio/ledger.ts', sourceClass: 'LEDGER', consumers: ['web', 'risk/gate'], priority: 'P1', durability: 'NEVER_COALESCE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'STATE_EXISTS_NO_EVENT', busTopic: 'position', authority: 'ledger tables (paper)' }),
  t({ topic: 'ditas.outcome.recorded.v1', ownerFile: 'ditas/service.ts', sourceClass: 'DITAS', consumers: ['ditas calibration', 'loss lab'], priority: 'P2', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 16_384, status: 'STATE_EXISTS_NO_EVENT', busTopic: null, authority: 'ditas_outcomes' }),
  t({ topic: 'qmc.agent.assessed.v1', ownerFile: null, sourceClass: 'QMC', consumers: ['qmc passports', 'web'], priority: 'P3', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 8_192, status: 'RESERVED', busTopic: null, authority: 'no agent evaluator exists (ditas/passports.ts holds STRATEGY passports, not agent ones)' }),
  t({ topic: 'research.challenger.proposed.v1', ownerFile: null, sourceClass: 'STRATEGY', consumers: ['owner review'], priority: 'P3', durability: 'DURABLE', retention: 'PERMANENT', accessClass: 'OWNER_PRIVATE', maxPayloadBytes: 16_384, status: 'RESERVED', busTopic: null, authority: 'no loss-lab challenger producer exists; never auto-promotes' }),
  t({ topic: 'ops.system.degraded.v1', ownerFile: 'ops/readiness.ts', sourceClass: 'SYSTEM', consumers: ['notify', 'trader joe', 'web'], priority: 'P0', durability: 'DURABLE', retention: '1Y', accessClass: 'SYSTEM_RESTRICTED', maxPayloadBytes: 4_096, status: 'STATE_EXISTS_NO_EVENT', busTopic: null, authority: 'readiness checks and protection incidents' }),
]);

const BY_TOPIC = new Map(CATALOG.map((s) => [s.topic, s]));
export const topicSpec = (topic: string) => BY_TOPIC.get(topic);

/** Summary for the owner's read-only catalog view. */
export function catalogSummary() {
  const count = (s: TopicStatus) => CATALOG.filter((x) => x.status === s).length;
  return {
    schemaVersion: 'fabric.catalog.v1' as const,
    topics: CATALOG,
    counts: { total: CATALOG.length, activeBestEffort: count('ACTIVE_BEST_EFFORT'), activeDurable: count('ACTIVE_DURABLE'), stateExistsNoEvent: count('STATE_EXISTS_NO_EVENT'), reserved: count('RESERVED') },
    note: 'Paper fill events are replayable from the audit log. The OMS, ledger and DITAS remain the sources of truth.',
  };
}
