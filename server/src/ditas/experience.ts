import { all, P } from '../db/db.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { STRATEGIES } from '../lab/strategies.js';
import { returnHealth } from './passports.js';

const HISTORY_SCAN_LIMIT = 500;
const MATCHED_WINDOW = 50;
type PaperRow = {
  id: string; instrument: string; market: string; opened_at: number; closed_at: number;
  realized_pnl: number; planned_risk: number; fees: number; exit_reason: string | null;
  report: string | null; decision_strategy: string | null;
};
export type NoTradeMode = 'SHADOW' | 'PAPER_ENFORCE';

/** Experimental learning cannot raise risk limits, authorize an order or enable LIVE. */
export function noTradeMode(): NoTradeMode {
  return process.env.MIA_EXPERIENCE_NO_TRADE_MODE === 'PAPER_ENFORCE' ? 'PAPER_ENFORCE' : 'SHADOW';
}

/**
 * Bounded, read-only experience from the canonical paper OMS. One closed position = one outcome.
 * No backtest, hypothetical Twin, owner-entered forecast or anonymous whale print enters this sample.
 * The cutoff prevents future outcomes from contaminating historical decisions.
 */
export function paperExperience(strategyId: string, strategyVersion: string, regime?: string, asOf = Date.now()) {
  if (!strategyId || !strategyVersion || !Number.isSafeInteger(asOf) || asOf < 0) throw new Error('invalid paper experience cohort or cutoff');
  const rows = all<PaperRow>(
    "SELECT p.id,p.instrument,p.market,p.opened_at,p.closed_at,p.realized_pnl,p.planned_risk,p.fees,p.exit_reason," +
    " d.report,d.strategy AS decision_strategy FROM positions p LEFT JOIN decisions d ON d.id=p.decision_id" +
    " WHERE p.account=? AND p.strategy=? AND p.status='CLOSED' AND p.closed_at IS NOT NULL AND p.closed_at<?" +
    " ORDER BY p.closed_at DESC,p.id DESC LIMIT ?",
    PAPER_ACCOUNT, strategyId, asOf, HISTORY_SCAN_LIMIT,
  );
  const excluded = { unknownVersion: 0, otherVersion: 0, invalidFinancials: 0, wrongDecision: 0, missingRegime: 0, otherRegime: 0 };
  const episodes: { positionId: string; instrumentId: string; closedAt: number; netR: number; netPnl: number; fees: number; exitReason: string | null; regime: string }[] = [];
  for (const row of rows) {
    let report: { strategy?: { id?: string; version?: string }; regime?: string; instrumentId?: string; market?: string } | null = null;
    try { if (row.report) report = P(row.report); } catch { /* quarantine malformed decision history */ }
    if (!report?.strategy?.version) { excluded.unknownVersion++; continue; }
    if (report.strategy.version !== strategyVersion) { excluded.otherVersion++; continue; }
    if (row.decision_strategy !== strategyId || (report.strategy.id && report.strategy.id !== strategyId) ||
        (report.instrumentId && report.instrumentId !== row.instrument) || (report.market && report.market !== row.market)) {
      excluded.wrongDecision++; continue;
    }
    if (!Number.isFinite(row.realized_pnl) || !Number.isFinite(row.planned_risk) || row.planned_risk <= 0 ||
        !Number.isFinite(row.fees) || row.fees < 0 || !Number.isSafeInteger(row.closed_at) ||
        !Number.isSafeInteger(row.opened_at) || row.closed_at <= row.opened_at ||
        !Number.isFinite(row.realized_pnl / row.planned_risk)) {
      excluded.invalidFinancials++; continue;
    }
    if (regime && !report.regime) { excluded.missingRegime++; continue; }
    if (regime && report.regime !== regime) { excluded.otherRegime++; continue; }
    episodes.push({ positionId: row.id, instrumentId: row.instrument, closedAt: row.closed_at,
      netR: row.realized_pnl / row.planned_risk, netPnl: row.realized_pnl, fees: row.fees,
      exitReason: row.exit_reason, regime: report.regime ?? 'UNKNOWN' });
    if (episodes.length === MATCHED_WINDOW) break;
  }
  const health = returnHealth(episodes.map(e => e.netR).reverse());
  const signal = health.status === 'DEGRADED_REVIEW' ? 'DEGRADED_REVIEW' :
    health.status === 'INSUFFICIENT_SAMPLE' ? 'INSUFFICIENT_SAMPLE' : 'OBSERVING';
  return {
    source: 'CANONICAL_PAPER_OMS', strategyId, strategyVersion, regime: regime ?? null, asOf,
    mode: noTradeMode(), signal, health, episodes, exclusions: excluded,
    inspectedClosedPositions: rows.length, truncatedHistory: rows.length === HISTORY_SCAN_LIMIT,
    limitedToMostRecent: MATCHED_WINDOW, lastClosedAt: episodes[0]?.closedAt ?? null,
    note: 'Observed paper positions, not live fills or independent alpha certification. Degradation uses an approximate normal interval assuming independent trades. SHADOW changes no decisions; PAPER_ENFORCE can only refuse new paper entries. No automatic strategy promotion or change to the risk gate.',
  };
}

/** Existing strategy definitions own the registry; experience only projects their current versions. */
export function paperExperienceOverview() {
  return { mode: noTradeMode(), source: 'CANONICAL_PAPER_OMS',
    strategies: STRATEGIES.map(s => paperExperience(s.id, s.version)),
    note: 'Realized PnL is recorded by the existing OMS, including the entry and exit fees. Past performance cannot guarantee future returns.' };
}
