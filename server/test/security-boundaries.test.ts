import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from '../src/config.js';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { updateDocumentMeta } from '../src/knowledge/store.js';

describe('Guardian Shield HTTP boundaries', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const secure = config.secureCookie;
  beforeAll(async () => { closeDb(); openDb(':memory:'); app = await buildApp(); });
  afterAll(async () => { config.secureCookie = secure; await app.close(); closeDb(); });

  it('grants no cross-origin access, for simple or preflighted requests', async () => {
    const origin = 'https://attacker.example';
    const simple = await app.inject({ url: '/api/auth/state', headers: { origin } });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
    expect(simple.headers['access-control-allow-credentials']).toBeUndefined();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/control',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-mia-csrf' } });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-headers']).toBeUndefined();
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
