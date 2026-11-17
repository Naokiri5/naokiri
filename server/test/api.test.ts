import { seedInstrument } from './helpers.js';
import { describe, it, expect, beforeAll } from 'vitest';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { DEFAULT_POLICY } from '../src/risk/policy.js';
import { commandMode, JOE_TOOL_NAMES } from '../src/joe/joe.js';
import { getControl } from '../src/core/mode.js';

describe('HTTP API (auth, permissions, release gate)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  const H = () => ({ cookie, 'x-mia-csrf': '1' });
  beforeAll(async () => { closeDb(); openDb(':memory:'); app = await buildApp(); });
  it('requires auth and a strong passphrase', async () => {
    expect((await app.inject({ url: '/api/shell' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'short' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
    expect(r.statusCode).toBe(200); cookie = String(r.headers['set-cookie']).split(';')[0];
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'another passphrase' } })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/shell', headers: { cookie } })).json().display).toBe('READ-ONLY');
  });
  it('rejects state changes without CSRF header', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/emergency/pause', headers: { cookie } })).statusCode).toBe(403);
  });
  it('policy acceptance and mode changes require step-up; PAPER requires policy; BOUNDED_LIVE is locked', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { mode: 'PAPER', password: 'correct horse battery' } })).json().error).toMatch(/risk policy/);
    expect((await app.inject({ method: 'POST', url: '/api/risk/policy', headers: H(), payload: { policy: DEFAULT_POLICY } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/risk/policy', headers: H(), payload: { policy: DEFAULT_POLICY, password: 'correct horse battery' } })).json().version).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { mode: 'PAPER' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { mode: 'PAPER', password: 'correct horse battery' } })).json().mode).toBe('PAPER');
    const live = await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { mode: 'BOUNDED_LIVE', password: 'correct horse battery' } });
    expect(live.statusCode).toBe(400); expect(live.json().error).toMatch(/BOUNDED_LIVE blocked/);
    expect((await app.inject({ url: '/api/qa', headers: { cookie } })).json().liveAllowed).toBe(false);
  });
  it('every GET workspace endpoint responds', async () => {
    for (const u of ['/api/overview', '/api/markets', '/api/scanner', '/api/intelligence', '/api/risk', '/api/bot', '/api/portfolio', '/api/orders', '/api/journal', '/api/calendar', '/api/lab', '/api/news', '/api/whales', '/api/wallet', '/api/connections', '/api/notifications', '/api/settings', '/api/qa', '/api/audit', '/api/joe', '/api/bubbles', '/api/dex', '/api/fx'])
      expect((await app.inject({ url: u, headers: { cookie } })).statusCode, u).toBe(200);
    const intel = (await app.inject({ url: '/api/intelligence', headers: { cookie } })).json();
    expect(intel.workers).toHaveLength(100); expect(intel.indicatorSpecialists).toHaveLength(50);
  });
  it('analyzes the existing closed cache and rejects unsupported instrument intervals', async () => {
    seedInstrument('CHARTUSDT');
    const r = await app.inject({ url: '/api/instrument/CHARTUSDT?interval=1h', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().chartIntelligence).toMatchObject({ status: 'VALID', decision: 'NO TRADE', timeframe: '1h' });
    expect((await app.inject({ url: '/api/instrument/CHARTUSDT?interval=1m', headers: { cookie } })).statusCode).toBe(400);
  });
  it('protects replay, validates intervals, and returns only the visible prefix', async () => {
    const candles = Array.from({ length: 30 }, (_, i) => ({ t: i * 3600000, o: 100, h: 102, l: 98, c: 101, v: 10 }));
    const payload = { instrument: 'fixture', timeframe: '1h', candles, visibleBars: 25 };
    expect((await app.inject({ method: 'POST', url: '/api/chart/replay', payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/chart/replay', headers: { cookie }, payload })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/api/chart/replay', headers: H(), payload });
    expect(r.statusCode).toBe(200); expect(r.json().candles).toHaveLength(25);
    expect(r.json().report.decision).toBe('NO TRADE');
    expect((await app.inject({ method: 'POST', url: '/api/chart/replay', headers: H(), payload: { ...payload, timeframe: '1m' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/chart/replay', headers: H(), payload: { ...payload, visibleBars: 31 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/chart/replay', headers: H(), payload: { ...payload, candles: Array(2001).fill(candles[0]) } })).statusCode).toBe(400);
  });
  it('Trader Joe has no order/limit/mode/withdraw tools and refuses such commands', async () => {
    expect([...JOE_TOOL_NAMES].sort()).toEqual(['analyze_instrument', 'explain_decision', 'get_instrument', 'get_large_prints', 'get_market_overview', 'get_news', 'get_opportunities', 'get_portfolio', 'get_risk_status', 'get_status', 'pause_new_orders']);
    expect(await commandMode('buy 10 BTC now')).toMatch(/can’t place orders/);
    await commandMode('pause'); expect(getControl().pausedNewOrders).toBe(true);
    const r = await app.inject({ method: 'POST', url: '/api/joe', headers: H(), payload: { message: 'help' } });
    expect(r.json().mode).toBe('COMMAND');
  });
});
