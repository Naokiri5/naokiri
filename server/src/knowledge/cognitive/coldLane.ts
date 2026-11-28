import type { MiaStrategyGenome } from './contracts.js';
import { runStrategyGenomeFunnel, type StrategyEvaluatorHooks } from './genomes.js';

export interface ColdLaneBatchOptions {
  batchSize: number;
  maxDurationMs: number;
  yieldEveryBatch?: boolean;
  signal?: AbortSignal;
}
export interface ColdLaneBatchReport {
  processedCount: number;
  remainingCount: number;
  nextCursor: number;
  verified: MiaStrategyGenome[];
  rejected: MiaStrategyGenome[];
  abortedByBudget: boolean;
  elapsedMs: number;
  tradingAuthority: false;
}
const yieldToEventLoop = () => new Promise<void>(r => setImmediate(r));
/**
 * Cooperatively bounded cold research. Not a hard CPU sandbox: evaluators must
 * respect AbortSignal and must be separately constrained for untrusted/CPU-heavy jobs.
 * Hot market/position protections never run from this lane.
 */
export async function runBoundedSgeColdLane(
  queue: readonly MiaStrategyGenome[], hooks: StrategyEvaluatorHooks,
  options: ColdLaneBatchOptions,
): Promise<ColdLaneBatchReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 32)
    throw new Error('COLD_BATCH_SIZE_OUT_OF_RANGE');
  if (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs < 10
      || options.maxDurationMs > 300_000) throw new Error('COLD_BUDGET_OUT_OF_RANGE');
  const started = performance.now(), verified: MiaStrategyGenome[] = [], rejected: MiaStrategyGenome[] = [];
  const deadline = started + options.maxDurationMs;
  let processedCount = 0;
  for (let start = 0; start < queue.length;) {
    if (options.signal?.aborted || performance.now() >= deadline) break;
    const end = Math.min(queue.length, start + options.batchSize);
    for (let i = start; i < end; i++) {
      if (options.signal?.aborted || performance.now() >= deadline) break;
      // Every queued hypothesis is a trial: deflate against the whole programme, not the one-genome call.
      const res = await runStrategyGenomeFunnel([queue[i]],hooks,options.signal,{ totalTrials: queue.length });
      verified.push(...res.verified); rejected.push(...res.rejected);
      processedCount++;
    }
    start = end;
    if (options.yieldEveryBatch !== false) await yieldToEventLoop();
  }
  return {
    processedCount,remainingCount:queue.length-processedCount,nextCursor:processedCount,
    verified,rejected,abortedByBudget:processedCount < queue.length,
    elapsedMs:performance.now()-started,tradingAuthority:false,
  };
}
