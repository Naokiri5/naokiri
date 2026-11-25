import { z } from 'zod';
import { get, run } from '../db/db.js';
import { QUALITY_LIMITS } from '../market/quality.js';
import { market } from '../market/store.js';
import { cashBalance, openPositions, PAPER_ACCOUNT, totalDeposits } from '../portfolio/ledger.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';

/**
 * Owner-set boundaries for one authorized BrainOS paper session: how much capital the session may have open and how
 * much it may lose. They are an additional, reduce-only layer on top of the accepted risk policy; the canonical risk
 * gate still sizes and approves every trade, and position protection never depends on them.
 *
 * - Capital in use is the entry notional of every open paper position (positions opened before the session count too:
 *   there is one paper account). Fees are not capital; they count toward the loss.
 * - Session P&L is measured at liquidation value (fresh bid less the exit fee) and is deposit-invariant: equity − net
 *   deposits, relative to the same measure at Run. An owner deposit or withdrawal is never profit or loss.
 * - An entry is allowed only while the worst case stays within the loss limit: current session P&L, minus the loss if
 *   every open position exits at its stop, minus the new trade's planned maximum loss. Gaps through a stop can still
 *   exceed the limit; the REFLEX then suspends entries.
 * - A missing, stale or future-dated quote for any open position makes the loss unverifiable: entries are blocked
 *   (fail closed), but no breach is recorded.
 * - A breach is latched the first time it is observed and never clears for that session generation.
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

export interface PaperLiquidationValue {
  equityUsd: number;
  /** Equity − net deposits. */
  performanceUsd: number;
  openNotionalUsd: number;
  /** Further loss if every open position exits at its stop (with the policy stop-fill buffer and exit fee). */
  openRiskToStopsUsd: number;
  /** Open positions without a fresh, positive bid; when non-empty the values above cannot be trusted. */
  unverifiedMarks: string[];
}

export interface SessionBoundaryUsage {
  capitalUsedUsd: number;
  /** null when any open position's mark is unverified. */
  sessionPnlUsd: number | null;
  openRiskToStopsUsd: number | null;
  unverifiedMarks: string[];
}

export type SessionLossDenial = 'SESSION_BOUNDARIES_MISSING' | 'SESSION_LOSS_LIMIT_REACHED' | 'SESSION_LOSS_UNVERIFIABLE';

const freshQuote = (ts: number, at: number) => {
  const age = at - ts;
  return Number.isFinite(age) && age >= 0 && age <= QUALITY_LIMITS.maxExecQuoteAgeMs;
};

/** Read-only valuation of the paper account at liquidation value. */
export function paperLiquidationValue(at: number): PaperLiquidationValue {
  const policy = currentPolicy()?.policy ?? DEFAULT_POLICY;
  const keep = 1 - policy.feeRate;
  const stopFill = 1 - policy.stopFillBufferPct / 100;
  let value = 0, notional = 0, risk = 0;
  const unverified: string[] = [];
  for (const position of openPositions(PAPER_ACCOUNT)) {
    notional += position.qty * position.entry_price;
    const quote = market.price(position.instrument);
    if (!quote || !Number.isFinite(quote.bid) || quote.bid <= 0 || !freshQuote(quote.ts, at)) {
      unverified.push(position.instrument);
      continue;
    }
    const exitValue = position.qty * quote.bid * keep;
    value += exitValue;
    risk += Math.max(0, exitValue - position.qty * position.stop_price * stopFill * keep);
  }
  const equity = cashBalance(PAPER_ACCOUNT) + value;
  return { equityUsd: equity, performanceUsd: equity - totalDeposits(PAPER_ACCOUNT), openNotionalUsd: notional,
    openRiskToStopsUsd: risk, unverifiedMarks: unverified };
}

/** Validate the owner's input against the current paper account and record it for this fence epoch. Call inside the opening transaction. */
export function recordSessionBoundaries(sessionId: string, fenceEpoch: number, input: unknown, at: number): SessionBoundaryRow {
  const limits = SESSION_BOUNDARIES.parse(input);
  if (limits.maxSessionLossUsd > limits.capitalLimitUsd) throw new Error('SESSION_LOSS_LIMIT_EXCEEDS_CAPITAL');
  const account = paperLiquidationValue(at);
  if (account.unverifiedMarks.length || !Number.isFinite(account.equityUsd) || !Number.isFinite(account.performanceUsd)
      || account.equityUsd <= 0) throw new Error('SESSION_BASELINE_UNVERIFIABLE');
  if (limits.capitalLimitUsd > account.equityUsd) throw new Error('SESSION_CAPITAL_EXCEEDS_EQUITY');
  run(`INSERT INTO brainos_session_boundaries(session_id,fence_epoch,capital_limit_usd,max_loss_usd,start_equity_usd,
    start_performance_usd,set_at) VALUES (?,?,?,?,?,?,?)`,
  sessionId, fenceEpoch, limits.capitalLimitUsd, limits.maxSessionLossUsd, account.equityUsd, account.performanceUsd, at);
  return sessionBoundaries(sessionId, fenceEpoch)!;
}

