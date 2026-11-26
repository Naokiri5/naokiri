import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get as httpGet, type ClientRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bus } from '../src/core/bus.js';
import { telemetry, TelemetryJournal } from '../src/core/telemetry.js';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';

describe('telemetry journal', () => {
  it('assigns ordered ids and replays exactly the missed events', () => {
    const journal = new TelemetryJournal(10);
    const first = journal.record('order', { n: 1 }, 1);
    journal.record('position', { n: 2 }, 2);
    journal.record('risk', { n: 3 }, 3);
    expect(first.id).toBe(`${journal.bootId}:1`);
    expect(journal.lastId).toBe(`${journal.bootId}:3`);
    expect(journal.since(first.id)).toEqual({ resync: false, events: [
      expect.objectContaining({ sequence: 2, topic: 'position', payload: { n: 2 } }),
      expect.objectContaining({ sequence: 3, topic: 'risk', payload: { n: 3 } }),
    ] });
    expect(journal.since(journal.lastId)).toEqual({ resync: false, events: [] });
    expect(journal.since(`${journal.bootId}:0`)).toMatchObject({ resync: false, events: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }] });
  });

  it('asks for a resync whenever the gap cannot be filled exactly', () => {
    const journal = new TelemetryJournal(3);
    for (let i = 1; i <= 5; i++) journal.record('ticker', { i });
    expect(journal.since(`${journal.bootId}:1`)).toEqual({ resync: true, reason: 'GAP_OLDER_THAN_JOURNAL' });
    expect(journal.since(`${journal.bootId}:2`)).toMatchObject({ resync: false, events: [{ sequence: 3 }, { sequence: 4 }, { sequence: 5 }] });
    expect(journal.since(`${journal.bootId === '00000000' ? '00000001' : '00000000'}:4`)).toEqual({ resync: true, reason: 'SERVER_RESTARTED' });
    expect(journal.since(`${journal.bootId}:9`)).toEqual({ resync: true, reason: 'EVENT_ID_IN_FUTURE' });
    for (const bad of ['', 'x', `${journal.bootId}:-1`, `${journal.bootId}:01`, `${journal.bootId}:1:2`])
      expect(journal.since(bad), bad).toEqual({ resync: true, reason: 'MALFORMED_EVENT_ID' });
  });

  it('keeps the ring bounded and isolates failing subscribers', () => {
    const journal = new TelemetryJournal(4);
    const seen: number[] = [];
    journal.subscribe(() => { throw new Error('closed socket'); });
    const stop = journal.subscribe((e) => seen.push(e.sequence));
    for (let i = 0; i < 100; i++) journal.record('ticker', null);
    stop();
    journal.record('ticker', null);
    expect(seen).toHaveLength(100);
    expect(journal.since(`${journal.bootId}:97`)).toMatchObject({ resync: false, events: [{ sequence: 98 }, { sequence: 99 }, { sequence: 100 }, { sequence: 101 }] });
    expect(() => new TelemetryJournal(0)).toThrow('TELEMETRY_CAPACITY_INVALID');
  });

  it('journals every bus event', () => {
    const before = telemetry.lastId;
    bus.publish('notification', { probe: true });
    const replay = telemetry.since(before);
    expect(replay).toMatchObject({ resync: false, events: [{ topic: 'notification', payload: { probe: true } }] });
  });
});

describe('live stream (authenticated, read-only, gap-free reconnection)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let base = ''; let cookie = '';
  const open: ClientRequest[] = [];
  beforeAll(async () => {
    closeDb(); openDb(':memory:');
    app = await buildApp();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
    cookie = String(setup.headers['set-cookie']).split(';')[0];
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { for (const r of open) r.destroy(); await app.close(); closeDb(); });

  /** Open a stream and return a reader that waits until the received text satisfies a predicate. */
  function stream(path: string, headers: Record<string, string> = {}) {
    let text = '';
    const response = new Promise<number>((resolve, reject) => {
      const request = httpGet(`${base}${path}`, { headers: { cookie, ...headers } }, (res) => {
        resolve(res.statusCode ?? 0);
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { text += chunk; });
      });
      request.on('error', reject);
      open.push(request);
    });
    const until = async (predicate: (t: string) => boolean) => {
      for (let i = 0; i < 200 && !predicate(text); i++) await new Promise((r) => setTimeout(r, 10));
      if (!predicate(text)) throw new Error(`stream did not produce the expected events:\n${text}`);
      return text;
    };
    return { response, until, text: () => text };
  }

  it('rejects unauthenticated clients and unknown topics', async () => {
    expect((await app.inject({ url: '/api/stream' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/stream?topics=order,secret', headers: { cookie } })).statusCode).toBe(400);
  });

  it('delivers only the subscribed topics with ids, and replays exactly what a reconnecting client missed', async () => {
    const live = stream('/api/stream?topics=order,position');
    expect(await live.response).toBe(200);
    await live.until((t) => t.includes('event: hello'));
    bus.publish('ticker', { ignored: true });
    bus.publish('order', { orderId: 'o1' });
    const text = await live.until((t) => t.includes('"orderId":"o1"'));
    expect(text).not.toContain('event: ticker');
    const lastId = /id: ([0-9a-f]{8}:\d+)\nevent: order/.exec(text)![1];

    // While the client is away, two more events happen; on reconnect it receives exactly those, in order.
    bus.publish('position', { positionId: 'p1' });
    bus.publish('order', { orderId: 'o2' });
    const resumed = stream('/api/stream?topics=order,position', { 'last-event-id': lastId });
    const replayed = await resumed.until((t) => t.includes('"orderId":"o2"'));
    expect(replayed).not.toContain('"orderId":"o1"');
    expect(replayed.indexOf('"positionId":"p1"')).toBeLessThan(replayed.indexOf('"orderId":"o2"'));
    expect(replayed.match(/"orderId":"o2"/g)).toHaveLength(1);
  });

  it('tells a client to resync when its last id cannot be replayed', async () => {
    const stale = stream('/api/stream', { 'last-event-id': '00000000:1' });
    const text = await stale.until((t) => t.includes('event: resync'));
    expect(text).toMatch(/event: resync\ndata: \{"reason":"(SERVER_RESTARTED|GAP_OLDER_THAN_JOURNAL)"\}/);
  });
});
