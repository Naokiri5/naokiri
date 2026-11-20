#!/usr/bin/env node
/**
 * Supervisor for an always-on PAPER server (no live trading is enabled by running this).
 *   node scripts/supervise.mjs            → runs `node scripts/run.mjs start` and restarts it if it crashes
 *
 * - A clean exit (code 0, e.g. after SIGTERM drain) ends supervision; any other exit is a crash and is restarted.
 * - Restarts back off exponentially (base × 2^n, capped at 60 s). A run that stayed up for MIA_SUPERVISE_STABLE_MS
 *   (default 120 s) resets the backoff.
 * - Crash-loop cap: more than MIA_SUPERVISE_MAX_CRASHES (default 8) crashes within MIA_SUPERVISE_WINDOW_MS
 *   (default 10 min) stops supervision with exit code 1, so a broken build cannot restart forever (systemd or the
 *   owner decides what next). The engine lease means a restarted copy never overlaps a still-draining one.
 * - SIGINT/SIGTERM are forwarded to the child; no restart follows.
 * Test hooks: MIA_SUPERVISE_CMD (JSON array: command and args) and MIA_SUPERVISE_BASE_MS.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (name, fallback, min, max) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= min && v <= max ? v : fallback; };
const baseMs = num('MIA_SUPERVISE_BASE_MS', 1_000, 1, 60_000);
const capMs = 60_000;
const stableMs = num('MIA_SUPERVISE_STABLE_MS', 120_000, 1, 86_400_000);
const maxCrashes = num('MIA_SUPERVISE_MAX_CRASHES', 8, 1, 1_000);
const windowMs = num('MIA_SUPERVISE_WINDOW_MS', 600_000, 1, 86_400_000);
const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let cmd = [process.execPath, resolve(serverDir, 'scripts', 'run.mjs'), 'start'];
if (process.env.MIA_SUPERVISE_CMD) {
  try { const c = JSON.parse(process.env.MIA_SUPERVISE_CMD); if (Array.isArray(c) && c.length && c.every((x) => typeof x === 'string')) cmd = c; else throw new Error(); }
  catch { console.error('[supervisor] MIA_SUPERVISE_CMD must be a JSON array of strings'); process.exit(2); }
}
const log = (m) => console.error(`[supervisor ${new Date().toISOString()}] ${m}`);
let child = null; let stopping = false; let streak = 0; let timer = null; const crashes = [];

function start() {
  timer = null; const startedAt = Date.now();
  child = spawn(cmd[0], cmd.slice(1), { cwd: serverDir, stdio: 'inherit', env: process.env });
  log(`started pid ${child.pid ?? '(none)'}`);
  let handled = false;
  // A spawn failure (ENOENT/EACCES) may emit 'error' without 'exit'; the supervisor used to fall idle and exit 0, which
  // systemd reads as a clean stop (MIA-OPS-004). Treat it exactly like a crash.
  child.on('error', (e) => { log(`spawn failed: ${e.message}`); onExit(127, null); });
  child.on('exit', (code, signal) => onExit(code, signal));
  function onExit(code, signal) {
    if (handled) return; handled = true;
    child = null; const upMs = Date.now() - startedAt;
    if (stopping) {
      // The server exits 1 when a lane fails to drain; the service manager must see that, not a clean stop (CodeRabbit #45).
      const clean = code === 0 || (code === null && (signal === 'SIGTERM' || signal === 'SIGINT'));
      log(clean ? `stopped (${signal ?? code})` : `stopped, but the server did not shut down cleanly (code ${code}, signal ${signal})`);
      process.exit(clean ? 0 : 1);
    }
    if (code === 0) { log('exited cleanly; supervision ends'); process.exit(0); }
    const now = Date.now(); crashes.push(now); while (crashes.length && now - crashes[0] > windowMs) crashes.shift();
    if (crashes.length > maxCrashes) { log(`crash loop: ${crashes.length} crashes within ${Math.round(windowMs / 1000)} s; giving up`); process.exit(1); }
    streak = upMs >= stableMs ? 1 : streak + 1;
    const delay = Math.min(capMs, baseMs * 2 ** (streak - 1));
    log(`crashed (${signal ? `signal ${signal}` : `code ${code}`}) after ${Math.round(upMs / 1000)} s; restart ${crashes.length}/${maxCrashes} in ${delay} ms`);
    timer = setTimeout(start, delay);
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  if (stopping) return; stopping = true; log(`${sig}: stopping`);
  if (timer) { clearTimeout(timer); process.exit(0); }
  child?.kill(sig);
});
start();
