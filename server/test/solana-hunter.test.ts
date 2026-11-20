/** Vitest regression tests for the read-only Solana Hunter. */
import { describe, it, expect, vi } from 'vitest';
import { rankSolanaPairs, type SolanaHuntPair } from '../src/solana/hunting.js';
import { assessParsedMint, inspectSolanaMint, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../src/solana/mint-audit.js';
import { GmgnReadClient } from '../src/solana/gmgn-read.js';
const mint = 'So11111111111111111111111111111111111111112';
const pair = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const now = Date.UTC(2026, 10, 19, 8);
const valid: SolanaHuntPair = {
  chainId: 'solana', dexId: 'raydium', pairAddress: pair, baseAddress: mint, baseSymbol: 'TEST', baseName: 'Mock',
  priceUsd: 0.01, liquidityUsd: 100_000, fdv: 100_000, marketCap: 100_000,
  volume24h: 90_000, volume1h: 30_000, buys1h: 35, sells1h: 15, change1h: 4, pairCreatedAt: now - 60_000
};

describe('Solana Hunter', () => {
  it('only includes Solana, deduplicates mints and never enables trading', () => {
    const rows = rankSolanaPairs([valid, { ...valid, liquidityUsd: 80_000 }, { ...valid, chainId: 'bsc' }], { nowMs: now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mint, liquidityUsd: 100_000, status: 'WATCH', tradingEligible: false });
  });
  it('rejects no-sell and underliquid pairs', () => {
    const rows = rankSolanaPairs([{ ...valid, liquidityUsd: 100, sells1h: 0 }], { nowMs: now });
    expect(rows[0].status).toBe('REJECT');
    expect(rows[0].blockers).toContain('LOW_LIQUIDITY');
    expect(rows[0].blockers).toContain('NO_OBSERVED_SELLS');
  });
  it('does not accept unknown age or invalid market data', () => {
    expect(rankSolanaPairs([{ ...valid, pairCreatedAt: null }], { nowMs: now })[0].status).toBe('INSUFFICIENT_DATA');
    expect(rankSolanaPairs([{ ...valid, priceUsd: NaN }], { nowMs: now })[0].status).toBe('REJECT');
  });
  const info = { decimals: 9, mintAuthority: null, freezeAuthority: null, supply: '100' };
  it('passes only simple mint-level checks with a verified owner program', () => {
    const a = assessParsedMint(mint, { owner: TOKEN_PROGRAM, data: { parsed: { type: 'mint', info } } });
    expect(a.status).toBe('PASS_MINT_CHECKS_ONLY');
    expect(a.tradingEligible).toBe(false);
  });
  it('blocks active mint/freeze permissions and risky Token-2022 extension', () => {
    const a = assessParsedMint(mint, { owner: TOKEN_2022_PROGRAM,
      data: { parsed: { type: 'mint', info: { ...info, mintAuthority: pair, extensions: [{ extension: 'transferHook' }] } } } });
    expect(a.status).toBe('BLOCK');
    expect(a.reasons).toContain('BLOCK_ACTIVE_MINT_AUTHORITY');
    expect(a.reasons).toContain('BLOCK_RISKY_EXTENSION_transferHook');
  });
  it('fails closed when unrecognized extensions or wrong owner are present', () => {
    expect(assessParsedMint(mint, { owner: TOKEN_PROGRAM, data: { parsed: { type: 'mint', info: { ...info, extensions: [{ extension: 'unknownFutureExtension' }] } } } }).status).toBe('UNKNOWN');
    expect(assessParsedMint(mint, { owner: 'UNKNOWN', data: { parsed: { type: 'mint', info } } }).status).toBe('BLOCK');
  });
  it('uses read-only getAccountInfo and rejects RPC outages', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: { value: { owner: TOKEN_PROGRAM, data: { parsed: { type: 'mint', info } } } } }) });
    const a = await inspectSolanaMint(mint, 'https://rpc.example.org', fn as unknown as typeof fetch);
    expect(a.status).toBe('PASS_MINT_CHECKS_ONLY');
    const req = fn.mock.calls[0][1];
    expect(JSON.parse(req.body).method).toBe('getAccountInfo');
    expect(await inspectSolanaMint(mint, 'http://unsafe.invalid', fn as unknown as typeof fetch)).toMatchObject({ status: 'UNKNOWN' });
    expect(await inspectSolanaMint(mint, 'https://rpc.example.org', vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch)).toMatchObject({ status: 'UNKNOWN' });
  });
  it('calls documented GMGN read-only routes with no signature or swap access', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: [{ id: 'mock' }] }) });
    const client = new GmgnReadClient('test-key', fn as unknown as typeof fetch);
    expect(await client.trending('5m')).toEqual([{ id: 'mock' }]);
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.host).toBe('openapi.gmgn.ai');
    expect(url.pathname).toBe('/v1/market/rank');
    expect(url.searchParams.get('chain')).toBe('sol');
    expect(fn.mock.calls[0][1].headers['X-APIKEY']).toBe('test-key');
    expect(fn.mock.calls[0][1].headers['X-Signature']).toBeUndefined();
    await client.tokenSecurity(mint);
    expect(new URL(fn.mock.calls[1][0]).pathname).toBe('/v1/token/security');
    expect(() => new GmgnReadClient('')).toThrow('GMGN_API_KEY_REQUIRED');
  });

});
