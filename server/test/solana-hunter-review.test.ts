import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { market } from '../src/market/store.js';
import { discover } from '../src/market/discover.js';
import { rankSolanaPairs, type SolanaHuntPair } from '../src/solana/hunting.js';
import { failureGate } from '../src/core/ratelimit.js';
import { buildApp } from '../src/index.js';
import type { DexPair } from '../src/providers/dexscreener.js';

/**
 * Omega PR-01 review tests (MIA side). The owner's starter tests stay byte-identical in solana-hunter.test.ts; these
 * cover the review fixes and the discover() integration. Read-only: nothing here can create an order.
 */
const NOW = Date.UTC(2026, 10, 19, 12);
const MINT = 'So11111111111111111111111111111111111111112';
const PAIR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const base: SolanaHuntPair = {
  chainId: 'solana', dexId: 'raydium', pairAddress: PAIR, baseAddress: MINT, baseSymbol: 'TEST', baseName: 'Mock',
  priceUsd: 0.01, liquidityUsd: 100_000, fdv: 100_000, marketCap: 100_000, volume24h: 90_000, volume1h: 30_000,
  buys1h: 35, sells1h: 15, change1h: 4, pairCreatedAt: NOW - 60_000,
};
const dex = (over: Partial<DexPair> = {}): DexPair => ({ ...base, url: '', quoteSymbol: 'SOL', buys24h: 100, sells24h: 50, change24h: 5, hasSocials: false, hasWebsite: false, ...over });

describe('ranker review fixes', () => {
  it('skips (never throws on) provider rows whose chainId or addresses are not strings', () => {
    const bad = [{ ...base, chainId: 123 }, { ...base, chainId: null }, { ...base, baseAddress: 42 }, { ...base, pairAddress: undefined }] as unknown as SolanaHuntPair[];
    expect(() => rankSolanaPairs(bad, { nowMs: NOW })).not.toThrow();
    expect(rankSolanaPairs([...bad, base], { nowMs: NOW }).map((r) => r.mint)).toEqual([MINT]);
  });
  it('strips control and bidi-override characters from attacker-controlled symbols', () => {
    const [row] = rankSolanaPairs([{ ...base, baseSymbol: 'US‮DC\u0000​', dexId: 'ray\u0007dium' }], { nowMs: NOW });
    expect(row.symbol).toBe('USDC'); // a right-to-left override can no longer make one ticker render as another
    expect(row.dex).toBe('raydium');
    const [empty] = rankSolanaPairs([{ ...base, baseSymbol: '‮​' }], { nowMs: NOW });
    expect(empty.symbol).toBe('?');
  });
  it('every row stays read-only: tradingEligible is always false, whatever the score', () => {
    const rows = rankSolanaPairs([base, { ...base, baseAddress: PAIR, pairAddress: MINT, liquidityUsd: 5_000_000, volume1h: 2_000_000 }], { nowMs: NOW });
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.tradingEligible).toBe(false);
  });
});

describe('discover() Solana watchlist integration', () => {
  beforeEach(() => { freshDb(); market.reset(); });

  it('is stale with no candidates before the DEX cache has ever loaded', () => {
    market.dexFetchedAt = 0;
    expect(discover(1e6, NOW).solanaHunter).toMatchObject({ stale: true, candidates: [], executionReady: false });
  });
  it('lists fresh Solana candidates, read-only, and leaves the existing lists unchanged', () => {
    market.dex = [dex(), dex({ chainId: 'ethereum', baseAddress: '0x' + 'a'.repeat(40) })];
    market.dexFetchedAt = NOW - 30_000;
    const d = discover(1e6, NOW);
    expect(d.solanaHunter.stale).toBe(false);
    expect(d.solanaHunter.executionReady).toBe(false);
    expect(d.solanaHunter.candidates.map((c) => c.mint)).toEqual([MINT]);
    expect(d.solanaHunter.candidates.every((c) => c.tradingEligible === false)).toBe(true);
    // No regression: the general DEX list still carries both chains and its safety verdict never allows automation.
    expect(d.dexLaunches).toHaveLength(2);
    expect(d.dexLaunches.every((p) => p.safety.eligibleForAutomation === false)).toBe(true);
  });
  it('treats an old cache as stale', () => {
    market.dex = [dex()];
    market.dexFetchedAt = NOW - 6 * 60_000;
    expect(discover(1e6, NOW).solanaHunter).toMatchObject({ stale: true, candidates: [] });
  });
  it('treats a future-dated cache (clock jump) as stale instead of fresh (review fix)', () => {
    market.dex = [dex()];
    market.dexFetchedAt = NOW + 60_000;
    expect(discover(1e6, NOW).solanaHunter).toMatchObject({ stale: true, candidates: [] });
  });
});

describe('/api/discover route', () => {
  it('requires the owner session and returns the read-only watchlist block', async () => {
    freshDb(); market.reset(); failureGate.reset();
    const app = await buildApp();
    try {
      expect((await app.inject({ url: '/api/discover' })).statusCode).toBe(401);
      const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('solana hunter owner') })).headers['set-cookie']).split(';')[0];
      const body = (await app.inject({ url: '/api/discover', headers: { cookie } })).json();
      expect(body.solanaHunter).toMatchObject({ executionReady: false });
      expect(Array.isArray(body.solanaHunter.candidates)).toBe(true);
    } finally { await app.close(); }
  });
});
