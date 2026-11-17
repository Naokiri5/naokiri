import type { WorkerContext } from '../workers/types.js';
import { INTERVAL_MS } from '../market/types.js';

export interface MarketFingerprint {
  version: 'market-dna-v1'; asOf: number; instrumentId: string; timeframe: string; regime: string;
  dataQuality: string; metrics: Record<string, number | null>; missing: string[]; limitations: string[];
}

const bounded = (value: number | null | undefined, scale = 1): number | null =>
  value != null && Number.isFinite(value) && Number.isFinite(scale) && scale > 0 ? Math.max(0, Math.min(1, value / scale)) : null;

/** Pure representation of a captured decision context; never reads the live market cache. */
export function fingerprint(ctx: WorkerContext, asOf = ctx.candidate.createdAt): MarketFingerprint {
  if (!Number.isFinite(asOf) || asOf < ctx.candidate.createdAt) throw new Error('fingerprint timestamp precedes captured context');
  const timeframe = ctx.candidate.interval, duration = INTERVAL_MS[timeframe];
  const raw = ctx.f[timeframe];
  const f = raw && Number.isFinite(raw.t) && raw.t + duration <= asOf ? raw : null;
  const limitations = [
    'Fixed research normalization scales; similarity is not a prediction or trading authorization.',
    'Historical availability of news, liquidity and correlations is asserted by the captured context; source timestamps must be preserved in its snapshot.',
    'Spot funding is not applicable. Macro and fundamental metrics are unavailable in the current context.',
  ];
  if (!f) limitations.push('No feature snapshot closed by the fingerprint timestamp; feature dimensions omitted.');
  if (ctx.quality.status === 'FAIL') limitations.push('Input data quality failed; fingerprint is retained for diagnostics and is not comparable.');
  const imp = ctx.impact;
  const trendDirection = f && Number.isFinite(f.ema20) && Number.isFinite(f.ema50) ? f.ema20 > f.ema50 ? 1 : f.ema20 < f.ema50 ? 0 : 0.5 : null;
  const width = f ? f.swingHigh - f.swingLow : NaN;
  const metrics = {
    trendDirection,
    trendStrength: bounded(f?.adx14, 100),
    volatility: bounded(f?.atrPct, 0.1),
    relativeVolume: bounded(f?.relVol20, 5),
    liquidityCoverage: bounded(imp && ctx.intendedNotional > 0 ? imp.depth1pct / ctx.intendedNotional : null, 10),
    spread: bounded(imp?.spreadBps, 100),
    impact: bounded(imp?.impactBps, 100),
    momentum: bounded(f?.rsi14, 100),
    structureLocation: bounded(f && width > 0 ? (f.close - f.swingLow) / width : null),
    correlationToBtc: bounded(ctx.corrToBtc != null && Number.isFinite(ctx.corrToBtc) ? (ctx.corrToBtc + 1) / 2 : null),
    macro: null,
    fundamentals: null,
  };
  return { version: 'market-dna-v1', asOf, instrumentId: ctx.candidate.instrumentId, timeframe, regime: f ? ctx.candidate.regime : 'UNKNOWN', dataQuality: ctx.quality.status,
    metrics, missing: Object.entries(metrics).filter(([, v]) => v == null).map(([k]) => k), limitations };
}

/** Equal-weight normalized distance on shared observations; missing dimensions never equal zero. */
export function compareFingerprints(a: MarketFingerprint, b: MarketFingerprint) {
  const dimensions = [...new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])];
  const sharedDimensions = dimensions.filter(k => a.metrics[k] != null && b.metrics[k] != null && Number.isFinite(a.metrics[k]) && Number.isFinite(b.metrics[k]));
  const coverage = dimensions.length ? sharedDimensions.length / dimensions.length : 0;
  const limitations = ['Shared-feature similarity is research evidence, not a probability of profit.'];
  const comparable = a.version === b.version && a.timeframe === b.timeframe && a.dataQuality !== 'FAIL' && b.dataQuality !== 'FAIL' && sharedDimensions.length >= 3 && coverage >= 0.5;
  if (!comparable) limitations.push('Version/timeframe mismatch, failed data quality or insufficient common observations.');
  const similarity = comparable ? Math.max(0, 1 - sharedDimensions.reduce((sum, k) => sum + Math.abs(a.metrics[k]! - b.metrics[k]!), 0) / sharedDimensions.length) : null;
  return { similarity, coverage, sharedDimensions, comparable, limitations };
}
