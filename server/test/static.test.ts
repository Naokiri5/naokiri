import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDb, openDb } from '../src/db/db.js';
import { config } from '../src/config.js';
import { buildApp } from '../src/index.js';

/** SEC-01 regression: static UI serving, SPA fallback, and path-traversal resistance. */
describe('static UI serving', () => {
  let dir = ''; let app: Awaited<ReturnType<typeof buildApp>>; const prev = config.webDist;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mia-web-'));
    mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html><title>MIA-INDEX</title>');
    writeFileSync(join(dir, 'dist', 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, 'secret.txt'), 'TOP-SECRET-OUTSIDE-WEBROOT');
    (config as any).webDist = join(dir, 'dist');
    closeDb(); openDb(':memory:'); app = await buildApp();
  });
  afterAll(async () => { await app.close(); (config as any).webDist = prev; rmSync(dir, { recursive: true, force: true }); });
  it('serves index, assets and SPA routes', async () => {
    expect((await app.inject({ url: '/' })).body).toContain('MIA-INDEX');
    const js = await app.inject({ url: '/assets/app.js' }); expect(js.statusCode).toBe(200); expect(js.headers['content-type']).toMatch(/javascript/);
    expect((await app.inject({ url: '/scanner' })).body).toContain('MIA-INDEX');
  });
  it('unknown API routes stay JSON 404', async () => {
    const r = await app.inject({ url: '/api/does-not-exist' }); expect(r.statusCode).toBe(404); expect(r.json()).toEqual({ error: 'not found' }); // never the SPA HTML
  });
  it('does not serve files outside the web root', async () => {
    for (const u of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e%2fsecret.txt']) {
      const r = await app.inject({ url: u });
      expect(r.body, u).not.toContain('TOP-SECRET');
    }
  });
  it('sends security headers', async () => {
    const r = await app.inject({ url: '/' });
    expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['x-frame-options']).toBe('DENY'); expect(r.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
