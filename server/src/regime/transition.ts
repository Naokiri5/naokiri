/**
 * Regime transition gate (BrainOS Omega connectivity and adaptive reliability, section 8).
 *
 * classifyRegime labels one closed candle. A strategy that fits "TREND_UP" should not enter on the first candle that
 * happens to read TREND_UP after a range, or while the label keeps flipping: those are the moments its assumptions are
 * least likely to hold. This adds hysteresis on top of the existing classifier, using the feature engine's recent
 * closed-candle snapshots:
 *  - STABLE: the last REGIME_CONFIRM_BARS candles share one known regime and the lookback has fewer than
 *    REGIME_MAX_FLIPS changes; entries may be evaluated as before.
 *  - TRANSITIONING: the regime changed within the confirmation window; entries wait until it is confirmed.
 *  - UNSTABLE: the regime keeps flipping across the lookback; entries wait.
 *  - UNKNOWN: too little history or an unknown regime; fail closed.
 * It only restricts entries. It never loosens a risk limit and never touches exits or protection.
 */
import type { FeatureSnapshot } from '../features/indicators.js';
import { classifyRegime, type Regime } from './regime.js';

export type RegimeStability = 'STABLE' | 'TRANSITIONING' | 'UNSTABLE' | 'UNKNOWN';
export const REGIME_CONFIRM_BARS = 3;
export const REGIME_LOOKBACK_BARS = 12;
export const REGIME_MAX_FLIPS = 4;

export interface RegimeStabilityResult {
  stability: RegimeStability;
  regime: Regime;
  /** Consecutive closed candles (newest backwards) with the current regime. */
  barsInRegime: number;
  /** Regime changes between consecutive candles in the lookback. */
  flips: number;
  reason: string;
}

export function assessRegimeStability(history: readonly FeatureSnapshot[]): RegimeStabilityResult {
  const window = history.slice(-REGIME_LOOKBACK_BARS);
  const regimes = window.map((f) => classifyRegime(f).regime);
  const regime = regimes.at(-1) ?? 'UNKNOWN';
  let barsInRegime = 0;
  for (let i = regimes.length - 1; i >= 0 && regimes[i] === regime; i--) barsInRegime++;
  let flips = 0;
  for (let i = 1; i < regimes.length; i++) if (regimes[i] !== regimes[i - 1]) flips++;
  const out = (stability: RegimeStability, reason: string): RegimeStabilityResult => ({ stability, regime, barsInRegime, flips, reason });

  if (regimes.length < REGIME_CONFIRM_BARS) return out('UNKNOWN', `only ${regimes.length} closed candle(s) of regime history`);
  if (regime === 'UNKNOWN') return out('UNKNOWN', 'current regime is unknown');
  if (window.some((f, i) => i > 0 && !(f.t > window[i - 1].t))) return out('UNKNOWN', 'regime history is not in candle order');
  if (barsInRegime < REGIME_CONFIRM_BARS) return out('TRANSITIONING', `${regime} for ${barsInRegime} of ${REGIME_CONFIRM_BARS} candles needed to confirm`);
  if (flips >= REGIME_MAX_FLIPS) return out('UNSTABLE', `${flips} regime changes in the last ${regimes.length} candles`);
  return out('STABLE', `${regime} confirmed for ${barsInRegime} candles`);
}
