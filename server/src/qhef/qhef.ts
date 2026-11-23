import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { latencyReport } from '../core/latency.js';
import { POOL, quarantined } from '../workers/runtime.js';
import { QCI_POLICY } from '../qci/coordinator.js';
import { config } from '../config.js';
import { market } from '../market/store.js';
import { bookAge } from '../market/quality.js';
import { botStatus } from '../bot/bot.js';

/**
 * Part 33.18 latency budgets. Budgets cover stages MIA controls (internal hot path). Provider round trips are
 * reported but not budgeted: they depend on the network and the venue. Budgets were set from the measured
 * baseline in docs/QHEF_LATENCY_BASELINE.md with headroom; they are engineering targets, not guarantees.
 */
export interface Budget { stage: string; lane: 'hot' | 'background' | 'provider'; metric: 'p95' | 'p99'; budgetMs: number | null; description: string }
export const BUDGETS: Budget[] = [
  { stage: 'qci.worker.compute', lane: 'hot', metric: 'p99', budgetMs: 5, description: 'one specialist worker evaluation' },
  { stage: 'qci.consensus', lane: 'hot', metric: 'p95', budgetMs: 150, description: 'all applicable workers + validation + challenge panel' },
  { stage: 'decision.engine', lane: 'hot', metric: 'p95', budgetMs: 100, description: 'decision pipeline incl. deterministic risk gate' },
  { stage: 'pipeline.candidate_to_decision', lane: 'hot', metric: 'p95', budgetMs: 500, description: 'candidate created → decision recorded' },
  { stage: 'oms.submit', lane: 'hot', metric: 'p95', budgetMs: 50, description: 'last-moment validation + paper fill + persistence' },
  { stage: 'features.incremental', lane: 'hot', metric: 'p95', budgetMs: 50, description: 'incremental indicator update per interval' },
  { stage: 'scan.cycle', lane: 'background', metric: 'p95', budgetMs: 3000, description: 'full deep-tier scan pass (excluding data fetch)' },
];

const LOOP_RES_MS = 10;
const loopDelay = monitorEventLoopDelay({ resolution: LOOP_RES_MS }); loopDelay.enable();
const startedAt = Date.now();
let lastEluSample = performance.eventLoopUtilization();

export function qhefReport() {
  const rep = latencyReport(); const byStage = new Map(rep.map((r) => [r.stage, r]));
  const budgets = BUDGETS.map((b) => {
    const r = byStage.get(b.stage); const v = r ? (b.metric === 'p95' ? r.p95 : r.p99) : null;
    return { ...b, samples: r?.samples ?? 0, p50: r?.p50 ?? null, p95: r?.p95 ?? null, p99: r?.p99 ?? null, max: r?.max ?? null,
      status: !r || v == null ? 'NO_DATA' : b.budgetMs != null && v > b.budgetMs ? 'OVER_BUDGET' : 'WITHIN_BUDGET' };
  });
  const providers = rep.filter((r) => r.stage.startsWith('provider.') || r.stage.startsWith('fabric.')).map((r) => ({ ...r, lane: 'provider' as const }));
  const other = rep.filter((r) => !BUDGETS.some((b) => b.stage === r.stage) && !providers.some((p) => p.stage === r.stage));
  // the histogram includes the sampling interval itself; report only the excess (true blocking delay)
  const ms = (ns: number) => Math.max(0, Math.round((ns / 1e6 - LOOP_RES_MS) * 100) / 100);
  const currentElu = performance.eventLoopUtilization();
  const windowElu = performance.eventLoopUtilization(currentElu, lastEluSample);
  lastEluSample = currentElu;
  const eluActiveRatio = Number.isFinite(windowElu.utilization) ? Math.max(0, Math.min(1, windowElu.utilization)) : null;
  const mem = process.memoryUsage();
  return {
    budgets, providers, other,
    eventLoop: { samplingMs: LOOP_RES_MS, p50: ms(loopDelay.percentile(50)), p95: ms(loopDelay.percentile(95)), p99: ms(loopDelay.percentile(99)), max: ms(loopDelay.max), mean: ms(loopDelay.mean), eluActiveRatio },
    process: { uptimeSec: Math.round((Date.now() - startedAt) / 1000), rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), node: process.versions.node },
    scheduler: { tickerIntervalMs: config.tickerIntervalMs, scanIntervalMs: config.scanIntervalMs, backgroundIntervalMs: 60_000, lastTickerAt: botStatus.lastTickerAt, lastScanAt: botStatus.lastScanAt, cycles: botStatus.cycles },
    workers: { concurrency: POOL.concurrency, deadlineMs: POOL.deadlineMs, quarantined: quarantined.size, quorum: QCI_POLICY },
    tiers: { t1Broad: market.tickers.size, t2Deep: market.universe.length },
    transport: { marketData: 'REST polling (documented fallback; WebSocket hosts not allow-listed)', eventBus: 'in-process' },
    note: 'Budgets apply to MIA-controlled stages only. Speed never bypasses data-quality, QCI, risk or permission checks.',
  };
}
/** Reset the SAME QHEF loop-delay histogram and ELU observation baseline (no duplicate sampler). */
export function resetLoopDelay() {
  loopDelay.reset();
  lastEluSample = performance.eventLoopUtilization();
}

