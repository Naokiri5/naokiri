// Run: node --import tsx scripts/benchmark-chart.mjs
// Synthetic fixture benchmark, not market-performance evidence.
import { analyzeChart } from '../server/src/chart/analysis.ts';
const candles = Array.from({ length: 400 }, (_, i) => ({ t: i * 3600000, o: 100 + i / 10, h: 102 + i / 10, l: 98 + i / 10, c: 101 + i / 10, v: 10 }));
for (let i = 0; i < 200; i++) analyzeChart('benchmark:synthetic', '1h', candles, 400 * 3600000);
const samples = [];
for (let i = 0; i < 2000; i++) {
  const start = performance.now();
  analyzeChart('benchmark:synthetic', '1h', candles, 400 * 3600000);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ node: process.version, bars: 400, warmup: 200, runs: samples.length, p50ms: samples[999], p95ms: samples[1899], p99ms: samples[1979], scope: 'single-process pure analysis; synthetic fixtures; excludes HTTP/providers/AI/OMS' }, null, 2));
