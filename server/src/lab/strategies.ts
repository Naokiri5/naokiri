import type { FeatureSnapshot } from '../features/indicators.js';
import { isNum } from '../features/indicators.js';
import type { Interval } from '../market/types.js';
import type { Regime } from '../regime/regime.js';

/**
 * Strategy capsules (Part 33.8): pure, versioned functions shared by live scanning AND backtests,
 * so the research result and the running logic cannot diverge. Spot venue ⇒ long-only.
 */
export interface Signal {
  direction: 'long';
  entryRef: number; stop: number;
  targets: { r: number; fraction: number }[];
  maxHoldBars: number; trailAfterR: number | null;
  trigger: string; invalidation: string; reasons: string[];
}
export interface StrategyDef {
  id: string; name: string; version: string; interval: Interval; suitableRegimes: Regime[];
  description: string;
  generate(f: FeatureSnapshot): Signal | null;
}

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'trend_pullback', name: 'Trend Pullback', version: '1.0.0', interval: '1h', suitableRegimes: ['TREND_UP'],
    description: 'Buy a pullback to the 20 EMA inside an established uptrend (EMA20>EMA50>EMA200, ADX≥20).',
    generate(f) {
      if (![f.ema20, f.ema50, f.ema200, f.adx14, f.atr14, f.rsi14].every(isNum)) return null;
      if (!(f.ema20 > f.ema50 && f.ema50 > f.ema200 && f.adx14 >= 20)) return null;
      if (Math.abs(f.close - f.ema20) > 0.6 * f.atr14 || f.close < f.ema50) return null;
      if (f.rsi14 < 40 || f.rsi14 > 62) return null;
      const stop = Math.min(f.close - 2 * f.atr14, f.swingLow);
      if (!(stop < f.close) || (f.close - stop) / f.close > 0.08) return null;
      return { direction: 'long', entryRef: f.close, stop, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1,
        trigger: `1h close within 0.6 ATR of EMA20 (${f.ema20.toPrecision(6)}) with RSI ${f.rsi14.toFixed(1)}`,
        invalidation: `1h close below ${stop.toPrecision(6)} (min of swing low / 2×ATR)`,
        reasons: ['EMA20>EMA50>EMA200', `ADX ${f.adx14.toFixed(1)}`, 'pullback to EMA20'] };
    },
  },
  {
    id: 'donchian_breakout', name: 'Volume-Confirmed Breakout', version: '1.0.0', interval: '1h', suitableRegimes: ['TREND_UP', 'COMPRESSION', 'RANGE'],
    description: 'Close above the 20-bar Donchian high with relative volume ≥1.5 while EMA50>EMA200.',
    generate(f) {
      if (![f.donchHigh20, f.relVol20, f.ema50, f.ema200, f.atr14].every(isNum)) return null;
      if (!(f.close > f.donchHigh20 && f.relVol20 >= 1.5 && f.ema50 > f.ema200)) return null;
      if ((f.close - f.donchHigh20) > 1.0 * f.atr14) return null; // avoid chasing extended moves
      const stop = f.close - 2.5 * f.atr14;
      return { direction: 'long', entryRef: f.close, stop, targets: [{ r: 2, fraction: 0.5 }, { r: 4, fraction: 0.5 }], maxHoldBars: 72, trailAfterR: 1.5,
        trigger: `1h close ${f.close.toPrecision(6)} > 20-bar high ${f.donchHigh20.toPrecision(6)} on ${f.relVol20.toFixed(2)}× volume`,
        invalidation: `1h close back below ${stop.toPrecision(6)} (2.5×ATR)`,
        reasons: ['Donchian breakout', `relative volume ${f.relVol20.toFixed(2)}×`, 'EMA50>EMA200'] };
    },
  },
  {
    id: 'range_reversion', name: 'Range Mean Reversion', version: '1.0.0', interval: '1h', suitableRegimes: ['RANGE'],
    description: 'In a non-trending range (ADX<20), buy closes below the lower Bollinger band with RSI<32; target the mid band.',
    generate(f) {
      if (![f.bbLower, f.bbMid, f.rsi14, f.adx14, f.atr14].every(isNum)) return null;
      if (!(f.adx14 < 20 && f.close < f.bbLower && f.rsi14 < 32)) return null;
      const stop = f.close - 1.5 * f.atr14;
      const r = (f.bbMid - f.close) / (f.close - stop);
      if (!(r >= 1)) return null;
      return { direction: 'long', entryRef: f.close, stop, targets: [{ r: Math.min(r, 2.5), fraction: 1 }], maxHoldBars: 24, trailAfterR: null,
        trigger: `1h close below lower band ${f.bbLower.toPrecision(6)} with RSI ${f.rsi14.toFixed(1)}`,
        invalidation: `1h close below ${stop.toPrecision(6)} (1.5×ATR) or ADX rising above 25`,
        reasons: ['ADX<20 (range)', 'close < lower Bollinger band', `RSI ${f.rsi14.toFixed(1)}`] };
    },
  },
];
export const strategyById = (id: string) => STRATEGIES.find((s) => s.id === id);
