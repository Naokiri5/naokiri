// Run: node --import tsx scripts/benchmark-trade-bars.mjs
// Memory soak: node --expose-gc --import tsx scripts/benchmark-trade-bars.mjs --soak [seconds]
// Synthetic fixture benchmark for BrainOS V2 roadmap §9 (FAST internal stages). It measures this process only;
// it is not market-performance evidence and excludes providers, network, OMS and chain inclusion.
import { FAST_TRADE_BARS, TradeBarBuilder } from '../server/src/market/tradeBars.ts';
import { assessVolumeSpike } from '../server/src/market/volumeSpike.ts';

const INSTRUMENTS = 1_000;
const SECONDS = 30;
// Untimed warm-up so the 5s and 15s windows hold their 20-bar baseline (21 x 15s) before latency is measured;
// without it every assessment returns INSUFFICIENT_EVIDENCE early and the deeper checks are never timed.
const WARMUP_SECONDS = 330;
const WARMUP_EVENTS_PER_SECOND = 2_000;
const BURST_EVENTS_PER_SECOND = 10_000; // roadmap burst target across all tracked candidates
const T0 = 1_800_000_000_000;
const FP = 1_000_000_000n;
const builders = Array.from({ length: INSTRUMENTS }, (_, i) => new TradeBarBuilder({ ...FAST_TRADE_BARS, instrumentId: `SOLANA_JUPITER:T${i}` }));
let state = 1;
const random = () => (state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32;
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: sorted.length, p50ms: percentile(sorted, 0.5), p95ms: percentile(sorted, 0.95), p99ms: percentile(sorted, 0.99), maxms: sorted.at(-1) };
};

if (process.argv[2] === '--soak') {
  // Sustained 2,000 events/s across 1,000 tokens; heap after forced GC each simulated minute must plateau.
  if (typeof global.gc !== 'function') throw new Error('run with --expose-gc');
  const seconds = Number(process.argv[3] ?? 1_800), rate = 2_000, heap = [];
  let n = 0;
  for (let s = 0; s < seconds; s++) {
    for (let k = 0; k < rate; k++) {
      const b = builders[Math.floor(random() * INSTRUMENTS)];
      const at = T0 + s * 1_000 + Math.floor((k / rate) * 1_000);
      b.ingest({ instrumentId: b.config.instrumentId, eventId: `soak${++n}:0`, eventTimeMs: at, priceFp: FP, baseQtyFp: FP,
        aggressor: random() < 0.5 ? 'buy' : 'sell', participant: `w${Math.floor(random() * 5_000)}`, finality: 'final' }, at);
    }
    if ((s + 1) % 60 === 0) { global.gc(); heap.push([s + 1, Math.round(process.memoryUsage().heapUsed / 1e6)]); }
  }
  console.log(JSON.stringify({ node: process.version, instruments: INSTRUMENTS, eventsPerSec: rate, events: n, heapMbAfterGcByMinute: heap }));
  process.exit(0);
}

const ingest = [], assess = [];
let id = 0, finalized = 0;
const verdicts = {};
let warm = 0;
for (let s = 0; s < WARMUP_SECONDS; s++) {
  for (let k = 0; k < WARMUP_EVENTS_PER_SECOND; k++) {
    const b = builders[Math.floor(random() * INSTRUMENTS)];
    const at = T0 + s * 1_000 + Math.floor((k / WARMUP_EVENTS_PER_SECOND) * 1_000);
    b.ingest({ instrumentId: b.config.instrumentId, eventId: `warm${++warm}:0`, eventTimeMs: at, priceFp: FP, baseQtyFp: FP,
      aggressor: random() < 0.5 ? 'buy' : 'sell', participant: `w${Math.floor(random() * 5_000)}`, finality: 'final' }, at);
  }
}
const T1 = T0 + WARMUP_SECONDS * 1_000;
const wall = performance.now();
for (let s = 0; s < SECONDS; s++) {
  for (let k = 0; k < BURST_EVENTS_PER_SECOND; k++) {
    const b = builders[Math.floor(random() * INSTRUMENTS)];
    const at = T1 + s * 1_000 + Math.floor((k / BURST_EVENTS_PER_SECOND) * 1_000);
    const trade = {
      instrumentId: b.config.instrumentId, eventId: `sig${++id}:0`, eventTimeMs: at,
      priceFp: FP + BigInt(Math.floor(random() * 1e6)), baseQtyFp: FP * BigInt(1 + Math.floor(random() * 9)),
      aggressor: random() < 0.5 ? 'buy' : 'sell', participant: `w${Math.floor(random() * 5_000)}`, finality: 'final',
    };
    const start = performance.now();
    const { finalized: bars } = b.ingest(trade, at);
    ingest.push(performance.now() - start);
    for (const bar of bars) {
      if (bar.intervalMs !== 1_000) continue;
      finalized++;
      const t = performance.now();
      const result = assessVolumeSpike({ windows: [1_000, 5_000, 15_000].map((intervalMs) => ({ intervalMs, bars: b.finalBars(intervalMs) })), nowMs: at, launchAgeMs: null });
      assess.push(performance.now() - t);
      verdicts[result.verdict] = (verdicts[result.verdict] ?? 0) + 1;
    }
  }
}
const elapsedMs = performance.now() - wall;
const memory = process.memoryUsage();
console.log(JSON.stringify({
  node: process.version, instruments: INSTRUMENTS, events: id, simulatedSeconds: SECONDS,
  throughputEventsPerSec: Math.round(id / (elapsedMs / 1000)),
  ingestIncludingFinalization: summary(ingest), roadmapBudget: { stage: 'incremental chart/feature update', p95ms: 7, p99ms: 10 },
  volumeAssessment: summary(assess), assessedBars: finalized, verdicts, warmupSeconds: WARMUP_SECONDS,
  rssMb: Math.round(memory.rss / 1e6), heapUsedMb: Math.round(memory.heapUsed / 1e6),
  scope: 'single process, synthetic uniform flow, pure builder and detector; excludes I/O, providers, risk, OMS',
}, null, 2));
