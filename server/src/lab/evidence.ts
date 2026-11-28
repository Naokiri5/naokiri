/**
 * Strategy evidence (DB-only): the out-of-sample cohort that Strategy Lab, strategy qualification and the risk gate
 * share. Kept free of network, backtest and provider imports so the risk gate can use it on the entry path.
 */
import { strategyById } from './strategies.js';
import { BACKTEST_MODEL_VERSION, type BtResult, type BtTrade } from './backtest.js';
import { all, get, J, P } from '../db/db.js';
import { qualifyEvidence, type QualificationReport } from './qualification.js';

/**
 * Out-of-sample evidence for the strategy's current version: OOS trades from the newest backtest per instrument,
 * preferring the current fill model. `backtestRuns` counts every stored run of this version (all trials, kept or not).
 */
export function oosCohort(strategyId: string) {
  const definition = strategyById(strategyId); if (!definition) return null;
  const rows = all<{ instrument: string; result: string }>('SELECT instrument, result FROM backtests WHERE strategy_id=? ORDER BY created_at DESC', strategyId);
  const legacy = { modelVersion: 1, instruments: new Set<string>(), trades: [] as BtTrade[] };
  const current = { modelVersion: BACKTEST_MODEL_VERSION, instruments: new Set<string>(), trades: [] as BtTrade[] };
  let otherModelRuns = 0; // stored runs under a non-legacy fill model that is not the current one: never evidence, but a re-run is needed
  for (const row of rows) {
    const result = P<BtResult>(row.result);
    if (result.strategyVersion !== definition.version) continue;
    const modelVersion = result.modelVersion ?? legacy.modelVersion;
    if (modelVersion !== current.modelVersion && modelVersion !== legacy.modelVersion) { otherModelRuns++; continue; }
    const cohort = modelVersion === current.modelVersion ? current : legacy;
    if (cohort.instruments.has(row.instrument)) continue;
    cohort.instruments.add(row.instrument);
    cohort.trades.push(...result.trades.filter((trade) => trade.segment === 'OOS'));
  }
  // Keep existing evidence usable until a run with the current fill model is available for this strategy.
  const { modelVersion, instruments, trades } = current.instruments.size ? current : legacy;
  // Every distinct configuration run for this version is a trial, including runs superseded above. Identical re-runs
  // (same instrument, window, bar count and fill model) are one trial, so repeating a run cannot dilute the benchmark.
  const trials = new Map<string, number[]>();
  for (const r of rows.map((row) => P<BtResult>(row.result)).filter((r) => r.strategyVersion === definition.version)) {
    const key = J([r.instrument, r.interval, r.from, r.to, r.bars, r.modelVersion ?? 1]);
    if (!trials.has(key)) trials.set(key, r.trades.filter((trade) => trade.segment === 'OOS').map((trade) => trade.r));
  }
  const runOosR = [...trials.values()];
  return { strategyVersion: definition.version, modelVersion, instruments: instruments.size, trades, otherModelRuns, backtestRuns: runOosR.length, runOosR };
}

/**
 * Qualification verdict for the strategy's current version, memoized on a fingerprint of its stored backtests: their
 * unique ids and creation times, plus the strategy and fill-model versions. Rowids alone are not enough (a restored or
 * different database can reuse them). Any change to the stored runs changes the key; an exception is never cached.
 */
const verdicts = new Map<string, { key: string; report: QualificationReport }>();
export function strategyQualification(strategyId: string): QualificationReport {
  const version = strategyById(strategyId)?.version ?? null;
  const f = get<{ ids: string | null; ts: number | null }>('SELECT GROUP_CONCAT(id) ids, SUM(created_at) ts FROM (SELECT id, created_at FROM backtests WHERE strategy_id=? ORDER BY id)', strategyId)!;
  const key = J([version, BACKTEST_MODEL_VERSION, f.ids, f.ts]);
  const hit = verdicts.get(strategyId);
  if (hit && hit.key === key) return hit.report;
  const report = qualifyEvidence(oosCohort(strategyId));
  verdicts.set(strategyId, { key, report });
  return report;
}
