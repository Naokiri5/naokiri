/**
 * Research-only portfolio historical tail-loss diagnostics.
 * Inspired by risk concepts in skfolio; this is an original TypeScript implementation.
 * It is not an OMS, risk-policy gate, prediction of future losses or authorization to trade.
 * Only CLOSED, timestamp-aligned 4h candles are admitted. Missing data means UNAVAILABLE.
 */
import type { Candle } from '../market/types.js';
import { pearsonCorrelation } from '../core/util.js';

const FOUR_HOURS_MS = 14_400_000;
const PEER_WINDOW = 96;
const MIN_PEER_CORRELATION = 0.35;
interface HoldingPeers {
  instrument: string;
  weightedPeerValue: number;
  strongestPeer: { instrument: string; correlation: number } | null;
}
export interface TailRiskExposure {
  instrument: string;
  /** Current validated marked value in the paper account's USDT reporting unit. */
  value: number;
  /** Closed 4h candles, oldest first. */
  candles: readonly Pick<Candle, 't' | 'c'>[];
}
export type TailRiskStatus = 'ESTIMATED' | 'UNAVAILABLE' | 'NO_EXPOSURE';
export interface TailRiskReport {
  status: TailRiskStatus;
  asOf: number;
  horizon: '4H';
  confidence: 0.95 | 0.99;
  observations: number;
  varLoss: number | null;
  /** Mean loss in the worst 5% or 1% of observations, prorating the cutoff observation. */
  expectedShortfallLoss: number | null;
  worstObservedLoss: number | null;
  maxObservedLossPctEquity: number | null;
  effectiveHoldings: number | null;
  correlatedPeers: { minimumCorrelation: number; observations: number; holdings: HoldingPeers[] } | null;
  reason: string | null;
  authority: 'RESEARCH_ONLY';
  note: string;
}
export interface TailRiskOptions {
  asOf: number;
  cash: number;
  confidence?: 0.95 | 0.99;
  minObservations?: number;
}
const note = 'Historical 4h fixed-current-exposure estimate, not a forecast or loss bound; excludes fees, funding, liquidity impact, gaps beyond observed history, and execution failures.';
const positive = (v: number) => Number.isFinite(v) && v > 0;

