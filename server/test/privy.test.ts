import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { freshDb, ownerSetupPayload } from './helpers.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { _setPrivyKeyForTests, contentSecurityPolicy } from '../src/security/privy.js';

/**
 * Privy sign-in, offline: tokens are signed with a locally generated ES256 key served through a local JWKS, exactly
 * the checks the server applies to real Privy tokens (signature, issuer, audience, expiry, subject format).
 */
const APP = 'cmtestprivyapp00000000001'; // 25 chars, like a real Privy app id
const OWNER = 'did:privy:owner0000000001';
const PW = 'privy route owner';
const json = { 'content-type': 'application/json', 'x-mia-csrf': '1' };
let priv: CryptoKey; let otherPriv: CryptoKey;
const token = (o: { sub?: string; aud?: string; iss?: string; exp?: number; key?: CryptoKey } = {}) =>
  new SignJWT({ sid: 'sess_1' }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setSubject(o.sub ?? OWNER)
    .setIssuer(o.iss ?? 'privy.io').setAudience(o.aud ?? APP).setIssuedAt().setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(o.key ?? priv);

describe('Privy sign-in', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  const post = (url: string, payload: unknown, withCookie = false) => app.inject({ method: 'POST', url, headers: withCookie ? { ...json, cookie } : json, payload: payload as any });
  const linkOwner = async () => {
    const result = await post('/api/security/privy/link', { accessToken: await token(), password: PW }, true);
    expect(result.statusCode).toBe(200);
  };
  beforeAll(async () => {
    process.env.MIA_PRIVY_APP_ID = APP;
    const k = await generateKeyPair('ES256'); priv = k.privateKey as CryptoKey;
    otherPriv = (await generateKeyPair('ES256')).privateKey as CryptoKey;
    _setPrivyKeyForTests({ keys: [{ ...(await exportJWK(k.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }] });
  });
  beforeEach(async () => {
    freshDb(); failureGate.reset(); app = await buildApp();
    const setup = await post('/api/auth/setup', ownerSetupPayload(PW));
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie']).split(';')[0];
  });
  afterEach(async () => { await app.close(); });
  afterAll(() => { delete process.env.MIA_PRIVY_APP_ID; _setPrivyKeyForTests(null); });

  it('public config exposes only the app id and state; wallet actions are LOCKED', async () => {
    const r = (await app.inject({ url: '/api/auth/privy/config' })).json();
    expect(r).toEqual({ enabled: true, appId: APP, linked: false, walletActions: 'LOCKED' });
  });
  it('refuses Privy login before the owner links an identity', async () => {
    const r = await post('/api/auth/privy/login', { accessToken: await token() });
    expect(r.statusCode).toBe(401); expect(r.json().error).toMatch(/not linked/); expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('linking needs a MIA session and a passphrase step-up', async () => {
    expect((await post('/api/security/privy/link', { accessToken: await token(), password: PW })).statusCode).toBe(401); // no session
    expect((await post('/api/security/privy/link', { accessToken: await token() }, true)).statusCode).toBe(403); // no step-up
    expect((await post('/api/security/privy/link', { accessToken: await token({ key: otherPriv }), password: PW }, true)).statusCode).toBe(401); // forged token
    const ok = await post('/api/security/privy/link', { accessToken: await token(), password: PW }, true);
    expect(ok.statusCode).toBe(200); expect(ok.json()).toEqual({ linked: true, userId: OWNER });
  });
  it('the linked owner signs in with a valid Privy token and gets a working session', async () => {
    await linkOwner();
    const r = await post('/api/auth/privy/login', { accessToken: await token() });
    expect(r.statusCode).toBe(200);
    const c = String(r.headers['set-cookie']); expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Strict/);
    const s = await app.inject({ url: '/api/auth/state', headers: { cookie: c.split(';')[0] } });
    expect(s.json().authenticated).toBe(true);
  });
  it.each([
    ['another Privy user', () => token({ sub: 'did:privy:someoneelse0001' })],
    ['a token for another app', () => token({ aud: 'cmanotherprivyapp00000001' })],
    ['a token from another issuer', () => token({ iss: 'evil.example' })],
    ['an expired token', () => token({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ['a token signed with a different key', () => token({ key: otherPriv })],
    ['a non-Privy subject', () => token({ sub: 'owner' })],
  ])('refuses %s', async (_name, make) => {
    await linkOwner();
    const r = await post('/api/auth/privy/login', { accessToken: await make() });
    expect(r.statusCode).toBe(401); expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('failed Privy logins hit the shared brute-force limiter', async () => {
    await linkOwner();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post('/api/auth/privy/login', { accessToken: await token({ sub: 'did:privy:attacker000001' }) })).statusCode;
    expect(last).toBe(429);
  });
  it('rejects malformed bodies', async () => {
    expect((await post('/api/auth/privy/login', { accessToken: 'short' })).statusCode).toBe(400);
    expect((await post('/api/auth/privy/login', { accessToken: await token(), extra: 1 })).statusCode).toBe(400);
  });
  it('unlink needs step-up, and afterwards Privy login is refused again', async () => {
    await linkOwner();
    expect((await post('/api/security/privy/unlink', {}, true)).statusCode).toBe(403);
    expect((await post('/api/security/privy/unlink', { password: PW }, true)).json()).toEqual({ linked: false });
    expect((await post('/api/auth/privy/login', { accessToken: await token() })).statusCode).toBe(401);
  });
  it('CSP opens only Privy/WalletConnect hosts when enabled, and stays strict when disabled', () => {
    const on = contentSecurityPolicy();
    expect(on).toContain('frame-src https://auth.privy.io'); expect(on).toContain("frame-ancestors 'none'"); expect(on).not.toMatch(/unsafe-eval|\*/);
    delete process.env.MIA_PRIVY_APP_ID;
    expect(contentSecurityPolicy()).toContain("connect-src 'self';"); expect(contentSecurityPolicy()).not.toContain('privy');
    process.env.MIA_PRIVY_APP_ID = APP;
  });
});

describe('Privy disabled', () => {
  it('an app id that is not 25 characters leaves Privy off and explains why', async () => {
    const { privyConfigProblem, privyEnabled } = await import('../src/security/privy.js');
    process.env.MIA_PRIVY_APP_ID = 'tooshort123';
    expect(privyEnabled()).toBe(false); expect(privyConfigProblem()).toMatch(/25-character/);
    delete process.env.MIA_PRIVY_APP_ID; expect(privyConfigProblem()).toBeNull();
  });
  it('config reports disabled and login is 404', async () => {
    delete process.env.MIA_PRIVY_APP_ID; freshDb(); failureGate.reset();
    const app = await buildApp();
    expect((await app.inject({ url: '/api/auth/privy/config' })).json()).toMatchObject({ enabled: false, appId: null });
    expect((await app.inject({ method: 'POST', url: '/api/auth/privy/login', headers: json, payload: { accessToken: 'x'.repeat(40) } })).statusCode).toBe(404);
    await app.close();
  });
});
