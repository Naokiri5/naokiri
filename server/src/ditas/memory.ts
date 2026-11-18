import { all, get, run, tx, getDb, J, P } from '../db/db.js';
import { uid, sha256 } from '../core/util.js';
import { market } from '../market/store.js';
import { assessQuality } from '../market/quality.js';
import { getControl } from '../core/mode.js';
import { INTERVAL_MS, type Interval } from '../market/types.js';
import type { Candidate, WorkerContext } from '../workers/types.js';
import type { DecisionReport } from '../decision/engine.js';
import { classifyRegime } from '../regime/regime.js';
import { STRATEGIES, strategyById } from '../lab/strategies.js';
import { fingerprint } from './fingerprint.js';

export type MemoryKind = 'NO_SIGNAL' | 'REJECTED' | 'PROPOSAL' | 'DECISION' | 'CORRECTION';
export interface MemoryEvent {
  id: string; kind: MemoryKind; instrumentId: string; strategyId: string | null; decisionId: string | null;
  createdAt: number; snapshotId: string | null; parentEventId: string | null; payload: any; hash: string;
}
const atomic = <T>(fn: () => T): T => tx(fn); // tx joins an enclosing transaction

const pick = (obj: any, keys: string) => Object.fromEntries(keys.split(' ').filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
const feature = (f: any) => f ? pick(f, 't n close ema9 ema20 ema50 ema200 rsi14 atr14 atrPct macd macdSignal macdHist adx14 plusDI minusDI bbMid bbUpper bbLower bbWidth bbPctB donchHigh20 donchLow20 donchHigh55 donchLow55 obv obvSlope10 volZ20 relVol20 takerBuyRatio ret1 ret5 ret20 roc10 realizedVol20 stochK14 williamsR14 cci20 mfi14 vwap20 zscore20 swingHigh swingLow ema20Slope5 ema50Slope10 bbWidthPctile100 efficiencyRatio10') : null;

/** Explicit allowlist: no credentials, config, chats or unrestricted agent tool context. */
function capture(instrumentId: string, interval: Interval, asOf: number, ctx?: WorkerContext) {
  const d = market.deep.get(instrumentId), t = market.tickers.get(instrumentId);
  return {
    schemaVersion: 'ditas.snapshot.v2', asOf, instrumentId, interval, regime: classifyRegime(d?.engines[interval].last ?? null).regime,
    ticker: t ? pick(t, 'instrumentId symbol base quote last bid ask changePct quoteVolume high low open trades providerTs receivedAt source') : null,
    candles: Object.fromEntries((['15m', '1h', '4h'] as const).map(iv => [iv, d?.engines[iv].candles.map(c => pick(c, 't o h l c v qv n tbv closeTime')) ?? []])),
    features: Object.fromEntries((['15m', '1h', '4h'] as const).map(iv => [iv, feature(ctx ? ctx.f[iv] : d?.engines[iv].last)])),
    book: d?.book ? { ts: d.book.ts, bids: d.book.bids.slice(0, 100), asks: d.book.asks.slice(0, 100) } : null,
    cross: Object.fromEntries(Object.entries(d?.cross ?? {}).map(([venue, q]) => [venue, pick(q, 'price bid ask ts venue')])), quality: ctx?.quality ?? assessQuality(instrumentId, interval, asOf),
    control: getControl(), fingerprint: ctx ? fingerprint(ctx, asOf) : null,
    context: ctx ? { asOf: ctx.asOf ?? null, breadth: ctx.breadth ?? null, frameQuality: ctx.frameQuality ?? null, btc1h: feature(ctx.btc1h), btc4h: feature(ctx.btc4h), ticker: ctx.ticker ? pick(ctx.ticker, 'last changePct quoteVolume trades high low') : null, safety: ctx.safety, impact: ctx.impact, news: ctx.news, prints: ctx.prints, corrToBtc: ctx.corrToBtc, feeRate: ctx.feeRate, intendedNotional: ctx.intendedNotional, strategyStats: ctx.strategyStats } : null,
    lineage: { intelligence: 'deterministic-workers', modelVersion: null, promptVersion: null, calibrationId: null, strategyVersions: STRATEGIES.map(s => ({ id: s.id, version: s.version })), note: 'No LLM prediction probability used by deterministic decision path.' },
  };
}

/**
 * Store-once market data. The heavy, highly repetitive parts of a snapshot — each interval's candle window and the order
 * book — are written to ditas_blobs under the sha256 of their canonical JSON and replaced by {"$blob": hash}. Strategies
 * evaluated on the same market state, and slower intervals that did not change, therefore share one stored copy.
 * The snapshot itself (and its own hash) still commits to every referenced hash, so evidence stays immutable.
 */
export const isBlobRef = (v: unknown): v is { $blob: string } => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).$blob === 'string' && Object.keys(v as object).length === 1;
function putBlob(kind: string, value: unknown, ts: number) {
  const payload = J(value); const hash = sha256(payload);
  run('INSERT OR IGNORE INTO ditas_blobs(hash,kind,created_at,payload) VALUES (?,?,?,?)', hash, kind, ts, payload);
  return { $blob: hash };
}
/** Candle windows slide by one bar per interval, so they are stored in time-aligned chunks of CANDLE_CHUNK bars: when a
 *  window advances only its first and last chunk change and every chunk in between is shared with earlier snapshots. */
