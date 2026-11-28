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
import { sessionPreflight } from '../src/ops/sessionPreflight.js';
import { freshDb } from './helpers.js';
import type { MintObservation } from '../src/providers/solanaRpc.js';

const NOW = Date.UTC(2026, 10, 23, 12, 0, 5);
const pair: DexPair = {
  chainId: 'solana', dexId: 'fixture', pairAddress: '11111111111111111111111111111111',
  url: 'https://example.invalid/pair', baseSymbol: 'NEW', baseName: 'New Token',
  baseAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', quoteSymbol: 'SOL', priceUsd: 0.01,
  liquidityUsd: 100000, fdv: 1000000, marketCap: 800000,
  volume24h: 100000, volume1h: 9000, buys24h: 50, sells24h: 25,
  buys1h: 8, sells1h: 4, change1h: 1, change24h: 5,
  pairCreatedAt: NOW - 60_000, hasSocials: true, hasWebsite: true,
};

function bars(interval: Interval, asOf = NOW): Candle[] {
  const period = INTERVAL_MS[interval];
  // Every interval ends strictly before the shared snapshot cutoff.
  const lastOpen = Math.floor((asOf - period) / period) * period;
  return Array.from({ length: 45 }, (_, i) => {
    const t = lastOpen - (44 - i) * period;
    const price = 100 + i * 0.5;
    return { t, o: price, h: price + 1, l: price - 1,
      c: price + 0.3, v: 1000 + i, closeTime: t + period - 1 };
  });
}

