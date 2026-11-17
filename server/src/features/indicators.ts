import type { Candle } from '../market/types.js';

/**
 * Incremental feature engine (Part 33.5). State is updated once per *closed* candle in O(window);
 * no full recomputation per tick. Every snapshot is deterministic for a given candle sequence.
 */
export interface FeatureSnapshot {
  t: number; n: number; close: number;
  ema9: number; ema20: number; ema50: number; ema200: number;
  rsi14: number; atr14: number; atrPct: number;
  macd: number; macdSignal: number; macdHist: number;
  adx14: number; plusDI: number; minusDI: number;
  bbMid: number; bbUpper: number; bbLower: number; bbWidth: number; bbPctB: number;
  donchHigh20: number; donchLow20: number; donchHigh55: number; donchLow55: number;
  obv: number; obvSlope10: number;
  volZ20: number; relVol20: number; takerBuyRatio: number;
  ret1: number; ret5: number; ret20: number; roc10: number;
  realizedVol20: number; stochK14: number; williamsR14: number; cci20: number; mfi14: number;
  vwap20: number; zscore20: number; swingHigh: number; swingLow: number;
  ema20Slope5: number; ema50Slope10: number; bbWidthPctile100: number; efficiencyRatio10: number;
}

class Ema { v = NaN; private k: number; private seed: number[] = []; constructor(private p: number) { this.k = 2 / (p + 1); }
  /** A non-finite input is skipped: one NaN would otherwise poison the average permanently. */
  update(x: number) { if (!Number.isFinite(x)) return this.v; if (Number.isNaN(this.v)) { this.seed.push(x); if (this.seed.length === this.p) { this.v = this.seed.reduce((a, b) => a + b, 0) / this.p; this.seed = []; } } else this.v = x * this.k + this.v * (1 - this.k); return this.v; } }
class Wilder { v = NaN; private seed: number[] = []; constructor(private p: number) {}
  update(x: number) { if (!Number.isFinite(x)) return this.v; if (Number.isNaN(this.v)) { this.seed.push(x); if (this.seed.length === this.p) { this.v = this.seed.reduce((a, b) => a + b, 0) / this.p; this.seed = []; } } else this.v = (this.v * (this.p - 1) + x) / this.p; return this.v; } }

export class FeatureEngine {
  readonly candles: Candle[] = [];
  private maxKeep = 400;
  private e9 = new Ema(9); private e20 = new Ema(20); private e50 = new Ema(50); private e200 = new Ema(200);
  private e12 = new Ema(12); private e26 = new Ema(26); private sig = new Ema(9);
  private gain = new Wilder(14); private loss = new Wilder(14); private atr = new Wilder(14);
  private pdm = new Wilder(14); private mdm = new Wilder(14); private adx = new Wilder(14);
  private obv = 0; private obvHist: number[] = []; private ema20Hist: number[] = []; private ema50Hist: number[] = []; private bbwHist: number[] = [];
  last: FeatureSnapshot | null = null;
  lastT = -1;

  /** Feed candles (any order, duplicates allowed). Only strictly newer closed candles are processed. */
  ingest(cs: Candle[]): number {
    let added = 0;
    for (const c of [...cs].sort((a, b) => a.t - b.t)) {
      if (c.t <= this.lastT) continue;
      this.step(c); added++;
    }
    return added;
  }

  private step(c: Candle) {
    const prev = this.candles[this.candles.length - 1];
    this.candles.push(c); this.lastT = c.t;
    if (this.candles.length > this.maxKeep) this.candles.shift();
    this.e9.update(c.c); this.e20.update(c.c); this.e50.update(c.c); this.e200.update(c.c);
    const m = this.e12.update(c.c) - this.e26.update(c.c);
    if (!Number.isNaN(m)) this.sig.update(m);
    if (prev) {
      const d = c.c - prev.c;
      this.gain.update(Math.max(d, 0)); this.loss.update(Math.max(-d, 0));
      const tr = Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
      this.atr.update(tr);
      const up = c.h - prev.h, dn = prev.l - c.l;
      this.pdm.update(up > dn && up > 0 ? up : 0); this.mdm.update(dn > up && dn > 0 ? dn : 0);
      if (this.atr.v > 0 && !Number.isNaN(this.pdm.v)) {
        const pdi = (100 * this.pdm.v) / this.atr.v, mdi = (100 * this.mdm.v) / this.atr.v;
        const dx = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
        this.adx.update(dx);
      }
      this.obv += d > 0 ? c.v : d < 0 ? -c.v : 0;
    }
    this.obvHist.push(this.obv); if (this.obvHist.length > 20) this.obvHist.shift();
    if (!Number.isNaN(this.e20.v)) { this.ema20Hist.push(this.e20.v); if (this.ema20Hist.length > 6) this.ema20Hist.shift(); }
    if (!Number.isNaN(this.e50.v)) { this.ema50Hist.push(this.e50.v); if (this.ema50Hist.length > 11) this.ema50Hist.shift(); }
    this.last = this.snapshot();
    if (!Number.isNaN(this.last.bbWidth)) { this.bbwHist.push(this.last.bbWidth); if (this.bbwHist.length > 100) this.bbwHist.shift(); }
    this.last.bbWidthPctile100 = this.bbwHist.length >= 20 ? this.bbwHist.filter((x) => x <= this.last!.bbWidth).length / this.bbwHist.length : NaN;
  }

