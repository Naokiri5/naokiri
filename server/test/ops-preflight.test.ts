import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runPreflightChecks } from '../src/ops/preflight.js';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';

describe('MIA canonical startup preflight', () => {
  let dir = '';
  const opts = (env: NodeJS.ProcessEnv = {}, nodeVersion?: string) => ({ env, dataDir: dir, nodeVersion });
  const status = (env: NodeJS.ProcessEnv = {}) => runPreflightChecks(opts(env));
  const makeDb = (journal: 'WAL' | 'DELETE' = 'WAL') => {
    const db = new DatabaseSync(join(dir, 'mia.db'));
    db.exec(`PRAGMA journal_mode=${journal}; CREATE TABLE owned_by_mia (id INTEGER PRIMARY KEY);`);
    db.close();
  };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mia-preflight-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('permits first boot without creating a phantom ledger or TCA database', () => {
    const report = status({ EXECUTION_MODE: 'paper', MIA_ALLOW_LIVE_TRADING: 'false' });
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'sqlite_integrity')?.status).toBe('skip');
  });

  it('verifies existing canonical WAL read-only without changing schema', () => {
    makeDb();
    const report = status();
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'sqlite_integrity')).toMatchObject({
      status: 'pass', detail: expect.stringContaining('quick_check'),
    });
    const db = new DatabaseSync(join(dir, 'mia.db'), { readOnly: true });
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owned_by_mia'").get()).toBeDefined();
      expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    } finally { db.close(); }
  });

  it.each(['live', 'replay', 'LIVE'])('refuses prototype execution mode %s even with credentials', (mode) => {
    const report = status({ EXECUTION_MODE: mode, MIA_ALLOW_LIVE_TRADING: 'true', BINANCE_API_KEY: 'fixture-not-a-key' });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'execution_authority')?.status).toBe('fail');
    expect(JSON.stringify(report)).not.toContain('fixture-not-a-key');
  });

  it('rejects env live opt-in while accepting a paper hint with LIVE disabled', () => {
    expect(status({ EXECUTION_MODE: 'paper', MIA_ALLOW_LIVE_TRADING: '1' }).ok).toBe(false);
    expect(status({ EXECUTION_MODE: 'paper', MIA_ALLOW_LIVE_TRADING: 'false' }).ok).toBe(true);
  });

  it('fails when phantom ledger or unimplemented order-size config would be ignored', () => {
    const r = status({ MIA_LEDGER_DB_PATH: join(dir, 'phantom.sqlite'), MIA_MAX_SINGLE_ORDER_USD: '1' });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'environment_contract')?.detail).toContain('MIA_LEDGER_DB_PATH');
    expect(r.checks.find((c) => c.name === 'sqlite_integrity')?.status).toBe('skip');
  });

  it('rejects old Node versions and inverted heap thresholds', () => {
    expect(runPreflightChecks(opts({}, '22.12.0')).ok).toBe(false);
    expect(runPreflightChecks(opts({}, '22.13.0')).ok).toBe(true);
    expect(status({ MIA_HEALTH_HEAP_WARN_RATIO: '0.94', MIA_HEALTH_HEAP_CRIT_RATIO: '0.90' }).ok).toBe(false);
    expect(status({ MIA_HEALTH_HEAP_WARN_RATIO: '0.50', MIA_HEALTH_HEAP_CRIT_RATIO: '0.95' }).ok).toBe(true);
  });

  it('fails closed on a real non-WAL canonical DB', () => {
    makeDb('DELETE');
    expect(status().checks.find((c) => c.name === 'sqlite_integrity')?.status).toBe('fail');
  });

  it('fails closed for a corrupt DB and a non-file SQLite path', () => {
    writeFileSync(join(dir, 'mia.db'), Buffer.from('not a sqlite database'));
    expect(status().ok).toBe(false);
    rmSync(join(dir, 'mia.db'));
    mkdirSync(join(dir, 'mia.db'));
    expect(status().ok).toBe(false);
  });

  it('rejects inaccessible canonical data directory before DB inspection', () => {
    const broken = join(dir, 'not-a-dir');
    writeFileSync(broken, 'not a directory');
    const r = runPreflightChecks({ env: {}, dataDir: broken });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'data_directory')?.status).toBe('fail');
  });
});

describe('actual Fastify startup smoke (no second coordinator)', () => {
  it('serves current health/readiness paths and protects owner APIs', async () => {
    freshDb();
    const app = await buildApp();
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('Fastify did not bind TCP');
      const base = `http://127.0.0.1:${address.port}`;
      const health = await fetch(base + '/api/health');
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true });
      const ready = await fetch(base + '/api/ready');
      expect([200, 503]).toContain(ready.status);
      const body = await ready.json() as { checks: Array<{ name: string }> };
      expect(body.checks.map((c) => c.name)).toContain('runtime.sqlite');
      const privateApi = await fetch(base + '/api/shell');
      expect(privateApi.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
