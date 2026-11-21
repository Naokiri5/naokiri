import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { LIVE_EXECUTION_AVAILABLE } from '../src/core/mode.js';
import { executionAdapter, environmentsOverview } from '../src/exec/environment.js';
import {
  BinanceSpotTestnet, TESTNET_ORIGIN, TestnetBoundaryError,
  testnetConfiguration, validateTestnetLimitOrder,
} from '../src/exec/venues/binanceTestnet.js';

const NOW = 1_700_000_000_000;
const GOOD_ORDER = {
  symbol: 'BTCUSDT' as const, side: 'BUY' as const,
  quantity: '0.001', price: '30000.00', clientOrderId: 'mia-testnet-only-1',
};

afterEach(() => { vi.unstubAllEnvs(); });
function transport(events: { urls: string[]; methods: string[] }, account = false) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    events.urls.push(url);
    events.methods.push(init.method ?? 'GET');
    expect(url.startsWith(TESTNET_ORIGIN + '/api/v3/')).toBe(true);
    expect(url.startsWith('https://api.binance.com/')).toBe(false);
    expect(init.redirect).toBe('error');
    const u = new URL(url);
    if (u.pathname === '/api/v3/time')
      return new Response(JSON.stringify({ serverTime: NOW }), { status: 200 });
    if (u.pathname === '/api/v3/account')
      return new Response(JSON.stringify({
        canTrade: true, accountType: 'SPOT',
        balances: [{ asset: 'BTC', free: '0.2', locked: '0' },
          { asset: 'ETH', free: '0', locked: '0' }],
      }), { status: 200 });
    if (u.pathname === '/api/v3/order/test')
      return new Response('{}', { status: 200 });
    if (u.pathname === '/api/v3/order')
      return new Response(JSON.stringify({
        symbol: 'BTCUSDT', clientOrderId: 'test-id',
        orderId: 1, status: 'PARTIALLY_FILLED',
        origQty: '0.001', executedQty: '0.0005', side: 'BUY',
      }), { status: 200 });
    throw Error('unapproved endpoint ' + u.pathname);
  };
}

describe('MIA three-environment contract — independent authority', () => {
  it('retains PAPER and keeps TESTNET & LIVE execution locked', () => {
    vi.stubEnv('BINANCE_TESTNET_API_KEY', '');
    vi.stubEnv('BINANCE_TESTNET_API_SECRET', '');
    expect(LIVE_EXECUTION_AVAILABLE).toBe(false);
    const paper = executionAdapter('PAPER');
    const testnet = executionAdapter('TESTNET');
    const live = executionAdapter('LIVE');
    expect(paper.account.environment).toBe('PAPER');
    expect(testnet.account.accountId).not.toBe(paper.account.accountId);
    expect(live.account.accountId).not.toBe(paper.account.accountId);
    expect(testnet.availability().state).toBe('LOCKED');
    expect(live.availability().state).toBe('LOCKED');
    expect(() => testnet.submitEntry({} as never, 'owner')).toThrow('TESTNET_EXECUTION_LOCKED');
    expect(() => testnet.closePosition('owner', 'a')).toThrow('TESTNET_EXECUTION_LOCKED');
    expect(() => live.submitEntry({} as never, 'owner')).toThrow();
  });
  it('does not expose secrets or silently grant order permissions', () => {
    vi.stubEnv('BINANCE_TESTNET_API_KEY', 'DO_NOT_EXPOSE_KEY');
    vi.stubEnv('BINANCE_TESTNET_API_SECRET', 'DO_NOT_EXPOSE_SECRET');
    const json = JSON.stringify(testnetConfiguration());
    expect(json).not.toContain('DO_NOT_EXPOSE');
    expect(testnetConfiguration()).toMatchObject({
      configured: true, actualOrderPlacement: 'LOCKED', productionExecution: 'LOCKED',
    });
  });
});

