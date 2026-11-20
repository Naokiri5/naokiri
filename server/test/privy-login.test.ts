import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { getSetting, setSetting } from '../src/core/settings.js';
import { setupOwner, validSession } from '../src/api/auth.js';
import * as privy from '../src/security/privy.js';
import { base32Decode, base32Encode, hotp, totpAt, beginEnrollment } from '../src/security/totp.js';

/**
 * Privy-only sign-in (MIA_AUTH_MODE=privy, the production default). Offline: Privy tokens are signed with a locally
 * generated ES256 key served through a local JWKS — the same checks the server applies to real Privy tokens. A real
 * Privy app and browser are needed to prove the hosted login itself; that is outside this suite.
 */
const APP = 'cmtestprivyapp00000000001';
const OWNER = 'did:privy:owner0000000001';
const STRANGER = 'did:privy:stranger000001';
const json = { 'content-type': 'application/json', 'x-mia-csrf': '1' };
const REMOTE = { ...json, 'x-forwarded-for': '203.0.113.9' }; // not a direct local connection
let priv: CryptoKey; let otherPriv: CryptoKey;
const token = (o: { sub?: string; aud?: string; iss?: string; exp?: number; key?: CryptoKey } = {}) =>
  new SignJWT({ sid: 's' }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(o.sub ?? OWNER)
    .setIssuer(o.iss ?? 'privy.io').setAudience(o.aud ?? APP).setIssuedAt().setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(o.key ?? priv);

let app: Awaited<ReturnType<typeof buildApp>>;
const post = (url: string, payload: unknown, headers: Record<string, string> = json) => app.inject({ method: 'POST', url, headers, payload: payload as any });
const get = (url: string, cookie?: string) => app.inject({ url, headers: cookie ? { cookie } : {} });
const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0];
async function signIn(sub = OWNER) { const r = await post('/api/auth/privy/login', { accessToken: await token({ sub }) }); expect(r.statusCode).toBe(200); return cookieOf(r); }
const totpSecret = () => base32Decode(getSetting<{ secret: string }>('owner_2fa', null as any).secret);

