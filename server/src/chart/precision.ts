/**
 * DEEP PRECISION research adapter (DPI-P1).
 *
 * Reuses existing chart/analysis.ts, native confirmed MIA candles, price-quality
 * reports, 100-worker registry metadata and the canonical market types. This
 * is NOT a second QCI, a risk gate, a trading strategy, or a venue adapter.
 * No order authorization, signing, execution or autonomous state transitions.
 */
import { analyzeChart, type ChartReport } from './analysis.js';
import { INTERVAL_MS, type Candle, type Instrument, type Interval } from '../market/types.js';
import type { DataQuality } from '../market/quality.js';
import { WORKERS } from '../workers/registry.js';

export type PrecisionStyle = 'SCALPING' | 'DAY_TRADING';
export type PrecisionBias = 'LONG' | 'SHORT' | 'NO_TRADE';
export type PrecisionStage = 'NO_TRADE' | 'OBSERVING' | 'ZONE_IDENTIFIED' | 'ZONE_TOUCHED_UNCONFIRMED';
export interface PrecisionZone {
  id: string;
  bias: Exclude<PrecisionBias, 'NO_TRADE'>;
  low: number;
  high: number;
  invalidation: number;
  stop: number;
  target: number;
  touched: boolean;
  detectedAt: number;
  expiresAt: number;
  provenance: 'PRIOR_CONFIRMED_15M_EXTREMA';
  rewardRiskAtWorstEdge: number;
  calibration: 'NOT_CALIBRATED';
}
export interface PrecisionPreview {
  version: 'mia-deep-precision-research-v1';
  instrumentId: string;
  style: PrecisionStyle;
  stage: PrecisionStage;
  bias: PrecisionBias;
  marketSupport: 'SPOT_RESEARCH_ONLY' | 'MARKET_ADAPTER_NOT_CERTIFIED';
  timeframes: readonly { timeframe: Interval; status: ChartReport['status']; trend: ChartReport['trend']; issues: readonly string[] }[];
  zone: PrecisionZone | null;
  /**
   * Metadata from the registered 100 workers, not 100 affirmative responses.
   * The existing QCI must independently run/validate actual signed packets.
   */
  workerPlan: {
    registeredWorkers: number;
    selectedWorkers: number;
    eligibleWorkerIds: readonly string[];
    providerBlocked: number;
    dependencyGroups: number;
    evidenceQuorum: 'NOT_EVALUATED';
  };
  qci: 'NOT_RUN_FOR_THIS_ZONE';
  reasons: readonly string[];
  nextStep: 'WAIT_FOR_CANONICAL_DECISION' | 'NO_TRADE';
  canAuthorizeTrade: false;
  canSubmitOrder: false;
  canSignOrder: false;
  note: string;
}

export interface PrecisionEvidence {
  instrument: Instrument;
  candles: Readonly<Partial<Record<Interval, readonly Candle[]>>>;
  quality: DataQuality;
  quote: { price: number; ts: number } | null;
  /** Server clock; never a caller-supplied authorization timestamp. */
  nowMs: number;
  style: PrecisionStyle;
}

const FRAMES = ['15m', '1h', '4h'] as const;
const DOMAINS = new Set(['trend', 'momentum', 'volatility', 'flow', 'liquidity', 'structure', 'regime', 'news', 'risk', 'execution']);
const finitePositive = (n: number) => Number.isFinite(n) && n > 0;
const tickFloor = (value: number, tick: number) => Number((Math.floor(value / tick + 1e-9) * tick).toFixed(12));
const tickCeil = (value: number, tick: number) => Number((Math.ceil(value / tick - 1e-9) * tick).toFixed(12));

/**
 * A purely observational, point-in-time chart preview for the current
 * 15m/1h/4h native data set. It neither constructs synthetic QCI approval
 * nor calls evaluateRisk() outside the canonical decision pipeline.
 */
