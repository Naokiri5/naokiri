// Run: node --expose-gc --import tsx scripts/benchmark-replay-stream.mjs [events=2000000]
// Roadmap P0.2 streaming acceptance: a large gzip NDJSON tape is generated in the OS temp directory, then streamed through
// the canonical tape reader (server/src/lab/tape-reader.ts) and deterministic replay (server/src/lab/eventReplay.ts)
// while resident memory is sampled. Synthetic data; measures this process only, not market performance.
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { streamCompressedMarketTape } from '../server/src/lab/tape-reader.ts';
import { replayBookProbes } from '../server/src/lab/eventReplay.ts';

const events = Number(process.argv[2] ?? 2_000_000);
const dir = mkdtempSync(join(tmpdir(), 'mia-replay-bench-'));
const file = join(dir, 'tape.ndjson.gz');
const FP = 1_000_000_000n;

async function writeTape() {
  const gzip = createGzip({ level: 1 });
  const out = createWriteStream(file);
  gzip.pipe(out);
  for (let i = 0; i < events; i++) {
    const ask = 100n * FP + BigInt(i % 1000) * 1_000_000n;
    const line = `{"type":"BOOK_TICK","tsMs":${1_700_000_000_000 + i},"venue":"BINANCE_SPOT","symbol":"${i % 5 ? 'BTCUSDT' : 'ETHUSDT'}","bidFp":"${ask - FP}","askFp":"${ask}","bidQtyFp":"${5n * FP}","askQtyFp":"${5n * FP}"}\n`;
    if (!gzip.write(line)) await once(gzip, 'drain');
  }
  gzip.end();
  await once(out, 'finish');
}

const t0 = performance.now();
await writeTape();
const written = performance.now() - t0;
const samples = [];
let seen = 0;
async function* counted() {
  for await (const event of streamCompressedMarketTape(file)) {
    if (++seen % 100_000 === 0) { globalThis.gc?.(); samples.push(process.memoryUsage().rss); }
    yield event;
  }
}
const t1 = performance.now();
const result = await replayBookProbes(counted(), { venue: 'BINANCE_SPOT', symbol: 'BTCUSDT', latencyMs: 5, maxWaitMs: 1_000, feeBps: 10, slippageBps: 5 },
  (book) => (book.tsMs % 1_000 === 1 ? { side: 'buy', qtyFp: FP } : null));
const replayMs = performance.now() - t1;
const mb = (b) => Math.round(b / 1048576);
const warm = samples.slice(Math.floor(samples.length / 4));
console.log(JSON.stringify({
  node: process.version, events, gzipBytes: statSync(file).size, writeSeconds: +(written / 1000).toFixed(1),
  replaySeconds: +(replayMs / 1000).toFixed(1), eventsPerSecond: Math.round(events / (replayMs / 1000)),
  rssMb: { first: mb(samples[0]), afterWarmupMin: mb(Math.min(...warm)), afterWarmupMax: mb(Math.max(...warm)), last: mb(samples.at(-1)) },
  probes: result.probes, observed: result.observed, determinismHash: result.determinismHash,
  scope: 'synthetic tape; reader + causal replay only; excludes strategy, risk and OMS',
}, null, 2));
rmSync(dir, { recursive: true, force: true });
