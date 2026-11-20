import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDb, seedInstrument } from './helpers.js';
import { all, closeDb, get, getDb, openDb, run, tx } from '../src/db/db.js';
import { SCHEMA_VERSION } from '../src/db/migrations.js';
import { correctEvent, memoryDetail, memoryEvents, recordOpportunity, verifyMemory } from '../src/ditas/memory.js';
import { market } from '../src/market/store.js';
import { analyzeInstrument, buildContext } from '../src/market/scanner.js';
import { decide } from '../src/decision/engine.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { strategyById } from '../src/lab/strategies.js';
import type { Candidate } from '../src/workers/types.js';

describe('DITAS permanent decision memory', () => {
  let instrumentId: string; const folders: string[] = [];
  const record = (dedupeKey = 'fixture:opportunity') => recordOpportunity({ kind: 'NO_SIGNAL', instrumentId, strategyId: 'trend_pullback', dedupeKey, reason: 'Synthetic fixture: entry conditions absent' });
  const count = (table: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n;
  const candidate = (): Candidate => {
    const close = market.deep.get(instrumentId)!.engines['1h'].last!.close;
    return { id: 'fixture-candidate', eventId: 'fixture-event', traceId: 'fixture-trace', instrumentId, symbol: 'MEMORYUSDT', base: 'MEMORY', market: 'crypto', venue: 'binance',
      strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h', regime: 'TREND_UP', createdAt: Date.now(),
      signal: { direction: 'long', entryRef: close, stop: close * 0.95, targets: [{ r: 2, fraction: 1 }], maxHoldBars: 48, trailAfterR: 1, trigger: 'fixture trigger', invalidation: 'fixture invalidation', reasons: ['fixture evidence'] } };
  };
  beforeEach(() => { freshDb(false); market.reset(); instrumentId = seedInstrument('MEMORYUSDT').inst.id; });
  afterEach(() => { closeDb(); market.reset(); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

  it('deduplicates retries without changing the original evidence or adding snapshots', () => {
    const first = record(), firstDetail = memoryDetail(first.id);
    market.tickers.get(instrumentId)!.last *= 2;
    const retry = recordOpportunity({ kind: 'REJECTED', instrumentId, strategyId: 'range_reversion', dedupeKey: 'fixture:opportunity', reason: 'Changed retry is not a correction' });
    expect(retry).toEqual(first); expect(memoryDetail(first.id)).toEqual(firstDetail);
    expect(count('ditas_events')).toBe(1); expect(count('ditas_snapshots')).toBe(1);
  });

  it('freezes market snapshots and returns independent parsed objects', () => {
    const d = market.deep.get(instrumentId)!;
    expect(memoryDetail(record('fixture:unattributed-book').id)!.snapshot!.book).toMatchObject({ source: null, lastUpdateId: null });
    d.book = { ...d.book!, source: 'BINANCE_SPOT_DEPTH_STREAM', lastUpdateId: 123 };
    const event = record(), frozen = memoryDetail(event.id)!;
    expect(frozen.snapshot!.book).toMatchObject({ source: 'BINANCE_SPOT_DEPTH_STREAM', lastUpdateId: 123, ts: d.book.ts });
    market.tickers.get(instrumentId)!.last = 99999;
    d.engines['1h'].candles[0].c = 55555;
    d.book!.bids[0][0] = 44444;
    d.book.lastUpdateId = 124;
    d.book.source = 'BINANCE_SPOT_REST';
    d.cross.kraken.price = 33333;
    expect(memoryDetail(event.id)).toEqual(frozen);
    frozen.snapshot!.ticker.last = 12345;
    expect(memoryDetail(event.id)!.snapshot!.ticker.last).not.toBe(12345);
    expect(memoryDetail(event.id)!.snapshot!.lineage).toMatchObject({ modelVersion: null, promptVersion: null, calibrationId: null });
    expect(verifyMemory()).toEqual({ ok: true, entries: 2 });
  });

  it('uses frozen pre-QCI evidence for the final decision despite intervening market refreshes', async () => {
    seedInstrument('BTCUSDT');
    const cand = candidate(), ctx = buildContext(cand);
    const proposal = recordOpportunity({ kind: 'PROPOSAL', instrumentId, strategyId: cand.strategyId, dedupeKey: 'fixture:proposal-before-qci', reason: 'fixture review', candidate: cand, ctx });
    ctx.memorySnapshotId = proposal.snapshotId!;
    const originalSnapshot = memoryDetail(proposal.id)!.snapshot;
    const review = runConsensus(ctx);
    // Represent updates arriving while bounded workers review their already-captured context.
    market.tickers.get(instrumentId)!.last = 99999;
    market.deep.get(instrumentId)!.engines['1h'].candles[0].c = 88888;
    market.deep.get(instrumentId)!.book!.bids[0][0] = 77777;
    const report = decide(cand, ctx, await review, null, 0);
    const decision = memoryEvents().find(e => e.decisionId === report.id)!;
    expect(decision.kind).toBe('DECISION'); expect(decision.snapshotId).toBe(proposal.snapshotId);
    expect(memoryDetail(decision.id)!.snapshot).toEqual(originalSnapshot);
    expect(count('ditas_snapshots')).toBe(1); expect(count('decisions')).toBe(1);
    expect(verifyMemory()).toEqual({ ok: true, entries: 2 });
  });

  it('excludes unexpected ticker, candle and feature fields from snapshot records', () => {
    const ticker = market.tickers.get(instrumentId)!;
    const d = market.deep.get(instrumentId)!;
    Object.assign(ticker, { apiKey: 'fixture-runtime-token-field' });
    Object.assign(d.engines['1h'].candles[0], { exchangeToken: 'fixture-runtime-token-field' });
    Object.assign(d.engines['1h'].last!, { executionCredential: 'fixture-runtime-token-field' });
    const snapshot = memoryDetail(record().id)!.snapshot!;
    expect(snapshot.ticker.last).toBe(ticker.last);
    expect(snapshot.candles['1h'][0].t).toBe(d.engines['1h'].candles[0].t);
    expect(snapshot.ticker).not.toHaveProperty('apiKey');
    expect(snapshot.candles['1h'][0]).not.toHaveProperty('exchangeToken');
    expect(snapshot.features['1h']).not.toHaveProperty('executionCredential');
    expect(JSON.stringify(snapshot)).not.toContain('fixture-runtime-token-field');
  });

  it('captures worker BTC inputs and the exact worker ticker with explicit context fields', () => {
    seedInstrument('BTCUSDT', { drift: 0.001, seed: 19 });
    const cand = candidate(), ctx = buildContext(cand);
    const expectedTicker = structuredClone(ctx.ticker);
    const expectedBtc1h = { t: ctx.btc1h!.t, close: ctx.btc1h!.close, ema20: ctx.btc1h!.ema20 };
    const expectedBtc4h = { t: ctx.btc4h!.t, close: ctx.btc4h!.close, ema20: ctx.btc4h!.ema20 };
    Object.assign(ctx.ticker!, { withdrawalCredential: 'fixture-omitted-context-field' });
    Object.assign(ctx.btc1h!, { token: 'fixture-omitted-context-field' });
    market.tickers.get(instrumentId)!.last = 99999;
    const event = recordOpportunity({ kind: 'PROPOSAL', instrumentId, strategyId: cand.strategyId, dedupeKey: 'fixture:exact-worker-context', reason: 'fixture evidence', candidate: cand, ctx });
    const snapshot = memoryDetail(event.id)!.snapshot!;
    expect(snapshot.context.ticker).toEqual(expectedTicker);
    expect(snapshot.context.ticker.last).not.toBe(snapshot.ticker.last);
    expect(snapshot.context.btc1h).toMatchObject(expectedBtc1h); expect(snapshot.context.btc4h).toMatchObject(expectedBtc4h);
    expect(snapshot.context.btc1h).not.toHaveProperty('token');
    expect(snapshot.context.ticker).not.toHaveProperty('withdrawalCredential');
    expect(JSON.stringify(snapshot)).not.toContain('fixture-omitted-context-field');
  });

  it('rejects missing or mismatched original snapshot references without adding partial memory', () => {
    const original = record();
    expect(() => recordOpportunity({ kind: 'DECISION', instrumentId, dedupeKey: 'fixture:missing-snapshot', reason: 'fixture', snapshotId: 'snap_missing' })).toThrow(/snapshot reference/);
    expect(() => recordOpportunity({ kind: 'DECISION', instrumentId: 'crypto:binance:OTHERUSDT', dedupeKey: 'fixture:other-snapshot', reason: 'fixture', snapshotId: original.snapshotId! })).toThrow(/snapshot reference/);
    expect(count('ditas_snapshots')).toBe(1); expect(count('ditas_events')).toBe(1);
  });

  it('allows traceable correction events without overwriting parent evidence', () => {
    const event = record(), original = memoryDetail(event.id)!.event;
    const correction = correctEvent(event.id, 'Operator review', 'The source was delayed; retain original evidence.');
    expect(correction).toMatchObject({ kind: 'CORRECTION', parentEventId: event.id, snapshotId: event.snapshotId });
    const detail = memoryDetail(event.id)!;
    expect(detail.event).toEqual(original); expect(detail.relatedEvents).toEqual([correction]);
    expect(verifyMemory()).toEqual({ ok: true, entries: 2 });
    expect(() => correctEvent(event.id, '', 'correction')).toThrow();
    expect(() => correctEvent('missing', 'review', 'correction')).toThrow(/not found/);
  });

  it('enforces update/delete immutability for memory, simulations and calibration records', () => {
    const event = record();
    run('INSERT INTO ditas_twin_runs(id,event_id,created_at,result,hash) VALUES (?,?,?,?,?)', 'twin', event.id, 1, '{}', 'fixture');
    run('INSERT INTO ditas_forecasts(id,dedupe_key,event_id,created_at,target_at,probability,cohort,payload) VALUES (?,?,?,?,?,?,?,?)', 'forecast', 'fixture-forecast-unique', event.id, 1, 2, 0.5, 'fixture', '{}');
    run('INSERT INTO ditas_outcomes(id,forecast_id,created_at,outcome,payload) VALUES (?,?,?,?,?)', 'outcome', 'forecast', 3, 1, '{}');
    for (const [table, id] of [['ditas_events', event.id], ['ditas_snapshots', event.snapshotId!], ['ditas_twin_runs', 'twin'], ['ditas_forecasts', 'forecast'], ['ditas_outcomes', 'outcome']]) {
      expect(() => run(`UPDATE ${table} SET id=id WHERE id=?`, id)).toThrow(/immutable/);
      expect(() => run(`DELETE FROM ${table} WHERE id=?`, id)).toThrow(/immutable/);
      expect(count(table)).toBe(1);
    }
  });

  it('rolls back a snapshot when event insertion fails', () => {
    getDb().exec("CREATE TRIGGER fixture_reject_event BEFORE INSERT ON ditas_events BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;");
    expect(() => record()).toThrow(/fixture write failure/);
    expect(count('ditas_events')).toBe(0); expect(count('ditas_snapshots')).toBe(0);
  });

  it('participates in an outer transaction so a decision and its memory roll back together', () => {
    expect(() => tx(() => {
      record();
      run('INSERT INTO journal(id,ts,kind,summary) VALUES (?,?,?,?)', 'fixture-journal', 1, 'DECISION', 'fixture');
      throw new Error('fixture outer transaction failure');
    })).toThrow(/outer transaction/);
    expect(count('ditas_events')).toBe(0); expect(count('ditas_snapshots')).toBe(0); expect(count('journal')).toBe(0);
    expect(verifyMemory()).toEqual({ ok: true, entries: 0 });
  });

  it('detects tampering even if a database administrator removes immutable triggers', () => {
    const event = record();
    getDb().exec('DROP TRIGGER ditas_events_no_update');
    run('UPDATE ditas_events SET payload=? WHERE id=?', '{"reason":"tampered"}', event.id);
    expect(verifyMemory()).toEqual({ ok: false, brokenAt: event.id });
  });

  it('detects snapshot content tampering independently of the event chain', () => {
    const event = record();
    getDb().exec('DROP TRIGGER ditas_snapshots_no_update');
    run('UPDATE ditas_snapshots SET payload=? WHERE id=?', '{"source":"tampered"}', event.snapshotId);
    expect(verifyMemory()).toEqual({ ok: false, brokenAt: event.snapshotId });
  });

  it('persists immutable evidence across a real SQLite close and reopen', () => {
    const folder = mkdtempSync(join(tmpdir(), 'mia-ditas-memory-')); folders.push(folder);
    const dbPath = join(folder, 'memory.sqlite'); closeDb(); openDb(dbPath);
    const event = record(), before = memoryDetail(event.id);
    closeDb(); market.reset(); openDb(dbPath);
    expect(memoryDetail(event.id)).toEqual(before);
    expect(verifyMemory()).toEqual({ ok: true, entries: 1 });
    expect(all('SELECT version FROM schema_migrations')).toHaveLength(SCHEMA_VERSION);
  });

  it('records manual no-signal analysis from the seeded closed cache without network calls', async () => {
    const result = await analyzeInstrument(instrumentId, 'range_reversion');
    expect(result).toMatchObject({ status: 'NO_SIGNAL' });
    const [event] = memoryEvents();
    expect(event).toMatchObject({ kind: 'NO_SIGNAL', instrumentId, strategyId: 'range_reversion' });
    expect(event.payload.strategy).toEqual({ id: 'range_reversion', version: strategyById('range_reversion')!.version });
    expect(memoryDetail(event.id)!.snapshot!.candles['1h']).toHaveLength(400);
    expect(verifyMemory()).toEqual({ ok: true, entries: 1 });
  });
});
