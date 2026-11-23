import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { closeDb, openDb } from '../src/db/db.js';
import { record, latencyReport } from '../src/core/latency.js';
import { getControl } from '../src/core/mode.js';

describe('owner latency and reliability cockpit contract', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  const headers = () => ({ cookie, 'x-mia-csrf': '1' });
  beforeAll(async () => {
    closeDb(); openDb(':memory:');
    app = await buildApp();
    const login = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'telemetry test passphrase' } });
    expect(login.statusCode).toBe(200);
    cookie = String(login.headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); closeDb(); });

  it('denies unauthenticated reads and writes and rejects CSRF-less reset', async () => {
    expect((await app.inject({ url: '/api/telemetry/latency' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/telemetry/latency/reset' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/telemetry/latency/reset', headers: { cookie } })).statusCode).toBe(403);
  });

  it('reports real QHEF metrics and REST-only depth without inventing Binance weight or WebSocket sync', async () => {
    record('oms.submit', 12);
    const response = await app.inject({ url: '/api/telemetry/latency', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const value = response.json();
    expect(value.schemaVersion).toBe(1);
    expect(value.slaOverallPass).toBeNull(); // one sampled stage cannot certify all QHEF budgets
    expect(value.stages.find((s: { stage: string }) => s.stage === 'oms.submit')).toMatchObject({
      metric: 'p95', budgetMs: 50, p95Ms: 12, status: 'WITHIN_BUDGET',
    });
    expect(value.eventLoop).toHaveProperty('eldP95Ms');
    expect(value.eventLoop).toHaveProperty('eluActiveRatio');
    expect(value.transport).toMatchObject({
      mode: 'REST_POLLING', websocketConnected: null, usedWeight1m: null, rateLimitCooldownUntilEpochMs: null,
    });
    expect(value.books.every((b: { syncState: string }) => b.syncState === 'REST_SNAPSHOT_UNVERIFIED')).toBe(true);
    expect(value.limitations).toContainEqual(expect.stringContaining('not instrumented'));
  });

  it('resets existing latency/QHEF counters but does not change canonical trading control', async () => {
    const prior = getControl();
    record('oms.submit', 80);
    expect(latencyReport().find((r) => r.stage === 'oms.submit')?.samples).toBeGreaterThan(0);
    const reset = await app.inject({ method: 'POST', url: '/api/telemetry/latency/reset', headers: headers(), payload: {} });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ reset: true });
    const after = (await app.inject({ url: '/api/telemetry/latency', headers: { cookie } })).json();
    expect(after.stages.find((s: { stage: string }) => s.stage === 'oms.submit')).toMatchObject({ count: 0, status: 'NO_DATA' });
    expect(getControl()).toEqual(prior);
    expect((await app.inject({ url: '/api/qhef', headers: { cookie } })).statusCode).toBe(200);
  });
});
