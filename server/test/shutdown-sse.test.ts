import { describe, it, expect, beforeEach } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { bus } from '../src/core/bus.js';

/** MIA-OPS-007: an open live stream must not hold app.close() (graceful stop hung 30 s and exited 1 with one tab open). */
describe('graceful close with open SSE clients', () => {
  beforeEach(() => freshDb());
  it('sends only topic names to an authenticated dashboard subscription', async () => {
    const app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    try {
      const path = '/api/stream?view=topics';
      expect((await app.inject({ url: path })).statusCode).toBe(401);
      const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('sse topic owner') });
      const cookie = String(setup.headers['set-cookie']).split(';')[0];
      const port = (app.server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie }, signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
      bus.publish('notification', { body: 'fixture internal notification' });
      let contents = '';
      while (!contents.includes('event: notification') || !contents.endsWith('\n\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('event stream closed before the notification');
        contents += chunk.value;
      }
      expect(contents).toContain('event: notification\ndata: {}\n\n');
      expect(contents).not.toContain('fixture internal notification');
    } finally {
      controller.abort();
      await app.close();
    }
  });
  it('app.close() ends open live streams and returns promptly', async () => {
    const app = await buildApp(); await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    const s = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('sse close owner') });
    const cookie = String(s.headers['set-cookie']).split(';')[0];
    const ended = new Promise<string>((resolve) => {
      const req = request({ port, host: '127.0.0.1', path: '/api/stream', headers: { cookie } }, (res) => {
        let body = ''; res.on('data', (d) => (body += d)); res.on('end', () => resolve(body)); res.on('close', () => resolve(body));
      });
      req.on('error', () => resolve('error')); req.end();
    });
    await new Promise((r) => setTimeout(r, 300)); // stream is open
    const t0 = Date.now(); await app.close(); const ms = Date.now() - t0;
    expect(ms).toBeLessThan(3_000);
    expect(await ended).toContain(': connected');
  });
});