describe('Binance Spot testnet signed non-executing preflight', () => {
  it('requires backend-only credentials, never a browser key', () => {
    vi.stubEnv('BINANCE_TESTNET_API_KEY', '');
    vi.stubEnv('BINANCE_TESTNET_API_SECRET', '');
    expect(() => new BinanceSpotTestnet()).toThrow('TESTNET_CREDENTIALS_NOT_CONFIGURED');
  });
  it('signs exactly the transmitted query and reads virtual funds', async () => {
    vi.stubEnv('MIA_OFFLINE', '0');
    const seen = { urls: [] as string[], methods: [] as string[] };
    const client = new BinanceSpotTestnet(
      { key: 'fake-key', secret: 'fake-secret' }, transport(seen), () => NOW);
    const balance = await client.account();
    expect(balance).toEqual({
      environment: 'TESTNET', canTrade: true, accountType: 'SPOT',
      assets: [{ asset: 'BTC', free: '0.2', locked: '0' }],
      note: 'VIRTUAL_FUNDS_ONLY',
    });
    expect(seen.methods).toEqual(['GET', 'GET']);
    const signed = new URL(seen.urls[1]!);
    expect(signed.pathname).toBe('/api/v3/account');
    const signature = signed.searchParams.get('signature');
    signed.searchParams.delete('signature');
    const expected = createHmac('sha256', 'fake-secret')
      .update(signed.searchParams.toString()).digest('hex');
    expect(signature).toBe(expected);
    expect(signed.searchParams.get('timestamp')).toBe(String(NOW));
    expect(signed.searchParams.get('recvWindow')).toBe('5000');
  });
  it('validates a LIMIT order only; never sends it to matching engine', async () => {
    vi.stubEnv('MIA_OFFLINE', '0');
    const seen = { urls: [] as string[], methods: [] as string[] };
    const client = new BinanceSpotTestnet(
      { key: 'fake-key', secret: 'fake-secret' }, transport(seen), () => NOW);
    expect(await client.validateOrderOnly(GOOD_ORDER)).toEqual({
      environment: 'TESTNET', valid: true, placed: false, status: 'VALIDATED_ONLY',
    });
    expect(seen.methods).toEqual(['GET', 'POST']);
    expect(new URL(seen.urls[1]!).pathname).toBe('/api/v3/order/test');
    expect(seen.urls.every(url => !/\/api\/v3\/order(?:\?|$)/.test(url))).toBe(true);
  });
  it('rejects unallowlisted symbols, invalid amounts and oversized diagnostics before network', async () => {
    vi.stubEnv('MIA_OFFLINE', '0');
    const seen = { urls: [] as string[], methods: [] as string[] };
    const client = new BinanceSpotTestnet(
      { key: 'fake-key', secret: 'fake-secret' }, transport(seen), () => NOW);
    for (const bad of [
      { ...GOOD_ORDER, symbol: 'SOLUSDT' },
      { ...GOOD_ORDER, price: '-1' },
      { ...GOOD_ORDER, quantity: '0' },
      { ...GOOD_ORDER, price: '10000000' },
      { ...GOOD_ORDER, clientOrderId: '../attack' },
      { ...GOOD_ORDER, side: 'CANCEL' },
    ]) {
      await expect(client.validateOrderOnly(bad as never)).rejects.toBeInstanceOf(TestnetBoundaryError);
    }
    expect(seen.urls).toHaveLength(0);
  });
  it('reads confirmed partial fills without creating a local ledger or order', async () => {
    vi.stubEnv('MIA_OFFLINE', '0');
    const seen = { urls: [] as string[], methods: [] as string[] };
    const client = new BinanceSpotTestnet(
      { key: 'fake-key', secret: 'fake-secret' }, transport(seen), () => NOW);
    const status = await client.orderStatus('BTCUSDT', 'test-id');
    expect(status).toMatchObject({
      environment: 'TESTNET', status: 'PARTIALLY_FILLED',
      executedQty: '0.0005', clientOrderId: 'test-id',
    });
    expect(seen.methods).toEqual(['GET', 'GET']);
  });
  it('treats venue 5xx as uncertain rather than claiming an order failed', async () => {
    vi.stubEnv('MIA_OFFLINE', '0');
    const client = new BinanceSpotTestnet(
      { key: 'fake-key', secret: 'fake-secret' },
      async (url) => new URL(url).pathname === '/api/v3/time'
        ? new Response(JSON.stringify({ serverTime: NOW }), { status: 200 })
        : new Response('backend failed', { status: 503 }),
      () => NOW,
    );
    await expect(client.validateOrderOnly(GOOD_ORDER))
      .rejects.toThrow('TESTNET_VENUE_UNAVAILABLE_OR_UNKNOWN');
  });
  it('refuses all outbound connectivity when MIA_OFFLINE=1', async () => {
    vi.stubEnv('MIA_OFFLINE', '1');
    const seen = { urls: [] as string[], methods: [] as string[] };
    const client = new BinanceSpotTestnet(
      { key: 'fake-key', secret: 'fake-secret' }, transport(seen), () => NOW);
    await expect(client.account()).rejects.toThrow('MIA_OFFLINE_BLOCKS_TESTNET');
    expect(seen.urls).toHaveLength(0);
  });
});

describe('HTTP testnet preflight — owner session and step-up', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  beforeAll(async () => {
    vi.stubEnv('BINANCE_TESTNET_API_KEY', '');
    vi.stubEnv('BINANCE_TESTNET_API_SECRET', '');
    closeDb(); openDb(':memory:');
    app = await buildApp();
    const result = await app.inject({
      method: 'POST', url: '/api/auth/setup',
      payload: { password: 'correct horse battery' },
    });
    expect(result.statusCode).toBe(200);
    cookie = String(result.headers['set-cookie']).split(';')[0]!;
  });
  it('reports three environments and a locked testnet without any credentials', async () => {
    expect((await app.inject({ url: '/api/trading/environments' })).statusCode).toBe(401);
    const reply = await app.inject({ url: '/api/trading/environments', headers: { cookie } });
    expect(reply.statusCode).toBe(200);
    const environments = reply.json().environments as Array<{ environment: string; state: string }>;
    expect(environments.map(x => x.environment)).toEqual(['PAPER', 'TESTNET', 'LIVE']);
    expect(environments.find(x => x.environment === 'TESTNET')?.state).toBe('LOCKED');
    expect(environments.find(x => x.environment === 'LIVE')?.state).toBe('LOCKED');
    const status = await app.inject({ url: '/api/trading/testnet/status', headers: { cookie } });
    expect(status.json()).toMatchObject({ configured: false, actualOrderPlacement: 'LOCKED' });
  });
  it('requires session, CSRF and owner passphrase before an order-validation API request', async () => {
    const payload = { ...GOOD_ORDER, password: 'correct horse battery' };
    expect((await app.inject({ method: 'POST', url: '/api/trading/testnet/validate-order',
      payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/trading/testnet/validate-order',
      headers: { cookie }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/trading/testnet/validate-order',
      headers: { cookie, 'x-mia-csrf': '1' }, payload: { ...GOOD_ORDER } })).statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST',
      url: '/api/trading/testnet/validate-order',
      headers: { cookie, 'x-mia-csrf': '1' }, payload });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error).toBe('TESTNET_CREDENTIALS_NOT_CONFIGURED');
  });
});
