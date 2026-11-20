import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { fetchProvider, provider } from '../src/providers/http.js';
import '../src/providers/binance.js';
import '../src/providers/pending.js';
import '../src/providers/vike.js';
import { ETH_RPC, readOnlyRpc } from '../src/research/aave.js';

describe('provider outbound policy', () => {
  const offline = config.offline;
  const transport = vi.fn<typeof fetch>();

  beforeEach(() => {
    config.offline = false;
    transport.mockReset();
    transport.mockImplementation(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', transport);
  });
  afterEach(() => {
    config.offline = offline;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    'data endpoint',
    'http://market.example/health',
    'https://localhost/health',
    'https://127.0.0.1/health',
    'https://[::1]/health',
    'https://account@market.example/health',
    'https://market.example/health#bookmark',
  ])('rejects an invalid HTTPS provider destination before dispatch', async (url) => {
    await expect(fetchProvider('binance', url)).rejects.toThrow(/destination/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('requires the intended credentialed provider origin', async () => {
    await expect(fetchProvider('telegram', 'https://market.example/sendMessage')).rejects.toThrow(/destination/i);
    await expect(fetchProvider('vike-data', 'https://market.example/v1/tokens', { headers: { 'X-API-KEY': 'fixture' } })).rejects.toThrow(/destination/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps Telegram and Vike requests on their configured protocol and path with redirects disabled', async () => {
    const telegram = 'https://api.telegram.org/bot-fixture/sendMessage?text=Guardian';
    const vike = 'https://data.vike.io/v1/tokens';
    await expect(fetchProvider('telegram', telegram)).resolves.toEqual({ ok: true });
    await expect(fetchProvider('vike-data', vike, { headers: { 'X-API-KEY': 'fixture' }, redirectMode: 'error' })).resolves.toEqual({ ok: true });
    expect(transport).toHaveBeenNthCalledWith(1, telegram, expect.objectContaining({ redirect: 'error', method: 'GET' }));
    expect(transport).toHaveBeenNthCalledWith(2, vike, expect.objectContaining({ redirect: 'error', method: 'GET' }));
  });

  it('preserves the server-configured HTTPS RPC path and JSON request without following redirects', async () => {
    const endpoint = 'https://rpc.example/v1/fixture?network=ethereum';
    vi.stubEnv('MIA_ETH_RPC_URL', endpoint);
    const jsonBody = { method: 'eth_chainId' };
    await expect(fetchProvider(ETH_RPC, endpoint, { jsonBody })).resolves.toEqual({ ok: true });
    await expect(fetchProvider(ETH_RPC, 'https://rpc.example/other', { jsonBody })).rejects.toThrow(/destination/i);
    expect(transport).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({
      redirect: 'error', method: 'POST', body: JSON.stringify(jsonBody),
    }));
  });

  it('refuses to let callers opt back into automatic redirects', async () => {
    await expect(fetchProvider('binance', 'https://data-api.binance.vision/api/v3/ping', { redirect: 'follow' })).rejects.toThrow(/redirect/i);
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps credential-bearing transport errors out of provider health and caller messages', async () => {
    transport.mockRejectedValueOnce(new Error('unexpected external details fixture'));
    await expect(fetchProvider('telegram', 'https://api.telegram.org/bot-fixture/sendMessage')).rejects.toThrow(/request failed/i);
    expect(provider('telegram')?.lastError).toBe('request failed');
  });

  it('keeps upstream RPC error details out of caller messages', async () => {
    vi.stubEnv('MIA_ETH_RPC_URL', 'https://rpc.example/v1/fixture');
    transport.mockResolvedValueOnce(Response.json({ error: { message: 'response detail fixture' } }));
    await expect(readOnlyRpc('eth_chainId')).rejects.toThrow(/^RPC returned an error$/);
  });
});
