import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/index.js';
import { freshDb } from './helpers.js';
import { failureGate } from '../src/core/ratelimit.js';
import { bindOwner, _setPrivyKeyForTests } from '../src/security/privy.js';
import type { FastifyInstance } from 'fastify';

const APP = 'cmtestprivyapp00000000001';
const OWNER = 'did:privy:owner0000000001';
const STRANGER = 'did:privy:stranger00000001';
let app: FastifyInstance;
let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
const post = (url: string, payload: object, cookie?: string) => app.inject({
  method: 'POST', url, headers: { 'x-mia-csrf': '1', ...(cookie ? { cookie } : {}) },
  payload,
});
async function token(sub = OWNER, appId = APP) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience(appId)
    .setSubject(sub).setIssuedAt().setExpirationTime('10m').sign(key);
}
beforeEach(async () => {
  process.env.MIA_AUTH_MODE = 'privy';
  process.env.MIA_PRIVY_APP_ID = APP;
  delete process.env.MIA_PRIVY_OWNER_ID;
  freshDb(); failureGate.reset();
  const pair = await generateKeyPair('ES256'); key = pair.privateKey;
  _setPrivyKeyForTests({ keys: [await exportJWK(pair.publicKey)] });
  app = await buildApp();
});
afterEach(async () => {
  await app.close();
  _setPrivyKeyForTests(null);
  delete process.env.MIA_AUTH_MODE;
  delete process.env.MIA_PRIVY_APP_ID;
  delete process.env.MIA_PRIVY_OWNER_ID;
});

describe('MIA wallet-first Privy integration into main — fail closed', () => {
  it('reports Privy as the public sign-in and refuses passphrase login and setup', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/auth/state' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ mode: 'privy', authenticated: false, privy: { appId: APP, enabled: true } });
    expect((await post('/api/auth/setup', { password: 'long-secret-owner-passphrase' })).statusCode).toBe(403);
    expect((await post('/api/auth/login', { password: 'long-secret-owner-passphrase' })).statusCode).toBe(403);
    expect((await post('/api/settings/password', { current: 'unused', next: 'unused' })).statusCode).toBe(401);
  });
  it('does not automatically provision the first stranger as owner', async () => {
    const res = await post('/api/auth/privy/login', { accessToken: await token(STRANGER) });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/shell' })).statusCode).toBe(401);
  });
  it('authenticates only a cryptographically verified and explicitly bound owner DID', async () => {
    bindOwner(OWNER, 'server-cli');
    const other = await post('/api/auth/privy/login', { accessToken: await token(STRANGER) });
    expect(other.statusCode).toBe(401);
    const res = await post('/api/auth/privy/login', { accessToken: await token() });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect((await app.inject({ method: 'GET', url: '/api/shell', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/shell' })).statusCode).toBe(401);
  });
  it('rejects a token intended for a different Privy app', async () => {
    bindOwner(OWNER, 'server-cli');
    const res = await post('/api/auth/privy/login', { accessToken: await token(OWNER, 'cmothertestprivy000000001') });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
  it('does not exchange a connected-wallet address or a forged access token for a session', async () => {
    bindOwner(OWNER, 'server-cli');
    for(const payload of [{ address: '0x1111111111111111111111111111111111111111', connected: true }, { accessToken: 'bogus-token' }]){
      const res = await post('/api/auth/privy/login', payload);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });
  it('requires independent enrolled 2FA for risk increases even when Privy owner signed in', async () => {
    bindOwner(OWNER, 'server-cli');
    const login = await post('/api/auth/privy/login', { accessToken: await token() });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const r = await post('/api/control', { pausedNewOrders: false, password: 'old-password' }, cookie);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/authenticator|two.factor|step.up/i);
    expect((await app.inject({ method: 'GET', url: '/api/security/2fa', headers: { cookie } })).statusCode).toBe(200);
  });
  it('requires server-console proof for first authenticator enrollment', async () => {
    bindOwner(OWNER, 'server-cli');
    const login = await post('/api/auth/privy/login', { accessToken: await token() });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const pending = await post('/api/security/2fa/begin', {}, cookie);
    expect(pending.statusCode).toBe(200);
    expect(pending.json().needsProof).toBe('console-code-or-passphrase');
    const denied = await post('/api/security/2fa/begin', { consoleCode: 'bad' }, cookie);
    expect(denied.statusCode).toBe(403);
  });
  it('blocks logout CSRF without revoking the legitimate owner session', async () => {
    bindOwner(OWNER, 'server-cli');
    const login = await post('/api/auth/privy/login', { accessToken: await token() });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const session = () => app.inject({ method: 'GET', url: '/api/shell', headers: { cookie } });
    expect((await session()).statusCode).toBe(200);

    const csrf = await app.inject({
      method: 'POST', url: '/api/auth/logout', headers: { cookie }, payload: {},
    });
    expect(csrf.statusCode).toBe(403);
    expect(csrf.json().error).toMatch(/CSRF/i);
    expect((await session()).statusCode).toBe(200);

    const logout = await post('/api/auth/logout', {}, cookie);
    expect(logout.statusCode).toBe(200);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    expect((await session()).statusCode).toBe(401);
  });
  it('never grants live-trading authority through authentication', async () => {
    bindOwner(OWNER, 'server-cli');
    const login = await post('/api/auth/privy/login', { accessToken: await token() });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const qa = await app.inject({ method: 'GET', url: '/api/qa', headers: { cookie } });
    expect(qa.statusCode).toBe(200);
    expect(qa.json().liveAllowed).toBe(false);
  });
});
