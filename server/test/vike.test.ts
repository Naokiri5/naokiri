import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Transport is mocked: no network. (Adapted from the owner-supplied vike.test.ts to the spec-checked adapter.)
vi.mock('../src/providers/http.js', () => ({ registerProvider: vi.fn(), setRateLimit: vi.fn(), fetchProvider: vi.fn(async () => ({ ok: true, source: 'fixture' })) }));
import { fetchProvider, registerProvider, setRateLimit } from '../src/providers/http.js';
import * as vike from '../src/providers/vike.js';

const mockedFetch = vi.mocked(fetchProvider);
// Registration happens once at import; capture it before beforeEach clears the fetch mock.
const registrations = vi.mocked(registerProvider).mock.calls.map((c) => c[0]);
const limits = vi.mocked(setRateLimit).mock.calls.map((c) => [...c]);
const KEY = 'vk_' + 'X'.repeat(32);
describe('Vike credentialed research adapter', () => {
  beforeEach(() => { mockedFetch.mockClear(); process.env.MIA_VIKE_API_KEY = KEY; });

  it('registers once with the existing provider registry and a 100/min budget (half of Vike\'s 200/min)', () => {
    expect(registrations.some((p) => p.id === 'vike-data' && p.requiresCredentials && p.sourceClass === 'onchain')).toBe(true);
    expect(limits).toContainEqual(['vike-data', 100]);
  });
  it('requests only the allowlisted host and path, key in the header only, redirects refused', async () => {
    const r = await vike.searchVike('ETH', 5);
    const [provider, url, opts] = mockedFetch.mock.calls[0];
    expect(provider).toBe('vike-data');
    expect(new URL(url).origin).toBe('https://data.vike.io'); expect(new URL(url).pathname).toBe('/v1/search');
    expect(opts?.redirectMode).toBe('error');
    expect(opts?.headers?.['X-API-KEY']).toBe(KEY); expect(url).not.toContain(KEY);
    expect(r).toMatchObject({ source: 'vike-data', kind: 'RESEARCH_ONLY', tradeEligible: false, freshness: 'UNVERIFIED' });
  });
  it('never makes a network call when the key is missing or malformed', async () => {
    delete process.env.MIA_VIKE_API_KEY;
    await expect(vike.searchVike('BTC')).rejects.toThrow(vike.VikeNotConfiguredError);
    process.env.MIA_VIKE_API_KEY = 'not-a-vike-key';
    await expect(vike.searchVike('BTC')).rejects.toThrow(/invalid format/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
  it('enforces the spec limits before transport', () => {
    expect(() => vike.searchVike('BTC', 21)).toThrow(/limit/);
    expect(() => vike.searchVike('', 2)).toThrow(/invalid/);
    expect(() => vike.getVikeOnchainTokenScreener({ chain: 'base', sort: 'smart_inflow' })).toThrow(/ethereum/);
    expect(() => vike.getVikeOnchainTokenScreener({ limit: 101 })).toThrow(/limit/);
    expect(() => vike.getVikePolymarketMarkets({ offset: 10_001 })).toThrow(/offset/);
    expect(() => vike.discoverVikeWallets({ chain: 'solana' as any })).toThrow(/chain/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
  it('blocks endpoint and parameter injection: values are encoded as query values, path is fixed', async () => {
    await vike.searchVike('x&limit=99/../../admin?y=1#z', 3);
    const u = new URL(mockedFetch.mock.calls[0][1]);
    expect(u.pathname).toBe('/v1/search'); expect(u.searchParams.get('limit')).toBe('3');
    expect(u.searchParams.get('q')).toBe('x&limit=99/../../admin?y=1#z'); expect(u.hash).toBe('');
  });
  it('archive: asset and tenor must be paired; the presigned link never leaves the server', async () => {
    await expect(vike.resolveVikePolymarketArchive({ date: '2026-11-18', stream: 'book_events', asset: 'btc' })).rejects.toThrow(/together/);
    mockedFetch.mockResolvedValueOnce({ url: 'https://files.example/signed?sig=SECRET', expires_in: 604800, expires_at: '2026-11-25T00:00:00Z', bytes: 123 });
    const r: any = await vike.resolveVikePolymarketArchive({ date: '2026-11-18', stream: 'book_events', asset: 'btc', tenor: '5m' });
    expect(new URL(mockedFetch.mock.calls[0][1]).pathname).toBe('/v1/polymarket/archive/url');
    expect(new URL(mockedFetch.mock.calls[0][1]).searchParams.get('redirect')).toBeNull();
    expect(JSON.stringify(r)).not.toContain('SECRET'); expect(JSON.stringify(r)).not.toContain('https://');
    expect(r.data.expires_at).toBe('2026-11-25T00:00:00Z');
  });
  it('every namespace goes through the same credentialed provider', async () => {
    await vike.discoverVikeWallets({ chain: 'base', size: 10, window: '90d' });
    await vike.getVikeOnchainTokenScreener({ chain: 'base', window: '24h' });
    await vike.getVikeHyperliquidCandles('BTC', { interval: '5m' });
    await vike.getVikePredictFunMarkets({ status: 'open' });
    await vike.getVikePolymarketMarkets({ query: 'bitcoin', limit: 10 });
    expect(mockedFetch.mock.calls.map((c) => new URL(c[1]).pathname)).toEqual(['/v1/onchain/wallets/discover', '/v1/onchain/tokens/screener', '/v1/hyperliquid/ohlcv', '/v1/predictfun/markets', '/v1/polymarket/markets']);
    expect(mockedFetch.mock.calls.every((c) => c[0] === 'vike-data' && c[2]?.redirectMode === 'error')).toBe(true);
  });
  it('a non-object response is rejected, never passed on as data', async () => {
    mockedFetch.mockResolvedValueOnce('<html>maintenance</html>');
    await expect(vike.searchVike('BTC')).rejects.toThrow(/unexpected Vike response/);
  });
  it('research code imports no OMS, signing, wallet or transfer module (skill check 4)', () => {
    for (const f of ['src/providers/vike.ts', 'src/research/vikeRoutes.ts']) {
      const imports = readFileSync(resolve(__dirname, '..', f), 'utf8').split('\n').filter((l) => /^import /.test(l)).join('\n');
      expect(imports, f).not.toMatch(/exec\/|oms|signing|wallet|transfer|ledger/);
    }
  });
});
