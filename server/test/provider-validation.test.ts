import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { assessCexAsset, assessDexPair } from '../src/safety/safety.js';
import { validRules } from '../src/providers/binance.js';
import { validQuote } from '../src/providers/coinbase.js';
import { SAFE_CHAIN, SAFE_ADDRESS } from '../src/providers/dexscreener.js';

/** Malformed or stale provider data must never read as PASS / usable (MIA-SAFE-001/002, MIA-PROV-001/002/003). */
describe('provider data validation', () => {
  beforeEach(() => { freshDb(); market.reset(); });
  it('CEX safety: NaN fields or a stale ticker/book give UNVERIFIED, never a PASS', () => {
    const { inst } = seedInstrument('ETHUSDT', { seed: 2 }) as any;
    expect(assessCexAsset(inst.id).status).not.toBe('UNVERIFIED'); // fresh, valid data: assessed normally
    market.tickers.get(inst.id)!.changePct = NaN; // "N/A" from the provider
    const nan = assessCexAsset(inst.id); expect(nan.status).toBe('UNVERIFIED'); expect(nan.eligibleForAutomation).toBe(false);
    expect(nan.checks.some((c) => c.name === 'pump/dump pattern' && c.result === 'PASS')).toBe(false);
    market.tickers.get(inst.id)!.changePct = 2; market.tickers.get(inst.id)!.receivedAt = Date.now() - 30 * 60_000;
    expect(assessCexAsset(inst.id).status).toBe('UNVERIFIED');
    market.tickers.get(inst.id)!.receivedAt = Date.now(); market.deep.get(inst.id)!.book!.ts = Date.now() - 30 * 60_000;
    const staleBook = assessCexAsset(inst.id); expect(staleBook.status).toBe('UNVERIFIED');
    expect(staleBook.checks.find((c) => c.name === 'order book')?.detail).toMatch(/stale/);
  });
  it('DEX safety: unreported liquidity is REJECTED; a seconds timestamp is not trusted as an age', () => {
    const base = { chainId: 'solana', dexId: 'x', pairAddress: 'p', url: '', baseSymbol: 'T', baseName: 'T', baseAddress: 'a', quoteSymbol: 'SOL', priceUsd: 1, fdv: 1e6, marketCap: 1e6,
      volume24h: 1e5, volume1h: 1e4, buys24h: 100, sells24h: 90, buys1h: 5, sells1h: 4, change1h: 0, change24h: 5, hasSocials: true, hasWebsite: true };
    expect(assessDexPair({ ...base, liquidityUsd: NaN, pairCreatedAt: Date.now() - 86400_000 * 10 }).status).toBe('REJECTED');
    const secs = assessDexPair({ ...base, liquidityUsd: 500_000, pairCreatedAt: Math.floor(Date.now() / 1000) });
    expect(secs.checks.find((c) => c.name === 'pair age')?.result).toBe('NOT_AVAILABLE');
    expect(secs.eligibleForAutomation).toBe(false);
  });
  it('symbol rules must be finite and positive; cross quotes must be finite, positive, uncrossed and dated', () => {
    const r = { symbol: 'X', base: 'X', quote: 'USDT', status: 'TRADING', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5 };
    expect(validRules(r)).toBe(true);
    for (const bad of [{ stepSize: NaN }, { stepSize: -0.001 }, { stepSize: 0 }, { tickSize: NaN }, { minNotional: NaN }]) expect(validRules({ ...r, ...bad })).toBe(false);
    const q = { price: 100, bid: 99.9, ask: 100.1, ts: Date.now(), venue: 'k' };
    expect(validQuote(q)).toBe(true);
    for (const bad of [{ price: NaN }, { bid: 0 }, { bid: 101, ask: 100 }, { ts: NaN }]) expect(validQuote({ ...q, ...bad })).toBe(false);
  });
  it('DEX profile ids that would change the request path are refused', () => {
    expect(SAFE_CHAIN.test('solana') && SAFE_CHAIN.test('base')).toBe(true);
    for (const bad of ['../../latest/dex/search?q=x#', 'SOLANA', 'a/b', '']) expect(SAFE_CHAIN.test(bad)).toBe(false);
    expect(SAFE_ADDRESS.test('So11111111111111111111111111111111111111112')).toBe(true);
    expect(SAFE_ADDRESS.test('abc/../x')).toBe(false);
  });
});
