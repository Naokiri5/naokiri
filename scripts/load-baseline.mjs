#!/usr/bin/env node
/**
 * Fixed-load performance baseline (debug work order §10.7). Starts the BUILT server offline on a temporary data
 * directory and port, creates a throwaway owner, then measures:
 *   - startup time until /api/health answers
 *   - p50/p95/p99 latency for a fixed set of authenticated GET routes (N sequential requests each)
 *   - event-loop delay and heap from /api/qhef after the load
 * Offline means no market data: this measures the API/DB/serialization path, not provider latency.
 *   node scripts/load-baseline.mjs [requestsPerRoute=200]
 * Never point this at a real data directory.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const N = Number(process.argv[2] ?? 200);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'mia-load-'));
const port = 8890 + Math.floor(Math.random() * 50);
const base = `http://127.0.0.1:${port}`;
const ROUTES = ['/api/health', '/api/ready', '/api/shell', '/api/overview', '/api/bot', '/api/portfolio', '/api/risk', '/api/history?from=0', '/api/intelligence', '/api/academy/stats'];

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const r2 = (x) => Math.round(x * 100) / 100;

const t0 = performance.now();
const child = spawn(process.execPath, [join(root, 'server/dist/main.js')], {
  env: { ...process.env, MIA_OFFLINE: '1', MIA_DATA_DIR: dataDir, MIA_PORT: String(port), MIA_HOST: '127.0.0.1', MIA_LOG: 'warn', NODE_OPTIONS: '--disable-warning=ExperimentalWarning' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let setupCode;
const output = createInterface({ input: child.stdout });
output.on('line', (line) => {
  setupCode ??= /First-time setup code: ([A-Z2-9]{5}(?:-[A-Z2-9]{5}){3})/.exec(line)?.[1];
});
try {
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  if (!up) throw new Error('server did not start');
  const startupMs = performance.now() - t0;
  for (let i = 0; i < 20 && !setupCode; i++) await new Promise((r) => setTimeout(r, 50));
  if (!setupCode) throw new Error('offline server did not print a first-time setup code');
  const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'load baseline throwaway owner', setupCode }) });
  const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0];
  if (!setup.ok || !cookie) throw new Error(`could not initialize the offline owner: HTTP ${setup.status}`);
  const routes = {};
  for (const r of ROUTES) {
    const ms = [];
    for (let i = 0; i < N; i++) {
      const s = performance.now(); const res = await fetch(base + r, { headers: { cookie } }); await res.arrayBuffer();
      if (!res.ok && !(r === '/api/ready' && res.status === 503)) throw new Error(`${r} → ${res.status}`);
      ms.push(performance.now() - s);
    }
    routes[r] = { p50: r2(pct(ms, 50)), p95: r2(pct(ms, 95)), p99: r2(pct(ms, 99)) };
  }
  const q = await (await fetch(`${base}/api/qhef`, { headers: { cookie } })).json().catch(() => null);
  console.log(JSON.stringify({ node: process.version, requestsPerRoute: N, startupMs: Math.round(startupMs), routesMs: routes,
    eventLoop: q?.eventLoop ?? q?.loop ?? null, process: q?.process ?? null, scope: 'offline server, sequential requests, empty paper account; excludes providers and LLM' }, null, 1));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  output.close();
  rmSync(dataDir, { recursive: true, force: true });
}
