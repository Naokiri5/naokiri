import { describe, it, expect } from 'vitest';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';

describe('graceful shutdown with an open live stream', () => {
  it('ends open SSE responses so app.close() does not wait for the forced exit', async () => {
    closeDb(); openDb(':memory:');
    const app = await buildApp();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/stream`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: hello');
    const started = Date.now();
    await app.close();
    // The stream ends rather than staying open until the client goes away.
    for (let r = await reader.read(); !r.done; r = await reader.read()) { /* drain */ }
    expect(Date.now() - started).toBeLessThan(5_000);
    closeDb();
  }, 15_000);
});
