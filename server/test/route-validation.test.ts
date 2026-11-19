import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';

/** H-04 / H-08 (100-agent audit, Squad H). */
const PW = 'route-validation owner';
const json = { 'content-type': 'application/json' };
describe('route input validation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let h: Record<string, string> = {};
  beforeAll(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: json, payload: ownerSetupPayload(PW) });
    h = { ...json, cookie: String(r.headers['set-cookie']).split(';')[0], 'x-mia-csrf': '1' };
  });
  afterAll(async () => { await app.close(); });
  it('H-08: /api/control rejects unknown keys', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/control', headers: h, payload: { zzz: 1 } })).statusCode).toBe(400);
  });
  it('H-04: invalid strategy-comparison requests do not spend the rate-limit budget', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/academy/strategy-comparison', headers: h, payload: { symbol: 'bad symbol!' } });
      expect(r.statusCode, `attempt ${i}`).toBe(400); // used to become 429 after the budget was spent on invalid input
    }
  });
});
