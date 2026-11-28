import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, closeDb, run } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { FAST_RESEARCH_MAX_AGE_MS } from '../src/choice/dualResearch.js';
import { runDualResearchPass, _resetDualResearchForTests } from '../src/choice/dualRuntime.js';
import { market } from '../src/market/store.js';
import { rejections } from '../src/market/scanner.js';
import { provider } from '../src/providers/http.js';
import { RELEASE_GATE_EVIDENCE_MAX_AGE_MS } from '../src/qa/gates.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { freshDb } from './helpers.js';

describe('Autopilot session preflight', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  const url = '/api/session/preflight';
  const selected = (mind: string, environment: string) => `${url}?mind=${mind}&environment=${environment}`;
  const read = (path: string) => app.inject({ url: path, headers: { cookie } });
  const snapshot = () => [
    'settings', 'audit_log', 'orders', 'fills', 'positions', 'ledger_entries', 'runtime_leases', 'journal',
  ].map((table) => all(`SELECT * FROM ${table}`));

  beforeEach(async () => {
    freshDb(false);
    app = await buildApp();
    const setup = await app.inject({
      method: 'POST', url: '/api/auth/setup', payload: { password: 'session readiness owner' },
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie']).split(';')[0];
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it('requires owner authentication and a valid, unambiguous selection', async () => {
    expect((await app.inject({ url: selected('FAST', 'PAPER') })).statusCode).toBe(401);
    expect((await read(url)).statusCode).toBe(400);
    expect((await read(selected('OBSERVE', 'PAPER'))).statusCode).toBe(400);
    expect((await read(selected('DEEP', 'BOUNDED_LIVE'))).statusCode).toBe(400);
    expect((await read(`${selected('DEEP', 'LIVE')}&mind=FAST`)).statusCode).toBe(400);
  });

  it('reports missing prerequisites and leaves every authority record intact', async () => {
    const before = snapshot();
    const response = await read(selected('FAST', 'PAPER'));
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      schemaVersion: 'mia.session.preflight.v1', mind: 'FAST', environment: 'PAPER', state: 'PREFLIGHT',
      canRun: false, canClose: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'execution-lane', status: 'BLOCKED', detail: expect.stringMatching(/sell route/i) }),
        expect.objectContaining({ id: 'session-lifecycle', status: 'BLOCKED' }),
        expect.objectContaining({ id: 'brainos-dependencies', detail: expect.any(String) }),
        expect.objectContaining({ id: 'risk-policy', status: 'BLOCKED' }),
        expect.objectContaining({ id: 'paper-account', status: 'BLOCKED' }),
        expect.objectContaining({ id: 'market-data', status: 'UNVERIFIED' }),
      ]),
    });
    expect(snapshot()).toEqual(before);
  });

  it('keeps selected sessions unavailable even when the legacy paper account is funded and enabled', async () => {
    acceptPolicy('owner', DEFAULT_POLICY);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1000);
    updateControl('owner', { mode: 'PAPER' });
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at)
      VALUES ('entry_test','entry_preflight','paper-bot','paper','crypto:binance:BTCUSDT','BUY','MARKET',1,'NEW','ENTRY',1,1)`);
    const before = snapshot();
    expect((await read(selected('DEEP', 'PAPER'))).json()).toMatchObject({
      canRun: false, canClose: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'risk-policy', status: 'PASS' }),
        expect.objectContaining({ id: 'paper-account', status: 'PASS' }),
        expect.objectContaining({ id: 'paper-recovery', status: 'BLOCKED', detail: expect.stringMatching(/order/i) }),
        expect.objectContaining({ id: 'execution-lane', status: 'BLOCKED', detail: expect.stringMatching(/margin/i) }),
      ]),
    });
    expect(getControl().mode).toBe('PAPER');
    expect(snapshot()).toEqual(before);
  });

  it('reports the real LIVE release gate lock and preserves the owner emergency state', async () => {
    updateControl('owner', { emergency: true, pausedNewOrders: true });
    expect((await read(selected('DEEP', 'LIVE'))).json()).toMatchObject({ canRun: false, checks: expect.arrayContaining([
      expect.objectContaining({ id: 'release-gates', status: 'UNVERIFIED' }),
    ]) });
    expect((await read('/api/qa')).statusCode).toBe(200);
    const before = snapshot();
    for (const mind of ['FAST', 'DEEP']) {
      const response = await read(selected(mind, 'LIVE'));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        mind, environment: 'LIVE', state: 'EMERGENCY', canRun: false, canClose: false,
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'owner-control', status: 'BLOCKED', detail: expect.stringMatching(/emergency/i) }),
          expect.objectContaining({ id: 'release-gates', status: 'BLOCKED', detail: expect.stringContaining('G07') }),
          expect.objectContaining({ id: 'live-account', status: 'BLOCKED' }),
        ]),
      });
    }
    expect(snapshot()).toEqual(before);
  });

  it('expires sampled gate evidence and keeps the legacy release evaluation off the preflight route', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = Date.now();
      const live = () => read(selected('FAST', 'LIVE'));
      expect((await read('/api/qa')).statusCode).toBe(200);
      acceptPolicy('owner', DEFAULT_POLICY);
      const response = await live();
      // The latest policy is visible, while G11 still reflects the time recorded on the QA evaluation.
      expect(response.json()).toMatchObject({ canRun: false, checks: expect.arrayContaining([
        expect.objectContaining({ id: 'risk-policy', status: 'PASS' }),
        expect.objectContaining({ id: 'release-gates', status: 'BLOCKED', observedAt: now, detail: expect.stringContaining('G11') }),
      ]) });
      vi.setSystemTime(now + RELEASE_GATE_EVIDENCE_MAX_AGE_MS + 1);
      expect((await live()).json()).toMatchObject({ canRun: false, checks: expect.arrayContaining([
        expect.objectContaining({ id: 'release-gates', status: 'UNVERIFIED' }),
      ]) });
    } finally { vi.useRealTimers(); }
  });

  it('expires provider and research evidence without granting a selected execution lane', async () => {
    const source = provider('dexscreener')!;
    const original = { ...source };
    const previousAsOf = market.dexFetchedAt;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = Date.now();
      market.dexFetchedAt = now;
      Object.assign(source, { status: 'LIVE', lastOkAt: now });
      await runDualResearchPass(async () => { throw new Error('futures research unavailable'); }, now);
      const request = () => read(selected('FAST', 'PAPER'));
      expect((await request()).json()).toMatchObject({ canRun: false, checks: expect.arrayContaining([
        expect.objectContaining({ id: 'connections', status: 'PASS' }),
        expect.objectContaining({ id: 'market-data', status: 'PASS' }),
      ]) });
      vi.setSystemTime(now + FAST_RESEARCH_MAX_AGE_MS + 1);
      expect((await request()).json()).toMatchObject({ canRun: false, checks: expect.arrayContaining([
        expect.objectContaining({ id: 'connections', status: 'UNVERIFIED' }),
        expect.objectContaining({ id: 'market-data', status: 'UNVERIFIED' }),
      ]) });
    } finally {
      Object.assign(source, original);
      market.dexFetchedAt = previousAsOf;
      _resetDualResearchForTests();
      vi.useRealTimers();
    }
  });

  it('returns scoped activity evidence to the owner without updating account marks', async () => {
    const path = '/api/activity';
    expect((await app.inject({ url: path })).statusCode).toBe(401);
    const at = Date.now();
    const evidence = { at, symbol: 'EXAMPLEUSDT', stage: 'data-quality', reason: 'stale quote' };
    rejections.push({ ...evidence, at: at - 1000 }, evidence);
    const before = snapshot();
    try {
      const response = await read(path);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ activity: [expect.objectContaining({
        at, kind: 'REJECTION', title: expect.stringContaining('EXAMPLEUSDT'), detail: 'stale quote', count: 2,
      })] });
      expect(snapshot()).toEqual(before);
    } finally { rejections.splice(-2); }
  });
});
