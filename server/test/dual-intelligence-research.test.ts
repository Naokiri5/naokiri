import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, Interval } from '../src/market/types.js';
import type { DexPair } from '../src/providers/dexscreener.js';
import { market } from '../src/market/store.js';
import { buildApp } from '../src/index.js';
import { all, closeDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';
import { INTERVAL_MS } from '../src/market/types.js';
import { parseFuturesMarketContext, parseFuturesResearchCandles, type fetchFuturesResearchSnapshot } from '../src/providers/binanceFuturesResearch.js';
import { assessFastMemecoinResearch, reconstructDeepFuturesResearch } from '../src/choice/dualResearch.js';

// Tests never call a real exchange. The live adapter is checked separately for pure parsing.
vi.mock('../src/providers/binanceFuturesResearch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/providers/binanceFuturesResearch.js')>();
  return { ...actual, fetchFuturesResearchSnapshot: vi.fn(async () => { throw new Error('TEST_NETWORK_UNAVAILABLE'); }) };
});

const NOW = Math.floor(Date.now() / INTERVAL_MS['4h']) * INTERVAL_MS['4h'];
const dexPair: DexPair = {
  chainId: 'solana', dexId: 'test', pairAddress: 'test-pair', url: 'https://example.invalid/pair',
  baseSymbol: 'TEST', baseName: 'Test Token', baseAddress: 'test-mint', quoteSymbol: 'SOL',
  priceUsd: 0.01, liquidityUsd: 200000, fdv: 2500000, marketCap: 2000000,
  volume24h: 100000, volume1h: 15000, buys24h: 50, sells24h: 30,
  buys1h: 8, sells1h: 6, change1h: 3, change24h: 5,
  pairCreatedAt: NOW - 3600000, hasSocials: true, hasWebsite: true,
};

function bars(iv: Interval, bumpLast = 0): Candle[] {
  const period = INTERVAL_MS[iv], start = NOW - period * 50;
  return Array.from({ length: 50 }, (_, i) => {
    const p = 100 + i * 0.25 + Math.sin(i / 1.8) * 2 + (i === 49 ? bumpLast : 0);
    return { t: start + i * period, o: p - 0.2, h: p + 0.8, l: p - 0.8,
      c: p + 0.2, v: 1000 + i * 3, closeTime: start + (i + 1) * period - 1 };
  });
}

