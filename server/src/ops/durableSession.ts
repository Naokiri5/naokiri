import { get, run, tx } from '../db/db.js';
import { getControl } from '../core/mode.js';
import { LeaseLostError, ownsLease, type LeaseFence } from './lease.js';
import { paperSpotSessionPreflight, sessionPreflight, type SessionMind } from './sessionPreflight.js';
import type { EngineView } from './readiness.js';
import { VENUE } from '../exec/oms.js';
import { unreconciledPaperOrders } from '../exec/recovery.js';
import { reconcile } from '../portfolio/calendar.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import {
  BRAINOS_SESSION_ID, durableSessionStatus,
  type BrainosSessionState, type DurableBrainosSession,
} from './paperSpotEntry.js';

export { durableSessionStatus, paperSpotEntryDenial } from './paperSpotEntry.js';
export type { BrainosSessionState, BrainosSuspendReason, DurableBrainosSession } from './paperSpotEntry.js';

export interface EntryPermissionVerdict {
  allowFastNewEntries: boolean;
  allowDeepNewEntries: boolean;
  allowContinuousResearch: true;
  exitSupervisorMustContinue: true;
  ledgerReconciliationMustContinue: true;
  reason: string;
}
function baseline(at: number): DurableBrainosSession {
  return {
    session_id: BRAINOS_SESSION_ID, version: 0, state: 'CLOSED', environment: 'PAPER',
    mind: 'FAST', lease_holder: null, lease_acquired_at: null,
    fence_epoch: 0, suspend_reason: 'NONE', started_at: null, closed_at: null, updated_at: at,
  };
}
function persist(
  old: DurableBrainosSession, nextState: BrainosSessionState, kind: string, at: number,
  patch: Partial<DurableBrainosSession> = {},
): DurableBrainosSession {
  if (!Number.isSafeInteger(at) || at <= 0 || at < old.updated_at)
    throw new Error('SESSION_CLOCK_REGRESSION');
  const next = { ...old, ...patch, version: old.version + 1, state: nextState, updated_at: at };
  const outcome = run(`INSERT INTO brainos_sessions (
    session_id,version,state,environment,mind,lease_holder,lease_acquired_at,fence_epoch,
    suspend_reason,started_at,closed_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(session_id) DO UPDATE SET
    version=excluded.version,state=excluded.state,environment=excluded.environment,
    mind=excluded.mind,lease_holder=excluded.lease_holder,
    lease_acquired_at=excluded.lease_acquired_at,fence_epoch=excluded.fence_epoch,
    suspend_reason=excluded.suspend_reason,started_at=excluded.started_at,
    closed_at=excluded.closed_at,updated_at=excluded.updated_at
  WHERE brainos_sessions.version=?`,
  BRAINOS_SESSION_ID, next.version, next.state, next.environment, next.mind, next.lease_holder,
  next.lease_acquired_at, next.fence_epoch, next.suspend_reason,
  next.started_at, next.closed_at, next.updated_at, old.version);
  if (Number(outcome.changes) !== 1) throw new Error('SESSION_CHECKPOINT_CONFLICT');
  run(`INSERT INTO brainos_session_events(
    session_id,version,from_state,to_state,kind,fence_epoch,ts
  ) VALUES (?,?,?,?,?,?,?)`,
  BRAINOS_SESSION_ID, next.version, old.state, next.state, kind, next.fence_epoch, at);
  return next;
}

function cancelPaperPendingApprovals(reason: string, at: number) {
  run(`UPDATE orders SET status='CANCELLED', reject_reason=?, updated_at=?
    WHERE account=? AND venue=? AND side='BUY' AND purpose='ENTRY' AND status='PENDING_APPROVAL'`,
  reason, at, PAPER_ACCOUNT, VENUE);
}

/** Enabling paper mode requires a separate owner-authorized session before new entries. */
export function requirePaperSpotSession(at?: number) {
  return tx(() => {
    const now = at ?? Date.now();
    return durableSessionStatus() ?? persist(baseline(now), 'CLOSED', 'PAPER_SPOT_SESSION_REQUIRED', now, { mind: 'SPOT_PAPER' });
  });
}

