import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, sha256 } from '../core/util.js';
import { assertWriteFence, ownsLease, LeaseLostError, type LeaseFence } from '../ops/lease.js';
import { closedKlineAt } from '../providers/binance.js';
import { INTERVAL_MS, type Interval } from '../market/types.js';

interface ForecastRow { id: string; created_at: number; target_at: number; probability: number; payload: string }
type Cursor = { target: number; id: string };
let cursor: Cursor = { target: 0, id: '' };
const BATCH = 4;
const provenance = 'BINANCE_PUBLIC_CLOSED_BAR';

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
    const p=P<{instrumentId:string;timeframe:Interval;referencePrice:number;target:string;provenance:string}>(f.payload);
    const symbol=/^crypto:binance:([A-Z0-9]{2,30})$/.exec(p?.instrumentId ?? '')?.[1];
    if (!symbol || p.target!=='CLOSE_ABOVE_REFERENCE' || p.provenance!=='OWNER_REGISTERED_PROBABILITY' ||
        !Object.hasOwn(INTERVAL_MS,p.timeframe) || !Number.isFinite(p.referencePrice) || p.referencePrice<=0 ||
        !Number.isFinite(f.probability) || f.probability<0 || f.probability>1) { deferred++; continue; }
    let bar;
    try { bar=await closedKlineAt(symbol,p.timeframe,f.target_at); }
    catch { deferred++; continue; }
    if (!bar) { deferred++; continue; }
    const receivedAt=Date.now();
    if (receivedAt < f.target_at || bar.closeTime!==f.target_at-1) { deferred++; continue; }
    const inserted=tx(()=>{
      assertWriteFence(fence);
      if (get('SELECT 1 FROM ditas_outcomes WHERE forecast_id=?',f.id)) return false;
      // Immutable original claim; only append source observation.
      const payload={ observedPrice:bar.c, observedAt:f.target_at,
        sourceReference:`binance:spot:klines:${symbol}:${p.timeframe}:${bar.t}`,
        provenance,target:p.target,receivedAt,bar,barHash:sha256(J(bar)),
        note:'Public venue historical close; forecast probability remains owner-registered. No execution or strategy authority.' };
      run('INSERT INTO ditas_outcomes(id,forecast_id,created_at,outcome,payload) VALUES (?,?,?,?,?)',
        uid('outcome'),f.id,receivedAt,bar.c>p.referencePrice?1:0,J(payload));
      return true;
    });
    if (inserted) settled++; else deferred++;
  }
  return { scanned:rows.length,settled,deferred,tradingAuthority:false as const };
}
