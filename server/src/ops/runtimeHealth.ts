import v8 from 'node:v8';
import { getDb } from '../db/db.js';
import { bus } from '../core/bus.js';
import { notify } from '../notify/notify.js';

/**
 * Runtime resource checks for the EXISTING MIA Fastify/SQLite server.
 * No second database, HTTP router, signer, OMS, or execution coordinator.
 * An idle SSE endpoint is healthy: clients are optional, not required for trading.
 */
export interface RuntimeHealthSample {
  heapUsedBytes: number;
  heapLimitBytes: number;
  databaseJournalMode: string;
  databaseFileBacked: boolean;
  databaseError: boolean;
  sseActiveStreams: number;
  sseLastFrameAtMs: number;
}

export interface RuntimeHealthCheck {
  name: 'runtime.heap' | 'runtime.sqlite' | 'runtime.sse';
  status: 'pass' | 'fail' | 'skip' | 'info';
  detail: string;
}

const ratioEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
};
const warnRatio = () => ratioEnv('MIA_HEALTH_HEAP_WARN_RATIO', 0.80);
const criticalRatio = () => Math.max(warnRatio(), ratioEnv('MIA_HEALTH_HEAP_CRIT_RATIO', 0.92));
const maxSseIdleMs = () => {
  const n = Number(process.env.MIA_HEALTH_MAX_SSE_IDLE_MS ?? 45_000);
  return Number.isFinite(n) && n >= 25_000 && n <= 300_000 ? n : 45_000;
};

// Keep a timestamp for every connected SSE client. A healthy client must not
// mask another stalled client; this also keeps close/error cleanup idempotent.
let nextStreamId = 0;
const streamFrames = new Map<number, number>();

/** Attach to the canonical authenticated GET /api/stream, not the proposed /api/telemetry/stream. */
export const sseHealth = {
  opened(nowMs = Date.now()): number {
    const id = ++nextStreamId;
    streamFrames.set(id, nowMs);
    return id;
  },
  emitted(id: number, nowMs = Date.now()): void {
    if (streamFrames.has(id)) streamFrames.set(id, nowMs);
  },
  closed(id: number): void {
    streamFrames.delete(id);
  },
  state() {
    // Oldest stream is the limiting liveness signal.
    const timestamps = streamFrames.values();
    let oldest = 0;
    for (const at of timestamps) {
      if (!oldest || at < oldest) oldest = at;
    }
    return { activeStreams: streamFrames.size, lastFrameAtMs: oldest };
  },
};

/** Read-only checks on the canonical database connection; never force WAL checkpoints. */
export function sampleRuntimeHealth(): RuntimeHealthSample {
  const heap = v8.getHeapStatistics();
  let databaseJournalMode = '';
  let databaseFileBacked = true;
  let databaseError = false;
  try {
    const db = getDb();
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined;
    const dbs = db.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
    databaseJournalMode = String(row?.journal_mode ?? '').toLowerCase();
    // SQLite in-memory databases cannot use WAL; skip the WAL-only rule for isolated unit tests.
    databaseFileBacked = !!dbs.find((entry) => entry.name === 'main')?.file;
  } catch {
    databaseError = true;
  }
  return {
    heapUsedBytes: heap.used_heap_size,
    heapLimitBytes: heap.heap_size_limit,
    databaseJournalMode,
    databaseFileBacked,
    databaseError,
    sseActiveStreams: activeStreams,
    sseLastFrameAtMs: lastFrameAtMs,
  };
}

/** Pure evaluator: deterministic to test without a live venue or network socket. */
export function runtimeHealthChecks(nowMs = Date.now(), sample: RuntimeHealthSample = sampleRuntimeHealth()): RuntimeHealthCheck[] {
  const ratio = sample.heapLimitBytes > 0 ? sample.heapUsedBytes / sample.heapLimitBytes : Infinity;
  const heapStatus: RuntimeHealthCheck['status'] = !Number.isFinite(ratio) || ratio >= criticalRatio()
    ? 'fail' : ratio >= warnRatio() ? 'info' : 'pass';
  const heap: RuntimeHealthCheck = {
    name: 'runtime.heap',
    status: heapStatus,
    detail: heapStatus === 'fail' ? 'V8 heap utilization critical' : heapStatus === 'info' ? 'V8 heap utilization elevated' : 'V8 heap utilization acceptable',
  };
  const sqlite: RuntimeHealthCheck = sample.databaseError
    ? { name: 'runtime.sqlite', status: 'fail', detail: 'SQLite health unavailable' }
    : !sample.databaseFileBacked
      ? { name: 'runtime.sqlite', status: 'skip', detail: 'in-memory SQLite (WAL not applicable)' }
      : sample.databaseJournalMode === 'wal'
        ? { name: 'runtime.sqlite', status: 'pass', detail: 'SQLite WAL active' }
        : { name: 'runtime.sqlite', status: 'fail', detail: 'SQLite WAL unavailable' };
  const sse: RuntimeHealthCheck = sample.sseActiveStreams === 0
    ? { name: 'runtime.sse', status: 'skip', detail: 'no connected telemetry clients' }
    : sample.sseLastFrameAtMs > 0 && nowMs >= sample.sseLastFrameAtMs
      && nowMs - sample.sseLastFrameAtMs <= maxSseIdleMs()
      ? { name: 'runtime.sse', status: 'pass', detail: 'telemetry stream emitting' }
      : { name: 'runtime.sse', status: 'fail', detail: 'connected telemetry stream stalled' };
  return [heap, sqlite, sse];
}

/** Entry-only safety interlock. Protective exits are deliberately NOT routed through this function. */
export function runtimeEntryBlocks(nowMs = Date.now(), sample: RuntimeHealthSample = sampleRuntimeHealth()): string[] {
  return runtimeHealthChecks(nowMs, sample)
    .filter((c) => c.status === 'fail' && (c.name === 'runtime.heap' || c.name === 'runtime.sqlite'))
    .map((c) => c.name === 'runtime.heap' ? 'RUNTIME_HEAP_CRITICAL' : 'RUNTIME_SQLITE_UNHEALTHY');
}

let previousFailures = '';
/**
 * Called periodically by buildApp after Fastify becomes ready.
 * Alerts once on each change of failing checks; errors in alert transport never restart trading.
 */
export function checkRuntimeHealthAndAlert(nowMs = Date.now()): RuntimeHealthCheck[] {
  const checks = runtimeHealthChecks(nowMs);
  const failed = checks.filter((c) => c.status === 'fail');
  const fingerprint = failed.map((c) => c.name).sort().join(',');
  if (fingerprint !== previousFailures) {
    if (fingerprint || previousFailures) {
      bus.publish('health', { type: 'runtime-resource-health', status: fingerprint ? 'DEGRADED' : 'RECOVERED', checks, at: nowMs });
      try {
        notify(fingerprint ? 'CRITICAL' : 'INFO', fingerprint ? 'Runtime resource health degraded' : 'Runtime resource health recovered',
          fingerprint ? failed.map((c) => c.name).join(', ') : 'Previously failing runtime resource checks recovered.', 'runtime-health');
      } catch { /* SQLite can be degraded: do not turn an alert failure into a process crash. */ }
    }
    previousFailures = fingerprint;
  }
  return checks;
}
