import { describe, expect, it } from 'vitest';
import { BRAIN_CAPABILITIES, buildBrainSnapshot, type BrainSignals } from '../src/knowledge/brain.js';

const NOW = 1_800_000_000_000;
const healthy: BrainSignals = {
  now: NOW,
  tickerAt: NOW - 2_000,
  scanAt: NOW - 5_000,
  dexAt: NOW - 10_000,
  tickerCount: 200,
  dexPairCount: 30,
  newsCount: 4,
  lastNewsAt: NOW - 60_000,
  largePrintCount: 2,
};
const getState = (signals: BrainSignals, id: string) => {
  const value = buildBrainSnapshot(signals).capabilities.find((c) => c.id === id);
  if (!value) throw new Error('Unknown capability: ' + id);
  return value;
};

describe('MIA BrainOS capability bridge (read-only)', () => {
  it('indexes exactly the 11 existing user tools without granting execution authority', () => {
    expect(BRAIN_CAPABILITIES).toHaveLength(11);
    expect(new Set(BRAIN_CAPABILITIES.map((c) => c.id)).size).toBe(11);
    const snapshot = buildBrainSnapshot(healthy);
    expect(snapshot.capabilities).toHaveLength(11);
    expect(snapshot.tradingAuthority).toBe(false);
    expect(snapshot.capabilities.every((c) => c.tradingAuthority === false)).toBe(true);
  });

  it('reports current canonical sources as available and unresolved tools as blocked', () => {
    expect(getState(healthy, 'market_terminal').state).toBe('EVIDENCE_AVAILABLE');
    expect(getState(healthy, 'ai_scanner').state).toBe('EVIDENCE_AVAILABLE');
    expect(getState(healthy, 'asset_discovery').state).toBe('EVIDENCE_AVAILABLE');
    expect(getState(healthy, 'market_bubble_map').state).toBe('EVIDENCE_AVAILABLE');
    expect(getState(healthy, 'news_events').state).toBe('EVIDENCE_AVAILABLE');
    expect(getState(healthy, 'whale_launch_monitor').state).toBe('PARTIAL');
    expect(getState(healthy, 'holder_map').state).toBe('BLOCKED');
    expect(getState(healthy, 'copy_trading').state).toBe('BLOCKED');
    expect(getState(healthy, 'bot_account').state).toBe('PAPER_ONLY');
  });

  it('never marks missing, stale, or future-dated provider evidence as available', () => {
    const stale = { ...healthy,
      tickerAt: NOW - 3600_000, scanAt: NOW - 3600_000, dexAt: NOW + 100,
      tickerCount: 200, dexPairCount: 30, newsCount: 0, lastNewsAt: 0,
      largePrintCount: 0,
    };
    for (const id of ['market_terminal', 'ai_scanner', 'asset_discovery', 'market_bubble_map', 'news_events', 'ai_intelligence', 'whale_launch_monitor']) {
      expect(getState(stale, id).state).toBe('WAITING_FOR_DATA');
    }
  });

  it('does not confuse a large CEX print or DEX profile with certified wallet tracking', () => {
    const c = getState({ ...healthy, dexPairCount: 0, largePrintCount: 1 }, 'whale_launch_monitor');
    expect(c.state).toBe('PARTIAL');
    expect(c.reason).toContain('wallet tracking is not certified');
    expect(getState(healthy, 'copy_trading').tradingAuthority).toBe(false);
  });

  it('rejects impossible snapshot timestamps', () => {
    expect(() => buildBrainSnapshot({ ...healthy, now: -1 })).toThrow('INVALID_BRAIN_SNAPSHOT_TIME');
    expect(() => buildBrainSnapshot({ ...healthy, now: Number.NaN })).toThrow('INVALID_BRAIN_SNAPSHOT_TIME');
  });
});