export function analyzeDeepPrecision(input: Readonly<PrecisionEvidence>): PrecisionPreview {
  const { instrument, candles, quality, quote, nowMs, style } = input;
  const reasons: string[] = [];
  const add = (code: string) => { if (!reasons.includes(code)) reasons.push(code); };
  const relevant = WORKERS.filter(w => DOMAINS.has(w.domain));
  const allowed = relevant.filter(w => w.capability !== 'PROVIDER_BLOCKED');
  const base = {
    version: 'mia-deep-precision-research-v1' as const,
    instrumentId: instrument.id,
    style,
    marketSupport: instrument.market === 'crypto' && instrument.venue === 'binance'
      ? 'SPOT_RESEARCH_ONLY' as const
      : 'MARKET_ADAPTER_NOT_CERTIFIED' as const,
    workerPlan: {
      registeredWorkers: WORKERS.length,
      selectedWorkers: allowed.length,
      eligibleWorkerIds: allowed.map(w => w.id),
      providerBlocked: relevant.length - allowed.length,
      dependencyGroups: new Set(allowed.map(w => w.dependencyGroup)).size,
      evidenceQuorum: 'NOT_EVALUATED' as const,
    },
    qci: 'NOT_RUN_FOR_THIS_ZONE' as const,
    canAuthorizeTrade: false as const,
    canSubmitOrder: false as const,
    canSignOrder: false as const,
    note: 'Research-only zones. No QCI consensus, broker feed certification, trigger order, fill or probability of profit is implied.',
  };
  const validClock = Number.isSafeInteger(nowMs) && nowMs > 0;
  const reports = FRAMES.map(timeframe => analyzeChart(
    instrument.id, timeframe, candles[timeframe] ?? [], nowMs,
  ));
  const timeframes = reports.map((r, i) => ({
    timeframe: FRAMES[i], status: r.status, trend: r.trend, issues: r.issues,
  }));
  if (!validClock) add('INVALID_SERVER_CLOCK');
  if (!finitePositive(instrument.tickSize)) add('INVALID_MARKET_TICK_SIZE');
  if (base.marketSupport !== 'SPOT_RESEARCH_ONLY') add('MARKET_ADAPTER_NOT_CERTIFIED');
  if (style === 'SCALPING') add('ONE_MINUTE_OR_TICK_TRIGGER_FEED_NOT_AVAILABLE');
  if (reports.some(r => r.status !== 'VALID')) add('CONFIRMED_MULTI_TIMEFRAME_DATA_REQUIRED');
  if (quality.status !== 'OK') add('CANONICAL_DATA_QUALITY_NOT_OK');
  if (quote === null || !finitePositive(quote.price) ||
      !Number.isSafeInteger(quote.ts) || quote.ts > nowMs || nowMs - quote.ts > 60_000)
    add('NO_FRESH_EXECUTABLE_REFERENCE_QUOTE');
  const [low, medium, high] = reports;
  const alignment = medium.trend === high.trend &&
    (medium.trend === 'BULLISH' || medium.trend === 'BEARISH');
  if (!alignment) add('HIGHER_TIMEFRAME_BIAS_UNKNOWN_OR_CONFLICTED');
  const bias: PrecisionBias = !alignment ? 'NO_TRADE' :
    medium.trend === 'BULLISH' ? 'LONG' : 'SHORT';
  if (bias === 'SHORT' && instrument.market === 'crypto')
    add('SPOT_SHORT_NOT_SUPPORTED');
  // A documented, reproducible price area, NOT a claim that institutional orders
  // or hidden stops exist there. The existing chart analyzer excludes the signal
  // candle when calculating its support/resistance range.
  let zone: PrecisionZone | null = null;
  const bars = candles['15m'] ?? [];
  const last = bars.at(-1);
  if (reasons.length === 0 && bias !== 'NO_TRADE' &&
      last && low.support !== null && low.resistance !== null &&
      finitePositive(low.support) && finitePositive(low.resistance) &&
      low.resistance > low.support && quote !== null) {
    const recentRange = Math.max(...bars.slice(-14).map(c => c.h - c.l));
    const rawBuffer = Math.max(instrument.tickSize, Math.min(recentRange * 0.2, low.support * 0.01));
    const pivot = bias === 'LONG' ? low.support : low.resistance;
    const lower = tickFloor(Math.max(instrument.tickSize, pivot - rawBuffer), instrument.tickSize);
    const upper = tickCeil(pivot + rawBuffer, instrument.tickSize);
    const stop = bias === 'LONG'
      ? tickFloor(lower - rawBuffer, instrument.tickSize)
      : tickCeil(upper + rawBuffer, instrument.tickSize);
    const target = bias === 'LONG' ? tickFloor(low.resistance, instrument.tickSize)
      : tickCeil(low.support, instrument.tickSize);
    const reward = bias === 'LONG' ? target - upper : lower - target;
    const risk = bias === 'LONG' ? upper - stop : stop - lower;
    if (finitePositive(lower) && finitePositive(upper) && finitePositive(stop) &&
        finitePositive(target) && lower <= upper && finitePositive(reward) && finitePositive(risk)) {
      const duration = INTERVAL_MS['15m'];
      const expiresAt = last.t + duration * 2;
      if (expiresAt > nowMs) {
        zone = {
          id: [instrument.id, style, bias, last.t, low.support, low.resistance].join(':'),
          bias, low: lower, high: upper, invalidation: stop, stop, target,
          touched: quote.price >= lower && quote.price <= upper,
          detectedAt: last.t + duration,
          expiresAt,
          provenance: 'PRIOR_CONFIRMED_15M_EXTREMA',
          rewardRiskAtWorstEdge: Number((reward / risk).toFixed(6)),
          calibration: 'NOT_CALIBRATED',
        };
      } else add('ZONE_EXPIRED');
    } else add('ZONE_GEOMETRY_OR_TICK_INVALID');
  }
  // Stage never asserts TRIGGER_CONFIRMED: no independent trigger/QCI/risk
  // authorization has been obtained or validated by this observational call.
  const stage: PrecisionStage = reasons.length > 0 ? 'NO_TRADE' :
    zone?.touched ? 'ZONE_TOUCHED_UNCONFIRMED' :
    zone ? 'ZONE_IDENTIFIED' : 'OBSERVING';
  if (!zone && reasons.length === 0) add('NO_VALID_ZONE_FROM_CONFIRMED_BARS');
  return {
    ...base, timeframes, zone, stage, bias,
    reasons: [...reasons, 'QCI_AND_CANONICAL_RISK_RECHECK_REQUIRED_BEFORE_ENTRY'],
    nextStep: stage === 'NO_TRADE' ? 'NO_TRADE' : 'WAIT_FOR_CANONICAL_DECISION',
  };
}
