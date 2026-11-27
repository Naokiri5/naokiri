import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { closeDb, openDb, run } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { telemetry } from '../src/core/telemetry.js';
import { sha256 } from '../src/core/util.js';

describe('owner telemetry streams', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let base: string;
  let appClosed: boolean;

  beforeEach(async () => {
    closeDb();
    openDb(':memory:');
    app = await buildApp();
    appClosed = false;
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie']).split(';')[0];
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (!appClosed) await app.close();
    closeDb();
  });

  async function openStream(query = '', headers: Record<string, string> = {}) {
    const signal = AbortSignal.timeout(4_000);
    const res = await fetch(`${base}/api/stream${query}`, { headers: { cookie, ...headers }, signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    return { reader: res.body!.getReader(), signal };
  }

  type Stream = Awaited<ReturnType<typeof openStream>>;

  async function readUntil(stream: Stream, marker: string) {
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes(marker)) {
      const result = await stream.reader.read();
      if (result.done) throw new Error('stream closed before delivering the expected frame');
      received += decoder.decode(result.value, { stream: true });
    }
    return received;
  }

  async function readToClose(stream: Stream) {
    const decoder = new TextDecoder();
    let received = '';
    try {
      for (;;) {
        const result = await stream.reader.read();
        if (result.done) break;
        received += decoder.decode(result.value, { stream: true });
      }
    } catch (error) {
      if (stream.signal.aborted) throw error;
      // A server-side destroy can surface as an abrupt end to Fetch's body.
      expect(error).toBeInstanceOf(TypeError);
    }
    return received + decoder.decode();
  }

  it('ends open SSE responses so app.close() does not wait for the forced exit', async () => {
    const stream = await openStream();
    await readUntil(stream, 'event: hello');
    const started = Date.now();
    await app.close();
    appClosed = true;
    expect((await stream.reader.read()).done).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 15_000);

  it('replays only requested topics for an active owner session', async () => {
    const cursor = telemetry.lastId;
    telemetry.record('news', { marker: 'filtered-out' });
    const order = telemetry.record('order', { marker: 'replay-fixture' });
    const stream = await openStream('?topics=order', { 'last-event-id': cursor });
    const frames = await readUntil(stream, 'replay-fixture');
    expect(frames).toContain(`id: ${order.id}\nevent: order`);
    expect(frames).not.toContain('filtered-out');
    await stream.reader.cancel();
  });

  it('stops delivering telemetry immediately after an owner logs out', async () => {
    const stream = await openStream('?topics=order');
    await readUntil(stream, 'event: hello');
    telemetry.record('order', { marker: 'before-logout' });
    await readUntil(stream, 'before-logout');

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-mia-csrf': '1' } });
    expect(logout.statusCode).toBe(200);
    telemetry.record('order', { marker: 'after-logout' });
    expect(await readToClose(stream)).not.toContain('after-logout');
  });

  it('closes an idle stream when its established session expires', async () => {
    const token = cookie.slice(cookie.indexOf('=') + 1);
    const expiresAt = Date.now() + 1_250;
    run('UPDATE sessions SET expires_at=? WHERE token_hash=?', expiresAt, sha256(token));
    const stream = await openStream();
    await readUntil(stream, 'event: hello');
    await readToClose(stream);
    expect(Date.now()).toBeGreaterThanOrEqual(expiresAt);
  });

  it('discards a frame whose UTF-8 size exceeds the stream limit', async () => {
    const stream = await openStream('?topics=order');
    await readUntil(stream, 'event: hello');
    telemetry.record('order', { marker: 'oversize-frame', body: 'é'.repeat(40_000) });
    expect(await readToClose(stream)).not.toContain('oversize-frame');
  });
});
