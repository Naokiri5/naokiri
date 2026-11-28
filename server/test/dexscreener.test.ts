import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { latestTokenPairs, search } from '../src/providers/dexscreener.js';

const mint = 'So11111111111111111111111111111111111111112';
const quote = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pool = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';
const otherMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const ethereum = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const dexPair = (overrides: Record<string, unknown> = {}) => ({
  chainId: 'solana',
  dexId: 'test',
  pairAddress: pool,
  baseToken: { address: mint, symbol: 'SOL' },
  quoteToken: { address: quote, symbol: 'Untrusted label' },
  liquidity: { usd: 100_000 },
  ...overrides,
});

describe('DEX Screener canonical pair discovery', () => {
  const fetchDex = vi.fn<typeof fetch>();
  let offline: boolean;

  beforeEach(() => {
    offline = config.offline;
    config.offline = false;
    fetchDex.mockReset();
    vi.stubGlobal('fetch', fetchDex);
  });

  afterEach(() => {
    config.offline = offline;
    vi.unstubAllGlobals();
  });

  it('keeps one valid Solana pair per requested mint and keeps quote identity separate from labels', async () => {
    fetchDex.mockResolvedValueOnce(Response.json([
      { chainId: 'solana', tokenAddress: mint },
      { chainId: 'solana', tokenAddress: mint },
      { chainId: 'solana', tokenAddress: '1'.repeat(33) },
    ]));
    fetchDex.mockResolvedValueOnce(Response.json([
      dexPair(),
      dexPair({ pairAddress: otherMint, liquidity: { usd: 50_000 } }),
      dexPair({ chainId: 'ethereum', liquidity: { usd: 9_000_000 } }),
      dexPair({ pairAddress: '1'.repeat(33), liquidity: { usd: 9_000_000 } }),
      dexPair({ baseToken: { address: otherMint }, quoteToken: { address: mint }, liquidity: { usd: 9_000_000 } }),
      dexPair({ baseToken: { address: mint.toUpperCase() }, liquidity: { usd: 9_000_000 } }),
    ]));

    await expect(latestTokenPairs()).resolves.toEqual([
      expect.objectContaining({ chainId: 'solana', baseAddress: mint, pairAddress: pool,
        quoteAddress: quote, quoteSymbol: 'Untrusted label' }),
    ]);
    expect(fetchDex).toHaveBeenNthCalledWith(2, `https://api.dexscreener.com/tokens/v1/solana/${mint}`, expect.anything());
    expect(fetchDex).toHaveBeenCalledTimes(2);
  });

  it('accepts case-equivalent EVM addresses and retains a missing quote identity as absent', async () => {
    fetchDex.mockResolvedValueOnce(Response.json([{ chainId: 'ethereum', tokenAddress: ethereum }]));
    fetchDex.mockResolvedValueOnce(Response.json([
      dexPair({ chainId: 'ethereum', pairAddress: ethereum, baseToken: { address: ethereum.toLowerCase() },
        quoteToken: { symbol: 'USDC' } }),
    ]));

    const pairs = await latestTokenPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ chainId: 'ethereum', baseAddress: ethereum.toLowerCase(), quoteSymbol: 'USDC' });
    expect(pairs[0]).not.toHaveProperty('quoteAddress');
  });

  it('cannot create a quote mint from a ticker or an invalid Solana address returned by search', async () => {
    fetchDex.mockResolvedValueOnce(Response.json({ pairs: [
      dexPair({ quoteToken: { address: '1'.repeat(33), symbol: 'SOL' } }),
      dexPair({ baseToken: { address: '1'.repeat(33) } }),
    ] }));

    const pairs = await search('SOL');
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ baseAddress: mint, quoteSymbol: 'SOL' });
    expect(pairs[0]).not.toHaveProperty('quoteAddress');
  });
});
