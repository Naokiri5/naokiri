import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { getControl } from '../src/core/mode.js';
import { failureGate } from '../src/core/ratelimit.js';

/** MIA-WEB-010: per-strategy operations apply to the server's current list, so a stale client cannot re-enable anything. */
describe('strategy disable/enable operations', () => {
  beforeEach(() => { freshDb(); failureGate.reset(); });
  it('two revokes keep both disabled; re-enable needs the passphrase and touches only that strategy', async () => {
    const app = await buildApp();
    try {
      const PW = 'strategy toggle owner';
      const s = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload(PW) });
      const headers = { cookie: String(s.headers['set-cookie']).split(';')[0], 'x-mia-csrf': '1', 'content-type': 'application/json' };
      const post = (payload: object) => app.inject({ method: 'POST', url: '/api/control', headers, payload });
      expect((await post({ disableStrategy: 'trend_pullback' })).statusCode).toBe(200);
      expect((await post({ disableStrategy: 'breakout' })).statusCode).toBe(200); // a stale client's second revoke
      expect(getControl().disabledStrategies.sort()).toEqual(['breakout', 'trend_pullback']);
      expect((await post({ enableStrategy: 'breakout' })).statusCode).toBe(403); // risk-increasing: step-up required
      expect((await post({ enableStrategy: 'breakout', password: PW })).statusCode).toBe(200);
      expect(getControl().disabledStrategies).toEqual(['trend_pullback']);
      expect((await post({ disableStrategy: 'x', disabledStrategies: [] })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
