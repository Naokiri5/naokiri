import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { market } from '../src/market/store.js';
import { matchAssets } from '../src/news/news.js';
import { safeHttpUrl, escapeRegExp } from '../src/core/util.js';

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
