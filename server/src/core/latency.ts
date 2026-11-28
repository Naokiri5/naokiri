/** Part 29.5 / 33.18 latency tracing: per-stage ring buffers with p50/p95/p99. */
const MAX = 2000;
// One canonical sampler. Overwrite the oldest observation in O(1), rather
// than shifting up to 2,000 values on each hot-path sample.
interface StageWindow { values: number[]; next: number }
const stages = new Map<string, StageWindow>();

export function record(stage: string, ms: number) {
  if (!stage.trim() || !Number.isFinite(ms) || ms < 0) return;
  let window = stages.get(stage);
  if (!window) { window = { values: [], next: 0 }; stages.set(stage, window); }
  window.values[window.next] = ms;
  window.next = (window.next + 1) % MAX;
}
export async function timed<T>(stage: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = performance.now();
  try { return await fn(); } finally { record(stage, performance.now() - t0); }
}
function pct(sorted: number[], q: number) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null; }
export function latencyReport() {
  return [...stages.entries()].map(([stage, window]) => {
    const s = [...window.values].sort((a, b) => a - b);
    const r = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
    return { stage, samples: s.length, p50: r(pct(s, 0.5)), p95: r(pct(s, 0.95)), p99: r(pct(s, 0.99)), max: r(s[s.length - 1] ?? null) };
  }).sort((a, b) => a.stage.localeCompare(b.stage));
}
export function resetLatency() { stages.clear(); }
