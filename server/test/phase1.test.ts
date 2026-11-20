import { describe, it, expect, beforeAll } from 'vitest';
import { closeDb, openDb, run } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { config } from '../src/config.js';
import { market } from '../src/market/store.js';
import { seedInstrument, ownerSetupPayload } from './helpers.js';
import { toCsv } from '../src/journal/history.js';
import { record } from '../src/core/latency.js';

describe('Phase 1 workspaces API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; const PW = 'phase one passphrase';
  const H = () => ({ cookie, 'x-mia-csrf': '1' });
  beforeAll(async () => {
    closeDb(); openDb(':memory:'); market.reset(); seedInstrument('BTCUSDT'); seedInstrument('ETHUSDT', { seed: 7 });
    app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload(PW) }); cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  it('every response carries a request id (and honours a safe incoming one)', async () => {
    const a = await app.inject({ url: '/api/health' }); expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await app.inject({ url: '/api/health', headers: { 'x-request-id': 'trace_abc12345' } }); expect(b.headers['x-request-id']).toBe('trace_abc12345');
    const c = await app.inject({ url: '/api/health', headers: { 'x-request-id': 'bad id<script>' } }); expect(c.headers['x-request-id']).not.toContain('<');
  });
  it('QHEF report evaluates budgets from real samples', async () => {
    record('qci.consensus', 12); record('qci.consensus', 14);
    const q = (await app.inject({ url: '/api/qhef', headers: { cookie } })).json();
    const c = q.budgets.find((b: any) => b.stage === 'qci.consensus');
    expect(c.status).toBe('WITHIN_BUDGET'); expect(c.samples).toBeGreaterThanOrEqual(2);
    expect(q.budgets.find((b: any) => b.stage === 'oms.submit').status).toBe('NO_DATA');
    expect(q.eventLoop.p99).toBeGreaterThanOrEqual(0); expect(q.workers.concurrency).toBeGreaterThan(0);
  });
  it('Security Center never returns secret values', async () => {
    // fake key assembled at runtime so the repository secret scanner never sees a key-shaped literal
    const prev = config.anthropicApiKey; (config as any).anthropicApiKey = ['sk', 'ant', 'TEST-SECRET-VALUE-123'].join('-');
    const r = await app.inject({ url: '/api/security', headers: { cookie } });
    expect(r.body).not.toContain('TEST-SECRET'); expect(r.json().checks.find((c: any) => c.id === 'SEC-1').detail).toMatch(/configured/);
    (config as any).anthropicApiKey = prev;
    expect(r.json().sessions.some((s: any) => s.current)).toBe(true);
  });
  it('revoking other sessions needs step-up and keeps the current session', async () => {
    const other = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PW } }); const otherCookie = String(other.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'POST', url: '/api/security/sessions/revoke-others', headers: H(), payload: {} })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/api/security/sessions/revoke-others', headers: H(), payload: { password: PW } });
    expect(r.json().revoked).toBe(1);
    expect((await app.inject({ url: '/api/shell', headers: { cookie: otherCookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/shell', headers: { cookie } })).statusCode).toBe(200);
  });
  it('Discover ranks only live-feed instruments', async () => {
    const d = (await app.inject({ url: '/api/discover', headers: { cookie } })).json();
    expect(d.volumeLeaders.map((x: any) => x.base)).toEqual(expect.arrayContaining(['BTC', 'ETH']));
    expect(d.unusualVolume.every((x: any) => x.relVol1h != null)).toBe(true);
  });
  it('history filters validate input and CSV exports are injection-safe', async () => {
    const t = Date.now();
    run("INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at) VALUES ('o1','=HYPERLINK(\"x\")','paper-bot','binance-paper','crypto:binance:BTCUSDT','BUY','MARKET',1,'FILLED','ENTRY',?,?)", t, t);
    const h = (await app.inject({ url: '/api/history?instrument=BTC&status=FILLED', headers: { cookie } })).json(); expect(h.orders).toHaveLength(1);
    expect((await app.inject({ url: '/api/history?instrument=BTC%27%3B--', headers: { cookie } })).statusCode).toBe(400);
    const csv = await app.inject({ url: '/api/history.csv', headers: { cookie } });
    expect(csv.headers['content-type']).toMatch(/text\/csv/); expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);
    expect(toCsv([{ a: -5, b: '@cmd' }], ['a', 'b'])).toBe("a,b\n-5,'@cmd");
  });
  it('Copy trading reports its real blocked state, with no fabricated wallets', async () => {
    const c = (await app.inject({ url: '/api/copy', headers: { cookie } })).json();
    expect(c.status).toBe('BLOCKED'); expect(c.trackedWallets).toEqual([]); expect(c.requirements.every((r: any) => r.status === 'PENDING_CREDENTIALS')).toBe(true);
  });
});
