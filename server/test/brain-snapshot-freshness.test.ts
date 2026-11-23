import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { closeDb } from '../src/db/db.js';
import { brainOverview, refreshBrainSnapshot, _resetBrainSnapshotForTests } from '../src/knowledge/brain.js';
import { refreshSettingsCapabilitySnapshot, _resetSettingsCapabilitySnapshotForTests } from '../src/knowledge/settingsCapabilities.js';
import { CAPABILITY_REFRESH_INTERVAL_MS } from '../src/knowledge/capabilitySnapshot.js';
import { market } from '../src/market/store.js';
import { freshDb, seedInstrument } from './helpers.js';

const NOW = Date.UTC(2026, 10, 23, 12);

describe('BrainOS retained capability evidence', () => {
  beforeEach(() => { freshDb(false); });
  afterEach(() => {
    _resetBrainSnapshotForTests();
    _resetSettingsCapabilitySnapshotForTests();
    market.reset();
    market.tickersFetchedAt = 0;
    closeDb();
  });

  it('re-evaluates source freshness without extending the capture time', () => {
    seedInstrument('BTCUSDT', { nowTs: NOW });
    market.tickersFetchedAt = NOW - config.tickerIntervalMs * 3;
    const terminal = (at: number) => brainOverview(at).latest?.capabilities.find((capability) => capability.id === 'market_terminal');
    refreshBrainSnapshot(NOW);
    expect(terminal(NOW)?.state).toBe('EVIDENCE_AVAILABLE');
    expect(terminal(NOW + 1)?.state).toBe('WAITING_FOR_DATA');
    expect(brainOverview(NOW + 1).latest?.capturedAt).toBe(NOW);
  });

  it('distinguishes unseen and expired samples while retaining capability contracts', () => {
    expect(brainOverview(NOW)).toMatchObject({ status: 'NOT_YET_REFRESHED', latest: null, lastCapturedAt: null });
    refreshBrainSnapshot(NOW);
    refreshSettingsCapabilitySnapshot(NOW);
    const boundary = NOW + 3 * CAPABILITY_REFRESH_INTERVAL_MS;
    expect(brainOverview(boundary)).toMatchObject({ status: 'REFRESHED', settings: { status: 'REFRESHED' } });
    for (const at of [NOW - 1, boundary + 1]) {
      const overview = brainOverview(at);
      expect(overview).toMatchObject({
        status: 'STALE', latest: null, lastCapturedAt: NOW,
        settings: { status: 'STALE', latest: null, lastCapturedAt: NOW },
      });
      expect(overview.registry).toHaveLength(11);
      expect(overview.settings.registry).toHaveLength(7);
    }
  });
});
