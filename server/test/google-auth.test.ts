import { ownerSetupPayload } from './helpers.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';

const password = 'google owner test passphrase';
const csrf = { 'x-mia-csrf': '1' };
const redirect = 'https://mia.example/api/auth/google/callback';
const originalSecureCookie = config.secureCookie;
let app: Awaited<ReturnType<typeof buildApp>>;

function provider(subject: string) {
  const upstream = vi.fn(async (input: string, init: RequestInit) => {
    if (input === 'https://oauth2.googleapis.com/token') {
      expect((init.body as URLSearchParams).get('code_verifier')).toMatch(/^[\w-]{43}$/);
      expect((init.body as URLSearchParams).get('redirect_uri')).toBe(redirect);
      return Response.json({ access_token: 'fixture-access-token' });
    }
    expect(input).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(init.headers).toEqual({ authorization: 'Bearer fixture-access-token' });
    return Response.json({ sub: subject });
  });
  vi.stubGlobal('fetch', upstream);
  return upstream;
}

const callback = (state: string, cookie: string) => app.inject({
  method: 'GET', url: `/api/auth/google/callback?state=${state}&code=fixture-code`, headers: { cookie },
});

async function setupOwner() {
  const response = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload(password) });
  expect(response.statusCode).toBe(200);
  return `mia_session=${response.cookies.find(c => c.name === 'mia_session')!.value}`;
}

async function startFlow(url: string, ownerCookie?: string) {
  const response = await app.inject({ method: 'POST', url, headers: { ...csrf, ...(ownerCookie ? { cookie: ownerCookie } : {}) }, payload: ownerCookie ? { password } : {} });
  expect(response.statusCode).toBe(200);
  const authUrl = new URL(response.json().url);
  expect(authUrl.origin).toBe('https://accounts.google.com');
  expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authUrl.searchParams.get('scope')).toBe('openid');
  const flow = response.cookies.find(c => c.name === '__Host-mia_google')!;
  expect(flow).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' });
  return { state: authUrl.searchParams.get('state')!, cookie: `${flow.name}=${flow.value}` };
}

describe('Google owner sign-in', () => {
  beforeEach(async () => {
    vi.stubEnv('MIA_GOOGLE_CLIENT_ID', 'fixture-client-id');
    vi.stubEnv('MIA_GOOGLE_CLIENT_SECRET', 'fixture-client-secret');
    vi.stubEnv('MIA_GOOGLE_REDIRECT_URI', redirect);
    config.secureCookie = true;
    closeDb();
    openDb(':memory:');
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    closeDb();
    vi.restoreAllMocks();
    config.secureCookie = originalSecureCookie;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('requires current owner verification, accepts only the linked subject, and revokes sessions on unlink', async () => {
    const owner = await setupOwner();
    expect((await app.inject({ method: 'POST', url: '/api/auth/google/start', headers: csrf, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/settings/google/link', headers: ownerHeaders(owner), payload: { password: 'wrong' } })).statusCode).toBe(403);
    const link = await startFlow('/api/settings/google/link', owner);
    const upstream = provider('linked-google-subject');
    expect((await callback('A'.repeat(43), link.cookie)).headers.location).toBe('/?google=failed');
    expect(upstream).not.toHaveBeenCalled();
    expect((await callback(link.state, link.cookie)).headers.location).toBe('/settings');

    const login = await startFlow('/api/auth/google/start');
    provider('other-google-subject');
    const refused = await callback(login.state, login.cookie);
    expect(refused.headers.location).toBe('/?google=failed');
    expect(refused.cookies.some(c => c.name === 'mia_session')).toBe(false);

    provider('linked-google-subject');
    const valid = await startFlow('/api/auth/google/start');
    const signedIn = await callback(valid.state, valid.cookie);
    expect(signedIn.headers.location).toBe('/');
    expect(signedIn.cookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '__Host-mia_google', maxAge: 0 }),
      expect.objectContaining({ name: 'mia_session', secure: true, httpOnly: true }),
    ]));
    const googleSession = `mia_session=${signedIn.cookies.find(c => c.name === 'mia_session')!.value}`;
    const authState = (cookie: string) => app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie } });
    expect((await authState(googleSession)).json()).toMatchObject({ authenticated: true, googleSignIn: true });
    const unlink = await app.inject({ method: 'POST', url: '/api/settings/google/unlink', headers: ownerHeaders(owner), payload: { password } });
    expect(unlink.statusCode).toBe(200);
    expect((await authState(googleSession)).json()).toMatchObject({ authenticated: false, googleSignIn: false });
  });

  it('rejects a link callback after the originating owner session signs out', async () => {
    const owner = await setupOwner();
    const link = await startFlow('/api/settings/google/link', owner);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: ownerHeaders(owner), payload: {} });
    const upstream = provider('linked-google-subject');
    expect((await callback(link.state, link.cookie)).headers.location).toBe('/settings?google=failed');
    expect(upstream).not.toHaveBeenCalled();
  });
});

function ownerHeaders(cookie: string) {
  return { ...csrf, cookie };
}
