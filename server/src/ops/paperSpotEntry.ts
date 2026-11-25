import { get } from '../db/db.js';
import { getControl } from '../core/mode.js';
import { unreconciledPaperOrders } from '../exec/recovery.js';
import { reconcile } from '../portfolio/calendar.js';
import { currentPolicy } from '../risk/policy.js';
import { ownsLease, type LeaseFence } from './lease.js';
import { checkSessionEntry, checkSessionLoss, sessionBoundaries, type SessionBoundaryRow } from './sessionBoundaries.js';
import type { SessionMind } from './sessionPreflight.js';

export type BrainosSessionState = 'CLOSED' | 'RECOVERING_ON_BOOT' | 'RUNNING'
  | 'ENTRY_SUSPENDED_RISK_HALT' | 'CLOSING_DRAINING_ENTRIES' | 'EMERGENCY_KILL_SWITCH';
export type BrainosSuspendReason = 'NONE' | 'OWNER_CLOSE_REQUESTED' | 'RISK_HALT'
  | 'LEASE_FENCING_LOST' | 'RECONCILIATION_MISMATCH' | 'EMERGENCY_HALT';
export interface DurableBrainosSession {
  session_id: string;
  version: number;
  state: BrainosSessionState;
  environment: 'PAPER' | 'LIVE';
  mind: SessionMind | 'SPOT_PAPER';
  lease_holder: string | null;
  lease_acquired_at: number | null;
  fence_epoch: number;
  suspend_reason: BrainosSuspendReason;
  started_at: number | null;
  closed_at: number | null;
  updated_at: number;
}

export const BRAINOS_SESSION_ID = 'brainos-autopilot';

/** A read never creates an authorizing session or mutates the financial ledger. */
export function durableSessionStatus(): DurableBrainosSession | null {
  return get<DurableBrainosSession>('SELECT * FROM brainos_sessions WHERE session_id=?', BRAINOS_SESSION_ID) ?? null;
}

/** Call inside the OMS write transaction, in addition to its existing checks and Risk Gate. */
export function paperSpotEntryDenial(fence: LeaseFence | null, at: number, entryCreatedAt?: number, inSpotScope = true): string | null {
  const session = durableSessionStatus();
  // Installations with no checkpoint still use their existing owner-configured paper controls.
  if (!session) return null;
  if (session.state !== 'RUNNING') return 'SESSION_NOT_RUNNING';
  if (session.environment !== 'PAPER' || session.mind !== 'SPOT_PAPER') return 'SESSION_NOT_SPOT_PAPER';
  if (!inSpotScope) return 'PAPER_SPOT_MARKET_OUTSIDE_SESSION_SCOPE';
  if (!fence || fence.name !== 'engine' || session.lease_holder !== fence.holder ||
      session.lease_acquired_at !== fence.acquired_at || !ownsLease(fence, at)) return 'STALE_OR_LOST_ENGINE_FENCE';
  const started = session.started_at;
  if (started === null || !Number.isSafeInteger(started) || started <= 0 || started > at) return 'SESSION_INVALID_START_TIME';
  const control = getControl();
  if (control.pausedNewOrders || control.emergency || (control.mode !== 'PAPER' && control.mode !== 'APPROVAL')) {
    return 'SESSION_OWNER_ENTRY_HALT';
  }
  if (control.updatedAt > started) return 'SESSION_OWNER_CONTROL_CHANGED';
  if (entryCreatedAt !== undefined && (!Number.isSafeInteger(entryCreatedAt) || entryCreatedAt < started || entryCreatedAt > at)) {
    return 'ENTRY_EVIDENCE_OUTSIDE_SESSION';
  }
  const ledger = reconcile();
  if (!ledger.ok || unreconciledPaperOrders()) return 'EXECUTION_NOT_RECONCILED';
  if (!currentPolicy() || !Number.isFinite(ledger.cash) || ledger.cash <= 0) return 'SESSION_RISK_POLICY_OR_FUNDS_UNAVAILABLE';
  return checkSessionLoss(sessionBoundaries(session.session_id, session.fence_epoch), at);
}

/** The owner-set boundaries of the current session generation, if any. */
export function activeSessionBoundaries(session = durableSessionStatus()): SessionBoundaryRow | null {
  return session ? sessionBoundaries(session.session_id, session.fence_epoch) : null;
}

/**
 * Called by the OMS inside its write transaction once the executed notional and planned maximum loss are known.
 * Installations with no checkpoint keep their existing behavior; any other session must be a running spot paper
 * session with capital and loss headroom for this trade.
 */
export function paperSpotSizeDenial(notional: number, plannedMaxLoss: number, at: number): string | null {
  const session = durableSessionStatus();
  if (!session) return null;
  if (session.state !== 'RUNNING') return 'SESSION_NOT_RUNNING';
  if (session.environment !== 'PAPER' || session.mind !== 'SPOT_PAPER') return 'SESSION_NOT_SPOT_PAPER';
  return checkSessionEntry(activeSessionBoundaries(session), notional, plannedMaxLoss, at);
}
