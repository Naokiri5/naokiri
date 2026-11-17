import { describe, it, expect, beforeAll } from 'vitest';
import { closeDb, openDb, run } from '../src/db/db.js';
import { readiness, READY_NOTE, type ReadinessInput } from '../src/core/readiness.js';
import { runStartupChecks } from '../src/core/startup.js';
import { buildApp } from '../src/index.js';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { submitEntry } from '../src/exec/oms.js';
import type { DecisionReport } from '../src/decision/engine.js';

const NOW = 1_800_000_000_000;
const ok: ReadinessInput = { dbOk: true, startupOk: true, offline: false, running: true, leaseState: 'OWNER', lastMonitorAt: NOW - 5_000, monitorFailing: false, lastScanAt: NOW - 30_000,
  tickersFetchedAt: NOW - 5_000, tickerIntervalMs: 15_000, policyAccepted: true, mode: 'PAPER' };

describe('readiness (pure)', () => {
  it('all PASS => ready, ages reported', () => {
    const r = readiness(ok, NOW);
    expect(r).toMatchObject({ ready: true, scope: 'PAPER_ENGINE', serverTime: NOW, reasons: [], agesMs: { ticker: 5_000, scan: 30_000, heartbeat: 5_000 }, note: READY_NOTE });
    expect(Object.values(r.checks).every((s) => s === 'PASS')).toBe(true);
  });
  it.each<[string, Partial<ReadinessInput>, string]>([
    ['db', { dbOk: false }, 'db'], ['startup', { startupOk: false }, 'startup'], ['offline', { offline: true }, 'engine'], ['not running', { running: false }, 'engine'],
    ['standby', { leaseState: 'STANDBY' }, 'lease'], ['vacant', { leaseState: 'VACANT' }, 'lease'],
    ['monitor stalled', { lastMonitorAt: NOW - 45_001 }, 'heartbeat'], ['no monitor pass yet', { lastMonitorAt: 0 }, 'heartbeat'], ['monitor failing', { monitorFailing: true }, 'heartbeat'],
    ['no market data', { tickersFetchedAt: 0 }, 'marketData'], ['stale market data', { tickersFetchedAt: NOW - 60_001 }, 'marketData'],
  ])('%s => not ready', (_n, over, check) => {
    const r = readiness({ ...ok, ...over }, NOW);
    expect(r.ready).toBe(false); expect((r.checks as any)[check]).toBe('FAIL'); expect(r.reasons).toContain(check);
  });
  it('heartbeat window scales with the ticker interval (3x, min 45 s)', () => {
    expect(readiness({ ...ok, tickerIntervalMs: 30_000, lastMonitorAt: NOW - 89_000 }, NOW).checks.heartbeat).toBe('PASS');
    expect(readiness({ ...ok, lastMonitorAt: NOW - 45_000 }, NOW).checks.heartbeat).toBe('PASS');
  });
  it('missing policy in PAPER/APPROVAL is WARN and still ready; in OBSERVE it is PASS', () => {
    for (const mode of ['PAPER', 'APPROVAL']) {
      const r = readiness({ ...ok, policyAccepted: false, mode }, NOW);
      expect(r).toMatchObject({ ready: true, reasons: ['policy'] }); expect(r.checks.policy).toBe('WARN');
    }
    expect(readiness({ ...ok, policyAccepted: false, mode: 'OBSERVE' }, NOW).checks.policy).toBe('PASS');
  });
  it('unknown ages are null', () => {
    expect(readiness({ ...ok, lastMonitorAt: 0, lastScanAt: 0, tickersFetchedAt: 0 }, NOW).agesMs).toEqual({ ticker: null, scan: null, heartbeat: null });
  });
});

describe('GET /api/ready (offline server)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { closeDb(); openDb(':memory:'); app = await buildApp(); runStartupChecks(); });
  it('is unauthenticated, 503 with engine FAIL, no-store, and leaks nothing sensitive', async () => {
    const r = await app.inject({ url: '/api/ready' });
    expect(r.statusCode).toBe(503); expect(r.headers['cache-control']).toBe('no-store');
    const b = r.json();
    expect(b).toMatchObject({ ready: false, scope: 'PAPER_ENGINE', checks: { db: 'PASS', startup: 'PASS', engine: 'FAIL', lease: 'FAIL', heartbeat: 'FAIL', marketData: 'FAIL', policy: 'PASS' } });
    expect(b.reasons).toEqual(['engine', 'lease', 'heartbeat', 'marketData']);
    expect(Object.keys(b).sort()).toEqual(['agesMs', 'checks', 'note', 'ready', 'reasons', 'scope', 'serverTime']);
    expect(r.body).not.toMatch(/"pid"|instanceId|equity|deposits|"positions"|SQLITE_|\/tmp|\/workspace|sqlite|SELECT/i);
  });
  it('only GET /api/ready is exempt from auth; /api/health is unchanged', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/ready' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/ready?x=1' })).statusCode).toBe(401);
    const h = await app.inject({ url: '/api/health' });
    expect(h.statusCode).toBe(200); expect(Object.keys(h.json()).sort()).toEqual(['offline', 'ok', 'schema', 'setup', 'version']);
  });
});

describe('runStartupChecks', () => {
  it('passes on a fresh database', () => {
    freshDb();
    const r = runStartupChecks();
    expect(r.ok).toBe(true); expect(r.checks.map((c) => c.id)).toEqual(['db_integrity', 'schema', 'audit_chain', 'ledger_reconcile', 'protective_stops']);
  });
  it('fails on a database newer than this build', () => {
    freshDb(); run('INSERT INTO schema_migrations(version, applied_at) VALUES (99, 0)');
    const r = runStartupChecks();
    expect(r.ok).toBe(false); expect(r.checks.find((c) => c.id === 'schema')).toMatchObject({ status: 'FAIL', detail: expect.stringMatching(/database is newer than this build/) });
  });
  it('fails when an open position lost its protective stop (and passes while it has one)', () => {
    freshDb(); market.reset(); const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 });
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const rep = { id: 'dec_x', candidateId: 'cand_x', traceId: 'tr', asset: 'ETHUSDT', instrumentId: inst.id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
      entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
      consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } } as unknown as DecisionReport;
    expect(submitEntry(rep, 'bot').ok).toBe(true);
    expect(runStartupChecks().ok).toBe(true);
    run("DELETE FROM orders WHERE purpose='PROTECTIVE_STOP'");
    const r = runStartupChecks();
    expect(r.ok).toBe(false); expect(r.checks.filter((c) => c.status === 'FAIL').map((c) => c.id)).toEqual(['protective_stops']);
  });
});
