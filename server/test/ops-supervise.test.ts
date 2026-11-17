import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SUP = resolve(__dirname, '../scripts/supervise.mjs');
/** Run the supervisor over a tiny child script; resolves with its exit code and stderr. */
function supervise(childSrc: string, env: Record<string, string> = {}, onStart?: (p: ReturnType<typeof spawn>, dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'mia-sup-')); const script = join(dir, 'child.mjs'); writeFileSync(script, childSrc);
  return new Promise<{ code: number | null; err: string; runs: number; dir: string }>((done) => {
    const p = spawn(process.execPath, [SUP], { env: { ...process.env, MIA_SUPERVISE_CMD: JSON.stringify([process.execPath, script, join(dir, 'runs')]), MIA_SUPERVISE_BASE_MS: '5', ...env } });
    let err = ''; p.stderr.on('data', (d) => (err += d));
    onStart?.(p, dir);
    p.on('exit', (code) => { const runs = existsSync(join(dir, 'runs')) ? readFileSync(join(dir, 'runs'), 'utf8').length : 0; rmSync(dir, { recursive: true, force: true }); done({ code, err, runs, dir }); });
  });
}
// Each run appends one character to the counter file passed as argv[2].
const COUNT = "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], 'x');";

describe('supervisor', () => {
  it('restarts a crashing child with backoff and gives up after the crash-loop cap', async () => {
    const r = await supervise(`${COUNT} process.exit(3);`, { MIA_SUPERVISE_MAX_CRASHES: '3' });
    expect(r.code).toBe(1);
    expect(r.runs).toBe(4); // first run + 3 restarts, then the 4th crash exceeds the cap
    expect(r.err).toMatch(/restart 1\/3 in 5 ms/); expect(r.err).toMatch(/restart 2\/3 in 10 ms/); expect(r.err).toMatch(/restart 3\/3 in 20 ms/);
    expect(r.err).toMatch(/crash loop/);
  });
  it('a clean exit ends supervision without a restart', async () => {
    const r = await supervise(`${COUNT} process.exit(0);`);
    expect(r.code).toBe(0); expect(r.runs).toBe(1); expect(r.err).toMatch(/exited cleanly/);
  });
  it('recovers: a crash followed by a clean exit restarts exactly once', async () => {
    const r = await supervise(`import { readFileSync, appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], 'x'); process.exit(readFileSync(process.argv[2], 'utf8').length === 1 ? 5 : 0);`);
    expect(r.code).toBe(0); expect(r.runs).toBe(2);
  });
  it('forwards SIGTERM to the child and does not restart it', async () => {
    const child = `${COUNT} process.on('SIGTERM', () => { appendFileSync(process.argv[2] + '.term', 't'); process.exit(0); }); setInterval(() => {}, 1000);`;
    let termSeen = false;
    const r = await supervise(child, {}, (p, dir) => {
      const wait = setInterval(() => { if (existsSync(join(dir, 'runs'))) { clearInterval(wait); p.kill('SIGTERM'); } }, 10);
      p.on('exit', () => { termSeen = existsSync(join(dir, 'runs.term')); });
    });
    expect(r.code).toBe(0); expect(r.runs).toBe(1); expect(termSeen).toBe(true); expect(r.err).toMatch(/SIGTERM: stopping/);
  });
  it('rejects a malformed command override', async () => {
    const r = await supervise('', { MIA_SUPERVISE_CMD: '{"not":"an array"}' });
    expect(r.code).toBe(2);
  });
});
