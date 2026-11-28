import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, sha256 } from '../core/util.js';
import { assertWriteFence, ownsLease, LeaseLostError, type LeaseFence } from '../ops/lease.js';
import { closedKlineAt } from '../providers/binance.js';
import { closedFuturesKlineAt, futuresResearchSymbol } from '../providers/binanceFuturesResearch.js';
import { INTERVAL_MS, type Interval } from '../market/types.js';
import { scoreMulticlassForecast, type ScenarioProbabilities } from './calibration.js';
import { DIRECTION_DEADBAND_BPS, DIRECTION_FORECAST_SOURCE, DIRECTION_FORECAST_TARGET, DIRECTION_MODEL_VERSION,
  directionOutcome } from './directionForecast.js';

interface ForecastRow { id: string; created_at: number; target_at: number; probability: number; payload: string }
type Cursor = { target: number; id: string };
let cursor: Cursor = { target: 0, id: '' };
const BATCH = 4;
const provenance = 'BINANCE_PUBLIC_CLOSED_BAR';

interface ForecastClaim {
  instrumentId: string;
  timeframe: Interval;
  referencePrice: number;
  target: string;
  provenance: string;
  modelVersion?: string;
  deadbandBps?: number;
  probabilities?: ScenarioProbabilities;
}

function forecastClaim(payload: string): ForecastClaim | null {
  try { return P<ForecastClaim | null>(payload); } catch { return null; }
}

/**
 * Bounded research-only settlement for existing explicit forecasts, including
 * proposals that never traded. No forecasts invented from worker confidence.
 * Only the canonical engine leader writes; no transaction spans network I/O.
 * An existing immutable owner outcome is never replaced.
 */
export async function verifyDueForecasts(fence: LeaseFence) {
  if (fence.name !== 'engine' || !ownsLease(fence)) throw new LeaseLostError();
  const cutoff = Date.now()-2_000;
  const select = (after: Cursor) => all<ForecastRow>(
    `SELECT f.id,f.created_at,f.target_at,f.probability,f.payload FROM ditas_forecasts f
      LEFT JOIN ditas_outcomes o ON o.forecast_id=f.id
      WHERE o.id IS NULL AND f.target_at<=? AND f.created_at<f.target_at
      AND (f.target_at>? OR (f.target_at=? AND f.id>?))
      ORDER BY f.target_at,f.id LIMIT ?`, cutoff,after.target,after.target,after.id,BATCH);
  let rows=select(cursor);
  if (!rows.length) { cursor={target:0,id:''}; rows=select(cursor); }
  let settled=0, deferred=0;
  for (const f of rows) {
    if (!ownsLease(fence)) throw new LeaseLostError();
    cursor={target:f.target_at,id:f.id};
    const p = forecastClaim(f.payload);
    if (!p || !Object.hasOwn(INTERVAL_MS,p.timeframe) || !Number.isFinite(p.referencePrice) || p.referencePrice<=0 ||
        !Number.isFinite(f.probability) || f.probability<0 || f.probability>1) { deferred++; continue; }
    const spot = p.target === 'CLOSE_ABOVE_REFERENCE' && p.provenance === 'OWNER_REGISTERED_PROBABILITY'
      ? /^crypto:binance:([A-Z0-9]{2,30})$/.exec(p.instrumentId)?.[1] : undefined;
    const futures = p.target === DIRECTION_FORECAST_TARGET && p.provenance === 'ENGINE_DIRECTION_RESEARCH' &&
      p.modelVersion === DIRECTION_MODEL_VERSION && p.deadbandBps === DIRECTION_DEADBAND_BPS[p.timeframe] &&
      p.probabilities?.BULLISH === f.probability ? futuresResearchSymbol(p.instrumentId) : undefined;
    if (!spot && !futures) { deferred++; continue; }
    let bar;
    try {
      bar = futures ? await closedFuturesKlineAt(futures, p.timeframe, f.target_at) : await closedKlineAt(spot!,p.timeframe,f.target_at);
    }
    catch { deferred++; continue; }
    if (!bar) { deferred++; continue; }
    const receivedAt=Date.now();
    if (receivedAt < f.target_at || bar.closeTime!==f.target_at-1) { deferred++; continue; }
    let outcome: 0 | 1 = bar.c > p.referencePrice ? 1 : 0;
    let direction = {};
    if (futures) {
      const realizedClass = directionOutcome(bar.c / p.referencePrice, p.deadbandBps!);
      if (!realizedClass) { deferred++; continue; }
      try { direction = { realizedClass, score: scoreMulticlassForecast(p.probabilities!, realizedClass) }; }
      catch { deferred++; continue; }
      outcome = realizedClass === 'BULLISH' ? 1 : 0;
    }
    const inserted=tx(()=>{
      assertWriteFence(fence);
      if (get('SELECT 1 FROM ditas_outcomes WHERE forecast_id=?',f.id)) return false;
      // Immutable original claim; only append source observation.
      const payload={ observedPrice:bar.c, observedAt:f.target_at,
        sourceReference:`binance:${futures ? 'usdm' : 'spot'}:klines:${futures ?? spot}:${p.timeframe}:${bar.t}`,
        provenance: futures ? DIRECTION_FORECAST_SOURCE : provenance, target:p.target, receivedAt, bar, barHash:sha256(J(bar)),
        note: futures ? 'Observed venue close for the frozen research forecast.'
          : 'Public venue historical close; forecast probability remains owner-registered. No execution or strategy authority.',
        ...direction };
      run('INSERT INTO ditas_outcomes(id,forecast_id,created_at,outcome,payload) VALUES (?,?,?,?,?)',
        uid('outcome'),f.id,receivedAt,outcome,J(payload));
      return true;
    });
    if (inserted) settled++; else deferred++;
  }
  return { scanned:rows.length,settled,deferred,tradingAuthority:false as const };
}
