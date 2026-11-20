import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb } from './helpers.js';
import { market } from '../src/market/store.js';
import { matchAssets } from '../src/news/news.js';
import { safeHttpUrl, escapeRegExp, displayText } from '../src/core/util.js';
import { config } from '../src/config.js';
import { _resetProviderBlocks } from '../src/providers/http.js';
import { search as dexSearch } from '../src/providers/dexscreener.js';

/** Provider strings (CoinGecko symbols, RSS links, DEX Screener URLs) are untrusted data. */
describe('untrusted provider text', () => {
  beforeEach(() => { freshDb(); market.cg.clear(); });
  it('MIA-SEC-004: a symbol with regex metacharacters does not break news matching', () => {
    for (const symbol of ['USD+(', '(((', '(A+)+B', '[X]']) market.cg.set(symbol, { id: symbol, symbol, name: 'Zz', price: 1, marketCap: 1, rank: 1, volume: 1, change24h: 0, image: '' });
    market.cg.set('SOL', { id: 'solana', symbol: 'SOL', name: 'Solana', price: 1, marketCap: 1, rank: 2, volume: 1, change24h: 0, image: '' });
    expect(() => matchAssets('USD+( and SOL rally while bitcoin holds')).not.toThrow(); // threw SyntaxError before the fix
    expect(matchAssets('USD+( and SOL rally while bitcoin holds')).toEqual(expect.arrayContaining(['SOL', 'BTC']));
    expect(matchAssets('X marks the spot')).not.toContain('[X]'); // treated literally, not as the character class [X]
  });
  it('MIA-SEC-006: only absolute http(s) links survive', () => {
    expect(safeHttpUrl('https://news.example.com/a?b=1')).toBe('https://news.example.com/a?b=1');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    for (const bad of ['javascript:alert(1)', ' JavaScript:fetch(1)', 'data:text/html,x', '/relative', '', 'vbscript:x', 'https://' + 'a'.repeat(3000), null, 42])
      expect(safeHttpUrl(bad)).toBe('');
  });
  it('escapeRegExp escapes every metacharacter', () => {
    const s = '.*+?^${}()|[]\\'; expect(new RegExp(`^${escapeRegExp(s)}$`).test(s)).toBe(true);
  });
});

/** Omega PR-01 third review: DEX Screener token text is cleaned once, where it enters MIA (every tab benefits). */
describe('DEX Screener token text and quote identity', () => {
  const realFetch = globalThis.fetch; const offline = config.offline;
  beforeEach(() => { freshDb(); _resetProviderBlocks(); Object.assign(config, { offline: false }); });
  afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, { offline }); _resetProviderBlocks(); });

  it('displayText strips control, bidi, filler and stacked-mark characters and truncates by code point', () => {
    expect(displayText('US\u202EDC\u3164\u0336', '?')).toBe('USDC');
    expect(displayText(42, '?')).toBe('?');
    expect(Array.from(displayText('\u{1F600}'.repeat(90), '?', 80))).toHaveLength(80);
  });
  it('search() returns cleaned symbols/names and only a well-formed quote address', async () => {
    const pair = (quoteAddress: unknown) => ({
      chainId: 'solana', dexId: 'ray\u202Edium', pairAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', url: 'javascript:alert(1)',
      baseToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'US\u202EDC\u200B', name: 'Real\u2028Coin\u3164' },
      quoteToken: { address: quoteAddress, symbol: 'S\u0336OL' }, priceUsd: '1', liquidity: { usd: 1000 },
    });
    globalThis.fetch = (async () => new Response(JSON.stringify({ pairs: [pair('So11111111111111111111111111111111111111112'), pair('../../etc'), pair(null)] }),
      { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const [a, b, c] = await dexSearch('usdc');
    expect(a).toMatchObject({ baseSymbol: 'USDC', baseName: 'RealCoin', quoteSymbol: 'SOL', dexId: 'raydium', url: '', quoteAddress: 'So11111111111111111111111111111111111111112' });
    expect(b.quoteAddress).toBe(''); // not an address: unknown, so untrusted downstream
    expect(c.quoteAddress).toBe('');
  });
});