/**
 * Read-only hot-path telemetry adapter for the existing QHEF measurements.
 * Never re-labels an observed stage as an uninstrumented proposed stage.
 * Binance market depth currently arrives as independent REST snapshots:
 * none of these books is certified as WebSocket diff-depth synchronized.
 */
export function latencyTelemetrySnapshot() {
  const now = Date.now();
  const q = qhefReport();
  const observed = q.budgets.filter((b) => b.status !== 'NO_DATA');
  const slaOverallPass = observed.length === 0 ? null : observed.every((b) => b.status === 'WITHIN_BUDGET');
  const stages = q.budgets.map((b) => ({
    stage: b.stage, lane: b.lane, description: b.description,
    metric: b.metric, budgetMs: b.budgetMs, count: b.samples,
    p50Ms: b.p50, p95Ms: b.p95, p99Ms: b.p99, maxMs: b.max,
    budgetBreaches: null as number | null, // canonical monitor does not retain per-stage breach counts
    status: b.status,
  }));
  const books = [...market.deep.values()].slice(0, 50).map((d) => {
    const b = d.book;
    const ageMs = bookAge(b, now);
    const bestBid = ageMs == null ? null : b!.bids[0][0];
    const bestAsk = ageMs == null ? null : b!.asks[0][0];
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
    return {
      symbol: d.instrument.symbol,
      syncState: 'REST_SNAPSHOT_UNVERIFIED' as const,
      lastUpdateId: b?.lastUpdateId ?? null,
      bestBid, bestAsk,
      spreadBps: mid != null && mid > 0 && bestBid != null && bestAsk != null
        ? (bestAsk - bestBid) / mid * 10_000 : null,
      ageMs,
    };
  });
  return {
    schemaVersion: 1, timestampEpochMs: now, slaOverallPass, stages,
    eventLoop: {
      eldP50Ms: q.eventLoop.p50, eldP95Ms: q.eventLoop.p95,
      eldP99Ms: q.eventLoop.p99, eldMaxMs: q.eventLoop.max,
      eluActiveRatio: q.eventLoop.eluActiveRatio,
      overloaded: q.eventLoop.p99 > 25 || (q.eventLoop.eluActiveRatio != null && q.eventLoop.eluActiveRatio > 0.85),
      samplingMs: q.eventLoop.samplingMs,
    },
    books,
    transport: {
      mode: 'REST_POLLING' as const,
      websocketConnected: null,
      usedWeight1m: null,
      rateLimitCooldownUntilEpochMs: null,
      weightHardLimit1m: 6000,
      weightSoftWatermark1m: 4800,
    },
    limitations: [
      'Proposed sub-50ms FAST/exit stages are not instrumented in this branch; existing QHEF stages are reported without relabeling.',
      'Binance REST polling has no verified synchronized diff-depth stream; book sync is unverified.',
      'Binance used-weight and 429/418 cooldown signals are not currently collected; headroom must not be inferred.',
      'SLA status covers only observed QHEF stages; it is not a certification for live trading.',
    ],
  };
}
