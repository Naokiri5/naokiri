import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, ownerSetupPayload, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { all, get, run, tx } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { recordOpportunity } from '../src/ditas/memory.js';
import { addOutcome } from '../src/ditas/service.js';
import { buildEvent, validateEvent, type FabricEvent } from '../src/fabric/contracts.js';
import { appendEvent, OutboxError } from '../src/fabric/outbox.js';
import { _resetConsumersForTests, outboxHealth, registerConsumer, relayOnce } from '../src/fabric/relay.js';

/** MIA NEXUS N2: durable transactional outbox, inbox dedup, relay retry/dead-letter. Fixed clocks, in-memory DB, offline. */
const NOW = Date.parse('2026-11-19T09:00:00.000Z');
const count = (table: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n;
let instrumentId = '';

function seedForecast(key: string, referencePrice = 100) {
  const event = recordOpportunity({ kind: 'NO_SIGNAL', instrumentId, strategyId: 'trend_pullback', dedupeKey: `outbox:${key}`, reason: 'Synthetic fixture: entry conditions absent' });
  const id = `forecast_${key}`;
  run('INSERT INTO ditas_forecasts(id,dedupe_key,event_id,created_at,target_at,probability,cohort,payload) VALUES (?,?,?,?,?,?,?,?)',
    id, `fixture-forecast-${key}`, event.id, 1, 2, 0.5, 'fixture', JSON.stringify({ referencePrice, target: 'close above reference' }));
  return { forecastId: id, eventId: event.id };
}
/** A valid durable event built directly (same topic/producer as the real DITAS producer). */
function outcomeEvent(n: number, traceId = 'trace_fixture'): FabricEvent {
  return buildEvent({ eventId: `ditas.outcome.fixture_${n}`, eventType: 'ditas.outcome.recorded.v1', source: 'ditas:service', sourceClass: 'DITAS',
    traceId, occurredAt: new Date(NOW - 1000).toISOString(), producerVersion: 'ditas-service@1', dataStatus: 'UNVERIFIED', accessClass: 'OWNER_PRIVATE',
    payload: { outcomeId: `o${n}`, forecastId: `f${n}`, decisionEventId: 'e', outcome: 1, observedPrice: 101, observedAt: NOW - 1000, provenance: 'OWNER_REPORTED_UNVERIFIED' } }, NOW);
}
const append = (n: number) => tx(() => appendEvent(outcomeEvent(n), NOW));

beforeEach(() => { freshDb(); _resetConsumersForTests(); market.reset(); instrumentId = seedInstrument('OUTBOXUSDT', { seed: 7 }).inst.id; });
afterEach(() => { _resetConsumersForTests(); });

describe('transactional outbox', () => {
  it('refuses to append outside the business transaction', () => {
    expect(() => appendEvent(outcomeEvent(1), NOW)).toThrow(OutboxError);
    expect(count('fabric_outbox')).toBe(0);
  });
  it('a rolled-back business transaction leaves no event behind', () => {
    expect(() => tx(() => { appendEvent(outcomeEvent(1), NOW); throw new Error('business write failed'); })).toThrow(/business write failed/);
    expect(count('fabric_outbox')).toBe(0);
  });
  it('refuses topics that are not enabled for durable delivery and invalid envelopes', () => {
    const ticker = buildEvent({ eventId: 'evt_t', eventType: 'market.ticker.updated.v1', source: 'market:fabric', sourceClass: 'MARKET', traceId: 't',
      occurredAt: new Date(NOW - 10).toISOString(), producerVersion: '4.1.0', dataStatus: 'VERIFIED', accessClass: 'PUBLIC_MARKET', payload: { last: 1 } }, NOW);
    expect(() => tx(() => appendEvent(ticker, NOW))).toThrow(/not enabled for durable delivery/);
    const tampered = { ...outcomeEvent(2), payload: { outcome: 0 } };
    expect(() => tx(() => appendEvent(tampered as FabricEvent, NOW))).toThrow(/invalid fabric event/);
    expect(count('fabric_outbox')).toBe(0);
  });
  it('a duplicate event id is rejected, so a retried producer cannot double-publish', () => {
    append(1);
    expect(() => append(1)).toThrow(/UNIQUE/);
    expect(count('fabric_outbox')).toBe(1);
  });
  it('stored envelopes are immutable and the log is append-only', () => {
    append(1);
    expect(() => run("UPDATE fabric_outbox SET envelope='{}' WHERE seq=1")).toThrow(/immutable/);
    expect(() => run("UPDATE fabric_outbox SET payload_hash='x' WHERE seq=1")).toThrow(/immutable/);
    expect(() => run('DELETE FROM fabric_outbox')).toThrow(/append-only/);
    run("UPDATE fabric_outbox SET attempts=1 WHERE seq=1"); // delivery bookkeeping stays writable
    expect(get<{ attempts: number }>('SELECT attempts FROM fabric_outbox WHERE seq=1')!.attempts).toBe(1);
  });
});

describe('DITAS outcome producer', () => {
  it('writes the outcome row and a valid event in one transaction, with decision lineage', () => {
    const { forecastId, eventId } = seedForecast('a');
    const before = { orders: count('orders'), fills: count('fills'), ledger: count('ledger_entries') };
    const out = addOutcome(forecastId, 105, 2, 'fixture source');
    expect(out.outcome).toBe(1);
    const row = get<{ envelope: string; event_type: string; status: string; producer: string }>('SELECT envelope, event_type, status, producer FROM fabric_outbox')!;
    expect(row).toMatchObject({ event_type: 'ditas.outcome.recorded.v1', status: 'PENDING', producer: 'ditas:service' });
    const event = JSON.parse(row.envelope) as FabricEvent;
    expect(validateEvent(event).ok).toBe(true);
    const origin = get<{ snapshot_id: string | null; instrument: string }>('SELECT snapshot_id, instrument FROM ditas_events WHERE id=?', eventId)!;
    expect(event).toMatchObject({ eventId: `ditas.outcome.${out.id}`, traceId: eventId, causationId: forecastId, instrumentId: origin.instrument, dataStatus: 'UNVERIFIED' });
    expect(event.snapshotId ?? null).toBe(origin.snapshot_id);
    expect(event.payload).toMatchObject({ outcomeId: out.id, provenance: 'OWNER_REPORTED_UNVERIFIED' });
    // Research event only: paper orders, fills and ledger are untouched.
    expect({ orders: count('orders'), fills: count('fills'), ledger: count('ledger_entries') }).toEqual(before);
  });
  it('a rejected outcome (duplicate settlement) writes neither the row nor an event', () => {
    const { forecastId } = seedForecast('b');
    addOutcome(forecastId, 99, 2, 'first');
    expect(() => addOutcome(forecastId, 101, 2, 'second')).toThrow(/duplicate outcome/);
    expect(count('ditas_outcomes')).toBe(1);
    expect(count('fabric_outbox')).toBe(1);
  });
  it('if the event cannot be stored, the outcome row is rolled back too', () => {
    const { forecastId } = seedForecast('c');
    run("CREATE TRIGGER fixture_block_outbox BEFORE INSERT ON fabric_outbox BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END");
    expect(() => addOutcome(forecastId, 101, 2, 'x')).toThrow(/outbox unavailable/);
    expect(count('ditas_outcomes')).toBe(0);
  });
});

describe('relay and consumer inbox', () => {
  it('delivers each event to each subscribed consumer once, in outbox order', () => {
    const seen: string[] = [];
    registerConsumer({ id: 'test:readmodel', topics: ['ditas.outcome.recorded.v1'], handle: (e) => { seen.push(e.eventId); } });
    append(1); append(2); append(3);
    expect(relayOnce({ nowMs: NOW })).toEqual({ delivered: 3, retried: 0, dead: 0, skippedBehindFailure: 0, noConsumer: 0 });
    expect(seen).toEqual(['ditas.outcome.fixture_1', 'ditas.outcome.fixture_2', 'ditas.outcome.fixture_3']);
    expect(relayOnce({ nowMs: NOW + 1 })).toEqual({ delivered: 0, retried: 0, dead: 0, skippedBehindFailure: 0, noConsumer: 0 });
    expect(count('fabric_inbox')).toBe(3);
  });
  it('redelivery after a crash between handling and the status update is ignored by the inbox', () => {
    let effects = 0;
    registerConsumer({ id: 'test:readmodel', topics: ['ditas.outcome.recorded.v1'], handle: () => { effects++; } });
    append(1);
    relayOnce({ nowMs: NOW });
    run("UPDATE fabric_outbox SET status='PENDING', delivered_at=NULL WHERE seq=1"); // simulate the lost status write
    expect(relayOnce({ nowMs: NOW + 1 }).delivered).toBe(1);
    expect(effects).toBe(1);
  });
  it('a handler failure rolls back its own writes and is retried with backoff', () => {
    let fail = true;
    registerConsumer({ id: 'test:flaky', topics: ['ditas.outcome.recorded.v1'], handle: () => {
      run("INSERT INTO settings(key,value,updated_at) VALUES ('fixture-side-effect','1',0)");
      if (fail) throw new Error('read model offline');
    } });
    append(1);
    expect(relayOnce({ nowMs: NOW }).retried).toBe(1);
    expect(get("SELECT 1 FROM settings WHERE key='fixture-side-effect'")).toBeUndefined();
    const r = get<{ attempts: number; deliver_after: number; last_error: string; status: string }>('SELECT attempts, deliver_after, last_error, status FROM fabric_outbox')!;
    expect(r).toMatchObject({ attempts: 1, deliver_after: NOW + 1000, status: 'PENDING' });
    expect(r.last_error).toMatch(/test:flaky: read model offline/);
    expect(relayOnce({ nowMs: NOW + 999 }).retried).toBe(0); // not due yet
    fail = false;
    expect(relayOnce({ nowMs: NOW + 1000 }).delivered).toBe(1);
  });
  it('a later event of the same topic never overtakes a failed one', () => {
    const seen: string[] = [];
    registerConsumer({ id: 'test:ordered', topics: ['ditas.outcome.recorded.v1'], handle: (e) => {
      if (e.eventId.endsWith('_1') && seen.length === 0) { seen.push('fail'); throw new Error('first fails once'); }
      seen.push(e.eventId);
    } });
    append(1); append(2);
    expect(relayOnce({ nowMs: NOW })).toEqual({ delivered: 0, retried: 1, dead: 0, skippedBehindFailure: 1, noConsumer: 0 });
    expect(count('fabric_inbox')).toBe(0);
    // A pass while event 1 is still backing off must NOT deliver event 2 (ordering holds across passes).
    expect(relayOnce({ nowMs: NOW + 500 })).toEqual({ delivered: 0, retried: 0, dead: 0, skippedBehindFailure: 1, noConsumer: 0 });
    append(3);
    expect(relayOnce({ nowMs: NOW + 600 }).skippedBehindFailure).toBe(2);
    expect(seen).toEqual(['fail']);
    expect(relayOnce({ nowMs: NOW + 1000 }).delivered).toBe(3);
    expect(seen).toEqual(['fail', 'ditas.outcome.fixture_1', 'ditas.outcome.fixture_2', 'ditas.outcome.fixture_3']);
  });
  it('a dead event releases the queue for later events, and the gap is audited', () => {
    const seen: string[] = [];
    registerConsumer({ id: 'test:ordered', topics: ['ditas.outcome.recorded.v1'], handle: (e) => { if (e.eventId.endsWith('_1')) throw new Error('poison'); seen.push(e.eventId); } });
    append(1); append(2);
    expect(relayOnce({ nowMs: NOW, maxAttempts: 1 })).toMatchObject({ dead: 1, delivered: 1 });
    expect(seen).toEqual(['ditas.outcome.fixture_2']);
    expect(all("SELECT 1 FROM audit_log WHERE action='fabric.dead_letter'")).toHaveLength(1);
  });
  it('an event nobody subscribes to is NO_CONSUMER, not DELIVERED', () => {
    append(1);
    expect(relayOnce({ nowMs: NOW })).toMatchObject({ delivered: 0, noConsumer: 1 });
    expect(get<{ status: string }>('SELECT status FROM fabric_outbox')!.status).toBe('NO_CONSUMER');
    expect(outboxHealth(NOW).counts.NO_CONSUMER).toBe(1);
  });
  it('after maxAttempts the event is dead-lettered, audited and the owner is notified — never deleted', () => {
    registerConsumer({ id: 'test:broken', topics: ['ditas.outcome.recorded.v1'], handle: () => { throw new Error('always fails'); } });
    append(1);
    let t = NOW;
    for (let i = 0; i < 2; i++) { relayOnce({ nowMs: t, maxAttempts: 3 }); t += 10 * 60_000; }
    expect(relayOnce({ nowMs: t, maxAttempts: 3 }).dead).toBe(1);
    expect(get<{ status: string; attempts: number }>('SELECT status, attempts FROM fabric_outbox')).toEqual({ status: 'DEAD', attempts: 3 });
    expect(all<{ action: string }>("SELECT action FROM audit_log WHERE action='fabric.dead_letter'")).toHaveLength(1);
    expect(all<{ title: string }>("SELECT title FROM notifications WHERE source='fabric'").map((n) => n.title)).toEqual(['Fabric event dead-lettered']);
    expect(relayOnce({ nowMs: t + 3_600_000 }).dead).toBe(0); // dead letters are not retried automatically
    const h = outboxHealth(t);
    expect(h.counts).toEqual({ PENDING: 0, DELIVERED: 0, NO_CONSUMER: 0, DEAD: 1 });
    expect(h.deadLetters[0]).toMatchObject({ eventId: 'ditas.outcome.fixture_1', attempts: 3 });
  });
  it('a stored envelope that no longer parses is dead-lettered, not delivered', () => {
    let calls = 0;
    registerConsumer({ id: 'test:readmodel', topics: ['ditas.outcome.recorded.v1'], handle: () => { calls++; } });
    // Bypass the immutability trigger only to simulate on-disk corruption.
    run('DROP TRIGGER fabric_outbox_envelope_immutable'); append(1);
    run("UPDATE fabric_outbox SET envelope='{\"schemaVersion\":\"bogus\"}' WHERE seq=1");
    expect(relayOnce({ nowMs: NOW }).dead).toBe(1);
    expect(calls).toBe(0);
  });
  it.each([
    ['not valid JSON (does not stall the relay)', () => 'not json{'],
    ['a payload whose hash no longer matches', (env: any) => JSON.stringify({ ...env, payload: { ...env.payload, outcome: 0 } })],
    ['an envelope for a different event id', (env: any) => JSON.stringify({ ...env, eventId: 'ditas.outcome.other' })],
    // 1e400 parses to Infinity and canonicalization throws: the relay must dead-letter it, not stop (CodeRabbit #45).
    ['a payload number that overflows to Infinity', (env: any) => JSON.stringify(env).replace('"outcome":1,', '"outcome":1e400,')],
  ])('a stored envelope with %s is dead-lettered and later events still flow', (_n, corrupt) => {
    const seen: string[] = [];
    registerConsumer({ id: 'test:readmodel', topics: ['ditas.outcome.recorded.v1'], handle: (e) => { seen.push(e.eventId); } });
    run('DROP TRIGGER fabric_outbox_envelope_immutable'); append(1); append(2);
    const env = JSON.parse(get<{ envelope: string }>('SELECT envelope FROM fabric_outbox WHERE seq=1')!.envelope);
    run('UPDATE fabric_outbox SET envelope=? WHERE seq=1', corrupt(env));
    expect(relayOnce({ nowMs: NOW })).toMatchObject({ dead: 1, delivered: 1 });
    expect(seen).toEqual(['ditas.outcome.fixture_2']);
  });
  it('health reports measured counts and the oldest pending age', () => {
    expect(outboxHealth(NOW)).toMatchObject({ counts: { PENDING: 0, DELIVERED: 0, NO_CONSUMER: 0, DEAD: 0 }, oldestPendingAgeMs: null, deadLetters: [] });
    append(1);
    expect(outboxHealth(NOW + 5000).oldestPendingAgeMs).toBe(5000);
  });
  it('rejects malformed consumer ids', () => {
    expect(() => registerConsumer({ id: 'Bad Id!', topics: [], handle: () => {} })).toThrow(/invalid consumer id/);
  });
});

describe('fabric outbox route', () => {
  it('needs an owner session and returns measured health', async () => {
    failureGate.reset(); const app = await buildApp();
    try {
      const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('fabric outbox owner') })).headers['set-cookie']).split(';')[0];
      expect((await app.inject({ url: '/api/fabric/outbox' })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/fabric/outbox?view=summary' })).statusCode).toBe(401);
      const j = (await app.inject({ url: '/api/fabric/outbox', headers: { cookie } })).json();
      expect(j.counts).toEqual({ PENDING: 0, DELIVERED: 0, NO_CONSUMER: 0, DEAD: 0 });
      expect(Array.isArray(j.consumers)).toBe(true);

      append(1);
      run("UPDATE fabric_outbox SET status='DEAD', attempts=1, last_error=?", 'fixture internal relay error');
      const full = await app.inject({ url: '/api/fabric/outbox', headers: { cookie } });
      expect(full.json().deadLetters).toMatchObject([{ lastError: 'fixture internal relay error' }]);
      const summary = await app.inject({ url: '/api/fabric/outbox?view=summary', headers: { cookie } });
      expect(summary.statusCode).toBe(200);
      expect(summary.json()).toEqual({ counts: { PENDING: 0, DELIVERED: 0, NO_CONSUMER: 0, DEAD: 1 }, oldestPendingAgeMs: null, consumers: [] });
    } finally { await app.close(); }
  });
});
