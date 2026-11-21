import type { Candle } from '../market/types.js';

/** OHLCV approximation using typical price weighted by base volume. */
export function candleVwap(candles: readonly Candle[]): number {
  let weighted = 0, volume = 0;
  for (const candle of candles) {
    weighted += ((candle.h + candle.l + candle.c) / 3) * candle.v;
    volume += candle.v;
  }
  return volume > 0 ? weighted / volume : NaN;
}

/**
 * Incremental feature engine (Part 33.5). State is updated once per *closed* candle in O(window);
 * no full recomputation per tick. Every snapshot is deterministic for a given candle sequence.
 */
export interface FeatureSnapshot {
  t: number; n: number; close: number;
  ema9: number; ema20: number; ema50: number; ema200: number;
  /** Research-only PDF slot compatibility metrics. */
  ema21?: number; ema55?: number; macdHistSlope?: number;
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

/** Values calculated from the latest ingested closed candle for research display. */
export interface AdvancedIndicatorSnapshot {
  candleOpenAt: number;
  wma20: number | null;
  hma20: number | null;
  keltner: { middle: number; lower: number; upper: number } | null;
  ichimoku: {
    conversion9: number | null;
    base26: number | null;
    leadingA: number | null;
    leadingB52: number | null;
    laggingClose: number;
    displacementBars: 26;
  };
  parabolicSar: { value: number; trend: 'UP' | 'DOWN' } | null;
  parkinson20: number | null;
  garmanKlass20: number | null;
}

type SarState = { value: number; uptrend: boolean; extreme: number; acceleration: number };

class Ema { v = NaN; private k: number; private seed: number[] = []; constructor(private p: number) { this.k = 2 / (p + 1); }
  /** A non-finite input is skipped: one NaN would otherwise poison the average permanently. */
  update(x: number) { if (!Number.isFinite(x)) return this.v; if (Number.isNaN(this.v)) { this.seed.push(x); if (this.seed.length === this.p) { this.v = this.seed.reduce((a, b) => a + b, 0) / this.p; this.seed = []; } } else this.v = x * this.k + this.v * (1 - this.k); return this.v; } }
class Wilder { v = NaN; private seed: number[] = []; constructor(private p: number) {}
  update(x: number) { if (!Number.isFinite(x)) return this.v; if (Number.isNaN(this.v)) { this.seed.push(x); if (this.seed.length === this.p) { this.v = this.seed.reduce((a, b) => a + b, 0) / this.p; this.seed = []; } } else this.v = (this.v * (this.p - 1) + x) / this.p; return this.v; } }

export class FeatureEngine {
  readonly candles: Candle[] = [];
  private maxKeep = 400;
  private e9 = new Ema(9); private e20 = new Ema(20); private e50 = new Ema(50); private e200 = new Ema(200);
  private e21 = new Ema(21); private e55 = new Ema(55); // research-only: no second feature engine
  private e12 = new Ema(12); private e26 = new Ema(26); private sig = new Ema(9);
  private gain = new Wilder(14); private loss = new Wilder(14); private atr = new Wilder(14);
  private pdm = new Wilder(14); private mdm = new Wilder(14); private adx = new Wilder(14);
  private obv = 0; private obvHist: number[] = []; private ema20Hist: number[] = []; private ema50Hist: number[] = []; private bbwHist: number[] = [];
  private sar: SarState | null = null;
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
    this.e21.update(c.c); this.e55.update(c.c);
    const m = this.e12.update(c.c) - this.e26.update(c.c);
    if (!Number.isNaN(m)) this.sig.update(m);
    if (prev) {
      this.sar = nextSar(this.sar, c, prev, this.candles.at(-3) ?? prev);
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

  get research(): AdvancedIndicatorSnapshot | null {
    const last = this.last;
    if (!last) return null;

    // HMA(20) = WMA(4) of 2×WMA(10) − WMA(20). The first result takes 23 closes.
    const closes = this.candles.slice(-23).map(candle => candle.c);
    const wma20 = closes.length >= 20 ? finiteOrNull(weightedAverage(closes, 20)) : null;
    let hma20: number | null = null;
    if (closes.length === 23) {
      const hullInputs = Array.from({ length: 4 }, (_, i) => {
        const end = 20 + i;
        const full = end === 23 && wma20 !== null ? wma20 : weightedAverage(closes, 20, end);
        return 2 * weightedAverage(closes, 10, end) - full;
      });
      hma20 = finiteOrNull(weightedAverage(hullInputs, 4));
    }

    const middle = last.ema20;
    const width = 2 * last.atr14;
    const lower = middle - width;
    const upper = middle + width;
    const keltner = Number.isFinite(lower) && Number.isFinite(upper) ? { middle, lower, upper } : null;
    const conversion9 = midrange(this.candles, 9);
    const base26 = midrange(this.candles, 26);

    return {
      candleOpenAt: last.t,
      wma20,
      hma20,
      keltner,
      ichimoku: {
        conversion9,
        base26,
        leadingA: conversion9 !== null && base26 !== null ? conversion9 / 2 + base26 / 2 : null,
        leadingB52: midrange(this.candles, 52),
        laggingClose: last.close,
        displacementBars: 26,
      },
      parabolicSar: this.sar && Number.isFinite(this.sar.value)
        ? { value: this.sar.value, trend: this.sar.uptrend ? 'UP' : 'DOWN' }
        : null,
      ...ohlcVolatility(this.candles),
    };
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
    const piv = win(11); const swingHigh = piv.length ? Math.max(...piv.slice(0, -1).map((x) => x.h)) : NaN; const swingLow = piv.length ? Math.min(...piv.slice(0, -1).map((x) => x.l)) : NaN;
    const w11 = win(11); const er = w11.length > 1 ? Math.abs(w11[w11.length - 1].c - w11[0].c) / w11.slice(1).reduce((s, x, i) => s + Math.abs(x.c - w11[i].c), 0) : NaN;
    const pdi = (100 * this.pdm.v) / this.atr.v, mdi = (100 * this.mdm.v) / this.atr.v;
    const rs = this.loss.v === 0 ? (this.gain.v === 0 ? 1 : Infinity) : this.gain.v / this.loss.v; // flat series ⇒ RSI 50, not 100
    return {
      t: c.t, n, close: c.c,
      ema9: this.e9.v, ema20: this.e20.v, ema50: this.e50.v, ema200: this.e200.v,
      ema21: this.e21.v, ema55: this.e55.v,
      macdHistSlope: this.last && Number.isFinite(this.last.macdHist) && Number.isFinite(this.e12.v - this.e26.v - this.sig.v)
        ? this.e12.v - this.e26.v - this.sig.v - this.last.macdHist : NaN,
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
      vwap20: candleVwap(win(20)), zscore20: sd ? (c.c - mid) / sd : NaN, swingHigh, swingLow,
      ema20Slope5: this.ema20Hist.length >= 6 ? this.ema20Hist[5] / this.ema20Hist[0] - 1 : NaN,
      ema50Slope10: this.ema50Hist.length >= 11 ? this.ema50Hist[10] / this.ema50Hist[0] - 1 : NaN,
      bbWidthPctile100: NaN, efficiencyRatio10: er,
    };
  }
}
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function weightedAverage(values: readonly number[], period: number, end = values.length): number {
  let weighted = 0;
  for (let weight = 1; weight <= period; weight++) {
    weighted += weight * values[end - period + weight - 1];
  }
  return weighted / (period * (period + 1) / 2);
}

function midrange(candles: readonly Candle[], period: number): number | null {
  if (candles.length < period) return null;
  let high = -Infinity, low = Infinity;
  for (let i = candles.length - period; i < candles.length; i++) {
    high = Math.max(high, candles[i].h);
    low = Math.min(low, candles[i].l);
  }
  return finiteOrNull(high / 2 + low / 2);
}

function nextSar(state: SarState | null, candle: Candle, previous: Candle, beforePrevious: Candle): SarState {
  const step = 0.02;
  const max = 0.2;
  // Seed direction from the second close and extremes from the first two bars.
  if (!state) {
    const uptrend = candle.c >= previous.c;
    return {
      uptrend,
      value: uptrend ? Math.min(candle.l, previous.l) : Math.max(candle.h, previous.h),
      extreme: uptrend ? Math.max(candle.h, previous.h) : Math.min(candle.l, previous.l),
      acceleration: step,
    };
  }

  const { uptrend, extreme, acceleration } = state;
  const candidate = state.value + acceleration * (extreme - state.value);
  const value = uptrend
    ? Math.min(candidate, previous.l, beforePrevious.l)
    : Math.max(candidate, previous.h, beforePrevious.h);
  const crossed = uptrend ? candle.l < value : candle.h > value;
  if (crossed) {
    return {
      uptrend: !uptrend,
      value: uptrend ? Math.max(extreme, candle.h, previous.h) : Math.min(extreme, candle.l, previous.l),
      extreme: uptrend ? candle.l : candle.h,
      acceleration: step,
    };
  }

  const currentExtreme = uptrend ? candle.h : candle.l;
  const extended = uptrend ? currentExtreme > extreme : currentExtreme < extreme;
  return {
    uptrend,
    value,
    extreme: extended ? currentExtreme : extreme,
    acceleration: extended ? Math.min(max, acceleration + step) : acceleration,
  };
}

function ohlcVolatility(candles: readonly Candle[]) {
  const period = 20;
  if (candles.length < period) return { parkinson20: null, garmanKlass20: null };
  let rangeSquared = 0, bodySquared = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const { h, l, c, o } = candles[i];
    rangeSquared += (Math.log(h) - Math.log(l)) ** 2;
    bodySquared += (Math.log(c) - Math.log(o)) ** 2;
  }
  // Per-bar log-return volatility fractions. Both estimators exclude inter-bar gaps.
  return {
    parkinson20: finiteOrNull(Math.sqrt(rangeSquared / (period * 4 * Math.LN2))),
    garmanKlass20: finiteOrNull(Math.sqrt(Math.max(0, 0.5 * rangeSquared - (2 * Math.LN2 - 1) * bodySquared) / period)),
  };
}

function avg(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function sdev(xs: number[]) { if (xs.length < 2) return NaN; const m = avg(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); }
export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * MIA 5 PDF 97-slot compatibility projection — read-only research.
 * The canonical FeatureEngine remains the only source for indicator values.
 * Unavailable slots stay null; no second vector calculator or trading authority exists.
 * Original PDF: docs/engineering/sources/MIA5_SWARM_MONOLITH_104P_PDF_VERBATIM.txt
 */
export const MIA5_SWARM_FEATURE_SLOTS = [
  'EMA_9',
  'EMA_21',
  'EMA_55',
  'DONCHIAN_20_HIGH',
  'DONCHIAN_20_LOW',
  'SUPERTREND_DIR',
  'MACD_HIST',
  'MACD_HIST_SLOPE',
  'ADX_14',
  'PLUS_DI_14',
  'MINUS_DI_14',
  'HTF_BIAS',
  'SESSION_VWAP',
  'VWAP_SLOPE',
  'OLS_SLOPE_BPS',
  'OLS_R_SQUARED',
  'ICHIMOKU_TENKAN',
  'ICHIMOKU_KIJUN',
  'ICHIMOKU_KUMO_TOP',
  'EQUITIES_ORB_HIGH',
  'EQUITIES_ORB_LOW',
  'RELATIVE_STRENGTH_Z',
  'SWING_STRUCTURE_CODE',
  'VWAP_SIGMA_DIST',
  'CONNORS_RSI_2',
  'BB_PERCENT_B',
  'RETURN_Z_SCORE',
  'RSI14_BULL_DIV',
  'RSI14_BEAR_DIV',
  'KELTNER_POS',
  'FVG_EQUILIBRIUM_SIGNAL',
  'SWEEP_RECLAIM_SIGNAL',
  'PAIRS_RESIDUAL_Z',
  'POC_DIST_ATR',
  'MICROPRICE_SKEW_BPS',
  'QUEUE_DEPLETION_ASYM',
  'SPREAD_COMPRESSION_RATIO',
  'BID_WALL_DEPTH_RATIO',
  'WALL_ABSORPTION_SIGNAL',
  'BOOK_RELOAD_SKEW',
  'BOOK_SLOPE_CONVEXITY_DIFF',
  'ICEBERG_RELOAD_SIDE',
  'CANCEL_TO_FILL_RATIO',
  'LEAD_VENUE_MID_DIFF_BPS',
  'OFI_L5_ACCEL',
  'AGGRESSOR_SWEEP_TICKS',
  'BLOCK_PRINT_DELTA_Z',
  'FOOTPRINT_IMBALANCE_STACK',
  'TAPE_TPS_RATIO',
  'CLIMAX_EXHAUSTION_FLAG',
  'TICK_RULE_BUY_RATIO',
  'INTRABAR_DELTA_FLIP',
  'SOL_DEX_NET_FLOW_RATIO',
  'PERP_SPOT_BASIS_APR_PCT',
  'TOP_VS_RETAIL_LS_DIV',
  'LIQ_CLUSTER_MAGNET_DIR',
  'FUNDING_DELTA_1H',
  'SPOT_LEADS_PERP_CVD',
  'TTM_SQUEEZE_RELEASE',
  'ATR_EXPANSION_RATIO',
  'ATR_PERCENTILE_RANK',
  'IV_RV_SPREAD_PCT',
  'PARKINSON_EFFICIENCY',
  'GARCH_COND_VOL_SLOPE',
  'POST_OPEN_VOL_STABLE',
  'TAIL_KURTOSIS_DROP',
  'SPL_MINT_REVOKED',
  'SPL_FREEZE_REVOKED',
  'TOKEN2022_CLEAN_EXT',
  'LP_LOCKED_PCT',
  'HOLDER_GINI_COEFF',
  'LP_TO_FDV_RATIO',
  'JUPITER_SIM_TAX_BPS',
  'DEPLOYER_HISTORY_SCORE',
  'POST_GRADUATION_HOLD',
  'LP_DELTA_15M_PCT',
  'SMART_WALLET_NET_Z',
  'FRESH_WHALE_BUY_COUNT',
  'UNIQUE_MAKER_GROWTH_RATIO',
  'CEX_NET_FLOW_Z',
  'DARK_POOL_BLOCK_DELTA_Z',
  'INSIDER_CLUSTER_COUNT',
  'LTH_ACCUM_FLAG',
  'MM_INVENTORY_SKEW',
  'BTC_MACRO_IMPULSE_Z',
  'SOL_BTC_ROTATION_Z',
  'EQUITY_RISK_ON_BREADTH',
  'DXY_INVERSE_Z',
  'PEAK_SESSION_ACTIVE',
  'SECTOR_ROTATION_RANK',
  'COINBASE_PREMIUM_BPS',
  'STABLECOIN_MINT_INFLOW_Z',
  'SPREAD_VS_30M_MEDIAN_MULT',
  'EXTENSION_FROM_EMA_ATR',
  'CROSS_ASSET_CONTAGION_CORR',
  'FRICTION_TO_EDGE_RATIO',
  'ORACLE_DISAGREEMENT_BPS',
] as const;

export interface Mia5SwarmResearchProjection {
  schemaVersion: 'mia5-pdf-97-research-v1';
  totalSlots: 97;
  sourceCandleOpenAt: number | null;
  sourceTimeframeValid: boolean;
  availableCount: number;
  availableSlotIds: number[];
  values: (number | null)[];
  missingCount: number;
  tradeEligible: false;
  status: 'UNVERIFIED' | 'PARTIAL';
}

/** A valid timeframe is required. Valid data is NOT a trading permission or calibrated vote. */
export function projectMia5SwarmResearchFeatures(
  snapshot: FeatureSnapshot | null,
  advanced: AdvancedIndicatorSnapshot | null,
  timeframeValid: boolean,
): Mia5SwarmResearchProjection {
  const values: (number | null)[] = Array.from({ length: MIA5_SWARM_FEATURE_SLOTS.length }, () => null);
  const allowed = timeframeValid && snapshot != null && Number.isFinite(snapshot.t);
  if (allowed) {
    const f = snapshot!;
    const set = (id: number, value: number | null | undefined) => {
      if (value != null && Number.isFinite(value)) values[id] = value;
    };
    // Slot IDs match the PDF. Existing EMA20/EMA50 are not substitutes for EMA21/EMA55.
    set(0, f.ema9);
    set(1, f.ema21);
    set(2, f.ema55);
    set(6, f.macdHist);
    set(7, f.macdHistSlope);
    set(8, f.adx14);
    set(9, f.plusDI);
    set(10, f.minusDI);
    set(25, f.bbPctB);
    if (advanced && advanced.candleOpenAt === f.t) {
      set(16, advanced.ichimoku.conversion9);
      set(17, advanced.ichimoku.base26);
      // The PDF's cloud-top slot is a projected series, not a current-time value.
    }
    if (Number.isFinite(f.atr14) && f.atr14 > 0 && Number.isFinite(f.ema20)) {
      set(29, (f.close - f.ema20) / (2.25 * f.atr14)); // PDF KELTNER_POS
    }
    if (Number.isFinite(f.atr14) && f.atr14 > 0 && f.ema21 != null && Number.isFinite(f.ema21)) {
      set(93, (f.close - f.ema21) / f.atr14); // PDF EXTENSION_FROM_EMA_ATR
    }
    // Existing Donchian snapshots exclude the current bar. PDF slots include it, so do
    // not silently relabel existing donchHigh20/Low20 as matching the PDF semantics.
    // All missing L2, Solana, derivatives, oracle and macro inputs remain unknown.
  }
  const availableSlotIds = values.flatMap((value, id) => value === null ? [] : [id]);
  return {
    schemaVersion: 'mia5-pdf-97-research-v1',
    totalSlots: 97,
    sourceCandleOpenAt: allowed ? snapshot!.t : null,
    sourceTimeframeValid: !!allowed,
    availableCount: availableSlotIds.length,
    availableSlotIds,
    values,
    missingCount: 97 - availableSlotIds.length,
    tradeEligible: false,
    status: allowed ? 'PARTIAL' : 'UNVERIFIED',
  };
}
