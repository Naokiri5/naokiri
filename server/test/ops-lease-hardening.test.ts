import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, openPositions, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { all, get, run } from '../src/db/db.js';
import { config } from '../src/config.js';
import { currentLease, tryAcquireLease } from '../src/ops/lease.js';
import { readiness, protectionIntervalMs, _resetWatchdog } from '../src/ops/readiness.js';
import { botStatus, botStatusView, startBot, stopBot, ENGINE_LEASE, engineLeaseTtlMs, _test } from '../src/bot/bot.js';
import * as lab from '../src/lab/lab.js';
import * as oms from '../src/exec/oms.js';
import { setCrashHook } from '../src/exec/crashpoint.js';
import type { DecisionReport } from '../src/decision/engine.js';
import { runtimeIntegrityStatus, storeIntegrityResult, RUNTIME_INTEGRITY_KEY } from '../src/ops/runtimeIntegrity.js';

// Network lanes are replaced; everything that writes (OMS, ledger, lease, journal) is the real code.
const hooks = vi.hoisted(() => ({
  duringAwait: (): void => {},
  tickers: async (): Promise<void> => {},
  books: async (): Promise<void> => {},
  deep: async (): Promise<void> => {},
}));
vi.mock('../src/market/fabric.js', async (orig) => ({
  ...(await orig<object>()),
  ensureRules: async () => {},
  refreshTickers: async () => { hooks.duringAwait(); await hooks.tickers(); },
  refreshBooks: () => hooks.books(),
  refreshDeep: () => hooks.deep(),
  refreshBackground: async () => { hooks.duringAwait(); },
}));
vi.mock('../src/ops/backup.js', async (orig) => ({ ...(await orig<object>()), maybeScheduledBackup: () => null }));
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
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    Object.assign(botStatus, { running: true, role: 'STOPPED', lastError: null, lastMonitorAt: 0, monitorFailing: false, startedAt: Date.now() });
    hooks.duringAwait = () => {};
    hooks.tickers = async () => {};
    hooks.books = async () => {};
    hooks.deep = async () => {};
    vi.mocked(oms.monitorPositions).mockClear(); vi.mocked(oms.submitEntry).mockClear(); vi.mocked(lab.checkStrategyHealth).mockClear(); _resetWatchdog();
  });
  afterEach(() => { stopBot(); setCrashHook(null); vi.useRealTimers(); _test.resetTakeoverRefusal(); (config as any).offline = wasOffline; });

  it('a ticker refresh that loses the lease leaves scheduling authority with the successor', async () => {
    hooks.duringAwait = steal;
    await _test.hotLane();
    expect(oms.monitorPositions).not.toHaveBeenCalled();
    expect(botStatus.role).toBe('STANDBY'); expect(botStatus.lastMonitorAt).toBe(0);
    expect(currentLease(ENGINE_LEASE)!.holder).toBe('other-host:1:x');
    expect(all("SELECT title FROM notifications WHERE source='engine-lease'").map((n: any) => n.title)).toEqual(['Engine lease lost']);
  });

  it('onDecision re-checks the lease synchronously: a decision after the lease was lost writes nothing', async () => {
    expect(_test.holdEngine()).toBe(true);
    await _test.protectionLane();
    _test.onDecision(report(id, last)); expect(count('positions')).toBe(1); // control: the leader trades
    steal();
    const before = [count('orders'), count('positions'), count('ledger_entries')];
    _test.onDecision(report(id, last));
    expect(oms.submitEntry).toHaveBeenCalledTimes(1);
    expect([count('orders'), count('positions'), count('ledger_entries')]).toEqual(before);
    expect(botStatus.role).toBe('STANDBY');
  });

  it('fences entry commits when another holder takes over after the scheduler check', async () => {
    await _test.protectionLane();
    setCrashHook((point) => { if (point === 'entry.preTx') steal(); });
    _test.onDecision(report(id, last));
    expect(botStatus.role).toBe('STANDBY');
    expect(count('orders')).toBe(0);
    expect(count('fills')).toBe(0);
    expect(count('positions')).toBe(0);
  });

  it('re-evaluates opportunities right after a position settles, at most once per window', async () => {
    botStatus.lastSettlementRescanAt = 0;
    const before = botStatus.settlementRescans;
    await _test.protectionLane(); // nothing open: nothing settles, no early scan
    expect(botStatus.settlementRescans).toBe(before);
    expect(oms.submitEntry(report(id, last), 'bot').ok).toBe(true);
    setBook(id, last * 0.96); // through the stop
    await _test.protectionLane();
    expect(openPositions()).toHaveLength(0);
    expect(botStatus.settlementRescans).toBe(before + 1);
    expect(_test.requestSettlementRescan()).toBe(false); // bounded: a second request inside the window is refused
    expect(_test.requestSettlementRescan(botStatus.lastSettlementRescanAt + 10_000)).toBe(true);
  });

  describe('coalescing scan scheduler', () => {
    let passes = 0; let release!: () => void; let entered!: () => void;
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };
    /** Blocks the first scan pass on a promise; later passes return at once. */
    const blockFirstPass = () => {
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      hooks.deep = async () => { passes++; if (passes === 1) { entered(); await gate; } };
      return started;
    };
    beforeEach(() => { passes = 0; botStatus.lastTickerAt = Date.now(); expect(_test.holdEngine()).toBe(true); });

    it('a settlement rescan during a pass causes exactly one extra pass after it finishes', async () => {
      const started = blockFirstPass();
      const first = _test.scanLane(); await started;
      botStatus.lastSettlementRescanAt = 0; const before = botStatus.settlementRescans;
      expect(_test.requestSettlementRescan()).toBe(true);
      await settle();
      expect(botStatus.settlementRescans).toBe(before + 1);
      expect(passes).toBe(1); expect(_test.scanDirty()).toBe(true);
      release(); await first; await settle();
      expect(passes).toBe(2); expect(_test.scanDirty()).toBe(false);
    });

    it('three wakes during one pass coalesce into one extra pass', async () => {
      const started = blockFirstPass();
      const first = _test.scanLane(); await started;
      void _test.scanLane(); void _test.scanLane(); void _test.scanLane();
      await settle(); expect(passes).toBe(1);
      release(); await first; await settle();
      expect(passes).toBe(2);
    });

    it('no extra pass when nothing arrived during the pass', async () => {
      await _test.scanLane(); await settle();
      expect(passes).toBe(0);
      const started = blockFirstPass();
      const first = _test.scanLane(); await started;
      release(); await first; await settle();
      expect(passes).toBe(1); expect(_test.scanDirty()).toBe(false);
    });

    it('no extra pass after stopBot()', async () => {
      const started = blockFirstPass();
      const first = _test.scanLane(); await started;
      void _test.scanLane();
      expect(_test.scanDirty()).toBe(true);
      stopBot(); expect(_test.scanDirty()).toBe(false);
      release(); await first; await settle();
      expect(passes).toBe(1);
    });

    it('no extra pass after the lease is lost', async () => {
      const started = blockFirstPass();
      const first = _test.scanLane(); await started;
      _test.requestSettlementRescan(botStatus.lastSettlementRescanAt + 10_000);
      await settle(); expect(_test.scanDirty()).toBe(true);
      steal();
      release(); await first; await settle();
      expect(passes).toBe(1); expect(_test.scanDirty()).toBe(false); expect(botStatus.role).toBe('STANDBY');
    });
  });

  it('fences protective exits at the write lock and leaves the position for the successor', async () => {
    expect(oms.submitEntry(report(id, last), 'bot').ok).toBe(true);
    setBook(id, last * 0.96);
    setCrashHook((point) => { if (point === 'monitor.preTx') steal(); });
    await _test.protectionLane();
    expect(botStatus.role).toBe('STANDBY');
    expect(openPositions()).toHaveLength(1);
    expect(count('fills')).toBe(1);
    expect(count('protection_incidents')).toBe(0);
  });

  it('closes a protected paper position on schedule while ticker and book refreshes are still pending', async () => {
    vi.useFakeTimers();
    stopBot();
    expect(oms.submitEntry(report(id, last), 'bot').ok).toBe(true);
    (config as any).offline = false;
    let releaseRefreshes!: () => void;
    const pending = new Promise<void>((resolve) => { releaseRefreshes = resolve; });
    hooks.tickers = () => pending;
    hooks.books = () => pending;
    try {
      startBot();
      await vi.advanceTimersByTimeAsync(1);
      const priorPass = botStatus.lastMonitorAt;
      expect(botStatusView().lanes.ticker.inFlight).toBe(true);
      expect(botStatusView().lanes.positionBooks.inFlight).toBe(true);
      setBook(id, last * 0.96);
      await vi.advanceTimersByTimeAsync(protectionIntervalMs());
      expect(openPositions()).toHaveLength(0);
      expect(botStatus.lastMonitorAt - priorPass).toBe(protectionIntervalMs());
      expect(botStatusView().lanes.ticker.inFlight).toBe(true);
      expect(readiness(botStatus).checks.find((check) => check.name === 'monitor')?.status).toBe('pass');
    } finally {
      stopBot();
      releaseRefreshes();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it('keeps checking positions while the scanner waits on deep market data', async () => {
    vi.useFakeTimers();
    stopBot();
    expect(oms.submitEntry(report(id, last), 'bot').ok).toBe(true);
    (config as any).offline = false;
    let releaseScan!: () => void;
    const pending = new Promise<void>((resolve) => { releaseScan = resolve; });
    hooks.deep = () => pending;
    try {
      startBot();
      await vi.advanceTimersByTimeAsync(1);
      expect(botStatusView().lanes.scan.inFlight).toBe(true);
      setBook(id, last * 0.96);
      await vi.advanceTimersByTimeAsync(protectionIntervalMs());
      expect(openPositions()).toHaveLength(0);
      expect(botStatusView().lanes.scan.inFlight).toBe(true);
    } finally {
      stopBot();
      releaseScan();
      await vi.advanceTimersByTimeAsync(0);
    }
  });

  it('freezes automated exposure while the monitor fails and resumes after a successful pass', async () => {
    vi.mocked(oms.monitorPositions).mockImplementationOnce(() => { throw new Error('protection failure'); });
    await _test.protectionLane();
    _test.onDecision(report(id, last));
    expect(count('fills')).toBe(0);
    await _test.protectionLane();
    _test.onDecision(report(id, last));
    expect(count('fills')).toBe(1);
  });

  it('lastMonitorAt advances only after an error-free monitor pass; readiness fails while the monitor errors or is stale', async () => {
    (config as any).offline = false;
    const monitor = (e: typeof botStatus) => readiness(e).checks.find((c) => c.name === 'monitor');
    await _test.protectionLane();
    const ok = botStatus.lastMonitorAt; expect(ok).toBeGreaterThan(0); expect(monitor(botStatus)!.status).toBe('pass');
    vi.mocked(oms.monitorPositions).mockImplementationOnce(() => { throw new Error('boom'); });
    vi.useFakeTimers();
    vi.setSystemTime(ok + 5);
    await _test.protectionLane();
    expect(botStatus.lastMonitorAt).toBe(ok); expect(botStatus.monitorFailing).toBe(true);
    expect(monitor(botStatus)).toMatchObject({ status: 'fail', detail: 'last position-monitor pass failed' });
    expect(readiness(botStatus).ready).toBe(false);
    await _test.protectionLane();
    expect(botStatus.lastMonitorAt).toBeGreaterThan(ok); expect(botStatus.monitorFailing).toBe(false); expect(monitor(botStatus)!.status).toBe('pass');
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

  it('takeover records its integrity result for the risk gate; a failed takeover records the failure', () => {
    expect(_test.holdEngine()).toBe(true);
    expect(runtimeIntegrityStatus().record).toMatchObject({ ok: true, source: 'takeover' });
    stopBot(); _test.resetTakeoverRefusal(); run('DELETE FROM runtime_leases');
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    Object.assign(botStatus, { running: true, role: 'STANDBY' });
    expect(_test.holdEngine()).toBe(false);
    const status = runtimeIntegrityStatus();
    expect(status.ok).toBe(false);
    expect(status.reasons[0]).toMatch(/^RUNTIME_INTEGRITY_FAILED: audit chain/);
  });

  it('a failure to store the takeover result does not refuse takeover (protection keeps running)', () => {
    run(`CREATE TRIGGER block_integrity_insert BEFORE INSERT ON settings WHEN NEW.key='${RUNTIME_INTEGRITY_KEY}' BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    expect(_test.holdEngine()).toBe(true);
    expect(botStatus.role).toBe('LEADER');
    expect(botStatus.lastError).toMatch(/^runtime-integrity store: .*disk full/);
    expect(runtimeIntegrityStatus().record).toBeNull();
  });

  it('a failed runtime check pauses entries with one alert, retries sooner, and never blocks a protective exit', async () => {
    expect(_test.holdEngine()).toBe(true);
    await _test.protectionLane();
    expect(oms.submitEntry(report(id, last), 'bot').ok).toBe(true);
    // Simulate the background lane finding a fault: the stored result fails, as refreshRuntimeIntegrity would store it.
    storeIntegrityResult({ ok: false, checks: [{ name: 'ledger reconcile', ok: false, detail: 'drift' }] }, 'runtime', Date.now());
    expect(oms.submitEntry(report(id, last * 1.001), 'bot').ok).toBe(false);
    setBook(id, last * 0.96); // through the stop
    await _test.protectionLane();
    expect(openPositions()).toHaveLength(0); // the exit was not gated
  });

  it('the background lane alerts once when the runtime check turns from clean to failed', async () => {
    expect(_test.holdEngine()).toBe(true);
    run("UPDATE settings SET value=json_set(value,'$.checkedAt',?) WHERE key=?", Date.now() - 31 * 60_000, RUNTIME_INTEGRITY_KEY);
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    await _test.backgroundLane();
    expect(runtimeIntegrityStatus().reasons[0]).toMatch(/^RUNTIME_INTEGRITY_FAILED: audit chain/);
    const alerts = () => all<any>("SELECT title FROM notifications WHERE title='New entries paused: integrity check failed'").length;
    expect(alerts()).toBe(1);
    run("UPDATE settings SET value=json_set(value,'$.checkedAt',?) WHERE key=?", Date.now() - 6 * 60_000, RUNTIME_INTEGRITY_KEY);
    await _test.backgroundLane(); // retried after 5 minutes, still failing: no second alert
    expect(alerts()).toBe(1);
    expect(runtimeIntegrityStatus().record!.checkedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('takeover integrity also fails on an open position without its protective stop, and on a newer schema', async () => {
    const restart = () => { stopBot(); _test.resetTakeoverRefusal(); Object.assign(botStatus, { running: true, role: 'STANDBY' }); };
    expect(_test.holdEngine()).toBe(true);
    await _test.protectionLane();
    _test.onDecision(report(id, last));
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

  it('reconciles again when the same holder returns after its lease expired', () => {
    expect(_test.holdEngine()).toBe(true);
    const old = currentLease(ENGINE_LEASE)!;
    run("UPDATE audit_log SET hash='tampered' WHERE id=(SELECT MIN(id) FROM audit_log)");
    vi.useFakeTimers();
    vi.setSystemTime(old.expires_at + 1);
    expect(_test.holdEngine()).toBe(false);
    expect(botStatus.role).toBe('STOPPED');
    expect(currentLease(ENGINE_LEASE)).toBeNull();
  });
});
