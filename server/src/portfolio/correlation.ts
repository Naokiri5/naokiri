import { market } from '../market/store.js';
import { pearsonCorrelation } from '../core/util.js';
/** Pearson correlation of the last N 1h log returns. null ⇒ unknown (callers must be conservative). */
export function correlation(a: string, b: string, n = 100): number | null {
  if (a === b) return 1;
  const ca = market.deep.get(a)?.engines['1h'].candles; const cb = market.deep.get(b)?.engines['1h'].candles;
  if (!ca || !cb) return null;
  const mb = new Map(cb.map((c) => [c.t, c.c]));
  const pairs: [number, number][] = [];
  for (let i = 1; i < ca.length; i++) { const x0 = mb.get(ca[i - 1].t), x1 = mb.get(ca[i].t); if (x0 && x1) pairs.push([Math.log(ca[i].c / ca[i - 1].c), Math.log(x1 / x0)]); }
  const s = pairs.slice(-n); if (s.length < 30) return null;
  return pearsonCorrelation(s);
}
