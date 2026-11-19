import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { config } from '../src/config.js';
import { _resetProviderBlocks } from '../src/providers/http.js';
import { executionAdapter, LiveLockedError, environmentsOverview } from '../src/exec/environment.js';

/** Vike research routes + Paper/Live environment contract, through the real app (fetch stubbed: no network). */
const KEY = 'vk_' + 'Y'.repeat(32);
const json = { 'content-type': 'application/json' };
const realFetch = globalThis.fetch; const flags = { offline: config.offline };
let seen: { url: string; headers: Record<string, string>; redirect?: string }[] = [];
const stub = (body: unknown, status = 200) => { seen = []; globalThis.fetch = (async (u: any, init: any) => { seen.push({ url: String(u), headers: init?.headers ?? {}, redirect: init?.redirect }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }) as typeof fetch; };

describe('Vike research routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeAll(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: ownerSetupPayload('vike route owner') });
    cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, flags); delete process.env.MIA_VIKE_API_KEY; _resetProviderBlocks(); });
  afterAll(async () => { await app.close(); });
  const get = (url: string, auth = true) => app.inject({ url, headers: auth ? { cookie } : {} });

  it('require an owner session (no public proxy)', async () => {
    expect((await get('/api/research/vike/search?q=eth', false)).statusCode).toBe(401);
    expect((await get('/api/trading/environments', false)).statusCode).toBe(401);
  });
  it('report PENDING credentials honestly and make no request when no key is configured', async () => {
    stub({}); Object.assign(config, { offline: false });
    const s = (await get('/api/research/vike/status')).json();
    expect(s).toMatchObject({ configured: false, kind: 'RESEARCH_ONLY' });
    const r = await get('/api/research/vike/search?q=eth');
    expect(r.statusCode).toBe(503); expect(r.json().error).toMatch(/MIA_VIKE_API_KEY/);
    expect(seen).toHaveLength(0);
  });
  it('with a key: research envelope, key only in the header, never in the response', async () => {
    process.env.MIA_VIKE_API_KEY = KEY; Object.assign(config, { offline: false });
    stub({ tokens: [{ symbol: 'PEPE', volume_usd: 1 }] });
    const r = await get('/api/research/vike/tokens?chain=ethereum&window=24h&limit=5');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ source: 'vike-data', kind: 'RESEARCH_ONLY', tradeEligible: false, data: { tokens: [{ symbol: 'PEPE' }] } });
    expect(r.body).not.toContain(KEY);
    expect(seen[0].url).toMatch(/^https:\/\/data\.vike\.io\/v1\/onchain\/tokens\/screener\?/);
    expect(seen[0].headers['X-API-KEY']).toBe(KEY); expect(seen[0].redirect).toBe('error');
  });
  it('validate input (400) before any request, including unknown query keys', async () => {
    process.env.MIA_VIKE_API_KEY = KEY; Object.assign(config, { offline: false }); stub({});
    for (const u of ['/api/research/vike/search?q=', '/api/research/vike/tokens?limit=500', '/api/research/vike/tokens?url=https://evil', '/api/research/vike/hyperliquid/ohlcv?symbol=BTC/../x', '/api/research/vike/polymarket/archive?date=2026-11-18&stream=book_events&asset=btc'])
      expect((await get(u)).statusCode, u).toBe(400);
    expect(seen).toHaveLength(0);
  });
  it('the archive route returns metadata only: no presigned link', async () => {
    process.env.MIA_VIKE_API_KEY = KEY; Object.assign(config, { offline: false });
    stub({ url: 'https://archive.example/f.parquet?X-Amz-Signature=SECRET', expires_at: '2026-11-25T00:00:00Z', bytes: 42 });
    const r = await get('/api/research/vike/polymarket/archive?date=2026-11-18&stream=trades');
    expect(r.statusCode).toBe(200); expect(r.body).not.toContain('SECRET'); expect(r.body).not.toContain('archive.example');
  });
  it('a Vike 401 or 429 surfaces as an upstream error without echoing provider text', async () => {
    process.env.MIA_VIKE_API_KEY = KEY; Object.assign(config, { offline: false });
    stub({ error: { code: 'UNAUTHORIZED', message: 'invalid credential' } }, 401);
    const r = await get('/api/research/vike/search?q=eth');
    expect(r.statusCode).toBe(502); expect(r.body).not.toContain(KEY);
  });
  it('trading environments: same layout, Live reported LOCKED', async () => {
    const r = (await get('/api/trading/environments')).json();
    expect(r.environments.map((e: any) => e.environment)).toEqual(['PAPER', 'LIVE']);
    expect(r.environments[1]).toMatchObject({ state: 'LOCKED' }); expect(r.environments[1].reasons.join()).toMatch(/NOT_CERTIFIED/);
  });
});

describe('Paper/Live execution adapters', () => {
  it('the Live adapter refuses every command and nothing else can be obtained for LIVE', () => {
    const live = executionAdapter('LIVE');
    expect(live.availability().state).toBe('LOCKED');
    expect(() => live.submitEntry({} as any, 'owner')).toThrow(LiveLockedError);
    expect(() => live.closePosition('owner', 'pos_x')).toThrow(/LOCKED/);
    expect(() => executionAdapter('DEMO' as any)).toThrow(/unknown trading environment/);
  });
  it('the Paper adapter wraps the existing OMS and labels results PAPER', () => {
    freshDb();
    const paper = executionAdapter('PAPER');
    expect(paper.account.environment).toBe('PAPER');
    const r = paper.submitEntry({ candidateId: 'c1', consensus: { expiresAt: 'garbage' }, decision: 'PAPER_TRADE' } as any, 'bot');
    expect(r).toMatchObject({ environment: 'PAPER', ok: false }); // the real OMS rejected it (no fill invented)
    expect(environmentsOverview()[0].state).not.toBe('LOCKED');
  });
});
