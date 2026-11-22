/**
 * MIA 5.x HP97 research read model. Additive to the canonical market fabric and
 * indicator engine: this projection never produces an execution signal or writes trades.
 * Indices 0..96 and bucket boundaries follow the uploaded unified HP97 specification.
 */
export const FEATURE_SCHEMA_VERSION = 'mia.hp97.projection.v1' as const;
export const FEATURE_COUNT = 97 as const;
export const FEATURE_SLOT_NAMES = (
  'MID_PRICE LAST_TRADE_PRICE MARK_PRICE INDEX_PRICE RETURN_1_TICK RETURN_5_TICK RETURN_20_TICK RETURN_100_TICK ' +
  'EMA_FAST_9 EMA_MEDIUM_21 EMA_SLOW_55 EMA_TREND_SLOPE_NORM REALIZED_VOL_20 REALIZED_VOL_100 VOL_RATIO_SHORT_LONG ATR_14 ' +
  'ATR_PCT_14 PARKINSON_VOL_20 GARMAN_KLASS_VOL_20 BOLLINGER_ZSCORE_20 BOLLINGER_BANDWIDTH_20 HURST_EXPONENT_EST ' +
  'BEST_BID BEST_ASK SPREAD_ABS SPREAD_BPS MICROPRICE MICROPRICE_EDGE_BPS OBI_L1 OBI_L5 OBI_L10 BOOK_SLOPE_BID ' +
  'BOOK_SLOPE_ASK BOOK_DEPTH_USD_1PCT TRADE_FLOW_IMBALANCE_20 CVD_20 CVD_100 CVD_SLOPE_NORM BUY_VOLUME_RATIO_20 ' +
  'AGGRESSOR_SWEEP_INTENSITY VPIN_TOXICITY KYLE_LAMBDA_IMPACT AMIHUD_ILLIQUIDITY TICK_ARRIVAL_RATE_HZ SESSION_VWAP ' +
  'VWAP_DEVIATION_PCT VWAP_ZSCORE ROLLING_VWAP_50 ROLLING_VWAP_200 TWAP_50 DIST_FROM_HIGH_100_PCT DIST_FROM_LOW_100_PCT ' +
  'RSI_14 STOCH_RSI_K MACD_HIST_NORM ADX_14 PLUS_DI_14 MINUS_DI_14 CCI_20 DONCHIAN_POS_20 KELTNER_SQUEEZE_RATIO ' +
  'FUNDING_RATE_CURRENT FUNDING_RATE_PREDICTED FUNDING_ANNUALIZED_PCT PERP_SPOT_BASIS_BPS OPEN_INTEREST_USD OI_DELTA_PCT_20 ' +
  'OI_PRICE_DIVERGENCE LONG_SHORT_ACCOUNT_RATIO LIQUIDATION_IMBALANCE_20 LIQUIDATION_CASCADE_SCORE DEX_POOL_LIQUIDITY_USD ' +
  'DEX_PRICE_IMPACT_1K_BPS SOLANA_PRIORITY_FEE_LAMPORTS JITO_TIP_PERCENTILE_75 JITO_BUNDLE_LAND_RATE ' +
  'HOLDER_TOP10_CONCENTRATION DEV_WALLET_DELTA_PCT RUGCHECK_RISK_SCORE SMART_MONEY_NET_FLOW_5M BONDING_CURVE_PROGRESS ' +
  'BTC_BETA_50 BTC_CORR_50 SOL_BETA_50 SOL_CORR_50 LEAD_LAG_RESIDUAL_BPS SECTOR_RELATIVE_STRENGTH ' +
  'DOLLAR_DXY_PROXY_MOMENTUM EQUITY_SPY_REGIME_SCORE EST_SLIPPAGE_BPS EST_ROUNDTRIP_FEE_BPS NET_EDGE_AFTER_COST_BPS ' +
  'CURRENT_POSITION_NOTIONAL_PCT UNREALIZED_PNL_PCT TRAILING_DRAWDOWN_PCT ROLLING_30_EXPECTANCY_R RISK_GOVERNOR_BUDGET_UTIL'
).trim().split(/\s+/);
export const FEATURE_BUCKETS = [
  { id: 'B01_PRICE_MOMENTUM', start: 0, end: 11 },
  { id: 'B02_VOLATILITY_REGIME', start: 12, end: 21 },
  { id: 'B03_ORDERBOOK_MICRO', start: 22, end: 33 },
  { id: 'B04_ORDERFLOW_VPIN', start: 34, end: 43 },
  { id: 'B05_VWAP_ANCHORS', start: 44, end: 51 },
  { id: 'B06_OSCILLATORS_PIVOTS', start: 52, end: 60 },
  { id: 'B07_PERP_FUNDING_OI', start: 61, end: 70 },
  { id: 'B08_SOLANA_DEX_MEV', start: 71, end: 80 },
  { id: 'B09_CROSS_ASSET_BETA', start: 81, end: 88 },
  { id: 'B10_TCA_RISK', start: 89, end: 96 },
] as const;
export type FeatureSlotName = string;
export interface FeatureSlotObservation { slot: number; name: string; value: number; observedAtMs: number; source: string }
export interface Feature97Projection {
  schema: typeof FEATURE_SCHEMA_VERSION;
  instrumentId: string;
  capturedAtMs: number;
  observations: FeatureSlotObservation[];
  absent: string[];
  coverage: { total: number; observed: number; requiredMissing: string[]; eligibleForSpotResearch: boolean };
  // Research-only, never an order authorization or certified winning probability.
  readOnly: true;
}
const REQUIRED_SPOT = ['MID_PRICE', 'BEST_BID', 'BEST_ASK', 'SPREAD_BPS', 'BOOK_DEPTH_USD_1PCT'] as const;
export function assertHp97Schema(): void {
  if (FEATURE_SLOT_NAMES.length !== FEATURE_COUNT || new Set(FEATURE_SLOT_NAMES).size !== FEATURE_COUNT)
    throw new Error('HP97_SLOT_COUNT_OR_DUPLICATION');
  const allocated = new Set<number>();
  for (const b of FEATURE_BUCKETS) for (let index = b.start; index <= b.end; index++) {
    if (index < 0 || index >= FEATURE_COUNT || allocated.has(index)) throw new Error('HP97_INVALID_BUCKET');
    allocated.add(index);
  }
  if (allocated.size !== FEATURE_COUNT) throw new Error('HP97_BUCKET_GAP');
}
/** No implicit zero for missing evidence. Conflicting timestamps are never silently overwritten. */
export class Feature97ProjectionBuilder {
  private readonly byName = new Map<string, FeatureSlotObservation>();
  constructor(readonly instrumentId: string) {
    assertHp97Schema();
    if (!instrumentId.trim()) throw new Error('HP97_INSTRUMENT_REQUIRED');
  }
  set(name: FeatureSlotName, value: number, observedAtMs: number, source: string, nowMs: number): void {
    const index = FEATURE_SLOT_NAMES.indexOf(name);
    if (index < 0) throw new Error('HP97_UNKNOWN_SLOT');
    if (!Number.isFinite(value)) throw new Error('HP97_NONFINITE');
    if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0 || observedAtMs > nowMs)
      throw new Error('HP97_INVALID_TIMESTAMP');
    if (!source.trim()) throw new Error('HP97_MISSING_SOURCE');
    if ((this.byName.get(name)?.observedAtMs ?? 0) > observedAtMs) throw new Error('HP97_OUT_OF_ORDER');
    this.byName.set(name, { slot: index, name, value, observedAtMs, source });
  }
  capture(nowMs: number, maxAgeMs: number): Feature97Projection {
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0)
      throw new Error('HP97_INVALID_CAPTURE_CLOCK');
    const observations = [...this.byName.values()].filter(x => nowMs - x.observedAtMs <= maxAgeMs)
      .sort((a,b) => a.slot-b.slot);
    const present = new Set(observations.map(x => x.name));
    const absent = FEATURE_SLOT_NAMES.filter(x => !present.has(x));
    const requiredMissing = REQUIRED_SPOT.filter(x => !present.has(x));
    return { schema: FEATURE_SCHEMA_VERSION, instrumentId: this.instrumentId, capturedAtMs: nowMs,
      observations, absent, coverage: { total: FEATURE_COUNT, observed: observations.length,
        requiredMissing, eligibleForSpotResearch: requiredMissing.length === 0 }, readOnly: true };
  }
}