function correlatedPeerExposure(exposures: readonly TailRiskExposure[], returns: readonly number[][]): TailRiskReport['correlatedPeers'] {
  if (exposures.length < 2 || returns.some(series => series.every(value => value === series[0]))) return null;
  const holdings: HoldingPeers[] = exposures.map(({ instrument }) => ({ instrument, weightedPeerValue: 0, strongestPeer: null }));
  function includePeer(holding: HoldingPeers, peer: TailRiskExposure, correlation: number) {
    holding.weightedPeerValue += peer.value * correlation;
    if (!holding.strongestPeer || correlation > holding.strongestPeer.correlation ||
        (correlation === holding.strongestPeer.correlation && peer.instrument < holding.strongestPeer.instrument)) {
      holding.strongestPeer = { instrument: peer.instrument, correlation };
    }
  }
  for (let i = 0; i < holdings.length; i++) {
    for (let j = i + 1; j < holdings.length; j++) {
      const coefficient = pearsonCorrelation(returns[i].map((value, k) => [value, returns[j][k]]));
      if (coefficient === null || !Number.isFinite(coefficient)) return null;
      if (coefficient <= MIN_PEER_CORRELATION) continue;
      const bounded = Math.min(1, coefficient);
      includePeer(holdings[i], exposures[j], bounded);
      includePeer(holdings[j], exposures[i], bounded);
    }
  }
  return { minimumCorrelation: MIN_PEER_CORRELATION, observations: returns[0].length, holdings };
}
/** Pure. Never mutates exposure, candles, ledger, risk mode or the source market cache. */
export function historicalPortfolioTailRisk(
  exposures: readonly TailRiskExposure[], options: TailRiskOptions,
): TailRiskReport {
  const confidence = options.confidence ?? 0.95;
  const minObservations = options.minObservations ?? 90;
  const result = (status: TailRiskStatus, reason: string | null, extras: Partial<TailRiskReport> = {}): TailRiskReport => ({
    status, reason, asOf: options.asOf, horizon: '4H', confidence,
    observations: 0, varLoss: null, expectedShortfallLoss: null,
    worstObservedLoss: null, maxObservedLossPctEquity: null,
    effectiveHoldings: null, correlatedPeers: null, authority: 'RESEARCH_ONLY', note, ...extras,
  });
  if (!Number.isSafeInteger(options.asOf) || options.asOf <= 0 ||
      !Number.isFinite(options.cash) || options.cash < 0 ||
      ![0.95, 0.99].includes(confidence) ||
      !Number.isSafeInteger(minObservations) || minObservations < 60)
    return result('UNAVAILABLE', 'INVALID_OPTIONS');
  if (exposures.length === 0) return result('NO_EXPOSURE', null);
  const ids = new Set<string>();
  let investedValue = 0;
  for (const e of exposures) {
    if (!e.instrument?.trim() || ids.has(e.instrument) || !positive(e.value))
      return result('UNAVAILABLE', 'INVALID_OR_DUPLICATE_EXPOSURE');
    ids.add(e.instrument);
    investedValue += e.value;
    if (!Number.isFinite(investedValue)) return result('UNAVAILABLE', 'NON_FINITE_EXPOSURE');
    if (e.candles.length < minObservations + 1) return result('UNAVAILABLE', 'INSUFFICIENT_HISTORY');
    let previousTime = -1;
    for (const c of e.candles) {
      if (!Number.isSafeInteger(c.t) || c.t <= previousTime || !positive(c.c) ||
          c.t + FOUR_HOURS_MS > options.asOf)
        return result('UNAVAILABLE', 'INVALID_OR_UNCLOSED_HISTORY');
      if (previousTime >= 0 && c.t - previousTime !== FOUR_HOURS_MS)
        return result('UNAVAILABLE', 'HISTORY_GAP');
      previousTime = c.t;
    }
    const latest = e.candles[e.candles.length - 1];
    if (options.asOf - (latest.t + FOUR_HOURS_MS) > FOUR_HOURS_MS * 2)
      return result('UNAVAILABLE', 'STALE_HISTORY');
  }
  const equity = investedValue + options.cash;
  if (!positive(equity)) return result('UNAVAILABLE', 'INVALID_EQUITY');
  // Align all assets on an identical set of closed 4h bars to avoid spurious correlation estimates.
  const endTime = Math.min(...exposures.map(e => e.candles[e.candles.length - 1].t));
  const starts = exposures.map(e => e.candles[0].t);
  const startTime = Math.max(...starts);
  const mapByAsset = exposures.map(e => new Map(e.candles.map(c => [c.t, c.c])));
  const nReturns = Math.round((endTime - startTime) / FOUR_HOURS_MS);
  if (nReturns < minObservations) return result('UNAVAILABLE', 'INSUFFICIENT_ALIGNED_HISTORY');
  const losses: number[] = [];
  const recentLogReturns: number[][] = exposures.map(() => []);
  for (let i = 1; i <= nReturns; i++) {
    const t0 = startTime + (i - 1) * FOUR_HOURS_MS;
    const t1 = startTime + i * FOUR_HOURS_MS;
    let pnl = 0;
    for (let j = 0; j < exposures.length; j++) {
      const before = mapByAsset[j].get(t0);
      const after = mapByAsset[j].get(t1);
      if (!before || !after || !positive(before) || !positive(after))
        return result('UNAVAILABLE', 'MISSING_ALIGNED_HISTORY');
      if (i > nReturns - PEER_WINDOW) recentLogReturns[j].push(Math.log(after / before));
      pnl += exposures[j].value * (after / before - 1);
    }
    if (!Number.isFinite(pnl)) return result('UNAVAILABLE', 'INVALID_PORTFOLIO_RETURN');
    losses.push(-pnl);
  }
  if (losses.length < minObservations) return result('UNAVAILABLE', 'INSUFFICIENT_HISTORY');
  const ranked = [...losses].sort((a, b) => a - b);
  const varIndex = Math.max(0, Math.ceil(confidence * ranked.length) - 1);
  const varLoss = Math.max(0, ranked[varIndex]);
  // Work in hundredths of an observation so exact tail sizes never round up at the cutoff.
  const tailHundredths = ranked.length * (confidence === 0.95 ? 5 : 1);
  const tailCount = tailHundredths / 100;
  const fullTailStart = ranked.length - Math.floor(tailCount);
  const cutoffWeight = (tailHundredths % 100) / tailHundredths;
  const fullTailMean = ranked.slice(fullTailStart).reduce((sum, loss) => sum + loss / tailCount, 0);
  const es = Math.max(0, fullTailMean + ranked[fullTailStart - 1] * cutoffWeight);
  const worst = Math.max(0, ranked[ranked.length - 1]);
  const hhi = exposures.reduce((sum, e) => sum + (e.value / investedValue) ** 2, 0);
  return result('ESTIMATED', null, {
    observations: losses.length,
    varLoss, expectedShortfallLoss: es, worstObservedLoss: worst,
    maxObservedLossPctEquity: 100 * worst / equity,
    effectiveHoldings: hhi > 0 ? 1 / hhi : null,
    correlatedPeers: correlatedPeerExposure(exposures, recentLogReturns),
  });
}
