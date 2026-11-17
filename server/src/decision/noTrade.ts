import { all, get } from '../db/db.js';
import { market } from '../market/store.js';
import { totalDeposits, PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { getControl } from '../core/mode.js';
import { currentPolicy } from '../risk/policy.js';
import { listIncidents } from '../exec/incidents.js';
import type { DecisionReport, DecisionState } from './engine.js';

/**
 * "Why MIA is not trading" (read-only projection). For each instrument it shows the latest persisted decision when that
 * decision is not a trade, with its blocking reasons read from the stored report only. It never calls evaluateRisk(),
 * never re-scores and never writes. Global blockers are known blockers from existing state, not execution clearance:
 * the risk gate still evaluates every order.
 */
export const NO_TRADE_TTL_MS = 2 * 3600_000;
export const NO_TRADE_WINDOW_MS = 24 * 3600_000;
const HISTORY_LIMIT = 5;
const TRADE_STATES = new Set<string>(['PAPER_TRADE', 'APPROVED_FOR_USER_CONFIRMATION', 'APPROVED_FOR_BOUNDED_EXECUTION'] satisfies DecisionState[]);

export type ReasonGroup = 'data' | 'safety' | 'consensus' | 'risk' | 'mode';
export interface Reason { group: ReasonGroup; code: string; text: string }
export type Evidence = 'RECENT' | 'STALE' | 'UNKNOWN';
export interface NoTradeHistory { decisionId: string; decision: string; createdAt: number; supersededBy: string; reasons: Reason[] }
export interface NoTradeRow {
  instrumentId: string; symbol: string; decisionId: string; strategy: string; decision: string; score: number | null;
  createdAt: number; ageMs: number | null; expiresAt: number | null; evidence: Evidence; supersededBy: string | null;
  risk: { decision: string; policyVersion: number | null; checkedAt: string } | null; reasons: Reason[]; missing: string[]; history: NoTradeHistory[];
}
export interface GlobalBlocker { code: string; group: ReasonGroup; text: string; href: string }

/** Every reason code risk/gate.ts emits today, mapped to a display group. Codes are matched verbatim; text is never rewritten. */
export const RISK_CODE_GROUP: Record<string, ReasonGroup> = {
  DATA_QUALITY_FAIL: 'data', NO_PRICE: 'data', PRICE_DEVIATION: 'data', POSITION_MARKS_MISSING: 'data', NO_ORDER_BOOK: 'data', ORDER_BOOK_STALE: 'data',
  INSTRUMENT_UNKNOWN: 'data', NON_FINITE_INPUT: 'data',
  ASSET_INELIGIBLE: 'safety', PROTECTION_INCIDENT_OPEN: 'safety',
  MODE_READ_ONLY: 'mode', NEW_ORDERS_PAUSED: 'mode', EMERGENCY_STOP_ACTIVE: 'mode', POLICY_NOT_ACCEPTED: 'mode', MARKET_NOT_APPROVED: 'mode',
  STRATEGY_DISABLED: 'mode', STRATEGY_SUSPENDED: 'mode', STRATEGY_NOT_REGISTERED: 'mode', STRATEGY_NOT_PROMOTED: 'mode',
  NO_EQUITY: 'risk', DAILY_LOSS_BREAKER: 'risk', WEEKLY_LOSS_BREAKER: 'risk', DRAWDOWN_CAPITAL_PRESERVATION: 'risk', DRAWDOWN_WARNING: 'risk',
  LOSS_STREAK_COOLDOWN: 'risk', LOSS_STREAK_REVIEW: 'risk', MAX_CONCURRENT_POSITIONS: 'risk', DUPLICATE_INSTRUMENT_POSITION: 'risk',
  PENDING_ENTRY_ORDER_EXISTS: 'risk', DUPLICATE_REQUEST: 'risk', CORRELATION_LIMIT: 'risk', SIZE_BELOW_VENUE_MINIMUM: 'risk', AGGREGATE_OPEN_RISK: 'risk',
  SPREAD: 'risk', SLIPPAGE: 'risk', COST_R: 'risk', ENTRY_PRICE_INVALID: 'risk', STOP_DIRECTION_INVALID: 'risk', RISK_ENGINE_EXCEPTION: 'risk',
};
/** Unknown codes stay in the risk group: they came from the risk gate, so they are never dropped or softened. */
export function classifyRiskCode(raw: string): Reason {
  const code = /^[A-Z][A-Z0-9_]*/.exec(raw)?.[0] ?? 'UNKNOWN';
  return { group: RISK_CODE_GROUP[code] ?? 'risk', code, text: raw };
}

type StoredReport = Partial<Pick<DecisionReport, 'asset' | 'decision' | 'steps' | 'risk' | 'consensus' | 'missingInformation' | 'opportunity' | 'dataFreshness'>>;
const failedStep = (r: StoredReport, prefix: string) => (Array.isArray(r.steps) ? r.steps.find((s) => typeof s?.name === 'string' && s.name.startsWith(prefix) && s.result === 'FAIL') : undefined);

/** Reasons recorded in a stored decision report. The engine's own decision order (decision/engine.ts) decides what each state can mean. */
export function reasonsFromReport(r: StoredReport): Reason[] {
  const out: Reason[] = [];
  const add = (group: ReasonGroup, code: string, text: unknown) => out.push({ group, code, text: String(text ?? '') });
  const fresh = failedStep(r, 'Market data freshness'); if (fresh) add('data', 'MARKET_DATA_FAIL', fresh.detail);
  const avail = failedStep(r, 'Instrument availability'); if (avail) add('data', 'INSTRUMENT_UNAVAILABLE', avail.detail);
  if (Array.isArray(r.risk?.reasonCodes)) for (const c of r.risk.reasonCodes) out.push(classifyRiskCode(String(c)));
  const safety = failedStep(r, 'Asset eligibility'); if (safety && !out.some((x) => x.code === 'ASSET_INELIGIBLE')) add('safety', 'ASSET_INELIGIBLE', safety.detail);
  const qci = failedStep(r, 'QCI consensus record'); if (qci) add('consensus', 'QCI_VETOED', qci.detail);
  const state = String(r.consensus?.state ?? '');
  if (r.decision === 'WAIT_FOR_CONFIRMATION') add('consensus', /^[A-Z_]+$/.test(state) ? state : 'UNKNOWN', 'consensus ' + (state || 'state missing'));
  if (r.decision === 'APPROVED_FOR_MONITORING') {
    // Monitoring with execution permitted can only come from the score floor (engine order); in OBSERVE only the mode is reported.
    const exec = failedStep(r, 'Execution permission');
    if (exec) add('mode', 'MODE_READ_ONLY', exec.detail);
    else add('consensus', 'SCORE_BELOW_MIN', 'opportunity score ' + (r.opportunity?.score ?? 'unknown') + ' was below the policy minimum in force when decided');
  }
  if (r.decision === 'INSUFFICIENT_DATA' && !out.some((x) => x.group === 'data')) add('data', 'INSUFFICIENT_DATA', 'data status ' + (r.dataFreshness?.status ?? 'missing'));
  if (!out.length) add('data', 'UNKNOWN', 'no blocking reason could be read from the stored report');
  return out;
}

interface DecisionRow { id: string; instrument: string; strategy: string; decision: string; score: number | null; created_at: number }
function parseReport(id: string): StoredReport | null {
  try { const v = JSON.parse(get<{ report: string }>('SELECT report FROM decisions WHERE id=?', id)?.report ?? ''); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
function reasonsOf(report: StoredReport | null): Reason[] {
  return report ? reasonsFromReport(report) : [{ group: 'data', code: 'REPORT_UNREADABLE', text: 'the stored decision report could not be read' }];
}
function projectRow(d: DecisionRow, history: NoTradeHistory[], nowTs: number): NoTradeRow {
  const report = parseReport(d.id);
  const validTs = Number.isFinite(d.created_at) && d.created_at > 0 && d.created_at <= nowTs;
  const ageMs = validTs ? nowTs - d.created_at : null;
  const evidence: Evidence = !report || ageMs == null ? 'UNKNOWN' : ageMs >= NO_TRADE_TTL_MS ? 'STALE' : 'RECENT';
  const risk = report?.risk ? { decision: String(report.risk.decision), policyVersion: report.risk.policyVersion ?? null, checkedAt: String(report.risk.ts) } : null;
  return {
    instrumentId: d.instrument, symbol: typeof report?.asset === 'string' ? report.asset : d.instrument.split(':').pop() ?? d.instrument, decisionId: d.id,
    strategy: d.strategy, decision: d.decision, score: d.score, createdAt: d.created_at, ageMs, expiresAt: validTs ? d.created_at + NO_TRADE_TTL_MS : null,
    evidence, supersededBy: null, risk, reasons: reasonsOf(report), missing: Array.isArray(report?.missingInformation) ? report.missingInformation.slice(0, 5).map(String) : [], history,
  };
}

/**
 * Known global blockers from existing state (control, policy, incidents, ledger deposits, market store). Absence is not
 * clearance. The ledger's accountState() is deliberately not used: it persists day/week/high-water marks, and this view
 * must never write.
 */
export function globalBlockers(nowTs = Date.now()): GlobalBlocker[] {
  const ctl = getControl(); const out: GlobalBlocker[] = [];
  const r = { rawMode: ctl.mode, emergency: ctl.emergency, pausedNewOrders: ctl.pausedNewOrders, policy: currentPolicy(), openIncidents: listIncidents().filter((i) => i.status === 'OPEN').length };
  if (r.rawMode === 'OBSERVE') out.push({ code: 'MODE_OBSERVE', group: 'mode', text: 'Execution mode is OBSERVE (read-only): decisions are monitored, never executed.', href: '/bot' });
  if (r.emergency) out.push({ code: 'EMERGENCY', group: 'mode', text: 'Emergency stop is active: no new orders.', href: '/risk' });
  if (r.pausedNewOrders) out.push({ code: 'PAUSED', group: 'mode', text: 'New orders are paused.', href: '/risk' });
  if (!r.policy) out.push({ code: 'NO_POLICY', group: 'mode', text: 'No risk policy accepted: paper execution stays disabled.', href: '/risk' });
  if (r.openIncidents > 0) out.push({ code: 'PROTECTION_INCIDENT_OPEN', group: 'safety', text: r.openIncidents + ' open protection incident(s): new entries on those instruments are blocked.', href: '/risk' });
  if (!(totalDeposits(PAPER_ACCOUNT) > 0)) out.push({ code: 'UNFUNDED', group: 'risk', text: 'Net paper deposits are zero: the risk gate denies every entry (NO_EQUITY).', href: '/bot' });
  const t = market.tickersFetchedAt;
  // Same 60 s threshold as the shell's data-health indicator (/api/shell).
  if (!t || t > nowTs || nowTs - t > 60_000) out.push({ code: 'STALE_DATA', group: 'data', text: t ? 'Market tickers are stale or future-dated (last batch ' + new Date(t).toISOString() + ').' : 'No market ticker batch received (offline or still loading).', href: '/connections' });
  return out;
}

export function noTradeBoard(nowTs = Date.now()) {
  const recent = all<DecisionRow>('SELECT id, instrument, strategy, decision, score, created_at FROM decisions WHERE created_at >= ? ORDER BY instrument, created_at DESC, rowid DESC', nowTs - NO_TRADE_WINDOW_MS);
  const byInstrument = new Map<string, DecisionRow[]>();
  for (const d of recent) { const list = byInstrument.get(d.instrument); if (list) list.push(d); else byInstrument.set(d.instrument, [d]); }
  const rows: NoTradeRow[] = []; const omittedTrades: { instrumentId: string; decisionId: string; decision: string }[] = [];
  for (const [instrumentId, list] of byInstrument) {
    const latest = list[0];
    if (TRADE_STATES.has(latest.decision)) { omittedTrades.push({ instrumentId, decisionId: latest.id, decision: latest.decision }); continue; }
    // Earlier non-trade decisions stay visible, each pointing at the decision that superseded it.
    const history = list.slice(1).map((d, i) => ({ d, supersededBy: list[i].id })).filter(({ d }) => !TRADE_STATES.has(d.decision)).slice(0, HISTORY_LIMIT)
      .map(({ d, supersededBy }) => ({ decisionId: d.id, decision: d.decision, createdAt: d.created_at, supersededBy, reasons: reasonsOf(parseReport(d.id)) }));
    rows.push(projectRow(latest, history, nowTs));
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return { asOf: nowTs, ttlMs: NO_TRADE_TTL_MS, windowMs: NO_TRADE_WINDOW_MS, global: globalBlockers(nowTs), globalLabel: 'known blockers, not execution clearance', rows, omittedTrades };
}