describe('Dual-intelligence market-specific research', () => {
  it('FAST uses the existing safety engine and never treats DEX discovery as sell verification', () => {
    const result = assessFastMemecoinResearch([dexPair], NOW, NOW);
    expect(result.lane).toBe('FAST_MEMECOIN');
    expect(result.status).toBe('NO_TRADE');
    expect(result.tradingAuthority).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].eligibleForAutomation).toBe(false);
    expect(result.candidates[0].reasons).toContain('UNVERIFIED_SELL_EXECUTION_AND_CONTRACT_PERMISSIONS');
    expect(assessFastMemecoinResearch([dexPair], NOW - 250000, NOW).reason).toBe('DEX_SOURCE_STALE_OR_MISSING');
  });

  it('DEEP produces an immutable-identity research hypothesis from only three valid futures candle horizons', () => {
    const snapshot: Awaited<ReturnType<typeof fetchFuturesResearchSnapshot>> = {
      symbol: 'BTCUSDT', market: 'CRYPTO_PERPETUAL_FUTURES',
      source: 'binance-usdm-public-klines', asOf: NOW,
      candles: { '15m': bars('15m', 6), '1h': bars('1h'), '4h': bars('4h') },
    };
    const result = reconstructDeepFuturesResearch(snapshot);
    expect(result.lane).toBe('DEEP_FUTURES');
    expect(result.state).toBe('RESEARCH_HYPOTHESIS');
    expect(result.plan?.direction).toBe('LONG');
    expect(result.plan?.entryTrigger).toBe('15M_BREAKOUT_UP');
    expect(result.plan?.requiredMissing).toContain('LIQUIDATION_STRESS');
    expect(result.plan?.requiredMissing).toContain('FUTURES_FUNDING');
    expect(result.plan?.volatilityScenarios).toHaveLength(2);
    expect(result.tradingAuthority).toBe(false);
    expect(reconstructDeepFuturesResearch(snapshot).plan?.planId).toBe(result.plan?.planId);
    const context = parseFuturesMarketContext('BTCUSDT',
      { symbol: 'BTCUSDT', time: NOW - 1_000, markPrice: '115', lastFundingRate: '0.0001' },
      { symbol: 'BTCUSDT', time: NOW - 100, openInterest: '321.5' }, NOW);
    const enriched = reconstructDeepFuturesResearch({ ...snapshot, context });
    expect(enriched.marketContext).toEqual(context);
    expect(enriched.plan?.requiredMissing).not.toContain('FUTURES_FUNDING');
    expect(enriched.plan?.requiredMissing).not.toContain('OPEN_INTEREST');
    expect(enriched.plan?.planId).not.toBe(result.plan?.planId);
    expect(reconstructDeepFuturesResearch({ ...snapshot, candles: { ...snapshot.candles, '4h': [] } }).state).toBe('NO_TRADE');
    expect(() => reconstructDeepFuturesResearch({ ...snapshot, market: 'crypto' as any })).toThrow(/IDENTITY/);
  });

  it('rejects stale, future-dated, wrong-symbol and missing futures observations', () => {
    const mark = { symbol: 'BTCUSDT', time: NOW - 100, markPrice: '115', lastFundingRate: '0' };
    const interest = { symbol: 'BTCUSDT', time: NOW - 100, openInterest: '321.5' };
    expect(parseFuturesMarketContext('BTCUSDT', mark, interest, NOW)).toMatchObject({
      funding: { rate: 0, markPrice: 115 }, openInterest: { quantity: 321.5 },
    });
    expect(parseFuturesMarketContext('BTCUSDT', { ...mark, time: NOW + 10 }, { ...interest, symbol: 'ETHUSDT' }, NOW)).toEqual({
      funding: null, openInterest: null,
    });
    expect(parseFuturesMarketContext('BTCUSDT', { ...mark, lastFundingRate: null }, { ...interest, time: NOW - 360_000 }, NOW)).toEqual({
      funding: null, openInterest: null,
    });
    expect(parseFuturesMarketContext('BTCUSDT', { ...mark, time: NOW + 5_400 }, null, NOW, NOW + 5_500).funding)
      .toMatchObject({ at: NOW + 5_400, localAt: NOW - 100 });
  });

  it('refuses malformed, replayed, stale, or forming futures candle history', () => {
    const asOf = NOW, period = INTERVAL_MS['15m'];
    const source = bars('15m').map((b) => [b.t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), b.closeTime]);
    const parsed = parseFuturesResearchCandles(source, '15m', asOf);
    expect(parsed).toHaveLength(50);
    expect(parseFuturesResearchCandles([...source, [asOf, '1', '2', '0.5', '1.5', '1', asOf + period - 1]], '15m', asOf)).toHaveLength(50);
    const replay = source.map((r) => [...r]);
    replay[4][0] = replay[3][0];
    replay[4][6] = Number(replay[4][0]) + period - 1;
    expect(() => parseFuturesResearchCandles(replay, '15m', asOf)).toThrow(/GAP_OR_REPLAY/);
    expect(() => parseFuturesResearchCandles([], '15m', asOf)).toThrow(/UNUSABLE/);
  });
});

describe('Read-only authenticated dual intelligence API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => { freshDb(false); market.reset(); app = await buildApp(); });
  afterEach(async () => { await app.close(); closeDb(); market.reset(); });
  it('requires owner session and never creates orders, fills or positions', async () => {
    expect((await app.inject({ url: '/api/choice/dual/fast' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/choice/dual/deep?symbol=BTCUSDT' })).statusCode).toBe(401);
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'dual research test owner' } });
    expect(setup.statusCode).toBe(200);
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    market.dex = [{ ...dexPair, pairCreatedAt: Date.now() - 60000 }];
    market.dexFetchedAt = Date.now();
    const fast = await app.inject({ url: '/api/choice/dual/fast', headers: { cookie } });
    expect(fast.statusCode).toBe(200);
    expect(fast.json()).toMatchObject({ lane: 'FAST_MEMECOIN', status: 'NO_TRADE', tradingAuthority: false });
    const deep = await app.inject({ url: '/api/choice/dual/deep?symbol=BTCUSDT', headers: { cookie } });
    expect(deep.statusCode).toBe(200);
    expect(deep.json()).toMatchObject({ lane: 'DEEP_FUTURES', state: 'NO_TRADE', tradingAuthority: false, plan: null });
    expect((await app.inject({ url: '/api/choice/dual/deep?symbol=UNKNOWN', headers: { cookie } })).statusCode).toBe(400);
    for (const table of ['orders', 'fills', 'positions', 'ledger_entries'])
      expect(all('SELECT * FROM ' + table)).toHaveLength(0);
  });
});
