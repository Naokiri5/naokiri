import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Blueprint L-01 acceptance, across two real OS processes sharing one SQLite file: a former leader that resumes after
 * its lease expired and another instance took over cannot commit an engine write, even if it skips the lane's check.
 */
const serverDir = resolve(import.meta.dirname, '..');
const TTL = 1_500;
const canSpawn = (() => { try { return spawnSync(process.execPath, ['-e', '0'], { timeout: 10_000 }).status === 0; } catch { return false; } })();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) return false; await sleep(25); } return true; }
function proc(fixture: string, dataDir: string) {
  const lines: any[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', `test/fixtures/${fixture}`], {
    cwd: serverDir, stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, MIA_DATA_DIR: dataDir, MIA_OFFLINE: '1', MIA_ENGINE_LEASE_TTL_MS: String(TTL), NODE_OPTIONS: '--disable-warning=ExperimentalWarning' },
  });
  let buf = ''; child.stdout!.on('data', (d) => { buf += d; const p = buf.split('\n'); buf = p.pop()!; for (const l of p) if (l) lines.push(JSON.parse(l)); });
  return { child, lines };
}

describe.skipIf(!canSpawn)('write fence across two real processes (blueprint L-01)', () => {
  const kids: ChildProcess[] = []; const dirs: string[] = [];
  afterEach(async () => { for (const k of kids) k.kill('SIGKILL'); await sleep(100); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it('a paused former leader cannot commit after another instance took the lease', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-fence-')); dirs.push(dir);
    const a = proc('stale-writer-process.ts', dir); kids.push(a.child);
    expect(await until(() => a.lines.some((l) => l.ready), 20_000)).toBe(true);
    expect(a.lines[0].leader).toBe(true);
    // Positive control: while A still holds a live lease, its fenced write commits.
    a.child.stdin!.write('write\n');
    expect(await until(() => a.lines.some((l) => 'wrote' in l), 10_000)).toBe(true);
    expect(a.lines.find((l) => 'wrote' in l).wrote).toBe(true);
    // A stops renewing (paused). B starts the normal engine loop and takes over once A's lease expires.
    const b = proc('engine-lease-process.ts', dir); kids.push(b.child);
    expect(await until(() => b.lines.some((l) => l.leader), 15_000)).toBe(true);
    // A resumes mid-lane and tries to write without re-checking: the fence inside the transaction refuses it.
    a.child.stdin!.write('write\n');
    expect(await until(() => a.lines.filter((l) => 'wrote' in l).length >= 2, 10_000)).toBe(true);
    const second = a.lines.filter((l) => 'wrote' in l)[1];
    expect(second).toMatchObject({ wrote: false, error: 'LeaseLostError' });
    const db = new DatabaseSync(join(dir, 'mia.db'), { readOnly: true });
    try {
      const rows = db.prepare("SELECT COUNT(*) n FROM journal WHERE summary='stale-writer write'").get() as { n: number };
      expect(rows.n).toBe(1); // only the positive-control write exists
    } finally { db.close(); }
  }, 60_000);
});