export const CANDLE_CHUNK = 50;
function candleChunks(iv: string, candles: any[], ts: number) {
  const step = INTERVAL_MS[iv as Interval] * CANDLE_CHUNK; const groups = new Map<number, any[]>();
  for (const c of candles) { const k = Math.floor(Number(c.t) / step); const g = groups.get(k) ?? []; g.push(c); groups.set(k, g); }
  return { $chunks: [...groups.values()].map((g) => putBlob(`candles.${iv}`, g, ts).$blob) };
}
function externalize(s: ReturnType<typeof capture>, ts: number) {
  return { ...s, candles: Object.fromEntries(Object.entries(s.candles).map(([iv, c]) => [iv, candleChunks(iv, c as any[], ts)])), book: s.book ? putBlob('book', s.book, ts) : null };
}
const isChunkRef = (v: unknown): v is { $chunks: string[] } => !!v && typeof v === 'object' && Array.isArray((v as any).$chunks) && (v as any).$chunks.every((h: unknown) => typeof h === 'string');
/** Expand blob references (v2) for readers; v1 snapshots pass through unchanged. A missing blob is an integrity error. */
export function expandSnapshot(payload: any) {
  const load = (hash: string) => { const b = get<{ payload: string }>('SELECT payload FROM ditas_blobs WHERE hash=?', hash); if (!b) throw new Error(`DITAS blob missing: ${hash}`); return P<any>(b.payload); };
  const blob = (ref: any) => (isBlobRef(ref) ? load(ref.$blob) : isChunkRef(ref) ? ref.$chunks.flatMap((h) => load(h)) : ref);
  if (!payload || payload.schemaVersion !== 'ditas.snapshot.v2') return payload;
  return { ...payload, candles: Object.fromEntries(Object.entries(payload.candles ?? {}).map(([iv, c]) => [iv, blob(c)])), book: blob(payload.book) };
}
/** All blob hashes a stored snapshot payload references. */
export function blobRefs(payloadText: string): string[] {
  const p = P<any>(payloadText); if (!p || p.schemaVersion !== 'ditas.snapshot.v2') return [];
  return [...Object.values(p.candles ?? {}), p.book].flatMap((r) => (isBlobRef(r) ? [r.$blob] : isChunkRef(r) ? r.$chunks : []));
}

function eventRow(r: any): MemoryEvent { return { id: r.id, kind: r.kind, instrumentId: r.instrument, strategyId: r.strategy, decisionId: r.decision_id, createdAt: r.created_at, snapshotId: r.snapshot_id, parentEventId: r.parent_event_id, payload: P(r.payload), hash: r.hash }; }
export function hashEvent(r: any) {
  return sha256(J([r.id, r.dedupe_key, r.created_at, r.kind, r.instrument, r.strategy, r.decision_id, r.snapshot_id, r.parent_event_id, r.payload, r.prev_hash]));
}

