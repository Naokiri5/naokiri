import { describe, expect, it } from 'vitest';
import type { DexPair } from '../src/providers/dexscreener.js';
import { assessDexPair } from '../src/safety/safety.js';

const NOW = Date.parse('2026-11-18T08:00:00Z');
const overview: DexPair = {
  chainId: 'solana', dexId: 'fixture', pairAddress: 'fixture-pool', url: 'https://dexscreener.com',
  baseSymbol: 'TEST', baseName: 'Fixture token', baseAddress: 'fixture-token', quoteSymbol: 'USDC',
  priceUsd: 1, liquidityUsd: 5_000_000, fdv: 5_000_000, marketCap: 4_000_000, volume24h: 1_000_000, volume1h: 100_000,
  buys24h: 300, sells24h: 150, buys1h: 30, sells1h: 15, change1h: 1, change24h: 4,
  pairCreatedAt: NOW - 3 * 86_400_000, hasSocials: true, hasWebsite: true,
};

describe('DEX screening evidence', () => {
  it('keeps aggregate liquidity and historical sells separate from critical security evidence', () => {
    const safety = assessDexPair(overview, NOW);
    expect(safety).toMatchObject({ status: 'UNVERIFIED', eligibleForAutomation: false });
    const required = [
      'contract permissions / sell simulation', 'executable sell-side depth', 'intended sell proceeds', 'LP control and lock', 'holder concentration',
    ];
    expect(safety.checks).toEqual(expect.arrayContaining(required.map(name =>
      expect.objectContaining({ name, result: 'NOT_AVAILABLE' }))));
    expect(safety.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'pool liquidity', result: 'PASS', detail: expect.stringContaining('reported aggregate') }),
      expect.objectContaining({ name: 'sell activity', result: 'PASS' }),
    ]));
  });

  it.each([NaN, Infinity, -1, 9_999])('rejects invalid or critically thin aggregate liquidity (%s)', liquidityUsd => {
    expect(assessDexPair({ ...overview, liquidityUsd }, NOW)).toMatchObject({
      status: 'REJECTED', eligibleForAutomation: false,
      checks: expect.arrayContaining([expect.objectContaining({ name: 'pool liquidity', result: 'FAIL' })]),
    });
  });

  it('retains rejection for many reported buys with no reported sells', () => {
    const safety = assessDexPair({ ...overview, sells24h: 0 }, NOW);
    expect(safety.status).toBe('REJECTED');
    expect(safety.eligibleForAutomation).toBe(false);
    expect(safety.checks.find(check => check.name === 'sell activity')?.result).toBe('FAIL');
  });
});
