import { INTERVAL_MS, type Candle, type Interval } from '../market/types.js';

export interface Detection {
  instrument: string; timeframe: Interval; detectedAt: number; kind: string;
  boundaries: { low: number; high: number }; method: string; evidence: string[];
  confidence: number; calibration: 'NOT_CALIBRATED'; expiresAt: number; invalidation: string;
}
export interface ChartReport {
  instrument: string; timeframe: Interval; asOf: number; status: 'VALID' | 'INVALID' | 'INSUFFICIENT_DATA';
  issues: string[]; trend: 'BULLISH' | 'BEARISH' | 'RANGING' | 'UNKNOWN';
  support: number | null; resistance: number | null; detections: Detection[];
  decision: 'NO TRADE'; note: string;
}

/** Strict point-in-time validation. Never sort, deduplicate or fill gaps silently. */
export function validateCandles(candles: readonly Candle[], timeframe: Interval, asOf: number): string[] {
  const issues = new Set<string>(); const duration = INTERVAL_MS[timeframe];
  if (!duration || !Number.isFinite(asOf)) return ['invalid timeframe or analysis timestamp'];
  if (!candles.length) issues.add('no closed candles');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.t, c.o, c.h, c.l, c.c, c.v].every(Number.isFinite) || c.t < 0 || Math.min(c.o, c.h, c.l, c.c) <= 0 || c.v < 0 || c.l > Math.min(c.o, c.c) || c.h < Math.max(c.o, c.c) || c.h < c.l) issues.add('invalid OHLCV');
    if (c.t + duration > asOf || (c.closeTime != null && (!Number.isFinite(c.closeTime) || c.closeTime >= asOf))) issues.add('future or forming candle');
    if (i && c.t - candles[i - 1].t !== duration) issues.add('duplicate, unordered or missing candles');
  }
  if (candles.length && asOf - (candles[candles.length - 1].t + duration) > 2 * duration) issues.add('stale candle history');
  return [...issues];
}