type Snapshot = Awaited<ReturnType<typeof fetchFuturesResearchSnapshot>>;
const snapshot = (symbol: FuturesResearchSymbol, asOf = NOW): Snapshot => ({
  symbol, market: 'CRYPTO_PERPETUAL_FUTURES', source: 'binance-usdm-public-klines',
  asOf, candles: { '15m': bars('15m', asOf), '1h': bars('1h', asOf), '4h': bars('4h', asOf) },
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

  it('prepares a Solana snapshot once and persists finalized mint restrictions in its existing candidate', async () => {
    freshDb(false);
    try {
      const listed = { ...pair, quoteAddress: 'So11111111111111111111111111111111111111112' };
      market.dex = [listed, { ...listed, chainId: 'ethereum' }];
      const observation: MintObservation = { mintAddress: pair.baseAddress, commitment: 'finalized',
        slot: 1234, checkedAt: NOW, program: 'SPL_TOKEN', status: 'BLOCKED', reasons: ['ACTIVE_FREEZE_AUTHORITY'] };
      const mintReader = vi.fn(async () => [observation]);
      const reader = async (symbol: FuturesResearchSymbol) => snapshot(symbol);
      const state = await runDualResearchPass(reader, NOW, () => true, mintReader);
      expect(mintReader).toHaveBeenCalledExactlyOnceWith([pair.baseAddress]);
      expect(state.fast.result).toMatchObject({ mintSourceStatus: 'OBSERVED', tradingAuthority: false, candidates: [
        { mintObservation: observation, knownQuote: true, safetyStatus: 'REJECTED', eligibleForAutomation: false },
      ] });
      expect(all<{ state: string; evidence_json: string }>('SELECT state,evidence_json FROM flin_launch_candidates')).toEqual([
        { state: 'REJECTED', evidence_json: expect.stringContaining('ACTIVE_FREEZE_AUTHORITY') },
      ]);
      await runDualResearchPass(reader, NOW + 30_000, () => true, mintReader);
      expect(mintReader).toHaveBeenCalledTimes(1);
      expect(dualResearchStatus(NOW + 240_001).fast.stale).toBe(true);
      expect(all('SELECT id FROM orders')).toHaveLength(0);
    } finally { closeDb(); }
  });

  it('does not persist a FAST cohort that expires during the mint read', async () => {
    freshDb(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = NOW + 240_000 - 1;
    vi.setSystemTime(start);
    try {
      market.dex = [{ ...pair, quoteAddress: 'So11111111111111111111111111111111111111112' }];
      const state = await runDualResearchPass(async (symbol) => snapshot(symbol), start, () => true, async () => {
        vi.setSystemTime(start + 2);
        return [];
      });
      expect(state.fast).toMatchObject({ stale: true, launchIntake: { status: 'STALE_SOURCE' },
        result: { candidates: [], mintSourceStatus: 'NOT_CHECKED' } });
      expect(all('SELECT candidate_id FROM flin_launch_candidates')).toHaveLength(0);
    } finally { vi.useRealTimers(); closeDb(); }
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

  it('retains one result per contract and isolates a failed refresh from the other instruments', async () => {
    const poll = 5 * 60_000;
    const reader = vi.fn(async (symbol: FuturesResearchSymbol, cutoff = NOW) => snapshot(symbol, cutoff));
    expect(dualResearchStatus(NOW).deepInstruments).toMatchObject(FUTURES_RESEARCH_SYMBOLS.map((symbol) => ({
      instrumentId: `futures:binance-usdm:${symbol}`, symbol, result: null, stale: true,
    })));
    await runDualResearchPass(reader, NOW);
    await runDualResearchPass(reader, NOW + poll);
    const ready = await runDualResearchPass(reader, NOW + 2 * poll);
    expect(reader.mock.calls.map(([symbol]) => symbol)).toEqual(FUTURES_RESEARCH_SYMBOLS);
    expect(ready.deepInstruments).toMatchObject(FUTURES_RESEARCH_SYMBOLS.map((symbol) => ({
      symbol, result: { symbol, tradingAuthority: false }, stale: false, error: null,
    })));

    reader.mockRejectedValueOnce(new Error('BTC unavailable'));
    const partial = await runDualResearchPass(reader, NOW + 3 * poll);
    expect(partial.deep).toMatchObject({ symbol: 'BTCUSDT', result: null, stale: true, error: 'BTC unavailable' });
    expect(partial.deepInstruments).toMatchObject([
      { symbol: 'BTCUSDT', attemptAt: NOW + 3 * poll, successAt: NOW, result: null, stale: true, consecutiveFailures: 1 },
      { symbol: 'ETHUSDT', attemptAt: NOW + poll, successAt: NOW + poll, result: { symbol: 'ETHUSDT' }, stale: false },
      { symbol: 'SOLUSDT', attemptAt: NOW + 2 * poll, successAt: NOW + 2 * poll, result: { symbol: 'SOLUSDT' }, stale: false },
    ]);
    expect(dualResearchStatus(NOW + 7 * poll).deepInstruments.every((instrument) => instrument.stale)).toBe(true);

    freshDb(false);
    try {
      const at = NOW + 3 * poll;
      const preflight = sessionPreflight({ running: false, role: 'STOPPED', startedAt: 0, lastTickerAt: 0,
        lastScanAt: 0, lastMonitorAt: 0, monitorFailing: false }, 'DEEP', 'PAPER', at);
      expect(preflight.checks).toContainEqual(expect.objectContaining({ id: 'market-data', status: 'PASS' }));
      expect(preflight.canRun).toBe(false);
    } finally { closeDb(); }
  });

  it('rejects wrong-symbol and future snapshots without poisoning another instrument', async () => {
    const poll = 5 * 60_000;
    await runDualResearchPass(async (symbol) => snapshot(symbol), NOW);
    await runDualResearchPass(async () => snapshot('BTCUSDT'), NOW + poll);
    const status = await runDualResearchPass(async (symbol) => snapshot(symbol, NOW + 2 * poll + 1), NOW + 2 * poll);
    expect(status.deepInstruments).toMatchObject([
      { symbol: 'BTCUSDT', stale: false, result: { symbol: 'BTCUSDT' } },
      { symbol: 'ETHUSDT', stale: true, error: 'FUTURES_SNAPSHOT_IDENTITY_MISMATCH', result: null },
      { symbol: 'SOLUSDT', stale: true, error: 'FUTURES_SNAPSHOT_IDENTITY_MISMATCH', result: null },
    ]);
    expect(dualResearchStatus(NOW - 1).deepInstruments.every((instrument) => instrument.stale)).toBe(true);
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

  it('discards a completed provider request after its lease check fails', async () => {
    const at = NOW + 5 * 60_000;
    await runDualResearchPass(async (symbol) => snapshot(symbol), NOW);
    let release!: (value: Snapshot) => void;
    let stillLeader = true;
    const reader = vi.fn((_symbol: FuturesResearchSymbol) => new Promise<Snapshot>((resolve) => { release = resolve; }));
    const pending = runDualResearchPass(reader, at, () => stillLeader);
    expect(reader).toHaveBeenCalledWith('ETHUSDT', at - 2000);
    stillLeader = false;
    release(snapshot('ETHUSDT', at - 2000));

    const status = await pending;
    expect(status.backgroundRunning).toBe(false);
    expect(status.deep).toMatchObject({ symbol: 'BTCUSDT', successAt: NOW, stale: false });
    expect(status.deepInstruments.find(({ symbol }) => symbol === 'ETHUSDT')).toMatchObject({
      attemptAt: 0, successAt: 0, stale: true, result: null,
    });
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
        deepInstruments: [
          { symbol: 'BTCUSDT', instrumentId: 'futures:binance-usdm:BTCUSDT', result: { tradingAuthority: false } },
          { symbol: 'ETHUSDT', instrumentId: 'futures:binance-usdm:ETHUSDT', result: null },
          { symbol: 'SOLUSDT', instrumentId: 'futures:binance-usdm:SOLUSDT', result: null },
        ],
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
