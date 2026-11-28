import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { all, closeDb, get, openDb, run } from '../src/db/db.js';
import { migrate } from '../src/db/migrations.js';
import { setupOwner } from '../src/api/auth.js';
import { _test as scheduler, botStatus, stopBot } from '../src/bot/bot.js';
import { config } from '../src/config.js';
import { updateControl } from '../src/core/mode.js';
import { buildApp } from '../src/index.js';
import { acquireOrRenewLease, currentLease, releaseLease } from '../src/ops/lease.js';
import { inspectLeaseWitness } from '../src/ops/leaseWitness.js';
import {
  drainExpiredMandate, durableEntryPermission, durableSessionStatus, finishDurableClose,
  authorizePaperSpotSession, openDurablePaperSession, openPaperSpotSession, paperSpotEntryDenial,
  recoverDurableSessionAfterTakeover, requestPaperSpotClose, suspendDurableEntries,
  type BrainosSessionState,
} from '../src/ops/durableSession.js';
import type { EngineView } from '../src/ops/readiness.js';
import { paperSpotSessionPreflight, sessionPreflight } from '../src/ops/sessionPreflight.js';
import { mandateEntryDenial, strategyConfigVersion } from '../src/ops/tradingMandate.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';

const NOW = Date.UTC(2026, 10, 23, 13, 0, 0);
const MANDATE = { capitalCeiling: 5_000, durationHours: 24 };
const engine: EngineView = {
  running: true, role: 'LEADER', startedAt: NOW - 1_000,
  lastTickerAt: NOW, lastScanAt: NOW, lastMonitorAt: NOW, monitorFailing: false,
};
let dir: string, file: string;
const offline = config.offline;
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
afterEach(() => { config.offline = offline; vi.useRealTimers(); closeDb(); rmSync(dir, { recursive: true, force: true }); });

function prepareSpotSession(leaseAt = NOW - 1) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW - 1);
  config.offline = false;
  setupOwner('offline test owner');
  acceptPolicy('owner', DEFAULT_POLICY);
  ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
  updateControl('owner', { mode: 'PAPER' });
  return acquireOrRenewLease('engine', 'leader-a', 1_000, leaseAt)!;
}

