import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { beginShutdown, isShuttingDown } from '../src/ops/shutdown.js';
import { closeDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';
import { waitForIdle } from '../src/knowledge/store.js';

describe('canonical process shutdown', () => {
  afterAll(() => closeDb());

  it('latches once and changes the existing readiness endpoint without claiming liveness failure', async () => {
    freshDb();
    const app = await buildApp();
    try {
      expect(isShuttingDown()).toBe(false);
      expect((await app.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(200);
      expect(beginShutdown()).toBe(true);
      expect(beginShutdown()).toBe(false);
      expect(isShuttingDown()).toBe(true);
      const ready = await app.inject({ method: 'GET', url: '/api/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ ready: false, checks: expect.arrayContaining([
        { name: 'lifecycle', status: 'fail', detail: 'process draining' },
      ]) });
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
      await waitForIdle();
    }
  });
});