beforeAll(async () => {
  const k = await generateKeyPair('ES256'); priv = k.privateKey as CryptoKey;
  otherPriv = (await generateKeyPair('ES256')).privateKey as CryptoKey;
  process.env.MIA_PRIVY_APP_ID = APP;
  privy._setPrivyKeyForTests({ keys: [{ ...(await exportJWK(k.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }] });
});
afterAll(() => { privy._setPrivyKeyForTests(null); delete process.env.MIA_PRIVY_APP_ID; });
let backups = '';
beforeEach(async () => {
  process.env.MIA_AUTH_MODE = 'privy'; delete process.env.MIA_PRIVY_OWNER_ID;
  backups = mkdtempSync(join(tmpdir(), 'mia-privy-bk-')); process.env.MIA_BACKUP_DIR = backups; // never the real data folder
  freshDb(); failureGate.reset(); app = await buildApp();
});
afterEach(async () => {
  await app.close(); process.env.MIA_AUTH_MODE = 'passphrase'; delete process.env.MIA_PRIVY_OWNER_ID;
  delete process.env.MIA_BACKUP_DIR; rmSync(backups, { recursive: true, force: true });
});

describe('authenticator codes (RFC 4226 / 6238)', () => {
  it('matches the published test vectors and round-trips base32', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, 0)).toBe('755224'); expect(hotp(secret, 9)).toBe('520489'); // RFC 4226 appendix D
    expect(totpAt(secret, 59_000, 8)).toBe('94287082'); expect(totpAt(secret, 1111111109_000, 8)).toBe('07081804'); // RFC 6238 appendix B
    expect(base32Encode(secret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });
});

describe('Privy-only sign-in screen state', () => {
  it('reports privy mode, offers no passphrase setup, and hides the step-up method from visitors', async () => {
    const s = (await get('/api/auth/state')).json();
    expect(s).toMatchObject({ mode: 'privy', authenticated: false, setupCodeRequired: false, privy: { enabled: true, appId: APP, linked: false, ownerConfigured: false } });
    expect(s.stepUp).toBeUndefined();
  });
  it('a missing app id leaves sign-in unavailable (404) instead of falling back to anything weaker', async () => {
    delete process.env.MIA_PRIVY_APP_ID;
    try {
      expect((await get('/api/auth/state')).json().privy.enabled).toBe(false);
      expect((await post('/api/auth/privy/login', { accessToken: 'x'.repeat(40) })).statusCode).toBe(404);
      expect((await post('/api/auth/setup', { password: 'a passphrase that is long' })).statusCode).toBe(403);
    } finally { process.env.MIA_PRIVY_APP_ID = APP; }
  });
  it('passphrase setup, login and change are refused, even when a legacy owner passphrase exists', async () => {
    expect((await post('/api/auth/setup', { password: 'brand new owner pass' })).statusCode).toBe(403);
    setupOwner('legacy owner pass');
    const l = await post('/api/auth/login', { password: 'legacy owner pass' });
    expect(l.statusCode).toBe(403); expect(l.json().error).toMatch(/sign in with Privy/); expect(l.headers['set-cookie']).toBeUndefined();
  });
});

describe('owner provisioning', () => {
  it('a verified Privy user is NOT made owner when nothing is provisioned; the reply names the id to configure', async () => {
    const r = await post('/api/auth/privy/login', { accessToken: await token({ sub: STRANGER }) });
    expect(r.statusCode).toBe(401); expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.json().error).toContain(`MIA_PRIVY_OWNER_ID=${STRANGER}`);
    expect(privy.getLink()).toBeNull();
  });
  it('MIA_PRIVY_OWNER_ID binds only that user, on first sign-in, after a database backup', async () => {
    process.env.MIA_PRIVY_OWNER_ID = OWNER;
    setSetting('test_marker', { keep: 42 }); setupOwner('legacy owner pass');
    expect((await post('/api/auth/privy/login', { accessToken: await token({ sub: STRANGER }) })).statusCode).toBe(401);
    expect(readdirSync(backups)).toEqual([]); // a refused stranger triggers no backup and no binding
    const r = await post('/api/auth/privy/login', { accessToken: await token() });
    expect(r.statusCode).toBe(200); expect(privy.getLink()?.userId).toBe(OWNER);
    expect(readdirSync(backups).some((f) => f.endsWith('.db'))).toBe(true);
    expect(getSetting('test_marker', null)).toEqual({ keep: 42 }); expect(getSetting<any>('owner', null)?.hash).toBeTruthy(); // existing data untouched
  });
  it('a failed backup binds nothing and opens no session (fail closed); the backup runs before the binding', async () => {
    process.env.MIA_PRIVY_OWNER_ID = OWNER;
    const blocker = join(backups, 'not-a-directory'); writeFileSync(blocker, 'x'); process.env.MIA_BACKUP_DIR = blocker;
    const r = await post('/api/auth/privy/login', { accessToken: await token() });
    expect(r.statusCode).toBe(500); expect(r.headers['set-cookie']).toBeUndefined(); expect(privy.getLink()).toBeNull();
    const order: string[] = [];
    await privy.loginWithPrivy(await token(), 'client', { backup: () => { order.push(`backup:${privy.getLink()?.userId ?? 'none'}`); } });
    expect(order).toEqual(['backup:none']);
  });
  it('once bound, the database owner wins: changing MIA_PRIVY_OWNER_ID cannot take the account over', async () => {
    privy.bindOwner(OWNER, 'server-cli');
    process.env.MIA_PRIVY_OWNER_ID = STRANGER;
    expect((await post('/api/auth/privy/login', { accessToken: await token({ sub: STRANGER }) })).statusCode).toBe(401);
    expect(privy.privyOwnerConfigProblem()).toMatch(/differs from the owner already bound/);
    expect((await post('/api/auth/privy/login', { accessToken: await token() })).statusCode).toBe(200);
  });
  it.each([
    ['an expired token', () => token({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ['a token for another app (audience)', () => token({ aud: 'cmanotherprivyapp00000001' })],
    ['a token from another issuer', () => token({ iss: 'evil.example' })],
    ['a forged token (wrong key)', () => token({ key: otherPriv })],
    ['a non-Privy subject', () => token({ sub: 'owner' })],
    ['another Privy user', () => token({ sub: STRANGER })],
  ])('refuses %s even for a bound owner setup', async (_n, make) => {
    privy.bindOwner(OWNER, 'server-cli');
    const r = await post('/api/auth/privy/login', { accessToken: await make() });
    expect(r.statusCode).toBe(401); expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('re-binding to another identity ends every existing session', async () => {
    privy.bindOwner(OWNER, 'server-cli'); const c = await signIn();
    privy.bindOwner(STRANGER, 'server-cli');
    expect((await get('/api/shell', c)).statusCode).toBe(401);
  });
});

describe('session after Privy sign-in', () => {
  beforeEach(() => { privy.bindOwner(OWNER, 'server-cli'); });
  it('sets an HttpOnly SameSite=Strict cookie that the existing protected API and CSRF rules accept', async () => {
    const r = await post('/api/auth/privy/login', { accessToken: await token() });
    const raw = String(r.headers['set-cookie']); expect(raw).toMatch(/HttpOnly/); expect(raw).toMatch(/SameSite=Strict/);
    const c = cookieOf(r);
    expect((await get('/api/shell', c)).statusCode).toBe(200);
    expect((await get('/api/shell')).statusCode).toBe(401); // anonymous
    expect((await app.inject({ method: 'POST', url: '/api/emergency/pause', headers: { 'content-type': 'application/json', cookie: c }, payload: {} })).statusCode).toBe(403); // no CSRF header
    expect((await get('/api/auth/state', c)).json()).toMatchObject({ authenticated: true, stepUp: 'unavailable' });
  });
  it('logout revokes the session on the server (a copied cookie stops working)', async () => {
    const c = await signIn();
    expect((await post('/api/auth/logout', {}, { ...json, cookie: c })).statusCode).toBe(200);
    expect((await get('/api/shell', c)).statusCode).toBe(401);
    expect((await get('/api/auth/state', c)).json().authenticated).toBe(false);
  });
  it('the live event stream accepts the Privy session cookie and refuses anonymous clients', async () => {
    const c = await signIn();
    await app.listen({ port: 0, host: '127.0.0.1' }); const port = (app.server.address() as AddressInfo).port;
    const open = (cookie?: string) => new Promise<{ status: number; body: string }>((resolve) => {
      const req = request({ port, host: '127.0.0.1', path: '/api/stream', headers: cookie ? { cookie } : {} }, (res) => {
        let body = ''; res.on('data', (d) => { body += d; if (body.includes('connected')) { resolve({ status: res.statusCode ?? 0, body }); req.destroy(); } });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', () => resolve({ status: 0, body: '' })); req.end();
    });
    expect((await open()).status).toBe(401);
    const ok = await open(c); expect(ok.status).toBe(200); expect(ok.body).toContain(': connected');
  });
  it('unlinking is refused when Privy is the only sign-in (it would lock the owner out)', async () => {
    const c = await signIn(); setupOwner('legacy owner pass');
    const r = await post('/api/security/privy/unlink', { password: 'legacy owner pass' }, { ...json, cookie: c });
    expect(r.statusCode).toBe(409); expect(privy.getLink()?.userId).toBe(OWNER);
  });
});

describe('step-up after the passphrase is gone (authenticator app)', () => {
  beforeEach(() => { privy.bindOwner(OWNER, 'server-cli'); });
  it('new install: protected actions are refused until an authenticator is enrolled (fail closed)', async () => {
    const c = await signIn();
    const r = await post('/api/control', { pausedNewOrders: false }, { ...json, cookie: c });
    expect(r.statusCode).toBe(403); expect(r.json().error).toMatch(/set up an authenticator app/);
  });
  it('enrolling from another device needs the server-console code; then codes are single-use', async () => {
    const c = await signIn(); const H = { ...REMOTE, cookie: c };
    expect((await post('/api/security/2fa/begin', {}, H)).json()).toEqual({ needsProof: 'console-code-or-passphrase' });
    expect((await post('/api/security/2fa/begin', { consoleCode: 'WRONG-CODE-0000' }, H)).statusCode).toBe(403);
    const printed = getSetting<{ code: string }>('owner_2fa_console_code', null as any).code; // what the console showed
    const b = (await post('/api/security/2fa/begin', { consoleCode: printed }, H)).json();
    expect(b.otpauth).toMatch(/^otpauth:\/\/totp\/MIA:owner\?secret=[A-Z2-7]+&issuer=MIA/);
    expect((await post('/api/security/2fa/confirm', { otp: '000000' }, H)).statusCode).toBe(403);
    expect((await post('/api/security/2fa/confirm', { otp: totpAt(base32Decode(b.secret), Date.now()) }, H)).json()).toEqual({ enrolled: true });
    expect((await get('/api/auth/state', c)).json().stepUp).toBe('totp');

    expect((await post('/api/control', { pausedNewOrders: false }, H)).statusCode).toBe(403); // no code
    const next = totpAt(totpSecret(), Date.now() + 30_000); // a step newer than the one used to confirm
    expect((await post('/api/control', { pausedNewOrders: false, otp: next }, H)).statusCode).toBe(200);
    const replay = await post('/api/control', { pausedNewOrders: false, otp: next }, H);
    expect(replay.statusCode).toBe(403); expect(replay.json().error).toMatch(/already used/);
    // Replacing the authenticator needs a current code, not the console code.
    expect((await post('/api/security/2fa/begin', {}, H)).json()).toEqual({ needsProof: 'otp' });
  });
  it('guessing codes hits the shared brute-force limiter', async () => {
    const c = await signIn();
    beginEnrollment({}, 'x');
    setSetting('owner_2fa', { secret: base32Encode(Buffer.alloc(20, 7)), enrolledAt: Date.now(), lastCounter: 0 });
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await post('/api/control', { pausedNewOrders: false, otp: String(100000 + i) }, { ...json, cookie: c })).statusCode;
    expect(last).toBe(429);
  });
  it('existing install: the legacy passphrase confirms actions until an authenticator is enrolled, then no longer', async () => {
    setupOwner('legacy owner pass'); const c = await signIn(); const H = { ...REMOTE, cookie: c };
    expect((await post('/api/control', { pausedNewOrders: false, password: 'legacy owner pass' }, H)).statusCode).toBe(200);
    const b = (await post('/api/security/2fa/begin', { password: 'legacy owner pass' }, H)).json(); // passphrase is valid proof to enroll
    await post('/api/security/2fa/confirm', { otp: totpAt(base32Decode(b.secret), Date.now()) }, H);
    const r = await post('/api/control', { pausedNewOrders: false, password: 'legacy owner pass' }, H);
    expect(r.statusCode).toBe(403); expect(r.json().error).toMatch(/authenticator code/);
  });
});