function pendingApproval(id: string, at: number, venue = 'binance-paper') {
  run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at)
    VALUES (?,?,?,?,?,'BUY','MARKET',1,'PENDING_APPROVAL','ENTRY',?,?)`,
  id, `${id}-client`, PAPER_ACCOUNT, venue, 'crypto:binance:BTCUSDT', at, at);
}

describe('BrainOS 6.1 operational durable session protection', () => {
  it('never creates a session when prerequisites or actual paper execution are uncertified', () => {
    const lease = acquireOrRenewLease('engine', 'leader-a', 60_000, NOW)!;
    expect(() => openDurablePaperSession(engine, 'FAST', {
      name: lease.name, holder: lease.holder, acquired_at: lease.acquired_at, epoch: lease.epoch,
    }, NOW)).toThrow('SESSION_EXECUTION_LANE_NOT_CERTIFIED');
    expect(durableSessionStatus()).toBeNull();
    expect(all('SELECT * FROM brainos_session_events')).toHaveLength(0);
  });

  it('rejects lost engine leases before a session transition and leaves state untouched', () => {
    const old = acquireOrRenewLease('engine', 'leader-a', 100, NOW)!;
    acquireOrRenewLease('engine', 'leader-b', 60_000, NOW + 101);
    expect(() => openDurablePaperSession(engine, 'FAST', {
      name: old.name, holder: old.holder, acquired_at: old.acquired_at, epoch: old.epoch,
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

describe('durable Binance spot paper authorization', () => {
  it('starts only the selected spot lane after owner, risk, funds and protection checks', () => {
    expect(paperSpotEntryDenial(null, NOW)).toBeNull();
    const fence = acquireOrRenewLease('engine', 'leader-a', 1_000, NOW - 1)!;
    expect(() => openPaperSpotSession(engine, fence, MANDATE, NOW)).toThrow('PAPER_SPOT_SESSION_PREFLIGHT_BLOCKED');
    expect(durableSessionStatus()).toBeNull();

    prepareSpotSession();
    expect(paperSpotEntryDenial(fence, NOW)).toBe('PAPER_SPOT_SESSION_REQUIRED');
    expect(paperSpotSessionPreflight({ ...engine, instanceId: 'standby' }, NOW).canRun).toBe(false);
    expect(paperSpotSessionPreflight({ ...engine, monitorFailing: true }, NOW).canRun).toBe(false);
    expect(paperSpotSessionPreflight(engine, NOW)).toMatchObject({ state: 'CLOSED', canRun: true, canClose: false });
    expect(sessionPreflight(engine, 'FAST', 'PAPER', NOW).canRun).toBe(false);
    expect(sessionPreflight(engine, 'DEEP', 'LIVE', NOW).canRun).toBe(false);

    pendingApproval('legacy-order', NOW);
    expect(openPaperSpotSession(engine, fence, MANDATE, NOW)).toMatchObject({ mind: 'SPOT_PAPER', state: 'RUNNING', fence_epoch: 1 });
    expect(get<{ status: string }>("SELECT status FROM orders WHERE id='legacy-order'")?.status).toBe('CANCELLED');
    expect(paperSpotSessionPreflight(engine, NOW)).toMatchObject({ state: 'RUNNING', canRun: false, canClose: true });
    expect(paperSpotEntryDenial(fence, NOW, NOW)).toBeNull();
    expect(paperSpotEntryDenial(null, NOW)).toBe('STALE_OR_LOST_ENGINE_FENCE');
    expect(paperSpotEntryDenial(fence, NOW, NOW, { scope: 'BINANCE_SPOT', strategy: { id: 'trend_pullback', version: '1.0.0' } })).toBeNull();
    expect(paperSpotEntryDenial(fence, NOW, NOW, { scope: 'FUTURES', strategy: { id: 'trend_pullback', version: '1.0.0' } })).toMatch(/^MARKET_OUTSIDE_SESSION_MANDATE/);
    expect(paperSpotEntryDenial(fence, NOW, NOW, { scope: 'SOLANA_MEMECOIN', strategy: { id: 'trend_pullback', version: '1.0.0' } })).toMatch(/^MARKET_OUTSIDE_SESSION_MANDATE/);
    expect(paperSpotEntryDenial(fence, NOW, NOW, { scope: 'UNSUPPORTED', strategy: { id: 'trend_pullback', version: '1.0.0' } })).toMatch(/^MARKET_OUTSIDE_SESSION_MANDATE/);
    expect(paperSpotEntryDenial(fence, NOW, NOW - 1)).toBe('ENTRY_EVIDENCE_OUTSIDE_SESSION');
    expect(paperSpotEntryDenial(fence, NOW, NOW + 1)).toBe('ENTRY_EVIDENCE_OUTSIDE_SESSION');
    expect(durableEntryPermission(engine, fence, NOW)).toMatchObject({ allowFastNewEntries: false, allowDeepNewEntries: false });
  });

  it('blocks a new lease generation from reusing a same-millisecond owner authorization', () => {
    const fence = prepareSpotSession(NOW);
    vi.setSystemTime(NOW);
    openPaperSpotSession(engine, fence, MANDATE, NOW);
    expect(paperSpotEntryDenial(fence, NOW, NOW)).toBeNull();
    expect(inspectLeaseWitness(file, NOW).session).toBe('BOUND');
    expect(releaseLease(fence.name, fence.holder, fence.acquired_at, fence.epoch)).toBe(true);
    const successor = acquireOrRenewLease(fence.name, fence.holder, 1_000, NOW)!;
    expect(successor.acquired_at).toBe(fence.acquired_at);
    expect(successor.epoch).toBeGreaterThan(fence.epoch);

    expect(paperSpotEntryDenial(successor, NOW, NOW)).toBe('STALE_OR_LOST_ENGINE_FENCE');
    expect(inspectLeaseWitness(file, NOW).session).toBe('UNBOUND');
    expect(recoverDurableSessionAfterTakeover(successor, NOW)).toMatchObject({ state: 'ENTRY_SUSPENDED_RISK_HALT' });
    expect(paperSpotEntryDenial(successor, NOW, NOW)).toBe('SESSION_NOT_RUNNING');
  });

  it('rolls the session opening back when its audit record cannot be written', () => {
    const fence = prepareSpotSession();
    pendingApproval('kept-approval', NOW);
    run("CREATE TEMP TRIGGER fixture_reject_session_audit BEFORE INSERT ON audit_log WHEN NEW.action='session.paper_spot.run' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END");
    try {
      expect(() => authorizePaperSpotSession(engine, fence, { ...MANDATE, authorizedBy: 'owner:test' }, NOW)).toThrow('fixture audit failure');
    } finally { run('DROP TRIGGER fixture_reject_session_audit'); }
    expect(durableSessionStatus()?.state ?? 'CLOSED').toBe('CLOSED');
    expect(get<{ status: string }>("SELECT status FROM orders WHERE id='kept-approval'")?.status).toBe('PENDING_APPROVAL');
    expect(authorizePaperSpotSession(engine, fence, { ...MANDATE, authorizedBy: 'owner:test' }, NOW)).toMatchObject({ state: 'RUNNING' });
    expect(get("SELECT 1 FROM audit_log WHERE action='session.paper_spot.run'")).toBeTruthy();
  });

  it('rejects a duplicate authorization (a repeated swipe or retried request) without a second mandate or audit row', () => {
    const fence = prepareSpotSession();
    const first = authorizePaperSpotSession(engine, fence, { ...MANDATE, authorizedBy: 'owner:test' }, NOW);
    expect(() => authorizePaperSpotSession(engine, fence, { ...MANDATE, capitalCeiling: MANDATE.capitalCeiling / 2, authorizedBy: 'owner:test' }, NOW + 1))
      .toThrow('SESSION_NOT_CLOSED');
    expect(durableSessionStatus()).toMatchObject({ state: 'RUNNING', capital_ceiling: first.capital_ceiling, started_at: NOW });
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action='session.paper_spot.run'")!.n).toBe(1);
  });

  it('never cancels an approval carrying execution evidence when the session closes', () => {
    const fence = prepareSpotSession();
    openPaperSpotSession(engine, fence, MANDATE, NOW);
    pendingApproval('clean-approval', NOW); pendingApproval('filled-approval', NOW);
    run("UPDATE orders SET filled_qty=1 WHERE id='filled-approval'");
    requestPaperSpotClose(NOW + 1);
    expect(get<{ status: string }>("SELECT status FROM orders WHERE id='clean-approval'")?.status).toBe('CANCELLED');
    expect(get<{ status: string }>("SELECT status FROM orders WHERE id='filled-approval'")?.status).toBe('PENDING_APPROVAL');
  });

  it('keeps a stale session blocked after an owner control change is reversed', () => {
    const fence = prepareSpotSession();
    openPaperSpotSession(engine, fence, MANDATE, NOW);
    vi.setSystemTime(NOW + 1);
    updateControl('owner', { pausedNewOrders: true });
    expect(paperSpotEntryDenial(fence, NOW + 1)).toBe('SESSION_OWNER_ENTRY_HALT');
    vi.setSystemTime(NOW + 2);
    updateControl('owner', { pausedNewOrders: false });
    expect(paperSpotEntryDenial(fence, NOW + 2)).toBe('SESSION_OWNER_CONTROL_CHANGED');
    expect(paperSpotSessionPreflight(engine, NOW + 2).checks).toContainEqual(expect.objectContaining({
      id: 'execution-lane', status: 'BLOCKED', detail: expect.stringContaining('controls changed after authorization'),
    }));
  });

  it('atomically cancels pending approvals on close and preserves draining across takeover', () => {
    const fence = prepareSpotSession();
    openPaperSpotSession(engine, fence, MANDATE, NOW);
    pendingApproval('session-order', NOW + 1);
    pendingApproval('other-venue-order', NOW + 1, 'other-venue');
    const draining = requestPaperSpotClose(NOW + 2);
    expect(draining?.state).toBe('CLOSING_DRAINING_ENTRIES');
    expect(requestPaperSpotClose(NOW + 3)?.version).toBe(draining?.version);
    expect(all<{ id: string; status: string }>('SELECT id,status FROM orders ORDER BY id'))
      .toEqual([{ id: 'other-venue-order', status: 'PENDING_APPROVAL' }, { id: 'session-order', status: 'CANCELLED' }]);
    expect(paperSpotEntryDenial(fence, NOW + 3)).toBe('SESSION_NOT_RUNNING');

    const takeoverAt = fence.expires_at + 1;
    const successor = acquireOrRenewLease('engine', 'leader-b', 60_000, takeoverAt)!;
    expect(recoverDurableSessionAfterTakeover(successor, takeoverAt)).toMatchObject({
      state: 'CLOSING_DRAINING_ENTRIES', lease_holder: 'leader-b',
    });
    expect(() => finishDurableClose(takeoverAt, fence)).toThrow('engine lease lost');
    vi.setSystemTime(takeoverAt);
    expect(finishDurableClose(undefined, successor)).toMatchObject({ state: 'CLOSED', closed_at: takeoverAt });
    expect(paperSpotEntryDenial(successor, takeoverAt)).toBe('SESSION_NOT_RUNNING');
  });

  it('requires explicit close after the owner clears the emergency stop', () => {
    const fence = prepareSpotSession();
    openPaperSpotSession(engine, fence, MANDATE, NOW);
    vi.setSystemTime(NOW + 1);
    updateControl('owner', { emergency: true, pausedNewOrders: true });
    expect(requestPaperSpotClose(NOW + 1)?.state).toBe('EMERGENCY_KILL_SWITCH');
    expect(paperSpotSessionPreflight(engine, NOW + 1).canClose).toBe(false);
    vi.setSystemTime(NOW + 2);
    updateControl('owner', { emergency: false, pausedNewOrders: false });
    expect(paperSpotSessionPreflight(engine, NOW + 2)).toMatchObject({ canRun: false, canClose: true });
    expect(() => openPaperSpotSession(engine, fence, MANDATE, NOW + 2)).toThrow('SESSION_NOT_CLOSED');
    expect(requestPaperSpotClose(NOW + 2)?.state).toBe('CLOSING_DRAINING_ENTRIES');
    expect(finishDurableClose(NOW + 3, fence).state).toBe('CLOSED');
    expect(openPaperSpotSession(engine, fence, MANDATE, NOW + 4).fence_epoch).toBe(2);
  });
});

describe('durable trading mandate', () => {
  const HOUR = 3_600_000;

  it('persists the owner mandate with the session and records it in the event log', () => {
    const fence = prepareSpotSession();
    const session = openPaperSpotSession(engine, fence, { ...MANDATE, authorizedBy: 'owner:passphrase' }, NOW);
    expect(session).toMatchObject({
      market_scope: 'BINANCE_SPOT', capital_ceiling: 5_000, risk_policy_version: 1, authorized_by: 'owner:passphrase',
      authorized_at: NOW, expires_at: NOW + 24 * HOUR, strategy_config_version: strategyConfigVersion(),
    });
    expect(durableSessionStatus()).toMatchObject({ capital_ceiling: 5_000, expires_at: NOW + 24 * HOUR });
    const event = get<{ kind: string; mandate_json: string }>(
      'SELECT kind, mandate_json FROM brainos_session_events ORDER BY seq DESC LIMIT 1')!;
    expect(event.kind).toBe('OWNER_OPEN_SPOT_PAPER_SESSION');
    expect(JSON.parse(event.mandate_json)).toMatchObject({ market_scope: 'BINANCE_SPOT', capital_ceiling: 5_000 });
    expect(paperSpotSessionPreflight(engine, NOW)).toMatchObject({
      mandate: { capital_ceiling: 5_000, openExposure: 0, expired: false },
      authorization: { maxCapital: 10_000, minDurationHours: 1, maxDurationHours: 720 },
    });
  });

  it('rejects a mandate beyond paper funds or duration bounds without granting entry authority', () => {
    const fence = prepareSpotSession();
    expect(() => openPaperSpotSession(engine, fence, { capitalCeiling: 10_001, durationHours: 24 }, NOW)).toThrow('MANDATE_CAPITAL_EXCEEDS_FUNDS');
    expect(() => openPaperSpotSession(engine, fence, { capitalCeiling: 0, durationHours: 24 }, NOW)).toThrow('MANDATE_CAPITAL_INVALID');
    expect(() => openPaperSpotSession(engine, fence, { capitalCeiling: Number.NaN, durationHours: 24 }, NOW)).toThrow('MANDATE_CAPITAL_INVALID');
    expect(() => openPaperSpotSession(engine, fence, { capitalCeiling: 1_000, durationHours: 0 }, NOW)).toThrow('MANDATE_DURATION_INVALID');
    expect(() => openPaperSpotSession(engine, fence, { capitalCeiling: 1_000, durationHours: 1.5 }, NOW)).toThrow('MANDATE_DURATION_INVALID');
    expect(() => openPaperSpotSession(engine, fence, { capitalCeiling: 1_000, durationHours: 721 }, NOW)).toThrow('MANDATE_DURATION_INVALID');
    expect(durableSessionStatus()?.state ?? 'CLOSED').toBe('CLOSED');
    expect(all("SELECT * FROM brainos_session_events WHERE to_state='RUNNING'")).toHaveLength(0);
  });

  it('fails closed when the risk policy changes after authorization', () => {
    const fence = prepareSpotSession();
    openPaperSpotSession(engine, fence, MANDATE, NOW);
    expect(paperSpotEntryDenial(fence, NOW, NOW)).toBeNull();
    vi.setSystemTime(NOW + 1);
    acceptPolicy('owner', { ...DEFAULT_POLICY });
    expect(paperSpotEntryDenial(fence, NOW + 1)).toBe('SESSION_RISK_POLICY_CHANGED');
    expect(paperSpotSessionPreflight(engine, NOW + 1).checks).toContainEqual(expect.objectContaining({
      id: 'execution-lane', status: 'BLOCKED', detail: expect.stringContaining('risk policy changed'),
    }));
  });

  it('drains an expired mandate without the owner and closes once reconciled', () => {
    const fence = prepareSpotSession();
    openPaperSpotSession(engine, fence, { capitalCeiling: 1_000, durationHours: 1 }, NOW);
    pendingApproval('expiring-order', NOW + 1);
    expect(drainExpiredMandate(NOW + HOUR - 1)?.state).toBe('RUNNING');
    expect(paperSpotEntryDenial(fence, NOW + HOUR)).toBe('SESSION_MANDATE_EXPIRED');
    const drained = drainExpiredMandate(NOW + HOUR)!;
    expect(drained).toMatchObject({ state: 'CLOSING_DRAINING_ENTRIES', suspend_reason: 'MANDATE_EXPIRED' });
    expect(get<{ status: string }>("SELECT status FROM orders WHERE id='expiring-order'")?.status).toBe('CANCELLED');
    expect(get<{ kind: string }>('SELECT kind FROM brainos_session_events ORDER BY seq DESC LIMIT 1')?.kind).toBe('MANDATE_EXPIRED');
    expect(drainExpiredMandate(NOW + HOUR + 1)?.version).toBe(drained.version);
    expect(finishDurableClose(NOW + HOUR + 2)).toMatchObject({ state: 'CLOSED', closed_at: NOW + HOUR + 2 });
  });

  it('upgrades a pre-mandate session in place and denies its new entries', () => {
    closeDb();
    const upgradeFile = join(dir, 'v6.sqlite');
    const raw = new DatabaseSync(upgradeFile);
    migrate(raw, 6);
    raw.prepare(`INSERT INTO brainos_sessions(session_id,version,state,environment,mind,lease_holder,lease_acquired_at,
      fence_epoch,suspend_reason,started_at,closed_at,updated_at) VALUES ('brainos-autopilot',3,'RUNNING','PAPER','SPOT_PAPER',
      'leader-a',?,2,'NONE',?,NULL,?)`).run(NOW - 1_000, NOW - 1_000, NOW);
    migrate(raw);
    raw.close();
    openDb(upgradeFile);
    const upgraded = durableSessionStatus()!;
    expect(upgraded).toMatchObject({ version: 3, state: 'RUNNING', fence_epoch: 2, capital_ceiling: null, market_scope: null });
    expect(mandateEntryDenial(upgraded, NOW)).toBe('SESSION_MANDATE_MISSING');
    expect(paperSpotEntryDenial(null, NOW)).toBe('SESSION_MANDATE_MISSING');
  });

  it('requires fresh authorization after upgrading an unbound mandate and allows it to drain', () => {
    closeDb();
    const upgradeFile = join(dir, 'v13.sqlite');
    const raw = new DatabaseSync(upgradeFile);
    try {
      migrate(raw, 13);
      raw.prepare(`INSERT INTO brainos_sessions(session_id,version,state,environment,mind,lease_holder,lease_acquired_at,
        fence_epoch,suspend_reason,started_at,updated_at,market_scope,capital_ceiling,risk_policy_version,authorized_by,
        authorized_at,expires_at,strategy_config_version) VALUES ('brainos-autopilot',1,'RUNNING','PAPER','SPOT_PAPER',
        'leader-a',?,1,'NONE',?,?,'BINANCE_SPOT',5000,1,'owner:test',?,?,?)`)
        .run(NOW - 1, NOW, NOW, NOW, NOW + HOUR, strategyConfigVersion());
    } finally { raw.close(); }
    openDb(upgradeFile);
    const fence = prepareSpotSession();
    expect(paperSpotEntryDenial(fence, NOW, NOW)).toBe('STALE_OR_LOST_ENGINE_FENCE');
    expect(inspectLeaseWitness(upgradeFile, NOW).session).toBe('UNBOUND');
    expect(durableSessionStatus()).toMatchObject({ state: 'RUNNING', lease_epoch: null, fence_epoch: 1, capital_ceiling: 5_000 });

    expect(requestPaperSpotClose(NOW)?.state).toBe('CLOSING_DRAINING_ENTRIES');
    expect(recoverDurableSessionAfterTakeover(fence, NOW)?.state).toBe('CLOSING_DRAINING_ENTRIES');
    expect(finishDurableClose(NOW, fence).state).toBe('CLOSED');
    expect(openPaperSpotSession(engine, fence, MANDATE, NOW)).toMatchObject({ state: 'RUNNING', lease_epoch: fence.epoch, fence_epoch: 2 });
    expect(paperSpotEntryDenial(fence, NOW, NOW)).toBeNull();
  });
});
