import { monitorEventLoopDelay } from 'node:perf_hooks';
import { latencyReport } from '../core/latency.js';
import { POOL, quarantined } from '../workers/runtime.js';
import { QCI_POLICY } from '../qci/coordinator.js';
import { config } from '../config.js';
import { market } from '../market/store.js';
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
  const mem = process.memoryUsage();
  return {
    budgets, providers, other,
    eventLoop: { samplingMs: LOOP_RES_MS, p50: ms(loopDelay.percentile(50)), p99: ms(loopDelay.percentile(99)), max: ms(loopDelay.max), mean: ms(loopDelay.mean) },
    process: { uptimeSec: Math.round((Date.now() - startedAt) / 1000), rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), node: process.versions.node },
    scheduler: { tickerIntervalMs: config.tickerIntervalMs, scanIntervalMs: config.scanIntervalMs, backgroundIntervalMs: 60_000, lastTickerAt: botStatus.lastTickerAt, lastScanAt: botStatus.lastScanAt, cycles: botStatus.cycles },
    workers: { concurrency: POOL.concurrency, deadlineMs: POOL.deadlineMs, quarantined: quarantined.size, quorum: QCI_POLICY },
    tiers: { t1Broad: market.tickers.size, t2Deep: market.universe.length },
    transport: { marketData: 'REST polling (documented fallback; WebSocket hosts not allow-listed)', eventBus: 'in-process' },
    note: 'Budgets apply to MIA-controlled stages only. Speed never bypasses data-quality, QCI, risk or permission checks.',
  };
}
export function resetLoopDelay() { loopDelay.reset(); }
