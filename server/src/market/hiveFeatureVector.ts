/**
 * MIA5 97-slot rolling market feature projection (source specification feature 01).
 *
 * This is an observational, source-validated feature feed. It does not create
 * workers, decide positions, bypass the canonical QCI/risk gate, or submit orders.
 * A complete 234-tick window is required before the 233-tick horizon is usable.
 *
 * The volume-toxicity slots are rolling signed-volume IMBALANCE PROXIES, not a
 * calibrated VPIN statistic; zero for absent optional fields is NOT evidence.
 */
export const HIVE_FEATURE_SLOTS = 97;
export const HIVE_MAX_HORIZON = 233;
export const HIVE_REQUIRED_TICKS = HIVE_MAX_HORIZON + 1;
export type HiveSleeve = 'futures' | 'spot' | 'memecoin' | 'yield' | 'stocks_etf';
const HORIZONS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233] as const;
const SLEEVE_CODE: Record<HiveSleeve, number> = {
  futures: 0.8, memecoin: 0.4, spot: 0, stocks_etf: -0.4, yield: -0.8,
};

export interface HiveMarketTick {
  symbol: string;
  sleeve: HiveSleeve;
  timestampMs: number;
  midPrice: number;
  bidPrice: number;
  askPrice: number;
  bidSizeL1: number;
  askSizeL1: number;
  bidDepthL5: number;
  askDepthL5: number;
  tradeVolume: number;
  buyVolume: number;
  sellVolume: number;
  fundingRate?: number;
  openInterest?: number;
  onChainLiquidityUsd?: number;
}

class Ring {
  private readonly values: Float64Array;
  private head = 0;
  private count = 0;
  constructor(readonly capacity: number) { this.values = new Float64Array(capacity); }
  push(value: number): void {
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  get size(): number { return this.count; }
  lag(n: number): number {
    if (!Number.isInteger(n) || n < 0 || n >= this.count) throw new RangeError('HIVE_RING_LAG_UNAVAILABLE');
    return this.values[(this.head - 1 - n + this.capacity) % this.capacity];
  }
  sum(window: number): number {
    let total = 0;
    for (let i = 0; i < Math.min(window, this.count); i++) total += this.lag(i);
    return total;
  }
  mean(window: number): number {
    const n = Math.min(window, this.count);
    return n ? this.sum(n) / n : 0;
  }
  std(window: number): number {
    const n = Math.min(window, this.count);
    if (n < 2) return 0;
    const avg = this.mean(n);
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const d = this.lag(i) - avg;
      ss += d * d;
    }
    return Math.sqrt(ss / (n - 1));
  }
}

interface SymbolState {
  sleeve: HiveSleeve;
  lastTimestampMs: number;
  lastMid: number;
  price: Ring;
  returns: Ring;
  l1: Ring;
  l5: Ring;
  signed: Ring;
  total: Ring;
  spread: Ring;
}

export interface HiveVectorOptions {
  symbols?: readonly string[];
  capacity?: number;
  maxSymbols?: number;
  /** Reject discontinuous history instead of blending two unrelated windows. */
  maxGapMs?: number;
}

/** Never infer missing book/trade fields from a 24-hour ticker or stale cache. */
export function validHiveMarketTick(tick: HiveMarketTick): boolean {
  if (!tick || typeof tick.symbol !== 'string' || !tick.symbol.trim() ||
      !Object.prototype.hasOwnProperty.call(SLEEVE_CODE, tick.sleeve) ||
      !Number.isSafeInteger(tick.timestampMs) || tick.timestampMs <= 0) return false;
  const fields = [
    tick.midPrice, tick.bidPrice, tick.askPrice, tick.bidSizeL1, tick.askSizeL1,
    tick.bidDepthL5, tick.askDepthL5, tick.tradeVolume, tick.buyVolume, tick.sellVolume,
  ];
  if (!fields.every(Number.isFinite) ||
      tick.bidPrice <= 0 || tick.askPrice <= tick.bidPrice ||
      tick.midPrice < tick.bidPrice || tick.midPrice > tick.askPrice ||
      fields.slice(3).some(v => v < 0) ||
      tick.bidSizeL1 + tick.askSizeL1 <= 0 ||
      tick.bidDepthL5 + tick.askDepthL5 <= 0 ||
      tick.tradeVolume <= 0 || tick.buyVolume + tick.sellVolume <= 0 ||
      tick.buyVolume + tick.sellVolume > tick.tradeVolume * (1 + 1e-9)) return false;
  for (const optional of [tick.fundingRate, tick.openInterest, tick.onChainLiquidityUsd]) {
    if (optional !== undefined && (!Number.isFinite(optional) || (
      optional !== tick.fundingRate && optional < 0
    ))) return false;
  }
  return true;
}

/** One state per market sleeve + symbol, with strictly monotone source timestamps. */
export class HiveFeatureVectorBuilder {
  private readonly states = new Map<string, SymbolState>();
  private readonly capacity: number;
  private readonly maxSymbols: number;
  private readonly maxGapMs: number;

