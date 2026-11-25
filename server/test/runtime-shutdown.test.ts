import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { beginShutdown, isShuttingDown } from '../src/ops/shutdown.js';
import { closeDb, openDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';
import { waitForIdle } from '../src/knowledge/store.js';

describe('canonical process shutdown', () => {
  afterAll(() => closeDb());

  it('latches once and changes the existing readiness endpoint without claiming liveness failure', async () => {
    freshDb();
    const app = await buildApp();
    try {
      expect(isShuttingDown()).toBe(false);
      expect((await app.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(200);
      expect(beginShutdown()).toBe(true);
      expect(beginShutdown()).toBe(false);
      expect(isShuttingDown()).toBe(true);
      const ready = await app.inject({ method: 'GET', url: '/api/ready' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({ ready: false, checks: expect.arrayContaining([
        { name: 'lifecycle', status: 'fail', detail: 'process draining' },
      ]) });
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
      await waitForIdle();
    }
  });
});

/** A real OS process, direct Node entrypoint (no shell/tsx watcher), private WAL and bounded cleanup. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cashBalance, ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { audit, verifyAuditChain } from '../src/core/audit.js';
import { performance } from 'node:perf_hooks';

async function unusedPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('no local test port');
  return address.port;
}

describe('real server subprocess lifecycle', () => {
  it.skipIf(process.platform === 'win32')('SIGTERM exits normally and preserves committed WAL evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-sigterm-'));
    const file = join(dir, 'mia.db');
    const port = await unusedPort();
    closeDb(); openDb(file);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 1234, 'sigterm-fixture');
    audit('fixture', 'SIGTERM_BASELINE');
    closeDb();
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, MIA_OFFLINE: '1', MIA_AUTH_MODE: 'passphrase',
        MIA_DATA_DIR: dir, MIA_PORT: String(port), MIA_HOST: '127.0.0.1', MIA_LOG: 'silent' },
      stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    });
    let output = '';
    child.stdout!.on('data', chunk => { output = (output + String(chunk)).slice(-16000); });
    child.stderr!.on('data', chunk => { output = (output + String(chunk)).slice(-16000); });
    let ended = false;
    const exited = new Promise<{code: number | null; signal: NodeJS.Signals | null}>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { ended = true; resolve({ code, signal }); });
    });
    // Attach an error handler immediately; awaited below and in cleanup.
    void exited.catch(() => {});
    try {
      const deadline = performance.now() + 12_000;
      // Readiness is a real child boot marker and HTTP response, not a fixed sleep.
      while (!output.includes('MIA 4.1 is running')) {
        if (ended || performance.now() >= deadline) throw new Error('server failed to boot: ' + output);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const ready = await fetch('http://127.0.0.1:' + port + '/api/ready', { signal: AbortSignal.timeout(2000) });
      expect(ready.status).toBe(200);
      await ready.text();
      const started = performance.now();
      expect(child.kill('SIGTERM')).toBe(true);
      const watchdog = setTimeout(() => child.kill('SIGKILL'), 10_000);
      let result: Awaited<typeof exited>;
      try { result = await exited; } finally { clearTimeout(watchdog); }
      expect(result, output).toEqual({ code: 0, signal: null });
      expect(performance.now() - started).toBeLessThan(10_000);
      expect(output).toContain('Stopped cleanly.');
      const db = openDb(file);
      expect(db.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' });
      expect(cashBalance()).toBe(1234);
      expect(verifyAuditChain().ok).toBe(true);
    } finally {
      if (!ended) child.kill('SIGKILL');
      await exited.catch(() => {});
      closeDb(); rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
