import { config } from '../config.js';
import { brainRegistryOverview } from './cognitive/registry.js';
import { market } from '../market/store.js';
import { recentNews } from '../news/news.js';
import { recentPrints } from '../whales/prints.js';
import { SETTINGS_CAPABILITIES, settingsCapabilityOverview } from './settingsCapabilities.js';
import { buildCapabilityNetwork } from './capabilityGraph.js';
import { capabilitySnapshotView } from './capabilitySnapshot.js';
import { CAPABILITY_READ_CONTRACT, type CapabilityEvidenceContract } from './capabilityContract.js';

/**
 * MIA Brain Capability Bridge.
 *
 * These are REFERENCES to existing canonical services, not executable code stored in
 * a language model, a second scanner, or a second trading authority. The existing
 * leader-owned background lane refreshes this read-only operational snapshot.
 *
 * Availability describes observed evidence, NOT permission to place an order.
 * Memory remains in the existing A-F/DITAS/accounting stores.
 */
export const BRAIN_CAPABILITIES = [
  { id: 'overview', owner: 'dashboard/overview.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Ticker or DEX observation time and count', output: 'Market overview availability', dependencies: 'MarketStore',
    freshness: 'Ticker within 3 refresh intervals or DEX within 5 minutes', provenance: 'MarketStore ticker and DEX counters', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'market_terminal', owner: 'market/fabric.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Ticker observation time and count', output: 'Terminal feed availability', dependencies: 'Canonical market adapters and MarketStore',
    freshness: 'Within 3 ticker refresh intervals', provenance: 'MarketStore tickersFetchedAt and ticker count', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'ai_scanner', owner: 'market/scanner.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Last canonical scanner pass', output: 'Scanner evidence availability', dependencies: 'Existing market scanner',
    freshness: 'Within 3 scan intervals', provenance: 'MarketStore lastScanAt', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'asset_discovery', owner: 'market/discover.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Ticker or DEX observation time and count', output: 'Discovery feed availability', dependencies: 'MarketStore',
    freshness: 'Ticker within 3 refresh intervals or DEX within 5 minutes', provenance: 'MarketStore ticker and DEX counters', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'market_bubble_map', owner: 'market/bubbles.ts', modes: ['DEEP'], evidence: {
    input: 'Ticker observation time and count', output: 'Market breadth availability', dependencies: 'MarketStore',
    freshness: 'Within 3 ticker refresh intervals', provenance: 'MarketStore tickersFetchedAt and ticker count', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'whale_launch_monitor', owner: 'whales/prints.ts + market/fabric.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'DEX snapshot or observed aggregate exchange prints', output: 'Launch and exchange-print evidence classified as partial', dependencies: 'DEX adapter and exchange prints cache',
    freshness: 'DEX within 5 minutes or print within 6 hours', provenance: 'MarketStore DEX timestamps and recent exchange prints', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'holder_map', owner: 'on-chain provider (not certified)', modes: ['FAST'], evidence: {
    input: 'Verified on-chain holders and token authorities', output: 'Blocked holder evidence status', dependencies: 'Certified token and holder RPC integration',
    freshness: 'Unavailable', provenance: 'Capability registry records integration gap', whenUnavailable: 'BLOCKED',
  } },
  { id: 'copy_trading', owner: 'on-chain provider (not certified)', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Attributed wallet activity and performance', output: 'Blocked tracked-wallet evidence status', dependencies: 'Certified wallet tracking and attribution',
    freshness: 'Unavailable', provenance: 'Capability registry records integration gap', whenUnavailable: 'BLOCKED',
  } },
  { id: 'news_events', owner: 'news/news.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Recent classified article timestamps', output: 'News availability', dependencies: 'RSS adapters and persisted news',
    freshness: 'Within 7 days', provenance: 'Canonical news records', whenUnavailable: 'WAITING_FOR_DATA',
  } },
  { id: 'bot_account', owner: 'portfolio/ledger.ts', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Canonical paper ledger ownership', output: 'Paper-only account scope', dependencies: 'Paper ledger and OMS',
    freshness: 'Scope declaration', provenance: 'Existing paper account and live release lock', whenUnavailable: 'PAPER_ONLY',
  } },
  { id: 'ai_intelligence', owner: 'workers/ + qci/ + decision/', modes: ['FAST', 'DEEP'], evidence: {
    input: 'Last canonical scanner pass', output: 'Pipeline observation availability', dependencies: 'Scanner, workers, QCI and decision engine',
    freshness: 'Within 3 scan intervals', provenance: 'MarketStore lastScanAt', whenUnavailable: 'WAITING_FOR_DATA',
  } },
] as const satisfies readonly {
  id: string; owner: string; modes: readonly ('FAST' | 'DEEP')[]; evidence: CapabilityEvidenceContract;
}[];

export type BrainCapabilityId = typeof BRAIN_CAPABILITIES[number]['id'];
export type BrainCapabilityState =
  | 'EVIDENCE_AVAILABLE' | 'WAITING_FOR_DATA' | 'PARTIAL' | 'BLOCKED' | 'PAPER_ONLY';

export interface BrainSignals {
  now: number;
  tickerAt: number;
  scanAt: number;
  dexAt: number;
  tickerCount: number;
  dexPairCount: number;
  newsCount: number;
  lastNewsAt: number;
  largePrintCount: number;
  lastLargePrintAt: number;
}

export interface BrainCapabilityView {
  id: BrainCapabilityId;
  owner: string;
  modes: readonly ('FAST' | 'DEEP')[];
  state: BrainCapabilityState;
  reason: string;
  tradingAuthority: false;
}

