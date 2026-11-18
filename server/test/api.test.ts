import { seedInstrument, seedBacktestFixture } from './helpers.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { all, closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { DEFAULT_POLICY } from '../src/risk/policy.js';
import { commandMode, JOE_TOOL_NAMES } from '../src/joe/joe.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { failureGate } from '../src/core/ratelimit.js';
import { setStrategyStatus } from '../src/lab/lab.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { quarantined, releaseQuarantine } from '../src/workers/runtime.js';
import { WORKERS } from '../src/workers/registry.js';
import { getSetting, setSetting } from '../src/core/settings.js';

describe('HTTP API (auth, permissions, release gate)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  const H = () => ({ cookie, 'x-mia-csrf': '1' });
  beforeAll(async () => { closeDb(); openDb(':memory:'); app = await buildApp(); });
  it('requires auth and a strong passphrase', async () => {
    expect((await app.inject({ url: '/api/shell' })).statusCode).toBe(401);
    // Raw binary bodies are accepted only by the authenticated Academy upload route, never by unauthenticated auth routes.
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(1024) })).statusCode).toBe(415);
    expect((await app.inject({ method: 'POST', url: '/api/academy/documents', headers: { 'content-type': 'application/octet-stream', 'x-mia-csrf': '1' }, payload: Buffer.from('x') })).statusCode).toBe(401);
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
  it('risk-increasing actions require step-up; risk-reducing ones do not', async () => {
    const password = 'correct horse battery'; const id = STRATEGIES[0].id; const worker = WORKERS[0].id;
    const statusUrl = `/api/lab/strategy/${id}/status`; const releaseUrl = `/api/workers/${worker}/release`;
    const post = (url: string, payload?: object) => app.inject({ method: 'POST', url, headers: H(), payload });
    const snapshot = () => ({
      control: getControl(), strategies: all('SELECT * FROM strategies ORDER BY id'), suspended: getSetting('suspendedStrategies', []), quarantine: [...quarantined].sort(),
      successes: all("SELECT * FROM audit_log WHERE action IN ('control.update','strategy.status','worker.release') ORDER BY id"),
    });
    const denied = async (url: string, payload: object) => {
      for (const password of [undefined, 'incorrect step-up passphrase']) {
        const before = snapshot(); const r = await post(url, { ...payload, password });
        expect(r.statusCode).toBe(403); expect(r.json().error).toMatch(/step-up/); expect(snapshot()).toEqual(before);
        expect(r.body).not.toContain('incorrect step-up passphrase');
      }
    };
    expect((await post('/api/emergency/pause', {})).statusCode).toBe(200);
    expect(getControl().pausedNewOrders).toBe(true);
    await denied('/api/control', { pausedNewOrders: false });
    expect((await post('/api/control', { pausedNewOrders: false, password })).statusCode).toBe(200);
    expect(getControl().pausedNewOrders).toBe(false);
    await denied('/api/control', { pausedNewOrders: false });
    expect((await post('/api/control', { disabledStrategies: [id] })).statusCode).toBe(200);
    await denied('/api/control', { disabledStrategies: [] });
    expect((await post('/api/control', { disabledStrategies: [], password })).statusCode).toBe(200);
    expect(getControl().disabledStrategies).toEqual([]);
    expect((await post('/api/emergency/stop', {})).statusCode).toBe(200);
    expect(getControl()).toMatchObject({ emergency: true, pausedNewOrders: true });
    await denied('/api/control', { emergency: false, pausedNewOrders: false });
    expect((await post('/api/control', { emergency: false, pausedNewOrders: false, password })).statusCode).toBe(200);
    expect(getControl()).toMatchObject({ emergency: false, pausedNewOrders: false });

    expect((await post(statusUrl, { status: 'SUSPENDED' })).statusCode).toBe(200);
    // Lifting a suspension by demoting it is still risk-increasing (CodeRabbit PR #13): it removes the strategy from the list.
    failureGate.reset(); // each denied() is two failed passphrase attempts; keep the per-client lockout out of this check
    await denied(statusUrl, { status: 'RESEARCH' }); await denied(statusUrl, { status: 'BACKTESTED' });
    failureGate.reset();
    await denied(statusUrl, { status: 'PAPER' });
    const noBacktest = await post(statusUrl, { status: 'PAPER', password });
    expect(noBacktest.statusCode).toBe(400); expect(noBacktest.json().error).toMatch(/backtest/);
    seedBacktestFixture(id);
    expect((await post(statusUrl, { status: 'PAPER', password })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/lab', headers: { cookie } })).json().strategies.find((s: { id: string; status: string }) => s.id === id).status).toBe('PAPER');
    expect((await post(statusUrl, { status: 'PAPER' })).statusCode).toBe(200);
    setSetting('suspendedStrategies', [id]);
    await denied(statusUrl, { status: 'PAPER' });
    expect((await post(statusUrl, { status: 'PAPER', password })).statusCode).toBe(200);
    expect(getSetting<string[]>('suspendedStrategies', [])).not.toContain(id);
    expect((await post(statusUrl, { status: 'BACKTESTED' })).statusCode).toBe(200); // demoting an unsuspended strategy stays password-free
    await denied(statusUrl, { status: 'LIVE_CANDIDATE' });
    const beforeLive = snapshot(); const live = await post(statusUrl, { status: 'LIVE_CANDIDATE', password });
    expect(live.statusCode).toBe(400); expect(live.json().error).toMatch(/release-gate/); expect(snapshot()).toEqual(beforeLive);
    for (const status of ['SUSPENDED', 'RETIRED']) expect((await post(statusUrl, { status })).statusCode).toBe(200); // risk-reducing: no passphrase
    failureGate.reset(); await denied(statusUrl, { status: 'RESEARCH' }); failureGate.reset(); // leaving RETIRED lifts the suspension
    expect((await post(statusUrl, { status: 'RESEARCH', password })).statusCode).toBe(200);
    expect((await post(statusUrl, { status: 'BACKTESTED' })).statusCode).toBe(200); // no longer suspended: demotion is password-free

    quarantined.add(worker);
    try {
      const beforeMissingBody = snapshot();
      expect((await post(releaseUrl)).statusCode).toBe(403); expect(snapshot()).toEqual(beforeMissingBody);
      await denied(releaseUrl, {});
      expect((await post(releaseUrl, { password })).statusCode).toBe(200); expect(quarantined.has(worker)).toBe(false);
      quarantined.add(worker);
      for (const [url, payload] of [['/api/control', { pausedNewOrders: false, password }], [statusUrl, { status: 'PAPER', password }], [releaseUrl, { password }]] as const) {
        const before = snapshot();
        expect((await app.inject({ method: 'POST', url, payload: { ...payload, actor: 'owner' } })).statusCode).toBe(401);
        expect((await app.inject({ method: 'POST', url, headers: { cookie }, payload })).statusCode).toBe(403);
        expect(snapshot()).toEqual(before);
      }
      expect(() => updateControl('trader-joe', { pausedNewOrders: false })).toThrow(/may not resume/);
      updateControl('owner', { disabledStrategies: [id] }); const beforeActor = snapshot();
      expect(() => updateControl('trader-joe', { disabledStrategies: [] })).toThrow(/may not re-enable/);
      expect(() => updateControl('trader-joe', { disabledStrategies: ['replacement'] })).toThrow(/may not re-enable/);
      expect(() => setStrategyStatus('trader-joe', id, 'PAPER')).toThrow(/only the owner/);
      expect(() => setStrategyStatus('trader-joe', id, 'RESEARCH')).toThrow(/only the owner/);
      expect(() => releaseQuarantine('trader-joe', worker)).toThrow(/only the owner/);
      expect(snapshot()).toEqual(beforeActor);
      updateControl('owner', { disabledStrategies: [] });
      setStrategyStatus('strategy-health-monitor', id, 'SUSPENDED');
      expect(getSetting<string[]>('suspendedStrategies', [])).toContain(id);
    } finally { quarantined.delete(worker); }
    const audit = JSON.stringify(all('SELECT * FROM audit_log'));
    expect(audit).toContain('auth.stepup.failed'); expect(audit).not.toContain(password); expect(audit).not.toContain('incorrect step-up passphrase');
    expect(JSON.stringify(getControl())).not.toContain('password');
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
  it('repeated query keys and bad ids are rejected as validation errors, never leaked as database errors', async () => {
    for (const url of ['/api/decisions?decision=a&decision=b', '/api/journal?kind=a&kind=b', '/api/markets/search?q=a&q=b', `/api/decisions/${'x'.repeat(200)}`]) {
      const r = await app.inject({ url, headers: { cookie } });
      expect([400, 404], url).toContain(r.statusCode); expect(r.body, url).not.toMatch(/named parameter|SQLITE|sqlite/i); // over-long path ids are 404 at the router
    }
    const r = await app.inject({ method: 'POST', url: '/api/emergency/pause', headers: { cookie, 'x-mia-csrf': '1' }, payload: { unexpected: true } });
    expect(r.statusCode).toBe(400);
  });
  it('Trader Joe has no order/limit/mode/withdraw tools and refuses such commands', async () => {
    expect([...JOE_TOOL_NAMES].sort()).toEqual(['analyze_instrument', 'explain_decision', 'get_instrument', 'get_large_prints', 'get_market_overview', 'get_news', 'get_opportunities', 'get_portfolio', 'get_risk_status', 'get_status', 'pause_new_orders', 'search_knowledge']);
    expect(await commandMode('buy 10 BTC now')).toMatch(/can’t place orders/);
    await commandMode('pause'); expect(getControl().pausedNewOrders).toBe(true);
    const r = await app.inject({ method: 'POST', url: '/api/joe', headers: H(), payload: { message: 'help' } });
    expect(r.json().mode).toBe('COMMAND');
  });
});

describe('HTTP hardening (auth gate, validation, error classes, step-up limits)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; const PW = 'hardening passphrase';
  const H = () => ({ cookie, 'x-mia-csrf': '1' });
  beforeAll(async () => {
    closeDb(); openDb(':memory:'); failureGate.reset(); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: PW } }); cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  it('a percent-encoded path cannot skip the session check', async () => {
    for (const url of ['/%61pi/shell', '/%61pi/audit', '/%2561pi/audit', '/api/%61udit']) {
      const r = await app.inject({ url });
      // 401 (gate), 404 (no route), the 503 'UI not built' page, or — when the UI is built — the public SPA shell
      // (a double-encoded path is not an /api path). What matters is that no API data is ever returned.
      if (r.statusCode === 200) expect(r.headers['content-type'], url).toMatch(/text\/html/);
      expect(r.body, url).not.toContain('"action"');
    }
    expect((await app.inject({ method: 'POST', url: '/%61pi/emergency/stop', headers: { 'x-mia-csrf': '1' } })).statusCode).not.toBe(200);
  });
  it('health stays public with a query string', async () => {
    expect((await app.inject({ url: '/api/health?probe=1' })).statusCode).toBe(200);
  });
  it('invalid query parameters are 400 with a message, not a crash or an empty 200', async () => {
    for (const url of ['/api/instrument/BTCUSDT?interval=5m', '/api/instrument/BTCUSDT?interval=__proto__', '/api/bubbles?limit=abc', '/api/bubbles?minVolume=-1', '/api/discover?minVolume=x', '/api/calendar?month=2026-13', '/api/calendar?month=foo']) {
      const r = await app.inject({ url, headers: { cookie } });
      expect(r.statusCode, url).toBe(400); expect(typeof r.json().error, url).toBe('string');
    }
    expect((await app.inject({ url: '/api/calendar?month=2026-01', headers: { cookie } })).statusCode).toBe(200);
  });
  it('unknown resources are 404 and unknown emergency actions are 404', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/emergency/launch', headers: H(), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/analyze', headers: H(), payload: { symbol: 'NOPEUSDT' } })).statusCode).toBe(404);
  });
  it('resuming after a pause needs the passphrase', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { pausedNewOrders: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { pausedNewOrders: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: H(), payload: { pausedNewOrders: false, password: PW } })).statusCode).toBe(200);
  });
  it('step-up guesses are rate limited like logins (429 with Retry-After)', async () => {
    failureGate.reset();
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'POST', url: '/api/wallet/freeze', headers: H(), payload: { on: false, password: `guess-${i}` } })).statusCode).toBe(403);
    const locked = await app.inject({ method: 'POST', url: '/api/wallet/freeze', headers: H(), payload: { on: false, password: PW } });
    expect(locked.statusCode).toBe(429); expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    failureGate.reset();
  });
  it('API responses are not cacheable and the CSP forbids framing', async () => {
    const r = await app.inject({ url: '/api/shell', headers: { cookie } });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  });
});

