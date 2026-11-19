import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDb } from './helpers.js';
import { audit } from '../src/core/audit.js';
import { getDb } from '../src/db/db.js';
import { createBackup, verifyBackup, verifyBackupInWorker } from '../src/ops/backup.js';

/** MA-14: the restore check runs in a worker thread, so a large backup no longer stalls the engine's event loop. */
const maxLoopGap = async (work: () => Promise<unknown> | unknown) => {
  let last = performance.now(), max = 0;
  const t = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last); last = n; }, 5);
  try { await new Promise((r) => setTimeout(r, 20)); await work(); await new Promise((r) => setTimeout(r, 20)); } finally { clearInterval(t); }
  return max;
};

describe('backup restore check off the event loop (MA-14)', () => {
  let dir = '';
  beforeEach(() => {
    freshDb(); dir = mkdtempSync(join(tmpdir(), 'mia-bkw-'));
    getDb().exec('BEGIN'); for (let i = 0; i < 40_000; i++) audit('owner', 'bench.event', { i, note: 'x'.repeat(80) }); getDb().exec('COMMIT');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('gives the same verdict as the in-thread check while keeping the event loop responsive', async () => {
    const m = createBackup({ dir, key: null });
    const file = join(dir, m.file);
    let syncResult: any; const syncGap = await maxLoopGap(() => { syncResult = verifyBackup(file, null); });
    let workerResult: any; const workerGap = await maxLoopGap(async () => { workerResult = await verifyBackupInWorker(file, null); });
    expect(workerResult.ok).toBe(true);
    expect(workerResult.checks.map((c: any) => [c.name, c.ok])).toEqual(syncResult.checks.map((c: any) => [c.name, c.ok]));
    console.log(`event-loop max gap: in-thread ${syncGap.toFixed(0)} ms, worker ${workerGap.toFixed(0)} ms`);
    expect(workerGap).toBeLessThan(syncGap / 2);
  }, 60_000);

  it('a corrupted backup fails in the worker too (never a pass)', async () => {
    const m = createBackup({ dir, key: null }); const file = join(dir, m.file);
    const buf = readFileSync(file); buf[buf.length - 100] ^= 0xff; writeFileSync(file, buf);
    const r = await verifyBackupInWorker(file, null);
    expect(r.ok).toBe(false); expect(r.checks.find((c) => c.name === 'checksum')!.ok).toBe(false);
  }, 60_000);
});
