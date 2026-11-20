import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { all } from '../src/db/db.js';
import { getSetting } from '../src/core/settings.js';
import { failureGate } from '../src/core/ratelimit.js';

/** CodeRabbit review of #45: two security findings in sign-in setup, each reproduced here before the fix. */
describe('auth hardening (CodeRabbit #45)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => { freshDb(); failureGate.reset(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });
  const setup = (setupCode: string, remoteAddress = '198.51.100.7') =>
    app.inject({ method: 'POST', url: '/api/auth/setup', remoteAddress, headers: { 'content-type': 'application/json' }, payload: { password: 'a long enough passphrase', setupCode } });
  const rejectedRows = () => all("SELECT id FROM audit_log WHERE action='auth.setup.code_rejected'").length;

  it('CWE-770: wrong setup codes are rate-limited before each one appends an audit row (one client, then many)', async () => {
    // A fixed clock keeps every attempt inside one failure window, however slowly the test runs.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-11-20T09:00:00.000Z'));
    try {
      const codes: number[] = [];
      for (let i = 0; i < 30; i++) codes.push((await setup('WRONG-CODE')).statusCode);
      expect(codes.slice(0, 5)).toEqual([403, 403, 403, 403, 403]); // the rejection itself is unchanged
      expect(codes.at(-1)).toBe(429);
      expect(rejectedRows()).toBe(5); // was 30: one permanent row per attempt
      // Spreading attempts over many addresses is bounded by the global failure budget.
      for (let i = 0; i < 60; i++) await setup('WRONG-CODE', `203.0.113.${i + 1}`);
      expect(rejectedRows()).toBeLessThanOrEqual(20);
      // The right code still works for a client that is not locked out once the window passes (here: a fresh gate).
      failureGate.reset();
      expect((await app.inject({ method: 'POST', url: '/api/auth/setup', remoteAddress: '192.0.2.10', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('a long enough passphrase') })).statusCode).toBe(200);
    } finally { vi.useRealTimers(); }
  });

  it('CWE-863: a loopback request without forwarding headers no longer skips first-authenticator proof', async () => {
    // app.inject arrives from 127.0.0.1 with no proxy headers: exactly what ssh -L / socat / port-forward look like.
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('a long enough passphrase') });
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    const begin = await app.inject({ method: 'POST', url: '/api/security/2fa/begin', headers: { cookie, 'content-type': 'application/json', 'x-mia-csrf': '1' }, payload: {} });
    expect(begin.json()).toEqual({ needsProof: 'console-code-or-passphrase' }); // was a fresh secret without any proof
    expect(getSetting('owner_2fa_pending', null)).toBeNull();
    // The passphrase is still valid proof for the owner at the machine.
    const withProof = await app.inject({ method: 'POST', url: '/api/security/2fa/begin', headers: { cookie, 'content-type': 'application/json', 'x-mia-csrf': '1' }, payload: { password: 'a long enough passphrase' } });
    expect(withProof.json()).toHaveProperty('secret');
  });
});
