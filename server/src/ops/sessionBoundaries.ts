import { z } from 'zod';
import { get, run } from '../db/db.js';
import { accountState, PAPER_ACCOUNT } from '../portfolio/ledger.js';

/**
 * Owner-set boundaries for one authorized BrainOS paper session: how much capital the session may have open and how
 * much it may lose before new entries stop. They are an additional, reduce-only layer on top of the accepted risk
 * policy; the canonical risk gate still sizes and approves every trade, and position protection never depends on them.
 *
 * Capital in use is the entry cost of every open paper position (positions opened before the session count too: there
 * is one paper account). Session P&L is deposit-invariant (equity − net deposits, relative to the value at Run), so an
 * owner deposit or withdrawal is never mistaken for profit or loss. A missing mark makes the loss unverifiable, which
 * blocks entries (fail closed) but is not treated as a breach.
 */
export const SESSION_BOUNDARIES = z.object({
  capitalLimitUsd: z.number().finite().positive().max(1e12),
  maxSessionLossUsd: z.number().finite().positive().max(1e12),
}).strict();
export type SessionBoundaryInput = z.infer<typeof SESSION_BOUNDARIES>;

export interface SessionBoundaryRow {
  session_id: string;
  fence_epoch: number;
  capital_limit_usd: number;
  max_loss_usd: number;
  start_equity_usd: number;
  start_performance_usd: number;
  set_at: number;
  breached_at: number | null;
  breach_reason: string | null;
}

export interface SessionBoundaryUsage {
  capitalUsedUsd: number;
  /** null when a position mark is missing or the account value is not finite. */
  sessionPnlUsd: number | null;
  marksMissing: string[];
}

export type SessionBoundaryDenial =
  | 'SESSION_BOUNDARIES_MISSING' | 'SESSION_LOSS_LIMIT_REACHED' | 'SESSION_LOSS_UNVERIFIABLE' | 'SESSION_CAPITAL_LIMIT';

/** Validate the owner's input against the current paper account and record it for this fence epoch. Call inside the opening transaction. */
export function recordSessionBoundaries(sessionId: string, fenceEpoch: number, input: unknown, at: number): SessionBoundaryRow {
  const limits = SESSION_BOUNDARIES.parse(input);
  if (limits.maxSessionLossUsd > limits.capitalLimitUsd) throw new Error('SESSION_LOSS_LIMIT_EXCEEDS_CAPITAL');
  const acct = accountState(PAPER_ACCOUNT, at);
  const performance = acct.equity - acct.deposits;
  if (acct.marksMissing.length || !Number.isFinite(acct.equity) || !Number.isFinite(performance) || acct.equity <= 0) {
    throw new Error('SESSION_BASELINE_UNVERIFIABLE');
  }
  if (limits.capitalLimitUsd > acct.equity) throw new Error('SESSION_CAPITAL_EXCEEDS_EQUITY');
  run(`INSERT INTO brainos_session_boundaries(session_id,fence_epoch,capital_limit_usd,max_loss_usd,start_equity_usd,
    start_performance_usd,set_at) VALUES (?,?,?,?,?,?,?)`,
  sessionId, fenceEpoch, limits.capitalLimitUsd, limits.maxSessionLossUsd, acct.equity, performance, at);
  return sessionBoundaries(sessionId, fenceEpoch)!;
}

export function sessionBoundaries(sessionId: string, fenceEpoch: number): SessionBoundaryRow | null {
  return get<SessionBoundaryRow>('SELECT * FROM brainos_session_boundaries WHERE session_id=? AND fence_epoch=?', sessionId, fenceEpoch) ?? null;
}

export function sessionBoundaryUsage(row: SessionBoundaryRow, at: number): SessionBoundaryUsage {
  const acct = accountState(PAPER_ACCOUNT, at);
  const used = get<{ s: number }>("SELECT COALESCE(SUM(qty*entry_price),0) s FROM positions WHERE account=? AND status='OPEN'", PAPER_ACCOUNT)!.s;
  const pnl = (acct.equity - acct.deposits) - row.start_performance_usd;
  return {
    capitalUsedUsd: used,
    sessionPnlUsd: acct.marksMissing.length || !Number.isFinite(pnl) ? null : pnl,
    marksMissing: acct.marksMissing,
  };
}

/** The loss limit is reached when verified session P&L is at or below −maxLoss. */
export const lossLimitReached = (row: SessionBoundaryRow, usage: SessionBoundaryUsage) =>
  usage.sessionPnlUsd !== null && usage.sessionPnlUsd <= -row.max_loss_usd;

/** Entry check that does not depend on the order size. Runs inside the OMS write transaction. */
export function sessionLossDenial(row: SessionBoundaryRow | null, at: number): SessionBoundaryDenial | null {
  if (!row) return 'SESSION_BOUNDARIES_MISSING';
  if (row.breached_at !== null) return 'SESSION_LOSS_LIMIT_REACHED';
  const usage = sessionBoundaryUsage(row, at);
  if (usage.sessionPnlUsd === null) return 'SESSION_LOSS_UNVERIFIABLE';
  return lossLimitReached(row, usage) ? 'SESSION_LOSS_LIMIT_REACHED' : null;
}

/** Entry check at the executed notional, after the depth-walk fill is known. Runs inside the OMS write transaction. */
export function sessionCapitalDenial(row: SessionBoundaryRow | null, notional: number, at: number): string | null {
  if (!row) return 'SESSION_BOUNDARIES_MISSING';
  const { capitalUsedUsd } = sessionBoundaryUsage(row, at);
  const total = capitalUsedUsd + notional;
  if (!Number.isFinite(total) || !Number.isFinite(notional) || notional <= 0 || total > row.capital_limit_usd + 1e-9) {
    return `SESSION_CAPITAL_LIMIT: open ${capitalUsedUsd.toFixed(2)} + fill ${notional.toFixed(2)} > limit ${row.capital_limit_usd.toFixed(2)}`;
  }
  return null;
}

/** Record the first breach only; later calls keep the original evidence. */
export function markSessionBreach(row: SessionBoundaryRow, reason: SessionBoundaryDenial, at: number) {
  return Number(run(`UPDATE brainos_session_boundaries SET breached_at=?, breach_reason=?
    WHERE session_id=? AND fence_epoch=? AND breached_at IS NULL`, at, reason, row.session_id, row.fence_epoch).changes) === 1;
}
