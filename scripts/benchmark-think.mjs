// Run (from repo root): MIA_OFFLINE=1 MIA_DATA_DIR=$(mktemp -d) node --import tsx scripts/benchmark-think.mjs
// THINK pipeline baseline (MIA-THINK-020/075): compute-only latency of the EXISTING path on synthetic, seeded fixtures:
//   buildContext -> runConsensus (100 workers + QCI) -> decide -> buildCertificate, then an offline evidence replay of
//   every recorded decision from its DITAS snapshot (replay is timed separately and NOT included in 'total').
// Excludes network, providers, HTTP, AI and OMS. Not market-performance evidence. Results depend on the machine.
import os from 'node:os';
import { freshDb, seedInstrument } from '../server/test/helpers.ts';
import { buildContext } from '../server/src/market/scanner.ts';
import { runConsensus } from '../server/src/qci/coordinator.ts';
import { decide } from '../server/src/decision/engine.ts';
import { buildCertificate } from '../server/src/decision/certificate.ts';
import { replayDecision } from '../server/src/ditas/replay.ts';
import { market } from '../server/src/market/store.ts';
import { get } from '../server/src/db/db.ts';

if (process.env.MIA_OFFLINE !== '1' || !process.env.MIA_DATA_DIR) { console.error('Set MIA_OFFLINE=1 and a throwaway MIA_DATA_DIR (the benchmark writes decisions).'); process.exit(2); }
freshDb(); market.reset();
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'DOTUSDT'];
const inst = SYMBOLS.map((s, i) => seedInstrument(s, { seed: 100 + i }));
const cand = (id, last, n) => ({ id: `cand_bench_${n}`, eventId: `ev${n}`, traceId: `tr${n}`, instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
  signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: ['bench'] }, regime: 'TREND_UP', createdAt: Date.now() });

const stages = { context: [], consensus: [], decide: [], certificate: [], total: [], replay: [] };
const replayStatus = {};
const states = {}; let failed = 0, abstained = 0, eligible = 0;
const RUNS = Number(process.env.BENCH_RUNS ?? 200), WARMUP = 20;
for (let n = 0; n < RUNS + WARMUP; n++) {
  const { inst: i, last } = inst[n % inst.length];
  const c = cand(i.id, last, n);
  const t0 = performance.now(); const ctx = buildContext(c);
  const t1 = performance.now(); const rec = await runConsensus(ctx);
  const t2 = performance.now(); const rep = decide(c, ctx, rec, null, 0);
  const t3 = performance.now();
  const row = get('SELECT report, consensus_id FROM decisions WHERE id=?', rep.id); const cons = get('SELECT record FROM consensus_records WHERE id=?', row.consensus_id);
  buildCertificate(row.report, cons?.record ?? null);
  const t4 = performance.now();
  const t5 = performance.now(); const rp = replayDecision(rep.id); const t6 = performance.now();
  if (n < WARMUP) continue;
  stages.replay.push(t6 - t5); replayStatus[rp.status] = (replayStatus[rp.status] ?? 0) + 1;
  stages.context.push(t1 - t0); stages.consensus.push(t2 - t1); stages.decide.push(t3 - t2); stages.certificate.push(t4 - t3); stages.total.push(t4 - t0);
  states[rec.state] = (states[rec.state] ?? 0) + 1; failed += rec.workers.failed; abstained += rec.workers.abstaining; eligible += rec.workers.eligible;
}
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100; };
const summary = Object.fromEntries(Object.entries(stages).map(([k, xs]) => [k, { p50ms: pct(xs, 50), p95ms: pct(xs, 95), p99ms: pct(xs, 99) }]));
console.log(JSON.stringify({
  benchmark: 'think-pipeline-v1', node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, runs: RUNS, warmup: WARMUP, instruments: SYMBOLS.length,
  stages: summary, consensusStates: states, offlineReplay: replayStatus, workerFailureRate: eligible ? Math.round((failed / eligible) * 1e4) / 1e4 : null, workerAbstentionRate: eligible ? Math.round((abstained / eligible) * 1e4) / 1e4 : null,
  scope: 'single process, warmed in-memory synthetic fixtures, SQLite writes included in consensus/decide; excludes network, providers, HTTP, AI, OMS. Not evidence of trading performance.',
}, null, 2));
