import { all } from '../db/db.js';
import { PAPER_ACCOUNT } from './ledger.js';

/**
 * MIA-ID-11 / portfolio patch PDF: research-only rolling PAPER expectancy.
 * Reads the canonical positions table; never establishes a second ledger, risk
 * gate, execution mode, promotion state, or real-money authorization.
 */
export interface ClosedPaperTrade {
  id: string;
  market: string;
  strategy: string;
  instrument: string;
  realized_pnl: number;
  planned_risk: number;
  closed_at: number;
}

export type ExpectancyStatus =
  | 'INSUFFICIENT_SAMPLE'
  | 'INVALID_EVIDENCE'
  | 'THRESHOLDS_MET_RESEARCH_ONLY'
  | 'THRESHOLDS_NOT_MET';

export interface PaperExpectancyCohort {
  market: string;
  strategy: string;
  sleeve: 'spot' | null;
  sampleTrades: number;
  sampleTarget: 30;
  winningTrades: number | null;
  winRatePct: number | null;
  rollingExpectancyUsd: number | null;
  rollingExpectancyR: number | null;
  /** Peak-to-trough realized drawdown in R units, NOT portfolio equity drawdown percent. */
  rollingMaxDrawdownR: number | null;
  profitFactor: number | null;
  status: ExpectancyStatus;
  note: string;
}

const SAMPLE_TARGET = 30;
const MIN_PROFIT_FACTOR = 1.25;

/** Pure calculation over the latest <=30 closed positions of one (market,strategy) cohort. */
export function assessPaperExpectancyCohort(rows: readonly ClosedPaperTrade[]): PaperExpectancyCohort {
  if (!rows.length) throw new Error('A paper expectancy cohort needs at least one observed position');
  const { market, strategy } = rows[0];
  if (rows.length > SAMPLE_TARGET || rows.some(r => r.market !== market || r.strategy !== strategy)) {
    throw new Error('Cohort must contain <=30 trades from one market and strategy');
  }
  const base = {
    market, strategy, sampleTrades: rows.length, sampleTarget: 30 as const,
    sleeve: rows.every(r => r.market === 'crypto' && r.instrument.startsWith('crypto:binance:'))
      ? 'spot' as const : null,
  };
  const valid = rows.every(r =>
    typeof r.id === 'string' && r.id.length > 0 &&
    Number.isFinite(r.closed_at) && r.closed_at > 0 &&
    Number.isFinite(r.realized_pnl) &&
    Number.isFinite(r.planned_risk) && r.planned_risk > 0,
  ) && new Set(rows.map(r => r.id)).size === rows.length;
  if (!valid) return {
    ...base, winningTrades: null, winRatePct: null, rollingExpectancyUsd: null,
    rollingExpectancyR: null, rollingMaxDrawdownR: null, profitFactor: null, status: 'INVALID_EVIDENCE',
    note: 'Missing/invalid stored PnL, planned risk, closing time or duplicate position ID; fail closed.',
  };

  const wins = rows.filter(r => r.realized_pnl > 0).length;
  const profit = rows.reduce((n, r) => n + Math.max(r.realized_pnl, 0), 0);
  const loss = rows.reduce((n, r) => n + Math.max(-r.realized_pnl, 0), 0);
  const expectancyUsd = rows.reduce((n, r) => n + r.realized_pnl, 0) / rows.length;
  const expectancyR = rows.reduce((n, r) => n + r.realized_pnl / r.planned_risk, 0) / rows.length;
  const factor = loss > 0 ? profit / loss : null;
  // Source SQL selects newest-first; drawdown must be evaluated oldest-first.
  // Start at a zero-R watermark and never fabricate a percent of sleeve equity.
  let realizedEquityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  for (const row of [...rows].sort((a, b) => a.closed_at - b.closed_at || a.id.localeCompare(b.id))) {
    realizedEquityR += row.realized_pnl / row.planned_risk;
    peakR = Math.max(peakR, realizedEquityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - realizedEquityR);
  }
  if (![profit, loss, expectancyUsd, expectancyR, realizedEquityR, maxDrawdownR].every(Number.isFinite) ||
      (factor !== null && !Number.isFinite(factor))) return {
    ...base, winningTrades: null, winRatePct: null, rollingExpectancyUsd: null,
    rollingExpectancyR: null, rollingMaxDrawdownR: null, profitFactor: null, status: 'INVALID_EVIDENCE',
    note: 'An aggregation overflowed or returned non-finite evidence; fail closed.',
  };
  const meetsThresholds = rows.length >= SAMPLE_TARGET &&
    expectancyUsd > 0 && expectancyR > 0 &&
    factor !== null && factor >= MIN_PROFIT_FACTOR;
  const status: ExpectancyStatus = rows.length < SAMPLE_TARGET ? 'INSUFFICIENT_SAMPLE'
    : meetsThresholds ? 'THRESHOLDS_MET_RESEARCH_ONLY' : 'THRESHOLDS_NOT_MET';

  return {
    ...base, winningTrades: wins, winRatePct: (wins / rows.length) * 100,
    rollingExpectancyUsd: expectancyUsd, rollingExpectancyR: expectancyR,
    rollingMaxDrawdownR: maxDrawdownR,
    profitFactor: factor, status,
    note: factor === null
      ? 'Profit factor not measurable without losses; never treat as automatic live eligibility.'
      : 'Historical PAPER sample only; strategy quality, costs, regime and live safety require independent verification.',
  };
}

/** Account-scoped, deterministic, read-only query: no shadow_trades table or dual SQLite databases. */
export function rollingPaperExpectancy() {
  const account = PAPER_ACCOUNT; // Never let an optional caller label a non-paper account as PAPER evidence.
  const rows = all<ClosedPaperTrade>(`
    WITH ranked AS (
      SELECT id, market, strategy, instrument, realized_pnl, planned_risk, closed_at,
        ROW_NUMBER() OVER (
          PARTITION BY market, strategy ORDER BY closed_at DESC, id DESC
        ) AS rn
      FROM positions
      WHERE account = ? AND status = 'CLOSED' AND closed_at IS NOT NULL
    )
    SELECT id, market, strategy, instrument, realized_pnl, planned_risk, closed_at
    FROM ranked WHERE rn <= 30 ORDER BY market, strategy, rn
  `, account);
  const buckets = new Map<string, ClosedPaperTrade[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.market, row.strategy]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return {
    account, mode: 'PAPER' as const, authority: 'RESEARCH_ONLY' as const,
    source: 'canonical positions.realized_pnl and positions.planned_risk' as const,
    thresholds: { trades: SAMPLE_TARGET, minExpectancyUsd: 0, minExpectancyR: 0, minProfitFactor: MIN_PROFIT_FACTOR },
    cohorts: [...buckets.values()].map(assessPaperExpectancyCohort),
    limitations: [
      'Never authorizes LIVE or TESTNET, increases trade size, or changes an OMS/risk decision.',
      'Groups by stored market and strategy; PDF setup category and venue-level TCA are not present in this ledger.',
      'The 30-trade thresholds are exploratory; no out-of-sample, independent execution-cost or slippage certification.',
      'Profit/loss uses stored realized_pnl without inventing independent fee or fill measurements.',
      'Rolling max drawdown is realized peak-to-trough R, not intraday or equity drawdown percent; it cannot certify the PDF drawdown gate.',
    ],
  };
}