  private snapshot(): FeatureSnapshot {
    const cs = this.candles; const n = cs.length; const c = cs[n - 1];
    const win = (k: number) => cs.slice(Math.max(0, n - k));
    const closes20 = win(20).map((x) => x.c);
    const mid = avg(closes20); const sd = sdev(closes20);
    const bbU = mid + 2 * sd, bbL = mid - 2 * sd;
    const hi = (k: number) => Math.max(...win(k).map((x) => x.h)); const lo = (k: number) => Math.min(...win(k).map((x) => x.l));
    const vols = win(21).slice(0, -1).map((x) => x.v);
    const vm = avg(vols), vs = sdev(vols);
    const back = (k: number) => (n > k ? cs[n - 1 - k].c : NaN);
    const logr = win(21).map((x, i, a) => (i ? Math.log(x.c / a[i - 1].c) : NaN)).slice(1);
    const h14 = hi(14), l14 = lo(14);
    const tp = win(20).map((x) => (x.h + x.l + x.c) / 3); const tpm = avg(tp); const md = avg(tp.map((x) => Math.abs(x - tpm)));
    // MFI 14
    let pos = 0, neg = 0; const w15 = win(15);
    for (let i = 1; i < w15.length; i++) { const a = (w15[i].h + w15[i].l + w15[i].c) / 3, b = (w15[i - 1].h + w15[i - 1].l + w15[i - 1].c) / 3; if (a > b) pos += a * w15[i].v; else if (a < b) neg += a * w15[i].v; }
    const w20 = win(20); const pv = w20.reduce((s, x) => s + ((x.h + x.l + x.c) / 3) * x.v, 0); const vv = w20.reduce((s, x) => s + x.v, 0);
    const piv = win(11); const swingHigh = piv.length ? Math.max(...piv.slice(0, -1).map((x) => x.h)) : NaN; const swingLow = piv.length ? Math.min(...piv.slice(0, -1).map((x) => x.l)) : NaN;
    const w11 = win(11); const er = w11.length > 1 ? Math.abs(w11[w11.length - 1].c - w11[0].c) / w11.slice(1).reduce((s, x, i) => s + Math.abs(x.c - w11[i].c), 0) : NaN;
    const pdi = (100 * this.pdm.v) / this.atr.v, mdi = (100 * this.mdm.v) / this.atr.v;
    const rs = this.loss.v === 0 ? (this.gain.v === 0 ? 1 : Infinity) : this.gain.v / this.loss.v; // flat series ⇒ RSI 50, not 100
    return {
      t: c.t, n, close: c.c,
      ema9: this.e9.v, ema20: this.e20.v, ema50: this.e50.v, ema200: this.e200.v,
      rsi14: Number.isNaN(this.gain.v) ? NaN : 100 - 100 / (1 + rs), atr14: this.atr.v, atrPct: this.atr.v / c.c,
      macd: this.e12.v - this.e26.v, macdSignal: this.sig.v, macdHist: this.e12.v - this.e26.v - this.sig.v,
      adx14: this.adx.v, plusDI: pdi, minusDI: mdi,
      bbMid: mid, bbUpper: bbU, bbLower: bbL, bbWidth: closes20.length >= 20 ? (bbU - bbL) / mid : NaN, bbPctB: (c.c - bbL) / (bbU - bbL),
      donchHigh20: n > 20 ? Math.max(...cs.slice(n - 21, n - 1).map((x) => x.h)) : NaN, donchLow20: n > 20 ? Math.min(...cs.slice(n - 21, n - 1).map((x) => x.l)) : NaN,
      donchHigh55: n > 55 ? Math.max(...cs.slice(n - 56, n - 1).map((x) => x.h)) : NaN, donchLow55: n > 55 ? Math.min(...cs.slice(n - 56, n - 1).map((x) => x.l)) : NaN,
      obv: this.obv, obvSlope10: this.obvHist.length > 10 ? (this.obvHist[this.obvHist.length - 1] - this.obvHist[this.obvHist.length - 11]) / (Math.abs(vm) * 10 || 1) : NaN,
      volZ20: vols.length >= 10 && vs > 0 ? (c.v - vm) / vs : NaN, relVol20: vm > 0 ? c.v / vm : NaN,
      takerBuyRatio: c.tbv != null && c.v > 0 ? c.tbv / c.v : NaN,
      ret1: back(1) ? c.c / back(1) - 1 : NaN, ret5: c.c / back(5) - 1, ret20: c.c / back(20) - 1, roc10: c.c / back(10) - 1,
      realizedVol20: sdev(logr), stochK14: h14 === l14 ? 50 : (100 * (c.c - l14)) / (h14 - l14), williamsR14: h14 === l14 ? -50 : (-100 * (h14 - c.c)) / (h14 - l14),
      cci20: md ? (tp[tp.length - 1] - tpm) / (0.015 * md) : NaN, mfi14: neg === 0 ? (pos ? 100 : 50) : 100 - 100 / (1 + pos / neg),
      vwap20: vv ? pv / vv : NaN, zscore20: sd ? (c.c - mid) / sd : NaN, swingHigh, swingLow,
      ema20Slope5: this.ema20Hist.length >= 6 ? this.ema20Hist[5] / this.ema20Hist[0] - 1 : NaN,
      ema50Slope10: this.ema50Hist.length >= 11 ? this.ema50Hist[10] / this.ema50Hist[0] - 1 : NaN,
      bbWidthPctile100: NaN, efficiencyRatio10: er,
    };
  }
}
function avg(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function sdev(xs: number[]) { if (xs.length < 2) return NaN; const m = avg(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); }
export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
