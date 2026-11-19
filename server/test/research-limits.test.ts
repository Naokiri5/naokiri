import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { RESEARCH_LIMITS } from '../src/knowledge/routes.js';

/** MIA-SEC-003: Academy research runs (history fetch + walk-forward per strategy) are rate limited like backtests. */
describe('academy research rate limits', () => {
  beforeEach(() => { freshDb(); RESEARCH_LIMITS.experiment.reset(); RESEARCH_LIMITS.comparison.reset(); });
  it('a second strategy comparison within the burst window is refused with 429 before any work starts', async () => {
    const app = await buildApp();
    try {
      const s = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('research limit owner') });
      const h = { cookie: String(s.headers['set-cookie']).split(';')[0], 'x-mia-csrf': '1', 'content-type': 'application/json' };
      const body = { symbol: 'BTCUSDT', interval: '1h', bars: 1500 };
      const first = await app.inject({ method: 'POST', url: '/api/academy/strategy-comparison', headers: h, payload: body });
      expect(first.statusCode).not.toBe(429); // offline: the run itself may fail upstream, but it was allowed to start
      const second = await app.inject({ method: 'POST', url: '/api/academy/strategy-comparison', headers: h, payload: body });
      expect(second.statusCode).toBe(429);
      expect(second.json().error).toMatch(/strategy comparison/);
    } finally { await app.close(); }
  });
  it('experiments allow a burst of 2, then 429', async () => {
    const app = await buildApp();
    try {
      const s = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('research limit owner') });
      const h = { cookie: String(s.headers['set-cookie']).split(';')[0], 'x-mia-csrf': '1', 'content-type': 'application/json' };
      const body = { kind: 'volatility_clustering', symbol: 'BTCUSDT', interval: '1h', bars: 500 };
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: 'POST', url: '/api/academy/experiments', headers: h, payload: body })).statusCode);
      expect(codes.slice(0, 2)).not.toContain(429); expect(codes[2]).toBe(429);
    } finally { await app.close(); }
  });
});
