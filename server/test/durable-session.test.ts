import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { all, closeDb, get, openDb, run } from '../src/db/db.js';
import { _test as scheduler, botStatus, stopBot } from '../src/bot/bot.js';
import { buildApp } from '../src/index.js';
import { acquireOrRenewLease, currentLease } from '../src/ops/lease.js';
import {
  durableEntryPermission, durableSessionStatus, finishDurableClose,
  openDurablePaperSession, recoverDurableSessionAfterTakeover, suspendDurableEntries,
  type BrainosSessionState,
} from '../src/ops/durableSession.js';
import type { EngineView } from '../src/ops/readiness.js';

const NOW = Date.UTC(2026, 10, 23, 13, 0, 0);
const engine: EngineView = {
  running: true, role: 'LEADER', startedAt: NOW - 1_000,
  lastTickerAt: NOW, lastScanAt: NOW, lastMonitorAt: NOW, monitorFailing: false,
};
let dir: string, file: string;
const seed = (state: BrainosSessionState) => {
  run(`INSERT INTO brainos_sessions(
    session_id,version,state,environment,mind,lease_holder,lease_acquired_at,
    fence_epoch,suspend_reason,started_at,closed_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    'brainos-autopilot', 1, state, 'PAPER', 'FAST', 'leader-a', NOW - 1_000,
    1, 'NONE', NOW - 1_000, null, NOW);
};
beforeEach(() => {
  closeDb();
  dir = mkdtempSync(join(tmpdir(), 'mia61-session-'));
  file = join(dir, 'brainos.sqlite');
  openDb(file);
});
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe('BrainOS 6.1 operational durable session protection', () => {
  it('never creates a session when prerequisites or actual paper execution are uncertified', () => {
    const lease = acquireOrRenewLease('engine', 'leader-a', 60_000, NOW)!;
    expect(() => openDurablePaperSession(engine, 'FAST', {
      name: lease.name, holder: lease.holder, acquired_at: lease.acquired_at,
    }, NOW)).toThrow('SESSION_EXECUTION_LANE_NOT_CERTIFIED');
    expect(durableSessionStatus()).toBeNull();
    expect(all('SELECT * FROM brainos_session_events')).toHaveLength(0);
  });

  it('rejects lost engine leases before a session transition and leaves state untouched', () => {
    const old = acquireOrRenewLease('engine', 'leader-a', 100, NOW)!;
    acquireOrRenewLease('engine', 'leader-b', 60_000, NOW + 101);
    expect(() => openDurablePaperSession(engine, 'FAST', {
      name: old.name, holder: old.holder, acquired_at: old.acquired_at,
    }, NOW + 101)).toThrow('SESSION_LEADER_FENCE_REQUIRED');
    expect(durableSessionStatus()).toBeNull();
  });

  it('leaves a healthy leader session intact on standby boot and recovers it after lease expiry', async () => {
    const leader = acquireOrRenewLease('engine', 'leader-a', 5_000, NOW - 1_000)!;
    seed('RUNNING');
    closeDb();
    openDb(file);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const app = await buildApp();
    try {
      botStatus.running = true;
      botStatus.lastMonitorAt = 0;
      await scheduler.protectionLane();
      expect(botStatus.role).toBe('STANDBY');
      expect(botStatus.lastMonitorAt).toBe(0);
      expect(durableSessionStatus()).toMatchObject({ state: 'RUNNING', version: 1, lease_holder: 'leader-a' });
      expect(all('SELECT * FROM brainos_session_events')).toHaveLength(0);

      const takeoverAt = leader.expires_at + 1;
      vi.setSystemTime(takeoverAt);
      await scheduler.protectionLane();
      expect(botStatus.role).toBe('LEADER');
      expect(botStatus.lastMonitorAt).toBe(takeoverAt);
      expect(durableSessionStatus()).toMatchObject({ state: 'ENTRY_SUSPENDED_RISK_HALT', version: 3, lease_holder: null });
      expect(all<{ kind: string }>('SELECT kind FROM brainos_session_events ORDER BY version').map(({ kind }) => kind))
        .toEqual(['BOOT_RECOVERY_STARTED', 'BOOT_RECOVERY_LOCKED']);
    } finally {
      stopBot();
      vi.useRealTimers();
      await app.close();
    }
  });

  it('crash recovery permanently suspends entries until explicit fresh certification', () => {
    const former = acquireOrRenewLease('engine', 'leader-a', 1_500, NOW - 1_000)!;
    seed('RUNNING');
    closeDb();
    openDb(file); // SQLite WAL reopened after an unclean-process equivalent.
    const successor = acquireOrRenewLease('engine', 'leader-b', 60_000, NOW + 1_000)!;
    expect(() => recoverDurableSessionAfterTakeover(former, NOW + 1_000)).toThrow('engine lease lost');
    expect(durableSessionStatus()?.version).toBe(1);
    const recovered = recoverDurableSessionAfterTakeover(successor, NOW + 1_000)!;
    expect(recovered).toMatchObject({
      state: 'ENTRY_SUSPENDED_RISK_HALT', version: 3, suspend_reason: 'RECONCILIATION_MISMATCH',
      lease_holder: null, fence_epoch: 1,
    });
    expect(all('SELECT * FROM brainos_session_events ORDER BY version').map((x: any) => x.kind))
      .toEqual(['BOOT_RECOVERY_STARTED', 'BOOT_RECOVERY_LOCKED']);
    expect(recoverDurableSessionAfterTakeover(successor, NOW + 2_000)?.version).toBe(3);
    expect(durableEntryPermission(engine, successor, NOW + 2_000)).toMatchObject({
      allowFastNewEntries: false, allowDeepNewEntries: false,
      allowContinuousResearch: true, exitSupervisorMustContinue: true,
      ledgerReconciliationMustContinue: true,
    });
  });

  it('keeps paper protection running if the durable checkpoint cannot be recovered', async () => {
    acquireOrRenewLease('engine', 'leader-a', 500, NOW - 1_000);
    seed('RUNNING');
    run('UPDATE brainos_sessions SET updated_at=?', NOW + 60_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    try {
      botStatus.running = true;
      botStatus.lastMonitorAt = 0;
      await scheduler.protectionLane();
      expect(botStatus.role).toBe('LEADER');
      expect(botStatus.lastMonitorAt).toBe(NOW);
      expect(botStatus.lastError).toBe('session recovery: SESSION_CLOCK_REGRESSION');
      expect(durableSessionStatus()?.version).toBe(1);
      expect(durableEntryPermission(engine, currentLease('engine'), NOW)).toMatchObject({
        allowFastNewEntries: false, allowDeepNewEntries: false,
        exitSupervisorMustContinue: true, reason: 'STALE_OR_LOST_ENGINE_FENCE',
      });
      expect(all('SELECT * FROM brainos_session_events')).toHaveLength(0);
    } finally {
      stopBot();
      vi.useRealTimers();
    }
  });

  it('owner close disables entries but cannot complete while unreconciled orders remain', () => {
    seed('RUNNING');
    const draining = suspendDurableEntries('OWNER_CLOSE_REQUESTED', NOW + 100)!;
    expect(draining.state).toBe('CLOSING_DRAINING_ENTRIES');
    expect(durableEntryPermission(engine, null, NOW + 100).allowFastNewEntries).toBe(false);
    run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at)
      VALUES ('unsettled','unsettled-order','paper-bot','paper','crypto:binance:BTCUSDT','BUY','MARKET',1,'NEW','ENTRY',1,1)`);
    expect(() => finishDurableClose(NOW + 200)).toThrow('SESSION_DRAIN_RECONCILIATION_INCOMPLETE');
    expect(durableSessionStatus()?.state).toBe('CLOSING_DRAINING_ENTRIES');
    run(`DELETE FROM orders WHERE id='unsettled'`);
    expect(finishDurableClose(NOW + 300).state).toBe('CLOSED');
    expect(all('SELECT * FROM brainos_session_events')).toHaveLength(2);
  });

  it('risk halt and emergency stop are persistent, idempotent and cannot be bypassed by callers', () => {
    seed('RUNNING');
    expect(suspendDurableEntries('RISK_HALT', NOW + 1)?.state).toBe('ENTRY_SUSPENDED_RISK_HALT');
    const v = durableSessionStatus()!.version;
    expect(suspendDurableEntries('RISK_HALT', NOW + 2)?.version).toBe(v);
    expect(suspendDurableEntries('EMERGENCY_HALT', NOW + 3)?.state).toBe('EMERGENCY_KILL_SWITCH');
    expect(suspendDurableEntries('OWNER_CLOSE_REQUESTED', NOW + 4)?.state).toBe('EMERGENCY_KILL_SWITCH');
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM brainos_session_events')?.n).toBe(2);
    for(const table of ['orders','fills','positions','ledger_entries'])
      expect(all('SELECT * FROM ' + table)).toHaveLength(0);
  });
});