export function sessionBoundaries(sessionId: string, fenceEpoch: number): SessionBoundaryRow | null {
  return get<SessionBoundaryRow>('SELECT * FROM brainos_session_boundaries WHERE session_id=? AND fence_epoch=?', sessionId, fenceEpoch) ?? null;
}

export function sessionBoundaryUsage(row: SessionBoundaryRow, at: number): SessionBoundaryUsage {
  const account = paperLiquidationValue(at);
  const pnl = account.performanceUsd - row.start_performance_usd;
  const verified = account.unverifiedMarks.length === 0 && Number.isFinite(pnl) && Number.isFinite(account.openRiskToStopsUsd);
  return {
    capitalUsedUsd: account.openNotionalUsd,
    sessionPnlUsd: verified ? pnl : null,
    openRiskToStopsUsd: verified ? account.openRiskToStopsUsd : null,
    unverifiedMarks: account.unverifiedMarks,
  };
}

/** The loss limit is reached when verified session P&L is at or below −maxLoss. */
export const lossLimitReached = (row: SessionBoundaryRow, usage: SessionBoundaryUsage) =>
  usage.sessionPnlUsd !== null && usage.sessionPnlUsd <= -row.max_loss_usd;

/** Record the first breach only; later calls keep the original evidence. Reduce-only, so any caller may latch it. */
export function markSessionBreach(row: SessionBoundaryRow, reason: 'SESSION_LOSS_LIMIT_REACHED', at: number) {
  return Number(run(`UPDATE brainos_session_boundaries SET breached_at=?, breach_reason=?
    WHERE session_id=? AND fence_epoch=? AND breached_at IS NULL`, at, reason, row.session_id, row.fence_epoch).changes) === 1;
}

/**
 * Entry check that does not depend on the order size; runs inside the OMS write transaction. A verified breach is
 * latched here, so a price that recovers before the REFLEX runs cannot reopen entries.
 */
export function checkSessionLoss(row: SessionBoundaryRow | null, at: number): SessionLossDenial | null {
  if (!row) return 'SESSION_BOUNDARIES_MISSING';
  if (row.breached_at !== null) return 'SESSION_LOSS_LIMIT_REACHED';
  const usage = sessionBoundaryUsage(row, at);
  if (usage.sessionPnlUsd === null) return 'SESSION_LOSS_UNVERIFIABLE';
  if (!lossLimitReached(row, usage)) return null;
  markSessionBreach(row, 'SESSION_LOSS_LIMIT_REACHED', at);
  return 'SESSION_LOSS_LIMIT_REACHED';
}

/**
 * Entry check at the executed fill, once the notional and planned maximum loss are known; runs inside the OMS write
 * transaction before any order, fill, position or ledger write.
 */
export function checkSessionEntry(row: SessionBoundaryRow | null, notional: number, plannedMaxLoss: number, at: number): string | null {
  if (!row) return 'SESSION_BOUNDARIES_MISSING';
  if (!Number.isFinite(notional) || notional <= 0 || !Number.isFinite(plannedMaxLoss) || plannedMaxLoss <= 0) return 'SESSION_ENTRY_INVALID';
  const usage = sessionBoundaryUsage(row, at);
  const total = usage.capitalUsedUsd + notional;
  if (!Number.isFinite(total) || total > row.capital_limit_usd + 1e-9) {
    return `SESSION_CAPITAL_LIMIT: open ${usage.capitalUsedUsd.toFixed(2)} + fill ${notional.toFixed(2)} > limit ${row.capital_limit_usd.toFixed(2)}`;
  }
  if (usage.sessionPnlUsd === null || usage.openRiskToStopsUsd === null) return 'SESSION_LOSS_UNVERIFIABLE';
  const worst = usage.sessionPnlUsd - usage.openRiskToStopsUsd - plannedMaxLoss;
  if (!Number.isFinite(worst) || worst < -row.max_loss_usd - 1e-9) {
    return `SESSION_LOSS_HEADROOM: worst case ${worst.toFixed(2)} if every stop is hit < -${row.max_loss_usd.toFixed(2)} limit`;
  }
  return null;
}
