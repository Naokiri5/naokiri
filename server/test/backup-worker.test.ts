import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort, type WorkerOptions } from 'node:worker_threads';
import { freshDb } from './helpers.js';
import { audit } from '../src/core/audit.js';
import { getDb } from '../src/db/db.js';
import { createBackup, verifyBackup, verifyBackupInWorker } from '../src/ops/backup.js';

const harness = vi.hoisted(() => ({
  created: vi.fn(),
  fixture: null as { source: string; ready: MessagePort } | null,
}));
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  return { ...actual, Worker: class extends actual.Worker {
    constructor(entry: string | URL, opts: WorkerOptions) {
      const fixture = harness.fixture;
      super(fixture?.source ?? entry, fixture ? {
        ...opts, eval: true, workerData: { ...opts.workerData, ready: fixture.ready }, transferList: [fixture.ready],
      } : opts);
      harness.created(this, opts.workerData.workspace);
    }
  } };
});

describe('backup restore check off the event loop (MA-14)', () => {
  let dir = '';
  beforeEach(() => {
    freshDb();
    audit('owner', 'backup.fixture', { count: 1 });
    dir = mkdtempSync(join(tmpdir(), 'mia-bkw-'));
    harness.created.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    harness.fixture = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('checks the same encrypted backup in the worker and removes its private workspace', async () => {
    const key = Buffer.alloc(32, 7);
    const m = createBackup({ dir, key });
    const file = join(dir, m.file);
    const syncResult = verifyBackup(file, key);
    const workerResult = await verifyBackupInWorker(file, key);
    expect(workerResult.ok).toBe(true);
    expect(workerResult).toEqual(syncResult);
    expect(harness.created).toHaveBeenCalledTimes(1);
    const [worker, workspace] = harness.created.mock.calls[0];
    expect(worker.threadId).toBe(-1);
    expect(existsSync(workspace)).toBe(false);
  });

  it('terminates a blocked worker and deletes its plaintext workspace before returning a timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { port1, port2 } = new MessageChannel();
    harness.fixture = { ready: port2, source: `
      const { workerData } = require('node:worker_threads');
      const { writeFileSync } = require('node:fs');
      const { join } = require('node:path');
      writeFileSync(join(workerData.workspace, 'snapshot.db'), 'synthetic decrypted snapshot', { mode: 0o600 });
      workerData.ready.postMessage('ready');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    ` };
    const ready = once(port1, 'message');
    const operation = verifyBackupInWorker(join(dir, 'fixture.db.enc'), null, 100);
    try {
      await Promise.race([ready, operation.then(() => { throw new Error('restore finished before its worker was blocked'); })]);
      const [worker, workspace] = harness.created.mock.calls[0];
      expect(existsSync(join(workspace, 'snapshot.db'))).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(await operation).toMatchObject({ ok: false, checks: [{ name: 'worker', detail: expect.stringContaining('timed out') }] });
      expect(worker.threadId).toBe(-1);
      expect(existsSync(workspace)).toBe(false);
    } finally {
      await vi.advanceTimersByTimeAsync(100);
      await operation;
      port1.close(); port2.close();
    }
  });

  it('a corrupted backup fails in the worker too (never a pass)', async () => {
    const m = createBackup({ dir, key: null }); const file = join(dir, m.file);
    const buf = readFileSync(file); buf[buf.length - 100] ^= 0xff; writeFileSync(file, buf);
    const r = await verifyBackupInWorker(file, null);
    expect(r.ok).toBe(false); expect(r.checks.find((c) => c.name === 'checksum')!.ok).toBe(false);
  });

  it.skipIf(process.env.MIA_BENCHMARK_BACKUPS !== '1')('reports restore-check responsiveness on a large backup', async () => {
    getDb().exec('BEGIN');
    for (let i = 0; i < 40_000; i++) audit('owner', 'bench.event', { i, note: 'x'.repeat(80) });
    getDb().exec('COMMIT');
    const m = createBackup({ dir, key: null }); const file = join(dir, m.file);
    const maxLoopGap = async (work: () => unknown) => {
      let last = performance.now(); let max = 0;
      const timer = setInterval(() => { const now = performance.now(); max = Math.max(max, now - last); last = now; }, 5);
      try { await new Promise(resolve => setTimeout(resolve, 20)); await work(); await new Promise(resolve => setTimeout(resolve, 20)); }
      finally { clearInterval(timer); }
      return max;
    };
    const syncGap = await maxLoopGap(() => verifyBackup(file, null));
    const workerGap = await maxLoopGap(() => verifyBackupInWorker(file, null));
    console.log(`event-loop max gap: in-thread ${syncGap.toFixed(0)} ms, worker ${workerGap.toFixed(0)} ms`);
  }, 60_000);
});
