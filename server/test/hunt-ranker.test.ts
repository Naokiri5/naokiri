import { describe, expect, it } from 'vitest';
import { screenCachedTokens, type HuntObservation } from '../src/hunt/ranker.js';

const NOW = 1_800_000_000_000;
const observation = (id: string, overrides: Partial<HuntObservation> = {}): HuntObservation => ({
  id, venue: 'DEX_POOL', symbol: id, source: 'fixture', receivedAt: NOW, providerAt: NOW,
  priceUsd: 1, volume24hUsd: 100_000, volume1hUsd: 20_000, liquidityUsd: 100_000,
  trades1h: 75, change1hPct: 3, change24hPct: 5, ...overrides,
});

describe('TITAN HUNTER read-only fast screening', () => {
  it('ranks 1000 cached observations deterministically without trading authority', () => {
    const records = Array.from({ length: 1000 }, (_, i) =>
      observation(`dex:solana:${i}`, { volume24hUsd: 100_000 + i * 100 }));
    const a = screenCachedTokens(records, NOW, 50);
    const b = screenCachedTokens([...records].reverse(), NOW, 50);
    expect(a.inspected).toBe(1000);
    expect(a.valid).toBe(1000);
    expect(a.results).toHaveLength(50);
    expect(a.results).toEqual(b.results);
    expect(a.results.every((x) => x.classification === 'WATCH_ONLY' && !x.tradeEligible)).toBe(true);
  });

  it('discards stale, future-dated, malformed and zero-price observations', () => {
    const records = [observation('valid'), observation('old', { providerAt: NOW - 600_000 }),
      observation('future', { providerAt: NOW + 60_000 }),
      observation('zero', { priceUsd: 0 }), observation('nan', { volume24hUsd: NaN })];
    const r = screenCachedTokens(records, NOW);
    expect(r.valid).toBe(1);
    expect(r.discarded).toBe(4);
    expect(r.results[0].id).toBe('valid');
  });

  it('keeps the freshest duplicate by canonical identity', () => {
    const old = observation('dex:solana:address', { providerAt: NOW - 1000, volume24hUsd: 100 });
    const latest = observation('dex:solana:address', { volume24hUsd: 999_999 });
    const r = screenCachedTokens([latest, old], NOW);
    expect(r.valid).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.results).toEqual(screenCachedTokens([latest], NOW).results);
  });

  it('flags missing liquidity and incomplete contract verification', () => {
    const r = screenCachedTokens([observation('x', { liquidityUsd: null })], NOW);
    expect(r.results[0].warnings).toContain('POOL_LIQUIDITY_UNVERIFIED');
    expect(r.results[0].warnings).toContain('TOKEN_CONTRACT_AND_SELLABILITY_UNVERIFIED');
    expect(r.results[0].tradeEligible).toBe(false);
  });

  it('rejects unbounded output and invalid clock arguments', () => {
    expect(() => screenCachedTokens([observation('x')], NOW, 0)).toThrow();
    expect(() => screenCachedTokens([observation('x')], NaN)).toThrow();
  });
});
