import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { all, get, run } from '../src/db/db.js';
import { config } from '../src/config.js';
import { currentLease, tryAcquireLease } from '../src/ops/lease.js';
import { readiness, _resetWatchdog } from '../src/ops/readiness.js';
import { botStatus, stopBot, ENGINE_LEASE, engineLeaseTtlMs, _test } from '../src/bot/bot.js';
import * as lab from '../src/lab/lab.js';
import * as oms from '../src/exec/oms.js';
import type { DecisionReport } from '../src/decision/engine.js';

// Network lanes are replaced; everything that writes (OMS, ledger, lease, journal) is the real code.
const hooks = vi.hoisted(() => ({ duringAwait: (): void => {} }));
vi.mock('../src/market/fabric.js', async (orig) => ({ ...(await orig<object>()), ensureRules: async () => {}, refreshTickers: async () => { hooks.duringAwait(); }, refreshBooks: async () => {}, refreshDeep: async () => {}, refreshBackground: async () => { hooks.duringAwait(); } }));
vi.mock('../src/whales/prints.js', async (orig) => ({ ...(await orig<object>()), scanPrints: async () => {} }));
vi.mock('../src/news/news.js', async (orig) => ({ ...(await orig<object>()), refreshNews: async () => 0 }));
vi.mock('../src/lab/lab.js', async (orig) => { const real = await orig<typeof import('../src/lab/lab.js')>(); return { ...real, checkStrategyHealth: vi.fn(real.checkStrategyHealth) }; });
vi.mock('../src/exec/oms.js', async (orig) => { const real = await orig<typeof import('../src/exec/oms.js')>(); return { ...real, monitorPositions: vi.fn(real.monitorPositions), submitEntry: vi.fn(real.submitEntry) }; });

function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}
const steal = () => run('UPDATE runtime_leases SET holder=?, expires_at=? WHERE name=?', 'other-host:1:x', Date.now() + 600_000, ENGINE_LEASE);
const count = (t: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)!.n;

