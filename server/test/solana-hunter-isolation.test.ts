import { describe, it, expect, beforeEach, vi } from 'vitest';
import { freshDb } from './helpers.js';
import { market } from '../src/market/store.js';
import { discover } from '../src/market/discover.js';

/**
 * Omega PR-01, second review: the Solana ranker runs on untrusted provider rows. If it ever throws, only the Solana
 * watchlist block empties (rankerFailed); the existing Discover lists must still be served. Read-only throughout.
 */
vi.mock('../src/solana/hunting.js', () => ({
  rankSolanaPairs: () => { throw new TypeError('simulated ranker crash on a malformed provider row'); },
}));

const NOW = Date.UTC(2026, 10, 19, 12);

describe('discover() isolates a Solana ranker failure', () => {
  beforeEach(() => { freshDb(); market.reset(); });

  it('keeps every existing list and reports rankerFailed with no candidates', () => {
    market.dex = [];
    market.dexFetchedAt = NOW - 30_000; // fresh, so the (failing) ranker is actually called
    const d = discover(1e6, NOW);
    expect(d.solanaHunter).toMatchObject({ stale: false, rankerFailed: true, candidates: [], executionReady: false, asOf: NOW - 30_000 });
    for (const k of ['volumeLeaders', 'gainers', 'losers', 'unusualVolume', 'largeCaps', 'dexLaunches'] as const) expect(Array.isArray(d[k])).toBe(true);
  });

  it('does not call the ranker at all on stale data, so a stale cache never reports rankerFailed', () => {
    market.dexFetchedAt = NOW - 10 * 60_000;
    expect(discover(1e6, NOW).solanaHunter).toMatchObject({ stale: true, rankerFailed: false, candidates: [] });
  });
});