export interface BrainSnapshot {
  schemaVersion: 'mia.brain.capabilities.v1';
  capturedAt: number;
  tradingAuthority: false;
  sources: BrainSignals;
  capabilities: BrainCapabilityView[];
  note: string;
}

const fresh = (ts: number, now: number, maxAge: number) =>
  Number.isSafeInteger(ts) && ts > 0 && ts <= now && now - ts <= maxAge;

/** Pure resolver: never calls an LLM, external provider, risk gate, or OMS. */
export function buildBrainSnapshot(s: BrainSignals): BrainSnapshot {
  if (!Number.isSafeInteger(s.now) || s.now <= 0) throw new Error('INVALID_BRAIN_SNAPSHOT_TIME');
  const tickers = s.tickerCount > 0 && fresh(s.tickerAt, s.now, config.tickerIntervalMs * 3);
  const scanner = fresh(s.scanAt, s.now, config.scanIntervalMs * 3);
  const dex = s.dexPairCount > 0 && fresh(s.dexAt, s.now, 5 * 60_000);
  const news = s.newsCount > 0 && fresh(s.lastNewsAt, s.now, 7 * 86_400_000);
  const hasPrints = s.largePrintCount > 0 && fresh(s.lastLargePrintAt, s.now, 6 * 3600_000);
  const available = (ok: boolean, label: string): [BrainCapabilityState, string] =>
    ok ? ['EVIDENCE_AVAILABLE', label + ' evidence available from canonical backend']
      : ['WAITING_FOR_DATA', label + ' evidence unavailable or stale'];

  const state = (id: BrainCapabilityId): [BrainCapabilityState, string] => {
    switch (id) {
      case 'overview': return available(tickers || dex, 'Market overview');
      case 'market_terminal': return available(tickers, 'Market terminal');
      case 'ai_scanner': return available(scanner, 'Scanner');
      case 'asset_discovery': return available(tickers || dex, 'Asset discovery');
      case 'market_bubble_map': return available(tickers, 'Market breadth and bubble map');
      case 'whale_launch_monitor':
        return dex || hasPrints
          ? ['PARTIAL', 'DEX launch profiles / aggregated large exchange prints; wallet tracking is not certified']
          : ['WAITING_FOR_DATA', 'No fresh launch profiles or observed large prints; wallet tracking is not certified'];
      case 'holder_map':
        return ['BLOCKED', 'Verified on-chain holder mapping requires an integrated and tested RPC provider'];
      case 'copy_trading':
        return ['BLOCKED', 'Verified tracked-wallet signals, performance attribution, and authorized execution are missing'];
      case 'news_events': return available(news, 'News');
      case 'bot_account':
        return ['PAPER_ONLY', 'Canonical ledger and paper account exist; real-money venue execution remains locked'];
      case 'ai_intelligence': return available(scanner, 'Worker/QCI/decision pipeline');
    }
  };
  return {
    schemaVersion: 'mia.brain.capabilities.v1',
    capturedAt: s.now,
    tradingAuthority: false,
    sources: { ...s },
    capabilities: BRAIN_CAPABILITIES.map((c) => {
      const [capabilityState, reason] = state(c.id);
      return { id: c.id, owner: c.owner, modes: c.modes, state: capabilityState, reason, tradingAuthority: false as const };
    }),
    note: 'Source-backed capability visibility only. No feature is made executable by storing its name in memory. Orders remain owned by decision, risk and OMS.',
  };
}

let latest: BrainSnapshot | null = null;

/**
 * Automatically invoked by the existing leader-owned background lane.
 * Reading an empty or stale feed produces WAITING_FOR_DATA, never a synthetic signal.
 */
export function refreshBrainSnapshot(now = Date.now()): BrainSnapshot {
  const n = recentNews(10).filter(({ ts }) => fresh(ts, now, 7 * 86_400_000));
  const p = recentPrints(10).filter(({ ts }) => fresh(ts, now, 6 * 3600_000));
  const snapshot = buildBrainSnapshot({
    now,
    tickerAt: market.tickersFetchedAt,
    scanAt: market.lastScanAt,
    dexAt: market.dexFetchedAt,
    tickerCount: market.tickers.size,
    dexPairCount: market.dex.length,
    newsCount: n.length,
    lastNewsAt: n.length ? Math.max(...n.map((item) => item.ts)) : 0,
    largePrintCount: p.length,
    lastLargePrintAt: p.length ? Math.max(...p.map((item) => item.ts)) : 0,
  });
  latest = snapshot;
  return snapshot;
}

export function brainOverview(at = Date.now()) {
  const view = capabilitySnapshotView(latest, at);
  const snapshot = view.latest;
  const current = snapshot ? {
    ...snapshot,
    capabilities: buildBrainSnapshot({ ...snapshot.sources, now: at }).capabilities,
  } : null;
  const settings = settingsCapabilityOverview(at);
  return {
    ...view,
    readContract: CAPABILITY_READ_CONTRACT,
    registry: BRAIN_CAPABILITIES,
    settings,
    // A single dependency-aware, fail-closed evidence view for Academy, Trader Joe and
    // future orchestrator preflights. This NEVER authorizes trading or stores executable code.
    network: buildCapabilityNetwork({
      at, autopilot: current, settings: settings.latest,
      autopilotRegistry: BRAIN_CAPABILITIES, settingsRegistry: SETTINGS_CAPABILITIES,
    }),
    latest: current,
    memoryAuthority: 'Existing knowledge A-F, DITAS append-only events, and canonical portfolio ledger',
    cognitiveFoundation: brainRegistryOverview(),
  };
}

/** Test isolation; not a user-facing reset or permission action. */
export function _resetBrainSnapshotForTests() { latest = null; }
