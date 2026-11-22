import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import {
  runtimeHealthChecks, runtimeEntryBlocks, sampleRuntimeHealth, sseHealth,
  type RuntimeHealthSample,
} from '../src/ops/runtimeHealth.js';

const T = 1_800_000_000_000;
const normal = (change: Partial<RuntimeHealthSample> = {}): RuntimeHealthSample => ({
  heapUsedBytes: 20,
  heapLimitBytes: 100,
  databaseJournalMode: 'wal',
  databaseFileBacked: true,
  databaseError: false,
  sseActiveStreams: 0,
  sseLastFrameAtMs: 0,
  ...change,
});
const status = (sample: RuntimeHealthSample, name: string) =>
  runtimeHealthChecks(T, sample).find((c) => c.name === name)?.status;

describe('canonical runtime health and entry safety', () => {
  it('accepts an ordinary WAL process without connected SSE clients', () => {
    const checks = runtimeHealthChecks(T, normal());
    expect(checks.map((c) => c.status)).toEqual(['pass', 'pass', 'skip']);
    expect(runtimeEntryBlocks(T, normal())).toEqual([]);
  });

  it('fails entry protection on critical V8 utilization but does not block at warning level', () => {
    expect(status(normal({ heapUsedBytes: 100 }), 'runtime.heap')).toBe('fail');
    expect(runtimeEntryBlocks(T, normal({ heapUsedBytes: 100 }))).toEqual(['RUNTIME_HEAP_CRITICAL']);
    expect(status(normal({ heapUsedBytes: 81 }), 'runtime.heap')).toBe('info');
    expect(runtimeEntryBlocks(T, normal({ heapUsedBytes: 81 }))).toEqual([]);
    expect(runtimeEntryBlocks(T, normal({ heapLimitBytes: 0 }))).toEqual(['RUNTIME_HEAP_CRITICAL']);
  });

  it('rejects non-WAL or unavailable file database, not in-memory fixtures', () => {
    expect(status(normal({ databaseJournalMode: 'delete' }), 'runtime.sqlite')).toBe('fail');
    expect(status(normal({ databaseError: true }), 'runtime.sqlite')).toBe('fail');
    expect(runtimeEntryBlocks(T, normal({ databaseJournalMode: 'delete' }))).toEqual(['RUNTIME_SQLITE_UNHEALTHY']);
    expect(status(normal({ databaseFileBacked: false, databaseJournalMode: 'memory' }), 'runtime.sqlite')).toBe('skip');
  });

  it('requires recent emitted frames only while authenticated SSE clients are connected', () => {
    const stale = normal({ sseActiveStreams: 1, sseLastFrameAtMs: T - 100_000 });
    expect(status(stale, 'runtime.sse')).toBe('fail');
    expect(runtimeEntryBlocks(T, stale)).toEqual([]); // an optional UI client cannot halt trading by itself
    expect(status(normal({ ...stale, sseActiveStreams: 0 }), 'runtime.sse')).toBe('skip');
    expect(status(normal({ sseActiveStreams: 1, sseLastFrameAtMs: T - 1_000 }), 'runtime.sse')).toBe('pass');
  });

  it('does not expose account balances, keys, database paths, or position details', () => {
    const serialized = JSON.stringify(runtimeHealthChecks(T, normal()));
    for (const value of ['account', 'secret', 'password', 'wallet', 'path:', 'position']) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe('SSE health integration', () => {
  const streamIds = new Set<number>();
  const open = (at: number) => {
    const id = sseHealth.opened(at);
    streamIds.add(id);
    return id;
  };
  beforeEach(() => freshDb());
  afterEach(() => {
    // Restore global counters even when a test fails before its last assertion.
    for (const id of streamIds) sseHealth.closed(id);
    streamIds.clear();
  });

  it('tracks a real emitted heartbeat and closes without leaving a stale stream', () => {
    const streamId = open(T - 100_000);
    expect(sseHealth.state().activeStreams).toBe(1);
    expect(runtimeHealthChecks(T, { ...normal(), sseActiveStreams: sseHealth.state().activeStreams,
      sseLastFrameAtMs: sseHealth.state().lastFrameAtMs }).find((c) => c.name === 'runtime.sse')?.status).toBe('fail');
    sseHealth.emitted(streamId, T - 1_000);
    expect(sseHealth.state().lastFrameAtMs).toBe(T - 1_000);
    sseHealth.closed(streamId);
    expect(sseHealth.state()).toEqual({ activeStreams: 0, lastFrameAtMs: 0 });
  });

  it('does not let one healthy client hide a second stalled stream', () => {
    const stale = open(T - 100_000);
    const fresh = open(T - 1_000);
    expect(sseHealth.state()).toEqual({ activeStreams: 2, lastFrameAtMs: T - 100_000 });
    const asSample = () => normal({
      sseActiveStreams: sseHealth.state().activeStreams,
      sseLastFrameAtMs: sseHealth.state().lastFrameAtMs,
    });
    expect(status(asSample(), 'runtime.sse')).toBe('fail');
    sseHealth.emitted(stale, T - 500);
    expect(status(asSample(), 'runtime.sse')).toBe('pass');
    sseHealth.closed(stale);
    sseHealth.emitted(stale, T); // closed stream cannot resurrect itself
    expect(sseHealth.state()).toEqual({ activeStreams: 1, lastFrameAtMs: T - 1_000 });
    sseHealth.closed(fresh);
    expect(status(asSample(), 'runtime.sse')).toBe('skip');
  });

  it('reads the real canonical SQLite database and V8 heap without opening a second DB', () => {
    const liveSample = sampleRuntimeHealth();
    expect(liveSample.databaseError).toBe(false);
    expect(['pass', 'skip']).toContain(status(liveSample, 'runtime.sqlite'));
    expect(liveSample.heapLimitBytes).toBeGreaterThan(0);
  });
});

describe('public readiness integration', () => {
  beforeEach(() => freshDb());
  it('uses the existing Fastify /api/ready endpoint and reports real resource checks', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/ready' });
      expect([200, 503]).toContain(response.statusCode); // market lanes may be stopped; health is still reported
      const body = response.json();
      const names = body.checks.map((check: { name: string }) => check.name);
      expect(names).toContain('runtime.heap');
      expect(names).toContain('runtime.sqlite');
      expect(names).toContain('runtime.sse');
      expect(JSON.stringify(body)).not.toContain('MIA_EVIDENCE_KEY');
    } finally {
      await app.close(); // must clear the periodic watchdog timer
    }
  });
});