/** Conservative OHLCV heuristics. Scores describe rule strength, never win probability. */
export function analyzeChart(instrument: string, timeframe: Interval, candles: readonly Candle[], asOf: number): ChartReport {
  const issues = validateCandles(candles, timeframe, asOf);
  const report: ChartReport = { instrument, timeframe, asOf, status: issues.length ? 'INVALID' : candles.length < 22 ? 'INSUFFICIENT_DATA' : 'VALID', issues, trend: 'UNKNOWN', support: null, resistance: null, detections: [], decision: 'NO TRADE', note: 'Chart evidence only; existing QCI, decision and risk engines retain trading authority. Confidence is not calibrated.' };
  if (report.status !== 'VALID') return report;
  const duration = INTERVAL_MS[timeframe], last = candles[candles.length - 1], prev = candles[candles.length - 2];
  const add = (kind: string, low: number, high: number, method: string, evidence: string[], invalidation: string, confidence = 0.6) => report.detections.push({ instrument, timeframe, detectedAt: asOf, kind, boundaries: { low, high }, method, evidence, confidence, calibration: 'NOT_CALIBRATED', expiresAt: asOf + duration, invalidation });
  const prior = candles.slice(-21, -1);
  report.support = Math.min(...prior.map(c => c.l)); report.resistance = Math.max(...prior.map(c => c.h));
  add('SUPPORT_RESISTANCE', report.support, report.resistance, 'Prior 20 closed-bar extrema; excludes signal candle', [`support=${report.support}`, `resistance=${report.resistance}`], 'Recalculate after next candle close');
  const swings: { kind: 'HIGH' | 'LOW'; price: number; t: number }[] = [];
  // Two bars on each side; a pivot is visible only after both right-side bars close.
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i], neighbors = [candles[i - 2], candles[i - 1], candles[i + 1], candles[i + 2]];
    if (neighbors.every(x => c.h > x.h)) swings.push({ kind: 'HIGH', price: c.h, t: c.t });
    if (neighbors.every(x => c.l < x.l)) swings.push({ kind: 'LOW', price: c.l, t: c.t });
  }
  const highs = swings.filter(s => s.kind === 'HIGH').slice(-2), lows = swings.filter(s => s.kind === 'LOW').slice(-2);
  if (highs.length === 2 && lows.length === 2) {
    report.trend = highs[1].price > highs[0].price && lows[1].price > lows[0].price ? 'BULLISH' : highs[1].price < highs[0].price && lows[1].price < lows[0].price ? 'BEARISH' : 'RANGING';
    add('SWING_STRUCTURE', Math.min(...lows.map(s => s.price)), Math.max(...highs.map(s => s.price)), 'Strict two-left/two-right confirmed pivots', [...highs, ...lows].map(s => `${s.kind} at ${s.t}: ${s.price}`), 'A newly confirmed pivot changes the sequence');
  }
  const range = last.h - last.l, body = Math.abs(last.c - last.o);
  if (range > 0 && body / range <= 0.1) add('DOJI', last.l, last.h, 'Body <= 10% of candle range', [`body/range=${body / range}`], 'Context changes after next close');
  if (prev.c < prev.o && last.c > last.o && last.o <= prev.c && last.c >= prev.o) add('BULLISH_ENGULFING', last.l, last.h, 'Opposite-direction real-body engulfing', [`prior body=${prev.c}..${prev.o}`, `current body=${last.o}..${last.c}`], `Close below ${last.l}`);
  if (prev.c > prev.o && last.c < last.o && last.o >= prev.c && last.c <= prev.o) add('BEARISH_ENGULFING', last.l, last.h, 'Opposite-direction real-body engulfing', [`prior body=${prev.o}..${prev.c}`, `current body=${last.c}..${last.o}`], `Close above ${last.h}`);
  if (last.h < prev.h && last.l > prev.l) add('INSIDE_BAR', last.l, last.h, 'Strictly inside prior high/low', [`mother range=${prev.l}..${prev.h}`], 'Break of mother-bar range');
  if (range > 0 && body / range <= 0.35) {
    if (Math.min(last.o, last.c) - last.l >= 0.6 * range) add('BULLISH_PIN_BAR', last.l, last.h, 'Lower wick >=60%, body <=35% of range', ['Long lower wick; reversal hypothesis only'], `Close below ${last.l}`);
    if (last.h - Math.max(last.o, last.c) >= 0.6 * range) add('BEARISH_PIN_BAR', last.l, last.h, 'Upper wick >=60%, body <=35% of range', ['Long upper wick; reversal hypothesis only'], `Close above ${last.h}`);
  }
  if (last.c > report.resistance) add('BREAKOUT_UP', report.resistance, last.c, 'Close exceeds prior 20-bar high', [`close=${last.c}`], `Close back below ${report.resistance}`);
  if (last.c < report.support) add('BREAKOUT_DOWN', last.c, report.support, 'Close below prior 20-bar low', [`close=${last.c}`], `Close back above ${report.support}`);
  if (last.h > report.resistance && last.c <= report.resistance) add('UPPER_LIQUIDITY_SWEEP_HYPOTHESIS', report.resistance, last.h, 'Wick above prior range, close back inside', ['Observed OHLCV only; hidden stops and institutional orders unknown'], `Close above ${last.h}`);
  if (last.l < report.support && last.c >= report.support) add('LOWER_LIQUIDITY_SWEEP_HYPOTHESIS', last.l, report.support, 'Wick below prior range, close back inside', ['Observed OHLCV only; hidden stops and institutional orders unknown'], `Close below ${last.l}`);
  const a = candles[candles.length - 3];
  if (last.l > a.h) add('BULLISH_FVG_HYPOTHESIS', a.h, last.l, 'Three-bar non-overlap: latest low > first high', ['Price imbalance hypothesis; no order-flow inference'], `Price fills gap to ${a.h}`);
  if (last.h < a.l) add('BEARISH_FVG_HYPOTHESIS', last.h, a.l, 'Three-bar non-overlap: latest high < first low', ['Price imbalance hypothesis; no order-flow inference'], `Price fills gap to ${a.l}`);
  return report;
}
