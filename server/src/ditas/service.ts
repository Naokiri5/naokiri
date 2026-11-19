import { all, get, run, J, P } from '../db/db.js';
import { uid, sha256 } from '../core/util.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { getControl } from '../core/mode.js';
import { market } from '../market/store.js';
import { assessQuality } from '../market/quality.js';
import { memoryDetail, memoryEvents } from './memory.js';
import { strategyPassports } from './passports.js';
import { compareFingerprints, type MarketFingerprint } from './fingerprint.js';
import { calibrationReport } from './calibration.js';
import { simulateTwin, type TwinAssumptions } from './twin.js';
import { INTERVAL_MS, type Candle } from '../market/types.js';

export const DITAS_COVERAGE = [
  { foundation: 'Market data truth', status: 'PARTIAL', detail: 'Strict timestamps, identities, quotes, books and closed-candle validation; polling crypto only. No WebSocket/session certification.' },
  { foundation: 'Decision memory', status: 'PARTIAL', detail: 'Immutable snapshots and events for new evaluated scans/proposals/decisions; existing actual fills remain in authoritative OMS tables. Legacy evidence is not backfilled.' },
  { foundation: 'Market DNA', status: 'PARTIAL', detail: 'Normalized captured features and time-filtered similarity; unavailable macro/fundamental dimensions remain missing.' },
  { foundation: 'Strategy passports', status: 'PARTIAL', detail: 'Current rules, version-aware OOS and recent paper health; lifecycle remains existing owner-controlled registry.' },
  { foundation: 'Decision Twin', status: 'PARTIAL', detail: 'Frozen proposal, shadow/delayed/WAIT alternatives with costs/depth limits. Hypothetical, uploaded history provenance unverified; exit-depth/queue impact not modeled.' },
  { foundation: 'Confidence calibration', status: 'PARTIAL', detail: 'Explicit probability forecast/outcome records and cohort metrics. No conversion of agent votes; no calibrated production model.' },
  { foundation: 'Portfolio and execution', status: 'PARTIAL', detail: 'Reuses risk, OMS and ledger. Extended sector/event budgets and acknowledgement/partial-fill telemetry pending.' },
  { foundation: 'AI reliability', status: 'PARTIAL', detail: 'Existing signed packets, bounded pool, timeouts and quarantine. Per-model prompt/cost evaluation pending.' },
  { foundation: 'Safety and recovery', status: 'PARTIAL', detail: 'Existing pause, emergency and owner recovery controls retained. Unified autonomous incident governor pending.' },
  { foundation: 'Strategy arena and stress simulator', status: 'MISSING', detail: 'Common-window competition and full operational scenario runner remain follow-on work.' },
  { foundation: 'Live certification', status: 'BLOCKED', detail: 'No live adapter/signer, paper evaluation sample or trading-performance certification. Live remains disabled.' },
];
const count = (table: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n;
export function forecastCohorts() { return all<{ cohort: string; n: number }>('SELECT cohort,COUNT(*) n FROM ditas_forecasts GROUP BY cohort ORDER BY cohort'); }
export function calibrationFor(cohort?: string) {
  if (!cohort) return { ...calibrationReport([]), cohort: null, cohorts: forecastCohorts(), note: 'Select an exact forecast cohort. Different strategies, versions, horizons and targets are never pooled.' };
  const rows = all<{ probability: number; outcome: 0 | 1 }>('SELECT f.probability,o.outcome FROM ditas_forecasts f JOIN ditas_outcomes o ON o.forecast_id=f.id WHERE f.cohort=? ORDER BY f.created_at', cohort);
  return { ...calibrationReport(rows), cohort, cohorts: forecastCohorts(), provenance: 'OWNER_REPORTED observations; independent market-source verification pending.' };
}
export function ditasOverview(cohort?: string) {
  const events = memoryEvents(100);
  const twins = all<any>('SELECT * FROM ditas_twin_runs ORDER BY created_at DESC LIMIT 50').map(r => ({ id: r.id, eventId: r.event_id, createdAt: r.created_at, result: P(r.result) }));
  const positions = get<any>("SELECT COUNT(*) n,COALESCE(SUM(realized_pnl),0) pnl FROM positions WHERE status='CLOSED' AND account=?", PAPER_ACCOUNT)!;
  const fingerprints = all<any>(`SELECT e.id event_id,json_extract(s.payload,'$.fingerprint') fingerprint FROM ditas_events e JOIN ditas_snapshots s ON s.id=e.snapshot_id WHERE json_extract(s.payload,'$.fingerprint') IS NOT NULL ORDER BY e.seq DESC LIMIT 100`).map(r => ({ ...P(r.fingerprint), eventId: r.event_id }));
  return { counts: { snapshots: count('ditas_snapshots'), events: count('ditas_events'), twins: count('ditas_twin_runs'), forecasts: count('ditas_forecasts'), outcomes: count('ditas_outcomes') },
    dataHealth: market.universe.slice(0, 100).map(instrumentId => ({ instrumentId, ...assessQuality(instrumentId) })), passports: strategyPassports(), events, twins, calibration: calibrationFor(cohort), fingerprints,
    actual: { label: 'PAPER', orders: get<any>('SELECT COUNT(*) n FROM orders WHERE account=?', PAPER_ACCOUNT)!.n, fills: get<any>('SELECT COUNT(*) n FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.account=?', PAPER_ACCOUNT)!.n, closedPositions: positions.n, realizedPnl: positions.pnl, fees: get<any>('SELECT COALESCE(SUM(f.fee),0) n FROM fills f JOIN orders o ON o.id=f.order_id WHERE o.account=?', PAPER_ACCOUNT)!.n },
    coverage: DITAS_COVERAGE, controls: getControl(), memoryIntegrity: { status: 'NOT_CHECKED', verificationEndpoint: '/api/ditas/verify' }, note: 'Research evidence only. Simulations are separate from the paper OMS; no live certification or automatic strategy changes.' };
}

export function runDecisionTwin(eventId: string, candles: Candle[], assumptions: Omit<TwinAssumptions, 'availableNotional' | 'liquidityObservedAt'>, sourceReference: string) {
  const d = memoryDetail(eventId); if (!d) throw new Error('event not found');
  const c = d.event.payload.candidate;
  if (!c || !d.snapshot || d.snapshot.quality.status === 'FAIL') throw new Error('Twin requires a frozen proposal with non-failed decision-time data');
  const duration = INTERVAL_MS[c.interval as keyof typeof INTERVAL_MS];
  const firstOpening = Math.ceil(d.event.createdAt / duration) * duration;
  const now = Date.now();
  if (!candles.length || candles[0].t !== firstOpening || candles.some(bar => bar.t + duration > now)) throw new Error('history must begin at the first opening after the recorded decision and contain only closed historical bars');
  const book = d.snapshot.book;
  const ref = book?.asks?.[0]?.[0];
  const availableNotional = book && Number.isFinite(ref) && ref > 0 ? book.asks.filter(([price]: number[]) => price <= ref * 1.01).reduce((sum: number, [price, qty]: number[]) => sum + price * qty, 0) : undefined;
  const result = simulateTwin({ instrumentId: c.instrumentId, decisionAt: d.event.createdAt, timeframe: c.interval, signal: c.signal }, candles, { ...assumptions, availableNotional, liquidityObservedAt: book?.ts });
  const stored = { ...result, dataProvenance: { kind: 'OWNER_UPLOADED_UNVERIFIED', sourceReference, historyHash: sha256(J(candles)), bars: candles.length, from: candles[0].t, to: candles.at(-1)!.t }, evaluatedAt: now };
  const id = uid('twin'); run('INSERT INTO ditas_twin_runs(id,event_id,created_at,result,hash) VALUES (?,?,?,?,?)', id, eventId, now, J(stored), sha256(J(stored)));
  return { id, eventId, createdAt: now, result: stored };
}

export function similarEnvironments(eventId: string) {
  const detail = memoryDetail(eventId);
  const anchor: MarketFingerprint | undefined = detail?.snapshot?.fingerprint;
  if (!detail || !anchor) throw new Error('event has no fingerprint');
  if (!Number.isFinite(anchor.asOf) || anchor.asOf > detail.event.createdAt) return [];
  return all<{ id: string; fingerprint: string }>(`
    SELECT e.id, json_extract(s.payload, '$.fingerprint') AS fingerprint
    FROM ditas_events e JOIN ditas_snapshots s ON s.id = e.snapshot_id
    WHERE e.seq < (SELECT seq FROM ditas_events WHERE id = ?)
      AND e.created_at <= ? AND e.snapshot_id <> ?
      AND json_type(s.payload, '$.fingerprint.asOf') IN ('integer', 'real')
      AND json_extract(s.payload, '$.fingerprint.asOf') <= ?
    ORDER BY e.seq DESC LIMIT 500
  `, eventId, detail.event.createdAt, detail.event.snapshotId, anchor.asOf).flatMap(r => {
    const fp = P<MarketFingerprint>(r.fingerprint);
    const comparison = compareFingerprints(anchor, fp);
    return comparison.comparable ? [{ eventId: r.id, instrumentId: fp.instrumentId, asOf: fp.asOf, ...comparison }] : [];
  }).sort((a, b) => b.similarity! - a.similarity!).slice(0, 20);
}

export function addForecast(eventId: string, probability: number, targetAt: number, referencePrice: number, modelVersion: string, promptVersion: string) {
  const d = memoryDetail(eventId), now = Date.now();
  if (!d?.event.payload.candidate) throw new Error('forecast requires a frozen proposal');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isSafeInteger(targetAt) || targetAt <= now || targetAt - now > 366 * 86400000 || !Number.isFinite(referencePrice) || referencePrice <= 0) throw new Error('invalid probability, reference or future forecast target');
  const c = d.event.payload.candidate;
  if (now < d.event.createdAt || now - d.event.createdAt > 60000 || targetAt <= d.event.createdAt) throw new Error('forecast must follow its event within 60 seconds; capture fresh evidence');
  const registrationLagBucket = Math.floor((now - d.event.createdAt) / 5000);
  const duration = INTERVAL_MS[c.interval as keyof typeof INTERVAL_MS];
  if (targetAt % duration !== 0) throw new Error('forecast target must be a closed timeframe boundary');
  const horizonBars = (targetAt - Math.floor(d.event.createdAt / duration) * duration) / duration;
  // Remaining time to target in quarter-bars: proposals early and late in the same bar have different real horizons.
  const remainingQuarterBars = Math.ceil((targetAt - d.event.createdAt) / (duration / 4));
  if (referencePrice !== c.signal.entryRef) throw new Error('forecast reference must equal frozen proposal entryRef');
  const dedupeKey = sha256(J([c.instrumentId, c.strategyId, c.strategyVersion, c.interval, targetAt, modelVersion, promptVersion]));
  const cohort = J([c.market, c.strategyId, c.strategyVersion, c.interval, modelVersion, promptVersion, 'CLOSE_ABOVE_REFERENCE', horizonBars, remainingQuarterBars, registrationLagBucket]);
  const payload = { target: 'CLOSE_ABOVE_REFERENCE', referencePrice, horizonBars, remainingQuarterBars, registrationLagBucket, modelVersion, promptVersion, instrumentId: c.instrumentId, strategyId: c.strategyId, strategyVersion: c.strategyVersion, timeframe: c.interval, provenance: 'OWNER_REGISTERED_PROBABILITY', note: 'Probability is explicitly supplied, never inferred from QCI votes. No execution authority.' };
  // Duplicates are a client error (400), detected explicitly: raw SQLite constraint errors are server faults (500).
  if (get('SELECT 1 FROM ditas_forecasts WHERE dedupe_key=?', dedupeKey)) throw new Error('duplicate forecast: this target/model/prompt is already registered for the proposal');
  const id = uid('forecast'); run('INSERT INTO ditas_forecasts(id,dedupe_key,event_id,created_at,target_at,probability,cohort,payload) VALUES (?,?,?,?,?,?,?,?)', id, dedupeKey, eventId, now, targetAt, probability, cohort, J(payload));
  return { id, eventId, createdAt: now, targetAt, probability, cohort, ...payload };
}
export function addOutcome(forecastId: string, observedPrice: number, observedAt: number, sourceReference: string) {
  const f = get<any>('SELECT * FROM ditas_forecasts WHERE id=?', forecastId), now = Date.now();
  if (!f) throw new Error('forecast not found');
  if (!Number.isFinite(observedPrice) || observedPrice <= 0 || observedAt !== f.target_at || observedAt > now || observedAt <= f.created_at) throw new Error('outcome must match the forecast target time and follow its recorded forecast');
  const prediction = P(f.payload), outcome = observedPrice > prediction.referencePrice ? 1 : 0, id = uid('outcome');
  const payload = { observedPrice, observedAt, sourceReference, provenance: 'OWNER_REPORTED_UNVERIFIED', target: prediction.target, note: 'Operator-supplied observation, not independently verified exchange history.' };
  if (get('SELECT 1 FROM ditas_outcomes WHERE forecast_id=?', forecastId)) throw new Error('duplicate outcome: this forecast is already settled');
  run('INSERT INTO ditas_outcomes(id,forecast_id,created_at,outcome,payload) VALUES (?,?,?,?,?)', id, forecastId, now, outcome, J(payload));
  return { id, forecastId, createdAt: now, outcome, ...payload };
}
