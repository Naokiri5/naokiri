import type { FeatureSnapshot } from '../features/indicators.js';
import { isNum } from '../features/indicators.js';

/** Part 11.4 / 32.3 adaptive regime classification. Deterministic, explainable. */
export type Regime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'HIGH_VOLATILITY' | 'COMPRESSION' | 'UNKNOWN';
export interface RegimeResult { regime: Regime; confidence: 'NOT_CALIBRATED'; reasons: string[] }

export function classifyRegime(f: FeatureSnapshot | null): RegimeResult {
  if (!f || f.n < 60 || !isNum(f.adx14) || !isNum(f.ema50)) return { regime: 'UNKNOWN', confidence: 'NOT_CALIBRATED', reasons: ['insufficient history'] };
  const reasons: string[] = [];
  if (isNum(f.bbWidthPctile100) && f.bbWidthPctile100 >= 0.9 && f.atrPct > 0.02) { reasons.push(`BB width at ${(f.bbWidthPctile100 * 100).toFixed(0)}th pct, ATR ${(f.atrPct * 100).toFixed(2)}%`); return { regime: 'HIGH_VOLATILITY', confidence: 'NOT_CALIBRATED', reasons }; }
  if (f.adx14 >= 22 && f.ema20 > f.ema50 && f.ema50Slope10 > 0) { reasons.push(`ADX ${f.adx14.toFixed(1)} ≥ 22`, 'EMA20 > EMA50, EMA50 rising'); return { regime: 'TREND_UP', confidence: 'NOT_CALIBRATED', reasons }; }
  if (f.adx14 >= 22 && f.ema20 < f.ema50 && f.ema50Slope10 < 0) { reasons.push(`ADX ${f.adx14.toFixed(1)} ≥ 22`, 'EMA20 < EMA50, EMA50 falling'); return { regime: 'TREND_DOWN', confidence: 'NOT_CALIBRATED', reasons }; }
  if (isNum(f.bbWidthPctile100) && f.bbWidthPctile100 <= 0.15) { reasons.push(`BB width at ${(f.bbWidthPctile100 * 100).toFixed(0)}th pct (squeeze)`); return { regime: 'COMPRESSION', confidence: 'NOT_CALIBRATED', reasons }; }
  reasons.push(`ADX ${f.adx14.toFixed(1)}`, 'no directional alignment');
  return { regime: 'RANGE', confidence: 'NOT_CALIBRATED', reasons };
}
