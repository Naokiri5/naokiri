import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { market } from '../src/market/store.js';
import type { DexPair } from '../src/providers/dexscreener.js';
import {
  FUTURES_RESEARCH_SYMBOLS, type FuturesResearchSymbol,
  type fetchFuturesResearchSnapshot,
} from '../src/providers/binanceFuturesResearch.js';
import { INTERVAL_MS, type Interval, type Candle } from '../src/market/types.js';
import {
  runDualResearchPass, dualResearchStatus, _resetDualResearchForTests,
} from '../src/choice/dualRuntime.js';
import { buildApp } from '../src/index.js';
import { all, closeDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';

const NOW = Date.UTC(2026, 10, 23, 12, 0, 5);
const pair: DexPair = {
  chainId: 'solana', dexId: 'fixture', pairAddress: 'test-pair',
  url: 'https://example.invalid/pair', baseSymbol: 'NEW', baseName: 'New Token',
  baseAddress: 'test-mint', quoteSymbol: 'SOL', priceUsd: 0.01,
  liquidityUsd: 100000, fdv: 1000000, marketCap: 800000,
  volume24h: 100000, volume1h: 9000, buys24h: 50, sells24h: 25,
  buys1h: 8, sells1h: 4, change1h: 1, change24h: 5,
  pairCreatedAt: NOW - 60_000, hasSocials: true, hasWebsite: true,
};

function bars(interval: Interval): Candle[] {
  const period = INTERVAL_MS[interval];
  // Every interval ends strictly before the shared snapshot cutoff.
  const lastOpen = Math.floor((NOW - period) / period) * period;
  return Array.from({ length: 45 }, (_, i) => {
    const t = lastOpen - (44 - i) * period;
    const price = 100 + i * 0.5;
    return { t, o: price, h: price + 1, l: price - 1,
      c: price + 0.3, v: 1000 + i, closeTime: t + period - 1 };
  });
}

type Snapshot = Awaited<ReturnType<typeof fetchFuturesResearchSnapshot>>;
const snapshot = (symbol: FuturesResearchSymbol): Snapshot => ({
  symbol, market: 'CRYPTO_PERPETUAL_FUTURES', source: 'binance-usdm-public-klines',
  asOf: NOW, candles: { '15m': bars('15m'), '1h': bars('1h'), '4h': bars('4h') },
});

beforeEach(() => {
  market.reset(); market.dexFetchedAt = NOW; market.dex = [pair];
  _resetDualResearchForTests();
});
afterEach(() => {
  market.reset(); market.dexFetchedAt = 0;
  _resetDualResearchForTests();
});

describe('running dual-intelligence background research', () => {
  it('consumes existing FAST evidence and evaluates real DEEP chart functions without order authority', async () => {
    const reader = vi.fn(async (symbol: FuturesResearchSymbol) => snapshot(symbol));
    const state = await runDualResearchPass(reader, NOW);
    expect(state.fast.result?.lane).toBe('FAST_MEMECOIN');
    expect(state.fast.result?.candidates).toHaveLength(1);
    expect(state.fast.result?.tradingAuthority).toBe(false);
    expect(state.deep.symbol).toBe('BTCUSDT');
    expect(state.deep.result?.lane).toBe('DEEP_FUTURES');
    expect(state.deep.result?.tradingAuthority).toBe(false);
    expect(state.deep.error).toBeNull();
    expect(state.deep.stale).toBe(false);
    expect(state.backgroundRunning).toBe(false);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('bounds futures requests and rotates known supported symbols only', async () => {
    const reader = vi.fn(async (symbol: FuturesResearchSymbol) => snapshot(symbol));
    await runDualResearchPass(reader, NOW);
    await runDualResearchPass(reader, NOW + 60_000);
    expect(reader).toHaveBeenCalledTimes(1);
    const next = await runDualResearchPass(reader, NOW + 5 * 60_000);
    expect(next.deep.symbol).toBe('ETHUSDT');
    expect(reader).toHaveBeenCalledTimes(2);
    expect(FUTURES_RESEARCH_SYMBOLS).toContain(next.deep.symbol);
  });

  it('fails closed on provider outage, rather than reusing old DEEP plans', async () => {
    await runDualResearchPass(async (symbol) => snapshot(symbol), NOW);
    const broken = await runDualResearchPass(async () => { throw new Error('PROVIDER_DOWN'); }, NOW + 5 * 60_000);
    expect(broken.deep.result).toBeNull();
    expect(broken.deep.stale).toBe(true);
    expect(broken.deep.consecutiveFailures).toBe(1);
    expect(broken.deep.error).toContain('PROVIDER_DOWN');
    expect(broken.fast.result?.candidates).toHaveLength(0); // source is now over four minutes old
    expect(broken.fast.stale).toBe(true);
  });

  it('ignores concurrent passes, while the first provider request is in flight', async () => {
    let release!: (value: Snapshot) => void;
    const reader = vi.fn((_symbol: FuturesResearchSymbol) => new Promise<Snapshot>((resolve) => { release = resolve; }));
    const first = runDualResearchPass(reader, NOW);
    const second = await runDualResearchPass(reader, NOW);
    expect(second.backgroundRunning).toBe(true);
    expect(reader).toHaveBeenCalledTimes(1);
    release(snapshot('BTCUSDT'));
    expect((await first).backgroundRunning).toBe(false);
  });
});

describe('authenticated background research status', () => {
  it('is protected, observable and cannot alter orders, fills or the financial ledger', async () => {
    freshDb(false);
    const app = await buildApp();
    try {
      expect((await app.inject({ url: '/api/choice/dual/status' })).statusCode).toBe(401);
      const setup = await app.inject({
        method: 'POST', url: '/api/auth/setup',
        payload: { password: 'dual runtime status owner' },
      });
      expect(setup.statusCode).toBe(200);
      const cookie = String(setup.headers['set-cookie']).split(';')[0];
      const reader = vi.fn(async (symbol: FuturesResearchSymbol) => snapshot(symbol));
      await runDualResearchPass(reader, NOW);
      const response = await app.inject({ url: '/api/choice/dual/status', headers: { cookie } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        version: 'dual-runtime-v1', tradingAuthority: false,
        fast: { result: { lane: 'FAST_MEMECOIN', tradingAuthority: false } },
        deep: { result: { lane: 'DEEP_FUTURES', tradingAuthority: false } },
      });
      for (const table of ['orders', 'fills', 'positions', 'ledger_entries'])
        expect(all('SELECT * FROM ' + table)).toHaveLength(0);
      expect(dualResearchStatus(NOW).backgroundRunning).toBe(false);
    } finally {
      await app.close();
      closeDb();
    }
  });
});
