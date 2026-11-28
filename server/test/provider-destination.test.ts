import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { fetchProvider, providerDestinationDenial, providers, registerProvider } from '../src/providers/http.js';
import '../src/providers/binance.js';
import '../src/providers/pending.js';

let offline: boolean;
beforeEach(() => { offline = config.offline; config.offline = false; });
afterEach(() => { config.offline = offline; vi.unstubAllGlobals(); });

const info = registerProvider({ id: 'ssrf-fixture', name: 'fixture', sourceClass: 'cex', markets: ['crypto'], license: 'fixture',
  realtime: 'REALTIME', requiresCredentials: false, hosts: ['api.example.invalid'] });
const ok = () => new Response('{"ok":true}', { status: 200 });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

describe('provider destination allowlist (SSRF guard)', () => {
  it.each([
    ['http://api.example.invalid/x', /non-HTTPS/],
    ['https://169.254.169.254/latest/meta-data', /not registered/],
    ['https://localhost/admin', /not registered/],
    ['https://evil.example/x', /not registered/],
    ['https://api.example.invalid.evil.example/x', /not registered/],
    ['https://user:pw@api.example.invalid/x', /credentials or port/],
    ['https://api.example.invalid:8443/x', /credentials or port/],
    ['not a url', /invalid URL/],
  ])('refuses %s before any network call', async (url, reason) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(providerDestinationDenial(info.id, url)).toMatch(reason);
    await expect(fetchProvider(info.id, url)).rejects.toThrow(reason);
    expect(fetch).not.toHaveBeenCalled();
    expect(info.errorCount).toBe(0); // a refused destination is a code defect, not a provider outage
  });

  it('allows the registered host and follows a redirect that stays on it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('/v2/x')).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetch);
    await expect(fetchProvider(info.id, 'https://api.example.invalid/v1/x')).resolves.toEqual({ ok: true });
    expect(String(fetch.mock.calls[1][0])).toBe('https://api.example.invalid/v2/x');
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it.each([['https://evil.example/steal'], ['http://api.example.invalid/x'], ['https://169.254.169.254/']])('refuses a redirect to %s', async (to) => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect(to)).mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetch);
    await expect(fetchProvider(info.id, 'https://api.example.invalid/x')).rejects.toThrow(/redirect refused/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses redirect loops and redirects without a location', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => redirect('/again')));
    await expect(fetchProvider(info.id, 'https://api.example.invalid/x')).rejects.toThrow(/too many hops/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 301 })));
    await expect(fetchProvider(info.id, 'https://api.example.invalid/x')).rejects.toThrow(/missing location/);
  });

  it('fails closed for a provider without registered hosts and never echoes a token-bearing path', async () => {
    registerProvider({ id: 'no-hosts', name: 'x', sourceClass: 'cex', markets: [], license: 'x', realtime: 'REALTIME', requiresCredentials: false });
    await expect(fetchProvider('no-hosts', 'https://api.example.invalid/x')).rejects.toThrow(/no allowed hosts/);
    await expect(fetchProvider('telegram', 'https://evil.example/botSECRET123/sendMessage')).rejects.not.toThrow(/SECRET123/);
  });

  it('every provider that can fetch declares its hosts', () => {
    const fetching = ['binance', 'telegram'];
    for (const id of fetching) expect(providers().find((p) => p.id === id)?.hosts?.length, id).toBeGreaterThan(0);
  });
});
