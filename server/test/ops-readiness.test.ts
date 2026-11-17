import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb } from './helpers.js';
import { readiness, checkScanStall, staleAfter, _resetWatchdog, type EngineView } from '../src/ops/readiness.js';
import { config } from '../src/config.js';
import { all, run } from '../src/db/db.js';
import { buildApp } from '../src/index.js';

const T = 1_800_000_000_000;
const engine = (o: Partial<EngineView> = {}): EngineView => ({ running: true, role: 'LEADER', startedAt: T - 3_600_000, lastTickerAt: T - 1_000, lastScanAt: T - 1_000, ...o });
const byName = (r: ReturnType<typeof readiness>, n: string) => r.checks.find((c) => c.name === n);

describe('readiness probe', () => {
  const wasOffline = config.offline;
  beforeEach(() => { freshDb(); (config as any).offline = false; _resetWatchdog(); });
  afterEach(() => { (config as any).offline = wasOffline; });

  it('is ready for a leader with fresh lanes', () => {
    const r = readiness(engine(), T);
    expect(r.ready).toBe(true);
    expect(byName(r, 'database')!.status).toBe('pass');
    expect(byName(r, 'tickers')!.status).toBe('pass');
    expect(byName(r, 'scanner')!.status).toBe('pass');
  });
  it('fails closed on a stale scanner, a stale ticker or a stopped engine', () => {
    expect(readiness(engine({ lastScanAt: T - staleAfter().scanMs - 1 }), T).ready).toBe(false);
    expect(readiness(engine({ lastTickerAt: T - staleAfter().tickerMs - 1 }), T).ready).toBe(false);
    expect(readiness(engine({ running: false, role: 'STOPPED' }), T).ready).toBe(false);
  });
  it('gives a fresh engine a grace period, then fails if nothing ran', () => {
    expect(readiness(engine({ startedAt: T - 1_000, lastTickerAt: 0, lastScanAt: 0 }), T).ready).toBe(true);
    expect(readiness(engine({ startedAt: T - staleAfter().scanMs - 1, lastTickerAt: 0, lastScanAt: 0 }), T).ready).toBe(false);
  });
  it('treats a standby (lease held elsewhere) as healthy with idle lanes', () => {
    const r = readiness(engine({ role: 'STANDBY', lastScanAt: 0, lastTickerAt: 0 }), T);
    expect(r.ready).toBe(true); expect(byName(r, 'engine')!.status).toBe('info'); expect(byName(r, 'scanner')).toBeUndefined();
  });
  it('fails when the schema is behind the code', () => {
    run('DELETE FROM schema_migrations WHERE version = (SELECT MAX(version) FROM schema_migrations)');
    const r = readiness(engine(), T); expect(r.ready).toBe(false); expect(byName(r, 'database')!.status).toBe('fail');
  });
  it('skips engine checks in offline mode', () => {
    (config as any).offline = true;
    const r = readiness(engine({ running: false, role: 'STOPPED' }), T);
    expect(r.ready).toBe(true); expect(byName(r, 'engine')!.status).toBe('skip');
  });
});

describe('scan-stall watchdog', () => {
  const wasOffline = config.offline;
  beforeEach(() => { freshDb(); (config as any).offline = false; _resetWatchdog(); });
  afterEach(() => { (config as any).offline = wasOffline; });
  const alerts = () => all<{ severity: string; title: string }>("SELECT severity, title FROM notifications WHERE source='watchdog' ORDER BY rowid");

  it('alerts once per stall and once on recovery', () => {
    const stale = engine({ lastScanAt: T - staleAfter().scanMs - 1 });
    expect(checkScanStall(stale, T)).toBe('STALLED');
    expect(checkScanStall(stale, T + 1_000)).toBe('STALLED');
    expect(alerts()).toEqual([{ severity: 'CRITICAL', title: 'Scanner stalled' }]);
    expect(checkScanStall(engine({ lastScanAt: T + 1_500 }), T + 2_000)).toBe('RECOVERED');
    expect(alerts().map((a) => a.title)).toEqual(['Scanner stalled', 'Scanner recovered']);
  });
  it('stays quiet on a standby or stopped engine', () => {
    expect(checkScanStall(engine({ role: 'STANDBY', lastScanAt: 0, startedAt: 0 }), T)).toBe('IDLE');
    expect(checkScanStall(engine({ running: false, lastScanAt: 0, startedAt: 0 }), T)).toBe('IDLE');
    expect(alerts()).toEqual([]);
  });
});

describe('GET /api/ready', () => {
  beforeEach(() => freshDb());
  it('is reachable without a session and exposes no secrets or error text', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/ready' });
      expect(res.statusCode).toBe(200); // tests run offline: engine skipped, database current
      const body = res.json();
      expect(body.ready).toBe(true);
      expect(Object.keys(body).sort()).toEqual(['at', 'checks', 'ready', 'role', 'schema']);
      for (const c of body.checks) expect(Object.keys(c).sort()).toEqual(['detail', 'name', 'status']);
    } finally { await app.close(); }
  });
});
