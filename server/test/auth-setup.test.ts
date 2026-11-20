import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import * as auth from '../src/api/auth.js';
import { getSetting } from '../src/core/settings.js';
import { all, getDb } from '../src/db/db.js';
import { failureGate } from '../src/core/ratelimit.js';

/** SEC-SETUP regression: every first-owner request requires the console code. */
const json = { 'content-type': 'application/json' };
const setup = (app: Awaited<ReturnType<typeof buildApp>>, remoteAddress: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/setup', remoteAddress, headers: { ...json, ...headers }, payload });
const codeOf = () => getSetting<{ code: string } | null>('setup_code', null)?.code ?? null;

describe('first-owner setup (SEC-SETUP)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const saved = { CODESPACES: process.env.CODESPACES, MIA_ALLOW_REMOTE_SETUP: process.env.MIA_ALLOW_REMOTE_SETUP };
  beforeEach(async () => { freshDb(); failureGate.reset(); delete process.env.MIA_ALLOW_REMOTE_SETUP; process.env.CODESPACES = 'true'; app = await buildApp(); });
  afterEach(async () => { await app.close(); for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

  it('rejects a remote claim inside a container without the one-time code (was 200 before the fix)', async () => {
    const r = await setup(app, '203.0.113.9', { password: 'attacker-owned-passphrase' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/setup code/);
    expect(auth.isSetup()).toBe(false);
    expect(all("SELECT action FROM audit_log WHERE action='auth.setup.code_rejected'")).toHaveLength(1);
  });
  it('rejects a wrong or malformed code', async () => {
    await setup(app, '203.0.113.9', { password: 'attacker-owned-passphrase' }); // creates the code
    for (const setupCode of ['AAAAA-BBBBB-CCCCC-DDDDD', '', 'x'.repeat(64)]) {
      expect((await setup(app, '203.0.113.9', { password: 'attacker-owned-passphrase', setupCode })).statusCode).toBe(403);
    }
    expect((await setup(app, '203.0.113.9', { password: 'attacker-owned-passphrase', setupCode: 'x'.repeat(65) })).statusCode).toBe(400);
    expect(auth.isSetup()).toBe(false);
  });
  it('treats a loopback socket with proxy headers as remote (port forwarders, reverse proxies)', async () => {
    for (const h of ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-funnel-request', 'tailscale-user-login']) {
      failureGate.reset(); // each header is an independent case; the setup-guess limit itself is tested in auth-hardening-45
      expect((await setup(app, '127.0.0.1', { password: 'attacker-owned-passphrase' }, { [h]: '203.0.113.9' })).statusCode).toBe(403);
    }
    expect(auth.isSetup()).toBe(false);
  });
  it('lets the operator, who can read the server console, finish setup remotely with the code (any case or dashes)', async () => {
    const state = await app.inject({ method: 'GET', url: '/api/auth/state', remoteAddress: '203.0.113.9' });
    expect(state.json()).toMatchObject({ setup: false, authenticated: false, setupCodeRequired: true });
    const code = codeOf()!; expect(code).toMatch(/^[A-Z2-9]{20}$/);
    const typed = code.toLowerCase().match(/.{1,5}/g)!.join(' - ');
    const r = await setup(app, '203.0.113.9', { password: 'legit owner passphrase', setupCode: typed });
    expect(r.statusCode).toBe(200); expect(String(r.headers['set-cookie'])).toMatch(/mia_session=/);
    expect(auth.isSetup()).toBe(true);
    expect(codeOf()).toBeNull(); // single use
    expect((await setup(app, '203.0.113.9', { password: 'second claim attempt', setupCode: typed })).statusCode).toBe(400);
  });
  it('requires the console code for direct loopback and completes setup with it', async () => {
    const state = await app.inject({ method: 'GET', url: '/api/auth/state', remoteAddress: '127.0.0.1' });
    expect(state.json()).toMatchObject({ setup: false, authenticated: false, setupCodeRequired: true, googleSignIn: false });
    const password = 'local owner passphrase';
    expect((await setup(app, '127.0.0.1', { password })).statusCode).toBe(403);
    expect(auth.isSetup()).toBe(false);
    expect((await setup(app, '127.0.0.1', { password, setupCode: codeOf() })).statusCode).toBe(200);
    expect(codeOf()).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/auth/state' })).json().setupCodeRequired).toBe(false);
  });
  it('requires the console code even when the retired environment override is still present', async () => {
    process.env.MIA_ALLOW_REMOTE_SETUP = '1';
    expect((await setup(app, '203.0.113.9', { password: 'example owner passphrase' })).statusCode).toBe(403);
    expect(auth.isSetup()).toBe(false);
  });
  it('preserves the code for retry when the first session could not be written', async () => {
    const setupCode = auth.ensureSetupCode(false, () => {});
    const credentials = { password: 'local owner passphrase', setupCode };
    getDb().exec(`CREATE TRIGGER block_session_fixture BEFORE INSERT ON sessions
      BEGIN SELECT RAISE(ABORT, 'fixture session write failed'); END;`);
    expect((await setup(app, '127.0.0.1', credentials)).statusCode).toBe(500);
    expect(auth.isSetup()).toBe(false);
    expect(auth.ensureSetupCode(false, () => {})).toBe(setupCode);
    getDb().exec('DROP TRIGGER block_session_fixture');
    expect((await setup(app, '127.0.0.1', credentials)).statusCode).toBe(200);
  });
  it('prints the code once when created and again only on explicit announce, never on every page load', () => {
    const lines: string[] = []; const log = (m: string) => lines.push(m);
    const shown = auth.ensureSetupCode(false, log); auth.ensureSetupCode(false, log); auth.ensureSetupCode(false, log);
    expect(lines).toHaveLength(1); expect(lines[0]).toContain(shown!);
    auth.ensureSetupCode(true, log); expect(lines).toHaveLength(2);
    auth.setupOwner('owner passphrase ok'); expect(auth.ensureSetupCode(true, log)).toBeNull(); expect(lines).toHaveLength(2);
  });
});
