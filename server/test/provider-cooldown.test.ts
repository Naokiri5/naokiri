import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { fetchProvider, registerProvider, setRateLimit } from '../src/providers/http.js';

let offline: boolean;
beforeEach(() => {
  offline = config.offline;
  config.offline = false;
  vi.useFakeTimers({ toFake: ['Date', 'performance'] });
});
afterEach(() => {
  config.offline = offline;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const register = (id: string) => registerProvider({
  id, name: id, sourceClass: 'cex', markets: ['crypto'], license: 'fixture',
  realtime: 'REALTIME', requiresCredentials: false,
});
const url = 'https://example.invalid/market';
const success = () => new Response('{"ok":true}', { status: 200 });

describe('canonical market provider cooldown', () => {
  it('honors Retry-After across all callers without counting suppressed calls as network failures', async () => {
    const info = register('cooldown-fixture');
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '5' } })).mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetch);
    await expect(fetchProvider(info.id, url)).rejects.toMatchObject({ status: 429 });
    await expect(fetchProvider(info.id, url)).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(info.errorCount).toBe(1);
    vi.advanceTimersByTime(4999);
    await expect(fetchProvider(info.id, url)).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(1);
    await expect(fetchProvider(info.id, url)).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(info.status).toBe('LIVE');
  });
  it('uses a conservative fallback for invalid Retry-After without blocking other providers', async () => {
    const a = register('fallback-fixture');
    const b = register('other-fixture');
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': 'invalid' } })).mockImplementation(async () => success());
    vi.stubGlobal('fetch', fetch);
    await expect(fetchProvider(a.id, url)).rejects.toMatchObject({ status: 429 });
    await expect(fetchProvider(b.id, url)).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(59_999);
    await expect(fetchProvider(a.id, url)).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(1);
    await expect(fetchProvider(a.id, url)).resolves.toEqual({ ok: true });
    expect(() => setRateLimit(a.id, NaN)).toThrow('INVALID_PROVIDER_RATE_LIMIT');
  });
  it('does not clear a cooldown when an already dispatched request succeeds', async () => {
    const info = register('concurrent-fixture');
    let finish!: (r: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3' } }));
    vi.stubGlobal('fetch', fetch);
    const first = fetchProvider(info.id, url);
    await Promise.resolve();
    await expect(fetchProvider(info.id, url)).rejects.toMatchObject({ status: 429 });
    finish(success());
    await expect(first).resolves.toEqual({ ok: true });
    expect(info.status).toBe('DEGRADED');
    await expect(fetchProvider(info.id, url)).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
