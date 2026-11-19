import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { CATALOG, topicSpec, catalogSummary } from '../src/fabric/catalog.js';
import { buildEvent, canonicalJson, payloadHash, validateEvent } from '../src/fabric/contracts.js';

/** MIA NEXUS N1: event envelope and topic catalog. Contracts only — nothing produces or consumes fabric events yet. */
const SRC = new URL('../src/', import.meta.url).pathname;
const NOW = Date.parse('2026-11-19T08:00:00.000Z');
const base = () => ({
  eventId: 'evt_0001', eventType: 'market.ticker.updated.v1', source: 'market:fabric', sourceClass: 'MARKET' as const,
  instrumentId: 'binance:BTCUSDT', traceId: 'trace_1', occurredAt: '2026-11-19T07:59:59.500Z', producerVersion: '4.1.0',
  dataStatus: 'VERIFIED' as const, accessClass: 'PUBLIC_MARKET' as const, payload: { last: 64000.5, bid: 64000, ask: 64001 },
});

describe('canonical JSON and payload hash', () => {
  it('is independent of key order and stable across calls', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(payloadHash({ x: 1, y: 2 })).toBe(payloadHash({ y: 2, x: 1 }));
  });
  it('refuses values JSON cannot represent faithfully', () => {
    expect(() => canonicalJson({ v: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
  });
});

describe('event envelope validation (fail closed)', () => {
  it('builds a valid event with hash and UTC times', () => {
    const e = buildEvent(base(), NOW);
    expect(e).toMatchObject({ schemaVersion: 'fabric.event.v1', receivedAt: '2026-11-19T08:00:00.000Z', recordedAt: '2026-11-19T08:00:00.000Z' });
    expect(e.payloadHash).toBe(payloadHash(base().payload));
    expect(validateEvent(e).ok).toBe(true);
  });
  it.each([
    ['an unknown field', (e: any) => ({ ...e, extra: 1 }), /Unrecognized key/],
    ['an unknown schema version', (e: any) => ({ ...e, schemaVersion: 'fabric.event.v2' }), /schemaVersion/],
    ['an uncatalogued topic', (e: any) => ({ ...e, eventType: 'market.price.guessed.v1' }), /unknown event type/],
    ['a producer that does not own the topic', (e: any) => ({ ...e, source: 'joe:joe' }), /may only be produced by market:fabric/],
    ['the wrong source class', (e: any) => ({ ...e, sourceClass: 'OMS' }), /sourceClass MARKET/],
    ['a tampered payload', (e: any) => ({ ...e, payload: { ...e.payload, last: 1 } }), /payloadHash does not match/],
    ['a non-UTC timestamp', (e: any) => ({ ...e, receivedAt: '2026-11-19T10:00:00+02:00' }), /receivedAt/],
    ['a future event time', (e: any) => ({ ...e, occurredAt: '2026-11-19T09:00:00.000Z' }), /future/],
    ['received after it was recorded', (e: any) => ({ ...e, receivedAt: '2026-11-19T08:00:01.000Z' }), /receivedAt is after recordedAt/],
    ['a malformed DITAS snapshot reference', (e: any) => ({ ...e, snapshotId: 'snap_latest' }), /snapshotId/],
  ])('rejects %s', (_n, mutate, why) => {
    const r = validateEvent(mutate(buildEvent(base(), NOW)));
    expect(r.ok).toBe(false); expect((r as any).errors.join(' ')).toMatch(why);
  });
  it('rejects secret-looking keys anywhere in the payload, even with a correct hash', () => {
    const payload = { order: { meta: [{ apiKey: 'x' }] } };
    const e = { ...buildEvent({ ...base(), eventType: 'market.ticker.updated.v1', payload: { ok: 1 } }, NOW), payload, payloadHash: payloadHash(payload) };
    const r = validateEvent(e); expect(r.ok).toBe(false); expect((r as any).errors.join(' ')).toMatch(/secret-like keys: payload\.order\.meta\[0\]\.apiKey/);
  });
  it('enforces the per-topic payload size limit', () => {
    expect(() => buildEvent({ ...base(), payload: { blob: 'x'.repeat(5_000) } }, NOW)).toThrow(/exceeds 4096 bytes/);
  });
  it('a RESERVED topic cannot be emitted, so nothing can fake QMC activity', () => {
    const spec = topicSpec('qmc.vote.sealed.v1')!;
    expect(() => buildEvent({ ...base(), eventType: spec.topic, source: spec.producer, sourceClass: 'QMC', accessClass: 'OWNER_PRIVATE', payload: { vote: 'SUPPORT' } }, NOW)).toThrow(/reserved: no producer/);
  });
  it('accepts a valid DITAS content-addressed snapshot reference', () => {
    expect(validateEvent(buildEvent({ ...base(), snapshotId: `snap_${'a'.repeat(64)}` }, NOW)).ok).toBe(true);
  });
});

describe('topic catalog', () => {
  it('lists the 23 NEXUS V3 topics, each once, with a versioned name', () => {
    expect(CATALOG).toHaveLength(23);
    expect(new Set(CATALOG.map((t) => t.topic)).size).toBe(23);
    for (const t of CATALOG) expect(t.topic).toMatch(/^[a-z]+(\.[a-z]+)+\.v1$/);
  });
  it('every implemented topic names ONE existing owner file; reserved topics name none', () => {
    for (const t of CATALOG) {
      if (t.status === 'RESERVED') { expect(t.ownerFile).toBeNull(); expect(t.producer).toMatch(/^reserved:/); }
      else { expect(t.ownerFile, t.topic).not.toBeNull(); expect(existsSync(join(SRC, t.ownerFile!)), t.ownerFile!).toBe(true); }
    }
  });
  it('every ACTIVE_BEST_EFFORT topic maps to a bus topic its owner really publishes today', () => {
    for (const t of CATALOG.filter((x) => x.status === 'ACTIVE_BEST_EFFORT')) {
      expect(t.busTopic, t.topic).not.toBeNull();
      const busSrc = readFileSync(join(SRC, 'core/bus.ts'), 'utf8');
      expect(busSrc, t.topic).toContain(`'${t.busTopic}'`);
    }
  });
  it('financial state topics are never coalesced; halts and outages are P0', () => {
    for (const name of ['order.intent.accepted.v1', 'order.state.changed.v1', 'fill.recorded.v1', 'ledger.updated.v1']) expect(topicSpec(name)!.durability).toBe('NEVER_COALESCE');
    expect(topicSpec('risk.halt.activated.v1')!.priority).toBe('P0');
    expect(topicSpec('ops.system.degraded.v1')!.priority).toBe('P0');
  });
  it('all QMC topics are RESERVED (the 1,000-profile registry was not supplied)', () => {
    const qmc = CATALOG.filter((t) => t.topic.startsWith('qmc.'));
    expect(qmc.length).toBe(4); expect(qmc.every((t) => t.status === 'RESERVED')).toBe(true);
  });
  it('the fabric module has no authority: it imports nothing from risk, OMS, ledger, wallet, decision or QCI', () => {
    const dir = join(SRC, 'fabric');
    const src = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/from ['"][^'"]*(risk\/|exec\/|portfolio\/|wallet\/|decision\/|qci\/|db\/)/);
  });
});

describe('fabric catalog route', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeAll(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: { password: 'fabric route owner' } })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); });
  it('needs an owner session and returns the catalog with honest counts', async () => {
    expect((await app.inject({ url: '/api/fabric/catalog' })).statusCode).toBe(401);
    const j = (await app.inject({ url: '/api/fabric/catalog', headers: { cookie } })).json();
    expect(j.counts).toEqual(catalogSummary().counts);
    expect(j.counts.total).toBe(23); expect(j.counts.reserved).toBeGreaterThan(0);
    expect(j.note).toMatch(/sources of truth/);
  });
});
