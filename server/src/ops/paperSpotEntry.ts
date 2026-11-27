import { config } from '../config.js';
import { get } from '../db/db.js';
import { getControl } from '../core/mode.js';
import { unreconciledPaperOrders } from '../exec/recovery.js';
import { reconcile } from '../portfolio/calendar.js';
import { currentPolicy } from '../risk/policy.js';
import { ownsLease, type LeaseFence } from './lease.js';
import type { SessionMind } from './sessionPreflight.js';
import { mandateCapitalDenial, mandateEntryDenial, type EntryScope, type MandateColumns } from './tradingMandate.js';

export type BrainosSessionState = 'CLOSED' | 'RECOVERING_ON_BOOT' | 'RUNNING'
  | 'ENTRY_SUSPENDED_RISK_HALT' | 'CLOSING_DRAINING_ENTRIES' | 'EMERGENCY_KILL_SWITCH';
export type BrainosSuspendReason = 'NONE' | 'OWNER_CLOSE_REQUESTED' | 'RISK_HALT'
  | 'LEASE_FENCING_LOST' | 'RECONCILIATION_MISMATCH' | 'EMERGENCY_HALT' | 'MANDATE_EXPIRED';
export interface DurableBrainosSession extends MandateColumns {
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

/** The market and strategy of a specific entry, checked against the session's trading mandate. */
export interface SessionEntry { scope: EntryScope; strategy: { id: string; version: string } | undefined }

/**
 * Call inside the OMS write transaction, in addition to its existing checks and Risk Gate. Omit `entry`
 * only for read-only status checks that do not concern a specific order.
 */
export function paperSpotEntryDenial(fence: LeaseFence | null, at: number, entryCreatedAt?: number, entry?: SessionEntry): string | null {
  const session = durableSessionStatus();
  // Offline simulations can use their seeded paper controls without an online engine or mandate.
  if (!session) return config.offline ? null : 'PAPER_SPOT_SESSION_REQUIRED';
  if (session.state !== 'RUNNING') return 'SESSION_NOT_RUNNING';
  if (session.environment !== 'PAPER' || session.mind !== 'SPOT_PAPER') return 'SESSION_NOT_SPOT_PAPER';
  const mandate = mandateEntryDenial(session, at, entry);
  if (mandate) return mandate;
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
  return null;
}

/**
 * Authorized-capital check for an entry whose actual cost (fill notional plus fees) is known. Call inside the
 * OMS write transaction after `paperSpotEntryDenial` has passed.
 */
export function paperSpotCapitalDenial(entryCost: number): string | null {
  const session = durableSessionStatus();
  if (!session) return config.offline ? null : 'PAPER_SPOT_SESSION_REQUIRED';
  return mandateCapitalDenial(session, entryCost);
}