  constructor(options: HiveVectorOptions = {}) {
    this.capacity = options.capacity ?? 256;
    this.maxSymbols = options.maxSymbols ?? 128;
    this.maxGapMs = options.maxGapMs ?? 60_000;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < HIVE_REQUIRED_TICKS ||
        !Number.isSafeInteger(this.maxSymbols) || this.maxSymbols < 1 ||
        !Number.isSafeInteger(this.maxGapMs) || this.maxGapMs < 1) {
      throw new Error('HIVE_VECTOR_CONFIGURATION_INVALID');
    }
    // Symbols alone cannot establish market sleeve; state is created on first valid tick.
    if (options.symbols && new Set(options.symbols).size > this.maxSymbols)
      throw new Error('HIVE_SYMBOL_CAPACITY_EXCEEDED');
  }

  private createState(sleeve: HiveSleeve): SymbolState {
    return {
      sleeve, lastTimestampMs: 0, lastMid: 0,
      price: new Ring(this.capacity), returns: new Ring(this.capacity),
      l1: new Ring(this.capacity), l5: new Ring(this.capacity),
      signed: new Ring(this.capacity), total: new Ring(this.capacity),
      spread: new Ring(this.capacity),
    };
  }

  /** Null means incomplete, invalid, duplicate, out-of-order or not warmed up. */
  update(tick: HiveMarketTick): Float64Array | null {
    if (!validHiveMarketTick(tick)) return null;
    const key = tick.sleeve + ':' + tick.symbol;
    let state = this.states.get(key);
    if (!state) {
      if (this.states.size >= this.maxSymbols) return null;
      state = this.createState(tick.sleeve);
      this.states.set(key, state);
    }
    if (tick.timestampMs <= state.lastTimestampMs) return null;
    if (state.lastTimestampMs > 0 && tick.timestampMs - state.lastTimestampMs > this.maxGapMs) {
      state = this.createState(tick.sleeve);
      this.states.set(key, state);
    }

    const mid = tick.midPrice;
    const l1den = tick.bidSizeL1 + tick.askSizeL1;
    const l5den = tick.bidDepthL5 + tick.askDepthL5;
    state.price.push(mid);
    state.returns.push(state.lastMid ? Math.log(mid / state.lastMid) : 0);
    state.l1.push((tick.bidSizeL1 - tick.askSizeL1) / l1den);
    state.l5.push((tick.bidDepthL5 - tick.askDepthL5) / l5den);
    state.signed.push(tick.buyVolume - tick.sellVolume);
    state.total.push(tick.tradeVolume);
    state.spread.push(((tick.askPrice - tick.bidPrice) / mid) * 10_000);
    state.lastMid = mid;
    state.lastTimestampMs = tick.timestampMs;
    if (state.price.size < HIVE_REQUIRED_TICKS) return null;

    const out = new Float64Array(HIVE_FEATURE_SLOTS);
    const baseVol = Math.max(state.returns.std(21), 1e-6);
    for (let i = 0; i < 12; i++) {
      const h = HORIZONS[i];
      out[i] = Math.tanh(Math.log(mid / state.price.lag(h)) * 150);
      out[12 + i] = Math.tanh(state.returns.std(Math.max(2, h)) / baseVol - 1);
      const mean = state.price.mean(Math.max(3, h));
      const std = Math.max(state.price.std(Math.max(3, h)), mid * 1e-5);
      out[24 + i] = Math.tanh((mid - mean) / (2 * std));
      out[36 + i] = Math.tanh(state.l1.mean(h) * 2.5);
      out[48 + i] = Math.tanh(state.l5.mean(h) * 2.5);
      const n = Math.max(2, h);
      const total = Math.max(state.total.sum(n), 1e-9);
      const signed = state.signed.sum(n);
      out[60 + i] = Math.tanh((Math.abs(signed) / total - 0.35) * 3);
      out[72 + i] = Math.tanh((signed / total) * 2.5);
    }
    const avgSpread = Math.max(state.spread.mean(34), 1e-4);
    for (let i = 0; i < 8; i++) {
      out[84 + i] = Math.tanh(1 - state.spread.mean(HORIZONS[i]) / avgSpread);
    }
    const micro = (tick.bidPrice * tick.askSizeL1 + tick.askPrice * tick.bidSizeL1) / l1den;
    out[92] = Math.tanh(((micro - mid) / (tick.askPrice - tick.bidPrice)) * 2);
    out[93] = Math.tanh((tick.fundingRate ?? 0) * 5000);
    out[94] = Math.tanh(Math.log1p(tick.openInterest ?? 0) * 0.05);
    out[95] = Math.tanh(Math.log1p(tick.onChainLiquidityUsd ?? 0) * 0.05);
    out[96] = SLEEVE_CODE[tick.sleeve];
    // In case the source window overflows a floating-point sum, never expose a
    // partially invalid feature vector to the shared-memory consumer.
    return out.every(Number.isFinite) ? out : null;
  }

  status(sleeve: HiveSleeve, symbol: string) {
    const s = this.states.get(sleeve + ':' + symbol);
    return {
      samples: s?.price.size ?? 0,
      lastTimestampMs: s?.lastTimestampMs ?? null,
      ready: !!s && s.price.size >= HIVE_REQUIRED_TICKS,
      authority: 'OBSERVATION_ONLY' as const,
    };
  }
}
