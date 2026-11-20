import { describe, it, expect, beforeEach } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';

/** MIA-OPS-007: an open live stream must not hold app.close() (graceful stop hung 30 s and exited 1 with one tab open). */
describe('graceful close with open SSE clients', () => {
  beforeEach(() => freshDb());
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
