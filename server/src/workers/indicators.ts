import type { FeatureSnapshot } from '../features/indicators.js';
import { isNum } from '../features/indicators.js';
import type { Interval } from '../market/types.js';

/**
 * Part 13.1 — 50 quantitative indicator specialists. Each owns exactly one indicator reading on one
 * timeframe and returns a normalized reading (-1 bearish … +1 bullish) with interpretation.
 * They do NOT vote in QCI (that would double-count price data, Part 16.4); they feed scoring + UI.
 */
export interface IndicatorReading { id: string; name: string; interval: Interval; value: number | null; signal: number | null; label: string }
type Spec = { key: keyof FeatureSnapshot; name: string; norm: (v: number, f: FeatureSnapshot) => number; fmt?: (v: number) => string };
const c = (x: number) => Math.max(-1, Math.min(1, x));
const SPECS: Spec[] = [
  { key: 'rsi14', name: 'RSI(14)', norm: (v) => c((v - 50) / 25) },
  { key: 'macdHist', name: 'MACD histogram', norm: (v, f) => c(v / (f.atr14 * 0.2 || 1)) },
  { key: 'adx14', name: 'ADX(14) directional', norm: (v, f) => c(((f.plusDI - f.minusDI) / 30) * Math.min(1, v / 25)) },
  { key: 'stochK14', name: 'Stochastic %K', norm: (v) => c((v - 50) / 40) },
  { key: 'cci20', name: 'CCI(20)', norm: (v) => c(v / 200) },
  { key: 'williamsR14', name: 'Williams %R', norm: (v) => c((v + 50) / 40) },
  { key: 'mfi14', name: 'Money Flow Index', norm: (v) => c((v - 50) / 30) },
  { key: 'roc10', name: 'Rate of Change(10)', norm: (v) => c(v / 0.05) },
  { key: 'bbPctB', name: 'Bollinger %B', norm: (v) => c((v - 0.5) * 2) },
  { key: 'zscore20', name: 'Z-score(20)', norm: (v) => c(v / 2) },
  { key: 'obvSlope10', name: 'OBV slope', norm: (v) => c(v) },
  { key: 'takerBuyRatio', name: 'Taker buy ratio', norm: (v) => c((v - 0.5) * 10) },
  { key: 'relVol20', name: 'Relative volume', norm: (v, f) => c((v - 1) * Math.sign(f.ret1 || 0)) },
  { key: 'ema50Slope10', name: 'EMA50 slope', norm: (v) => c(v / 0.01) },
  { key: 'efficiencyRatio10', name: 'Kaufman efficiency', norm: (v, f) => c(v * Math.sign(f.roc10 || 0) * 2) },
  { key: 'atrPct', name: 'ATR %', norm: () => 0, fmt: (v) => `${(v * 100).toFixed(2)}%` },
  { key: 'realizedVol20', name: 'Realized volatility', norm: () => 0, fmt: (v) => `${(v * 100).toFixed(2)}%` },
];
const EXTRA: { name: string; iv: Interval; read: (f: FeatureSnapshot) => number }[] = [
  { name: 'EMA20 vs EMA50 (1h)', iv: '1h', read: (f) => c((f.ema20 / f.ema50 - 1) / 0.01) },
  { name: 'EMA50 vs EMA200 (4h)', iv: '4h', read: (f) => c((f.ema50 / f.ema200 - 1) / 0.03) },
];
export const INDICATOR_SPECIALISTS = [
  ...(['15m', '1h', '4h'] as Interval[]).flatMap((iv) => SPECS.slice(0, iv === '15m' ? 14 : 17).map((s) => ({ id: '', iv, s }))),
].slice(0, 48);
INDICATOR_SPECIALISTS.forEach((x, i) => (x.id = `IND-${String(i + 1).padStart(2, '0')}`));
export const INDICATOR_COUNT = INDICATOR_SPECIALISTS.length + EXTRA.length;

export function readIndicators(f: Partial<Record<Interval, FeatureSnapshot | null>>): IndicatorReading[] {
  const out: IndicatorReading[] = INDICATOR_SPECIALISTS.map(({ id, iv, s }) => {
    const snap = f[iv]; const v = snap ? (snap[s.key] as number) : NaN;
    if (!snap || !isNum(v)) return { id, name: s.name, interval: iv, value: null, signal: null, label: 'unavailable' };
    const sig = s.norm(v, snap); const ok = Number.isFinite(sig) ? sig : null;
    return { id, name: s.name, interval: iv, value: v, signal: ok, label: s.fmt ? s.fmt(v) : ok == null ? '—' : ok > 0.25 ? 'bullish' : ok < -0.25 ? 'bearish' : 'neutral' };
  });
  EXTRA.forEach((e, i) => {
    const snap = f[e.iv]; const v = snap ? e.read(snap) : NaN;
    out.push({ id: `IND-${String(49 + i)}`, name: e.name, interval: e.iv, value: isNum(v) ? v : null, signal: isNum(v) ? v : null, label: !isNum(v) ? 'unavailable' : v > 0.25 ? 'bullish' : v < -0.25 ? 'bearish' : 'neutral' });
  });
  return out;
}