describe('shell status payload (independent setup)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeAll(async () => {
    closeDb(); openDb(':memory:'); failureGate.reset(); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
    cookie = String(r.headers['set-cookie']).split(';')[0];
    expect((await app.inject({ method: 'POST', url: '/api/risk/policy', headers: { cookie, 'x-mia-csrf': '1' }, payload: { policy: DEFAULT_POLICY, password: 'correct horse battery' } })).statusCode).toBe(200);
  });
  afterAll(async () => { await app.close(); });
  it('shell carries what the status ribbon needs: server clock, live lock, policy limits, engine cadence', async () => {
    const before = Date.now();
    const s = (await app.inject({ url: '/api/shell', headers: { cookie } })).json();
    expect(s.serverTime).toBeGreaterThanOrEqual(before);
    expect(s.liveAllowed).toBe(false); expect(s.gates).toMatch(/live execution LOCKED/);
    const { dailyLossPct, weeklyLossPct, drawdownWarnPct, drawdownHaltPct, maxOpenRiskPct, maxConsecutiveLosses } = DEFAULT_POLICY;
    expect(s.riskLimits).toEqual({ dailyLossPct, weeklyLossPct, drawdownWarnPct, drawdownHaltPct, maxOpenRiskPct, maxConsecutiveLosses });
    expect(s.account).toMatchObject({ weeklyPnlPct: 0, consecutiveLosses: 0, marksMissing: 0 });
    expect(s.scanIntervalMs).toBeGreaterThan(0); expect(s.tickerIntervalMs).toBeGreaterThan(0);
    expect(s.offline).toBe(true); expect(s.bot.running).toBe(false);
    expect(s.dataHealth.stale).toBe(true); expect(s.dataHealth.tickersAt).toBe(0);
  });
});