/** Start the existing spot simulator after the authenticated owner has verified step-up. */
export function openPaperSpotSession(engine: EngineView & { instanceId?: string }, fence: LeaseFence, at?: number) {
  return tx(() => {
    const now = at ?? Date.now();
    const old = durableSessionStatus() ?? baseline(now);
    if (old.state !== 'CLOSED') throw new Error('SESSION_NOT_CLOSED');
    if (fence.name !== 'engine' || !ownsLease(fence, now) ||
        (engine.instanceId !== undefined && fence.holder !== engine.instanceId)) {
      throw new Error('SESSION_LEADER_FENCE_REQUIRED');
    }
    if (!paperSpotSessionPreflight(engine, now).canRun) throw new Error('PAPER_SPOT_SESSION_PREFLIGHT_BLOCKED');
    cancelPaperPendingApprovals('approval predates the new spot paper session', now);
    return persist(old, 'RUNNING', 'OWNER_OPEN_SPOT_PAPER_SESSION', now, {
      environment: 'PAPER', mind: 'SPOT_PAPER', lease_holder: fence.holder,
      lease_acquired_at: fence.acquired_at, fence_epoch: old.fence_epoch + 1,
      suspend_reason: 'NONE', started_at: now, closed_at: null,
    });
  });
}

/**
 * An actual paper RUN requires the real preflight (currently canRun=false) and canonical
 * engine lease. There is no caller-supplied "certified" boolean or way to unlock LIVE.
 */
export function openDurablePaperSession(engine: EngineView, mind: SessionMind, fence: LeaseFence, at = Date.now()) {
  return tx(() => {
    const old = durableSessionStatus() ?? baseline(at);
    if (old.state !== 'CLOSED') throw new Error('SESSION_NOT_CLOSED');
    if (engine.role !== 'LEADER' || !ownsLease(fence, at) || fence.name !== 'engine')
      throw new Error('SESSION_LEADER_FENCE_REQUIRED');
    if (!sessionPreflight(engine, mind, 'PAPER', at).canRun)
      throw new Error('SESSION_EXECUTION_LANE_NOT_CERTIFIED');
    if (getControl().emergency || getControl().pausedNewOrders)
      throw new Error('SESSION_OWNER_ENTRY_HALT');
    return persist(old, 'RUNNING', 'OWNER_OPEN_SESSION', at, {
      environment: 'PAPER', mind, lease_holder: fence.holder,
      lease_acquired_at: fence.acquired_at, fence_epoch: old.fence_epoch + 1,
      suspend_reason: 'NONE', started_at: at, closed_at: null,
    });
  });
}

/** Only the lease holder can recover a session left by an earlier engine generation. */
export function recoverDurableSessionAfterTakeover(fence: LeaseFence, clock?: number) {
  return tx(() => {
    const at = clock ?? Date.now();
    if (fence.name !== 'engine' || !ownsLease(fence, at)) throw new LeaseLostError();
    const old = durableSessionStatus();
    if (!old || !['RUNNING','CLOSING_DRAINING_ENTRIES','RECOVERING_ON_BOOT'].includes(old.state))
      return old;
    if (old.state !== 'RECOVERING_ON_BOOT' && old.lease_holder === fence.holder && old.lease_acquired_at === fence.acquired_at)
      return old;
    if (old.state === 'CLOSING_DRAINING_ENTRIES') {
      return persist(old, old.state, 'DRAIN_RECOVERY_FENCED', at, {
        lease_holder: fence.holder, lease_acquired_at: fence.acquired_at,
      });
    }
    const recovering = old.state === 'RECOVERING_ON_BOOT' ? old
      : persist(old, 'RECOVERING_ON_BOOT', 'BOOT_RECOVERY_STARTED', at, {
        suspend_reason: 'LEASE_FENCING_LOST', lease_holder: null, lease_acquired_at: null,
      });
    // A recovered session is ALWAYS suspended; a fresh, explicit owner action and a
    // certified execution lane are required to resume (not presently exposed).
    return persist(recovering, 'ENTRY_SUSPENDED_RISK_HALT', 'BOOT_RECOVERY_LOCKED', at,
      { suspend_reason: 'RECONCILIATION_MISMATCH' });
  });
}

/** Risk/emergency/owner CLOSE can always revoke new entry authority; no lease needed to halt. */
export function suspendDurableEntries(
  kind: 'RISK_HALT' | 'OWNER_CLOSE_REQUESTED' | 'EMERGENCY_HALT', at = Date.now(),
) {
  return tx(() => {
    const old = durableSessionStatus();
    if (!old) return null;
    if (kind === 'EMERGENCY_HALT')
      return old.state === 'EMERGENCY_KILL_SWITCH' ? old
        : persist(old, 'EMERGENCY_KILL_SWITCH', 'EMERGENCY_STOP_TRIGGERED', at,
          { suspend_reason: kind });
    if (old.state === 'EMERGENCY_KILL_SWITCH' || old.state === 'CLOSED') return old;
    if (old.state === 'CLOSING_DRAINING_ENTRIES') return old;
    const state = kind === 'OWNER_CLOSE_REQUESTED'
      ? 'CLOSING_DRAINING_ENTRIES' : 'ENTRY_SUSPENDED_RISK_HALT';
    if (old.state === state) return old;
    return persist(old, state, kind, at, { suspend_reason: kind });
  });
}

