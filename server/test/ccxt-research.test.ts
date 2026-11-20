import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { config } from '../src/config.js';
import { failureGate } from '../src/core/ratelimit.js';
import { _resetProviderBlocks } from '../src/providers/http.js';
import * as cx from '../src/research/ccxtResearch.js';

/**
 * CCXT research adapter, offline: a fake exchange exercises MIA's real transport (fetchProvider with a stubbed global
 * fetch), so the GET-only, keyless and allow-list guarantees are tested on the code path production uses.
 */
const realFetch = globalThis.fetch; const flags = { offline: config.offline };
let calls: { url: string; init: any }[] = [];
const stubFetch = (body: unknown, status = 200) => { calls = []; globalThis.fetch = (async (u: any, init: any) => { calls.push({ url: String(u), init }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }) as typeof fetch; };

function fakeExchange(id: string, extra: Partial<cx.CcxtLike> = {}): cx.CcxtLike {
  const ex: cx.CcxtLike = {
    id, rateLimit: 1000, urls: { api: 'https://api.example-exchange.test', test: 'https://testnet.example-exchange.test' }, has: {},
    sandbox: false,
    setSandboxMode(on: boolean) { (this as any).sandbox = on; },
    fetch: async () => { throw new Error('original CCXT transport must never be used'); },
    loadMarkets: async function () { await ex.fetch('https://api.example-exchange.test/markets'); return { 'BTC/USDT': {}, 'ETH/USDT': {} }; },
    fetchTicker: async (s) => ({ symbol: s, last: Number((await ex.fetch(`https://api.example-exchange.test/ticker?s=${s}`) as any).last) }),
    fetchOrderBook: async (s, l) => ({ symbol: s, limit: l, bids: [[1, 2]], asks: [[1.1, 2]] }),
    fetchOHLCV: async () => [[0, 1, 2, 0.5, 1.5, 10]],
    ...extra,
  } as cx.CcxtLike & { sandbox: boolean };
  return ex;
}

describe('CCXT research adapter', () => {
  afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, flags); delete process.env.MIA_CCXT_SANDBOX; _resetProviderBlocks(); cx._setCcxtFactoryForTests(null); });

  it('routes CCXT HTTP through MIA (GET only) and labels results research-only', async () => {
    Object.assign(config, { offline: false }); stubFetch({ last: '64000.5' });
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id));
    const r = await cx.ccxtTicker('kraken', 'btc/usdt');
    expect(r).toMatchObject({ source: 'ccxt', exchange: 'kraken', kind: 'RESEARCH_ONLY', tradeEligible: false, sandbox: false, data: { symbol: 'BTC/USDT', last: 64000.5 } });
    expect(calls).toHaveLength(1); expect(calls[0].init.method ?? 'GET').toBe('GET');
  });
  it('blocks every non-GET request before it leaves the process (orders, withdrawals, transfers)', async () => {
    Object.assign(config, { offline: false }); stubFetch({});
    let ex!: cx.CcxtLike;
    cx._setCcxtFactoryForTests(async (id) => (ex = fakeExchange(id)));
    await cx.ccxtMarkets('binance');
    await expect(ex.fetch('https://api.example-exchange.test/order', 'POST', {}, '{"side":"buy"}')).rejects.toThrow(/read-only \(GET only\)/);
    await expect(ex.fetch('https://api.example-exchange.test/withdraw', 'DELETE')).rejects.toThrow(/GET only/);
    await expect(ex.fetch('https://api.example-exchange.test/x', 'GET', {}, 'body')).rejects.toThrow(/GET only/);
    await expect(ex.fetch('http://api.example-exchange.test/x')).rejects.toThrow(/non-HTTPS/);
    expect(calls).toHaveLength(1); // only loadMarkets' GET went out
  });
  it('never calls a host outside the exchange\'s own API URLs and refuses redirects', async () => {
    Object.assign(config, { offline: false }); stubFetch({});
    let ex!: cx.CcxtLike;
    cx._setCcxtFactoryForTests(async (id) => (ex = fakeExchange(id)));
    await cx.ccxtMarkets('binance');
    await expect(ex.fetch('https://evil.example/steal')).rejects.toThrow(/not this exchange/);
    expect(calls.map((c) => c.url)).not.toContain('https://evil.example/steal');
    expect(calls.every((c) => c.init.redirect === 'error' || c.init.redirect === 'manual')).toBe(true);
  });
  it('an exchange rejecting the request (4xx) is reported as a 400, a rate limit is not', async () => {
    Object.assign(config, { offline: false }); stubFetch({ msg: 'bad symbol' }, 400);
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id));
    await expect(cx.ccxtTicker('kraken', 'BTC/USDT')).rejects.toBeInstanceOf(cx.CcxtResearchError);
    _resetProviderBlocks(); stubFetch({}, 429);
    await expect(cx.ccxtTicker('kraken', 'BTC/USDT')).rejects.not.toBeInstanceOf(cx.CcxtResearchError);
  });
  it('a failed first market load does not poison the exchange: the next request builds a fresh instance', async () => {
    Object.assign(config, { offline: false }); stubFetch({});
    let built = 0;
    cx._setCcxtFactoryForTests(async (id) => {
      const n = ++built; const ex = fakeExchange(id); let loading: Promise<Record<string, unknown>> | null = null;
      // Like CCXT: an instance keeps its first loadMarkets() promise, so a rejected one is returned on every later call.
      ex.loadMarkets = () => (loading ??= n === 1 ? Promise.reject(new Error('network down'))
        : Promise.resolve({ 'BTC/USDT': {} }).then((m) => { ex.markets = m; return m; }));
      return ex;
    });
    await expect(cx.ccxtMarkets('kraken')).rejects.toThrow(/network down/);
    await expect(cx.ccxtMarkets('kraken')).resolves.toMatchObject({ data: { count: 1 } }); // was: 'network down' until restart
    expect(built).toBe(2);
    await cx.ccxtMarkets('kraken');
    expect(built).toBe(2); // a working instance is reused
  });
  it('refuses an exchange instance that carries any credential', async () => {
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id, { apiKey: 'k' }));
    await expect(cx.ccxtMarkets('okx')).rejects.toThrow(/credential \(apiKey\)/);
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id, { secret: 's' }));
    await expect(cx.ccxtMarkets('okx')).rejects.toThrow(/credential/);
  });
  it('only allow-listed exchanges and well-formed symbols/limits', async () => {
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id));
    await expect(cx.ccxtTicker('mtgox', 'BTC/USD')).rejects.toThrow(/not allow-listed/);
    await expect(cx.ccxtTicker('kraken', 'BTCUSD')).rejects.toThrow(/BTC\/USDT/);
    await expect(cx.ccxtTicker('kraken', '../../x')).rejects.toThrow(/BTC\/USDT/);
    await expect(cx.ccxtOrderBook('kraken', 'BTC/USD', 500)).rejects.toThrow(/1\.\.100/);
    await expect(cx.ccxtCandles('kraken', 'BTC/USD', '3m')).rejects.toThrow(/timeframe/);
  });
  it('sandbox mode uses official test URLs and refuses exchanges without one', async () => {
    process.env.MIA_CCXT_SANDBOX = '1';
    let ex!: cx.CcxtLike & { sandbox?: boolean };
    cx._setCcxtFactoryForTests(async (id) => (ex = fakeExchange(id)));
    expect((await cx.ccxtOrderBook('bybit', 'BTC/USDT', 5)).sandbox).toBe(true); expect(ex.sandbox).toBe(true);
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id, { urls: { api: 'x' } }));
    await expect(cx.ccxtOrderBook('kraken', 'BTC/USDT')).rejects.toThrow(/no official sandbox/);
  });
  it('honours MIA offline mode (no request is sent)', async () => {
    Object.assign(config, { offline: true }); stubFetch({ last: 1 });
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id));
    await expect(cx.ccxtTicker('coinbaseexchange', 'BTC/USD')).rejects.toThrow(/offline/);
    expect(calls).toHaveLength(0);
  });
  it('static guard: the adapter never references order, withdrawal or credential APIs', () => {
    const src = ['../src/research/ccxtResearch.ts', '../src/research/ccxtRoutes.ts'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
    expect(src).not.toMatch(/\b(createOrder|cancelOrder|editOrder|withdraw|transfer|fetchBalance|setLeverage|createDepositAddress)\s*\(/);
    expect(src).not.toMatch(/process\.env\.[A-Z_]*(KEY|SECRET|PASS)/);
    expect(src).not.toMatch(/from '\.\.\/(exec|portfolio|risk)\//);
  });
});

describe('CCXT research routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeAll(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('ccxt route owner') });
    cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); cx._setCcxtFactoryForTests(null); globalThis.fetch = realFetch; Object.assign(config, flags); });
  it('require an owner session and validate input strictly', async () => {
    expect((await app.inject({ url: '/api/research/ccxt' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/research/ccxt', headers: { cookie } })).json()).toMatchObject({ kind: 'RESEARCH_ONLY', exchanges: expect.arrayContaining([expect.objectContaining({ id: 'kraken', provider: 'ccxt-kraken' })]) });
    expect((await app.inject({ url: '/api/research/ccxt/mtgox/ticker?symbol=BTC/USD', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/research/ccxt/kraken/ticker?symbol=BTC/USD&apiKey=x', headers: { cookie } })).statusCode).toBe(400);
  });
  it('serve research data through the adapter', async () => {
    Object.assign(config, { offline: false }); stubFetch({ last: '3.5' });
    cx._setCcxtFactoryForTests(async (id) => fakeExchange(id));
    const r = await app.inject({ url: '/api/research/ccxt/kraken/ticker?symbol=ETH/USD', headers: { cookie } });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ tradeEligible: false, data: { symbol: 'ETH/USD', last: 3.5 } });
  });
  it('there is no POST route for CCXT at all', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/research/ccxt/kraken/ticker', headers: { cookie, 'x-mia-csrf': '1', 'content-type': 'application/json' }, payload: {} });
    expect([404, 405]).toContain(r.statusCode);
  });
});
