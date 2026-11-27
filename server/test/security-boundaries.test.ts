import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from '../src/config.js';
import { createSession, validSession } from '../src/api/auth.js';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { updateDocumentMeta } from '../src/knowledge/store.js';
import { readPublicOrigin } from '../src/security/origins.js';

describe('Guardian Shield HTTP boundaries', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const secure = config.secureCookie;
  const publicOrigin = config.publicOrigin;
  beforeAll(async () => { closeDb(); openDb(':memory:'); app = await buildApp(); });
  afterEach(() => { config.secureCookie = secure; config.publicOrigin = publicOrigin; });
  afterAll(async () => { await app.close(); closeDb(); });

  it('grants no cross-origin access, for simple or preflighted requests', async () => {
    const origin = 'https://attacker.example';
    const simple = await app.inject({ url: '/api/auth/state', headers: { origin } });
    expect(simple.statusCode).toBe(403);
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
    expect(simple.headers['access-control-allow-credentials']).toBeUndefined();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/control',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-mia-csrf' } });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-headers']).toBeUndefined();
  });

  it('keeps same-origin owner bootstrap and authentication working through the development proxy', async () => {
    config.secureCookie = false;
    config.publicOrigin = undefined;
    const headers = { host: 'localhost:5173', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' };
    const payload = { password: 'local recovery passphrase' };
    const first = await app.inject({ method: 'POST', url: '/api/auth/setup', headers, payload });
    expect(first.statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toBeDefined();
  });

  it('refuses a foreign browser origin despite a valid cookie, CSRF and forwarded headers', async () => {
    config.secureCookie = false;
    config.publicOrigin = undefined;
    const token = createSession('127.0.0.1', 'passphrase');
    const headers = { host: 'localhost:5173', cookie: `mia_session=${token}`, 'x-mia-csrf': '1' };
    const denied = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: {
      ...headers, origin: 'https://other.example', 'x-forwarded-host': 'other.example', 'x-forwarded-proto': 'https',
    } });
    expect(denied.statusCode).toBe(403);
    expect(validSession(token)).toBe(true);
    const local = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, origin: 'http://localhost:5173' } });
    expect(local.statusCode).toBe(200);
    expect(validSession(token)).toBe(false);
  });

  it.each(['null', 'https://app.example/path', 'https://app.example, https://other.example'])('rejects the malformed or opaque Origin %s', async (origin) => {
    config.publicOrigin = 'https://app.example';
    const response = await app.inject({ url: '/api/health', headers: { origin } });
    expect(response.statusCode).toBe(403);
  });

  it.each(['same-site', 'cross-site'])('rejects browser Fetch Metadata %s when Origin is absent', async (site) => {
    const response = await app.inject({ url: '/api/auth/state', headers: { 'sec-fetch-site': site } });
    expect(response.statusCode).toBe(403);
  });

  it('honors the pinned origin through a rewritten Host and preserves Origin-absent health and owner requests', async () => {
    config.publicOrigin = 'https://app.example';
    const headers = { host: 'internal.example' };
    const client = await app.inject({ url: '/api/health', headers });
    expect(client.statusCode).toBe(200);
    const browser = await app.inject({ url: '/api/auth/state', headers: {
      ...headers, origin: 'https://app.example', 'sec-fetch-site': 'same-origin',
    } });
    expect(browser.statusCode).toBe(200);
    const foreign = await app.inject({ url: '/api/auth/state', headers: { ...headers, origin: 'https://internal.example' } });
    expect(foreign.statusCode).toBe(403);
    const token = createSession('127.0.0.1', 'passphrase');
    const cli = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie: `mia_session=${token}`, 'x-mia-csrf': '1' } });
    expect(cli.statusCode).toBe(200);
    expect(validSession(token)).toBe(false);
  });

  it('uses HTTPS for the raw Host behind a trusted secure-cookie deployment', async () => {
    config.secureCookie = true;
    config.publicOrigin = undefined;
    const response = await app.inject({ url: '/api/auth/state', headers: { host: 'app.example', origin: 'https://app.example' } });
    expect(response.statusCode).toBe(200);
  });

  it('sends hardening headers, never caches API responses, and adds HSTS only over HTTPS', async () => {
    config.secureCookie = false;
    const plain = await app.inject({ url: '/api/auth/state' });
    expect(plain.headers).toMatchObject({ 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    expect(String(plain.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(plain.headers['strict-transport-security']).toBeUndefined();
    config.secureCookie = true;
    const https = await app.inject({ url: '/api/auth/state' });
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('public origin configuration', () => {
  it('accepts a canonical public HTTPS origin and local HTTP recovery origin', () => {
    expect(readPublicOrigin('https://APP.example/')).toBe('https://app.example');
    expect(readPublicOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(readPublicOrigin('')).toBeUndefined();
  });

  it.each(['http://app.example', 'https://app.example/path', 'https://name:pass@app.example', '*'])('rejects the unsafe setting %s', (origin) => {
    expect(() => readPublicOrigin(origin)).toThrow(/MIA_PUBLIC_ORIGIN/);
  });
});

describe('SQL identifiers', () => {
  it('refuses metadata columns outside the allowlist even if a caller skips route validation', () => {
    closeDb(); openDb(':memory:');
    const patch = { 'title=?, status': 'x' } as unknown as Parameters<typeof updateDocumentMeta>[2];
    expect(() => updateDocumentMeta('owner', 'missing', patch)).toThrow('unknown metadata field');
    closeDb();
  });
});

describe('secret files stay out of Git', () => {
  const root = resolve(__dirname, '../..');
  const ignored = (path: string) => {
    try { execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root }); return true; } catch { return false; }
  };
  it.each(['.env', '.env.production', '.env.local', 'server/.env.railway', 'deploy/key.pem', 'signer.key', 'id.p12',
    'secrets/privy.json', 'credentials/broker.json', 'wallet-backups/w.json'])('ignores %s', (path) => {
    expect(ignored(path)).toBe(true);
  });
  it('still tracks the placeholder template', () => { expect(ignored('.env.example')).toBe(false); });
});