export function recordOpportunity(input: { kind: Exclude<MemoryKind, 'CORRECTION'>; instrumentId: string; strategyId?: string; interval?: Interval; dedupeKey: string; reason: string; candidate?: Candidate; ctx?: WorkerContext; report?: DecisionReport; snapshotId?: string }) {
  return atomic(() => {
    const exists = get<any>('SELECT * FROM ditas_events WHERE dedupe_key=?', input.dedupeKey);
    if (exists) return eventRow(exists);
    const ts = Date.now(), id = uid('evt');
    let snapshotId = input.snapshotId ?? input.ctx?.memorySnapshotId;
    if (snapshotId) { const original = get<any>('SELECT instrument FROM ditas_snapshots WHERE id=?', snapshotId); if (!original || original.instrument !== input.instrumentId) throw new Error('invalid original snapshot reference'); }
    else { const snapshot = J(externalize(capture(input.instrumentId, input.interval ?? '1h', ts, input.ctx), ts)); const hash = sha256(snapshot); snapshotId = `snap_${hash}`;
      run('INSERT OR IGNORE INTO ditas_snapshots(id,created_at,instrument,payload,hash) VALUES (?,?,?,?,?)', snapshotId, ts, input.instrumentId, snapshot, hash); }

    const payload = J({ reason: input.reason, strategy: input.strategyId ? { id: input.strategyId, version: strategyById(input.strategyId)?.version ?? null } : null, candidate: input.candidate ?? null, report: input.report ?? null, prediction: { probability: null, status: 'UNCALIBRATED' } });
    const prevHash = get<any>('SELECT hash FROM ditas_events ORDER BY seq DESC LIMIT 1')?.hash ?? 'GENESIS';
    const row = { id, dedupe_key: input.dedupeKey, created_at: ts, kind: input.kind, instrument: input.instrumentId, strategy: input.strategyId ?? null, decision_id: input.report?.id ?? null, snapshot_id: snapshotId, parent_event_id: null, payload, prev_hash: prevHash };
    run('INSERT INTO ditas_events(id,dedupe_key,created_at,kind,instrument,strategy,decision_id,snapshot_id,parent_event_id,payload,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, row.dedupe_key, ts, row.kind, row.instrument, row.strategy, row.decision_id, snapshotId, null, payload, prevHash, hashEvent(row));
    return eventRow({ ...row, hash: hashEvent(row) });
  });
}

export function correctEvent(eventId: string, reason: string, correction: string) {
  if (!reason.trim() || reason.length > 1000 || !correction.trim() || correction.length > 5000) throw new Error('correction reason/text required within limits');
  return atomic(() => {
    const parent = get<any>('SELECT * FROM ditas_events WHERE id=?', eventId); if (!parent) throw new Error('event not found');
    const id = uid('evt'), ts = Date.now(), payload = J({ reason, correction, actor: 'owner' });
    const prevHash = get<any>('SELECT hash FROM ditas_events ORDER BY seq DESC LIMIT 1')?.hash ?? 'GENESIS';
    const row = { id, dedupe_key: id, created_at: ts, kind: 'CORRECTION', instrument: parent.instrument, strategy: parent.strategy, decision_id: parent.decision_id, snapshot_id: parent.snapshot_id, parent_event_id: eventId, payload, prev_hash: prevHash };
    run('INSERT INTO ditas_events(id,dedupe_key,created_at,kind,instrument,strategy,decision_id,snapshot_id,parent_event_id,payload,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, id, ts, row.kind, row.instrument, row.strategy, row.decision_id, row.snapshot_id, eventId, payload, prevHash, hashEvent(row));
    return eventRow({ ...row, hash: hashEvent(row) });
  });
}
export function memoryEvents(limit = 100) { return all<any>('SELECT * FROM ditas_events ORDER BY seq DESC LIMIT ?', Math.min(500, Math.max(1, limit))).map(eventRow); }
export function memoryDetail(id: string) {
  const r = get<any>('SELECT * FROM ditas_events WHERE id=?', id); if (!r) return null;
  const snapshot = r.snapshot_id ? get<any>('SELECT * FROM ditas_snapshots WHERE id=?', r.snapshot_id) : null;
  return { event: eventRow(r), snapshot: snapshot ? { id: snapshot.id, createdAt: snapshot.created_at, hash: snapshot.hash, ...expandSnapshot(P(snapshot.payload)) } : null,
    relatedEvents: all<any>('SELECT * FROM ditas_events WHERE parent_event_id=? ORDER BY seq', id).map(eventRow) };
}
/** Verifies the event chain and snapshot hashes; rows may come from a backup snapshot instead of the live database. */
export function verifyMemory(events: any[] = all<any>('SELECT * FROM ditas_events ORDER BY seq'), snapshots: any[] = all<any>('SELECT * FROM ditas_snapshots'),
  blobs: any[] = all<any>('SELECT * FROM ditas_blobs'), twinRuns: any[] = all<any>('SELECT * FROM ditas_twin_runs')) {
  let prev = 'GENESIS';
  for (const r of events) { if (r.prev_hash !== prev || r.hash !== hashEvent(r)) return { ok: false, brokenAt: r.id }; prev = r.hash; }
  // G-02 / G-03 (100-agent audit): a twin run's stored hash must match its result, and every snapshot an event
  // references must be present (a backup with the snapshots removed used to verify).
  for (const t of twinRuns) if (t.hash !== sha256(t.result)) return { ok: false, brokenAt: `twin:${t.id}` };
  const snapIds = new Set(snapshots.map((s) => s.id));
  for (const r of events) if (r.snapshot_id && !snapIds.has(r.snapshot_id)) return { ok: false, brokenAt: `${r.id} (missing snapshot ${r.snapshot_id})` };
  const blobHashes = new Set<string>();
  for (const b of blobs) { if (sha256(b.payload) !== b.hash) return { ok: false, brokenAt: `blob:${b.hash}` }; blobHashes.add(b.hash); }
  for (const r of snapshots) {
    if (sha256(r.payload) !== r.hash || r.id !== `snap_${r.hash}`) return { ok: false, brokenAt: r.id };
    for (const h of blobRefs(r.payload)) if (!blobHashes.has(h)) return { ok: false, brokenAt: `${r.id} (missing blob ${h})` };
  }
  return { ok: true, entries: events.length }; // shape unchanged for /api/ditas/verify callers
}