describe('engine lease hardening (additive to holdEngine)', () => {
  let id = ''; let last = 0;
  const wasOffline = config.offline;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    Object.assign(botStatus, { running: true, role: 'STOPPED', lastError: null, lastMonitorAt: 0, monitorFailing: false, startedAt: Date.now() });
    hooks.duringAwait = () => {}; vi.mocked(oms.monitorPositions).mockClear(); vi.mocked(oms.submitEntry).mockClear(); vi.mocked(lab.checkStrategyHealth).mockClear(); _resetWatchdog();
  });
  afterEach(() => { stopBot(); _test.resetTakeoverRefusal(); (config as any).offline = wasOffline; });

  it('hotLane re-checks the lease after its awaits: a lost lease skips the monitor writes and drops to STANDBY', async () => {
    hooks.duringAwait = steal;
    await _test.hotLane();
    expect(oms.monitorPositions).not.toHaveBeenCalled();
    expect(botStatus.role).toBe('STANDBY'); expect(botStatus.lastMonitorAt).toBe(0);
    expect(currentLease(ENGINE_LEASE)!.holder).toBe('other-host:1:x');
    expect(all("SELECT title FROM notifications WHERE source='engine-lease'").map((n: any) => n.title)).toEqual(['Engine lease lost']);
  });

  it('onDecision re-checks the lease synchronously: a decision after the lease was lost writes nothing', () => {
    expect(_test.holdEngine()).toBe(true);
    _test.onDecision(report(id, last)); expect(count('positions')).toBe(1); // control: the leader trades
    steal();
    const before = [count('orders'), count('positions'), count('ledger_entries')];
    _test.onDecision(report(id, last));
    expect(oms.submitEntry).toHaveBeenCalledTimes(1);
    expect([count('orders'), count('positions'), count('ledger_entries')]).toEqual(before);
    expect(botStatus.role).toBe('STANDBY');
  });

  it('lastMonitorAt advances only after an error-free monitor pass; readiness fails while the monitor errors or is stale', async () => {
    (config as any).offline = false;
    const monitor = (e: typeof botStatus) => readiness(e).checks.find((c) => c.name === 'monitor');
    // Controlled clock instead of a real wait (CodeRabbit PR #12): lastMonitorAt and readiness both read Date.now().
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_800_000_000_000);
    try {
    await _test.hotLane();
    const ok = botStatus.lastMonitorAt; expect(ok).toBeGreaterThan(0); expect(monitor(botStatus)!.status).toBe('pass');
    vi.mocked(oms.monitorPositions).mockImplementationOnce(() => { throw new Error('boom'); });
    vi.setSystemTime(Date.now() + 5); await _test.hotLane();
    expect(botStatus.lastMonitorAt).toBe(ok); expect(botStatus.monitorFailing).toBe(true);
    expect(monitor(botStatus)).toMatchObject({ status: 'fail', detail: 'last position-monitor pass failed' });
    expect(readiness(botStatus).ready).toBe(false);
    vi.setSystemTime(Date.now() + 5); await _test.hotLane();
    expect(botStatus.lastMonitorAt).toBeGreaterThan(ok); expect(botStatus.monitorFailing).toBe(false); expect(monitor(botStatus)!.status).toBe('pass');
    } finally { vi.useRealTimers(); }
  });

  it('takeover runs the integrity checks; a failure releases the lease, stops the engine and records why', () => {
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    botStatus.role = 'STANDBY';
    expect(_test.holdEngine()).toBe(false);
    expect(botStatus).toMatchObject({ running: false, role: 'STOPPED' });
    expect(botStatus.lastError).toMatch(/^integrity: audit chain: broken at entry/);
    expect(currentLease(ENGINE_LEASE)).toBeNull();
    expect(get<any>("SELECT title FROM notifications WHERE source='engine-lease'")!.title).toBe('Engine stopped: integrity check failed');
  });

  it('takeover integrity also fails on an open position without its protective stop, and on a newer schema', () => {
    const restart = () => { stopBot(); _test.resetTakeoverRefusal(); Object.assign(botStatus, { running: true, role: 'STANDBY' }); };
    expect(_test.holdEngine()).toBe(true); _test.onDecision(report(id, last));
    run("DELETE FROM orders WHERE purpose='PROTECTIVE_STOP'");
    restart(); run('DELETE FROM runtime_leases');
    expect(_test.holdEngine()).toBe(false); expect(botStatus.lastError).toMatch(/protective stops: 1 open position\(s\) without a matching active stop/);
    freshDb(); run('INSERT INTO schema_migrations(version, applied_at) VALUES (999, 0)');
    restart();
    expect(_test.holdEngine()).toBe(false); expect(botStatus.lastError).toMatch(/schema: v999/);
  });

  it('a refused takeover stays refused: the process cannot re-acquire the lease or trade from an in-flight scan', () => {
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    botStatus.role = 'STANDBY';
    expect(_test.holdEngine()).toBe(false);
    const before = [count('orders'), count('positions'), count('ledger_entries')];
    expect(_test.holdEngine()).toBe(false);
    _test.onDecision(report(id, last));
    expect(oms.submitEntry).not.toHaveBeenCalled();
    expect([count('orders'), count('positions'), count('ledger_entries')]).toEqual(before);
    expect(currentLease(ENGINE_LEASE)).toBeNull();
  });

  it('backgroundPass re-checks the lease after its awaits before backups and strategy suspension', async () => {
    expect(_test.holdEngine()).toBe(true);
    hooks.duringAwait = steal;
    await _test.backgroundLane();
    expect(lab.checkStrategyHealth).not.toHaveBeenCalled();
    expect(botStatus.role).toBe('STANDBY');
    expect(count("journal WHERE summary LIKE 'Backup %'")).toBe(0);
  });

  it('the lease TTL override applies only offline; an online engine always keeps the 45 s minimum', () => {
    const was = config.engineLeaseTtlMs;
    try {
      (config as any).engineLeaseTtlMs = 1_500;
      (config as any).offline = true; expect(engineLeaseTtlMs()).toBe(1_500);
      (config as any).offline = false; expect(engineLeaseTtlMs()).toBeGreaterThanOrEqual(45_000);
    } finally { (config as any).engineLeaseTtlMs = was; }
  });

  it('a healthy takeover passes; renewals by the current leader do not re-run the checks', () => {
    tryAcquireLease(ENGINE_LEASE, 'other-host:1:x', 1, 0); // an expired lease from a crashed leader
    botStatus.role = 'STANDBY';
    expect(_test.holdEngine()).toBe(true); expect(botStatus.role).toBe('LEADER');
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    expect(_test.holdEngine()).toBe(true); expect(botStatus.role).toBe('LEADER');
  });
});