/** Revoke entries and cancel pending paper approvals together, leaving protective exits running. */
export function requestPaperSpotClose(at?: number) {
  return tx(() => {
    const now = at ?? Date.now();
    const old = durableSessionStatus();
    if (!old || old.state === 'CLOSED') return old;
    cancelPaperPendingApprovals('paper session closing', now);
    if (getControl().emergency) return suspendDurableEntries('EMERGENCY_HALT', now);
    if (old.state === 'CLOSING_DRAINING_ENTRIES') return old;
    return persist(old, 'CLOSING_DRAINING_ENTRIES', 'OWNER_CLOSE_REQUESTED', now, {
      suspend_reason: 'OWNER_CLOSE_REQUESTED',
    });
  });
}

/** Closing requires all paper exposure and pending execution to be reconciled. */
export function finishDurableClose(at?: number, fence?: LeaseFence) {
  return tx(() => {
    const now = at ?? Date.now();
    if (fence && (fence.name !== 'engine' || !ownsLease(fence, now))) throw new LeaseLostError();
    const old = durableSessionStatus();
    if (!old || old.state !== 'CLOSING_DRAINING_ENTRIES')
      throw new Error('SESSION_NOT_DRAINING');
    const positions = get<{ count: number }>(
      `SELECT COUNT(*) count FROM positions WHERE account=? AND status='OPEN'`, PAPER_ACCOUNT,
    )?.count ?? 0;
    const pending = get(`SELECT 1 FROM orders WHERE account=? AND venue=? AND side='BUY' AND purpose='ENTRY'
      AND status='PENDING_APPROVAL' LIMIT 1`, PAPER_ACCOUNT, VENUE);
    if (positions || pending || unreconciledPaperOrders() || !reconcile().ok)
      throw new Error('SESSION_DRAIN_RECONCILIATION_INCOMPLETE');
    return persist(old, 'CLOSED', 'DRAIN_COMPLETE', now,
      { suspend_reason: 'NONE', closed_at: now, lease_holder: null, lease_acquired_at: null });
  });
}

/**
 * This is an ADDITIONAL gate, not an alternative to OMS or Unified Risk.
 * No execution integrations are enabled by this module.
 */
export function durableEntryPermission(engine: EngineView, fence: LeaseFence | null, at = Date.now()): EntryPermissionVerdict {
  const no = (reason: string): EntryPermissionVerdict => ({
    allowFastNewEntries: false, allowDeepNewEntries: false,
    allowContinuousResearch: true, exitSupervisorMustContinue: true,
    ledgerReconciliationMustContinue: true, reason,
  });
  const state = durableSessionStatus();
  if (!state || state.state !== 'RUNNING') return no('SESSION_NOT_RUNNING');
  if (!fence || fence.name !== 'engine' || fence.holder !== state.lease_holder
    || fence.acquired_at !== state.lease_acquired_at || !ownsLease(fence, at))
    return no('STALE_OR_LOST_ENGINE_FENCE');
  if (state.environment !== 'PAPER') return no('LIVE_EXECUTION_NOT_CERTIFIED');
  if (state.mind === 'SPOT_PAPER') return no('PAPER_SPOT_SESSION_ONLY');
  if (getControl().emergency || getControl().pausedNewOrders) return no('OWNER_ENTRY_HALT');
  if (!reconcile().ok || unreconciledPaperOrders()) return no('EXECUTION_NOT_RECONCILED');
  if (!sessionPreflight(engine, state.mind, 'PAPER', at).canRun) return no('LANE_PREFLIGHT_NOT_CERTIFIED');
  return { allowFastNewEntries: state.mind === 'FAST', allowDeepNewEntries: state.mind === 'DEEP',
    allowContinuousResearch: true, exitSupervisorMustContinue: true,
    ledgerReconciliationMustContinue: true, reason: 'ELIGIBLE_FOR_CANONICAL_RISK_AND_OMS' };
}
