export interface AggressiveFlow {
  buyBase: number;
  sellBase: number;
  deltaBase: number;
  imbalance: number | null;
  tradeCount: number | null;
}

export interface VolumeWindow {
  window: '5m' | '1h' | '24h';
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: 'NO_CANDLE_FEED' | 'CANDLES_MISSING' | 'CANDLE_BATCH_REJECTED' | 'CANDLES_INVALID' | 'CANDLES_STALE' | 'BASELINE_UNAVAILABLE' | null;
  closedAt: number | null;
  receivedAt: number | null;
  baseVolume: number | null;
  baselineWindows: number;
  medianBaseVolume: number | null;
  relativeToMedian: number | null;
  changeVsPreviousPct: number | null;
  aggressiveFlow: AggressiveFlow | null;
  candles: number;
}

export interface DepthProbe {
  side: 'buy' | 'sell';
  requestedQuote: number;
  filledFully: boolean;
  impactBps: number | null;
  avgPrice: number | null;
}

export interface BookActivity {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: 'BOOK_MISSING' | 'BOOK_INVALID' | 'BOOK_STALE' | null;
  quoteAgeMs: number | null;
  capturedAt: number | null;
  bidLevelCount: number | null;
  askLevelCount: number | null;
  spreadBps: number | null;
  bidDepth1pctQuote: number | null;
  askDepth1pctQuote: number | null;
  bidShare1pct: number | null;
  impactCurve: DepthProbe[];
  exit: {
    bandBps: 100;
    conservativeBaseCapacity: number | null;
    requestedBaseQty: number | null;
    fitsVisibleCapacity: boolean | null;
    avgPrice: number | null;
    impactBps: number | null;
  };
}

export interface CexActivityReport {
  schemaVersion: 1;
  instrumentId: string;
  asOf: number;
  source: 'binance' | null;
  baseAsset: string | null;
  quoteAsset: string | null;
  volume: VolumeWindow[];
  book: BookActivity;
}
