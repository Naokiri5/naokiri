import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const serverDir = resolve(import.meta.dirname, '..');
const TTL = 1_500;
/** Some sandboxes forbid child processes; the test is skipped there instead of failing. */
const canSpawn = (() => { try { return spawnSync(process.execPath, ['-e', '0'], { timeout: 10_000 }).status === 0; } catch { return false; } })();
type Line = { id: string; leader: boolean; role: string; at: number };

function engine(dataDir: string) {
  const s = { lines: [] as Line[], alive: true };
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/engine-lease-process.ts'], {
    cwd: serverDir, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, MIA_DATA_DIR: dataDir, MIA_OFFLINE: '1', MIA_ENGINE_LEASE_TTL_MS: String(TTL), NODE_OPTIONS: '--disable-warning=ExperimentalWarning' },
  });
  let buf = '';
  child.stdout!.on('data', (d) => { buf += d; const parts = buf.split('\n'); buf = parts.pop()!; for (const l of parts) if (l) s.lines.push(JSON.parse(l)); });
  child.on('exit', () => { s.alive = false; });
  return { child, s, leader: () => s.alive && !!s.lines.at(-1)?.leader };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) return false; await sleep(25); } return true; }

describe.skipIf(!canSpawn)('engine lease across two real processes', () => {
  const kids: ChildProcess[] = []; const dirs: string[] = [];
  afterEach(async () => { for (const k of kids) k.kill('SIGKILL'); await sleep(100); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it('one leader at a time; after SIGKILL the standby takes over once the TTL expires, with no overlapping writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-engine-lease-')); dirs.push(dir);
    const a = engine(dir); kids.push(a.child);
    expect(await until(a.leader, 15_000)).toBe(true); // A created the schema and leads
    const b = engine(dir); kids.push(b.child);
    expect(await until(() => b.s.lines.length > 0, 15_000)).toBe(true); // B is up and made its first attempt
    for (let i = 0; i < 40; i++) { await sleep(50); expect([a, b].filter((p) => p.leader()).length).toBe(1); }
    expect(b.leader()).toBe(false); expect(b.s.lines.at(-1)!.role).toBe('STANDBY');
    a.child.kill('SIGKILL');
    // Anchor the takeover to A's persisted lease expiry, not to wall-clock sampling (CodeRabbit PR #12). B cannot take a
    // live lease, so right after the kill the row is still A's.
    const leaseRow = () => { const d = new DatabaseSync(join(dir, 'mia.db'), { readOnly: true }); try { return d.prepare("SELECT holder, acquired_at, expires_at FROM runtime_leases WHERE name='engine'").get() as { holder: string; acquired_at: number; expires_at: number }; } finally { d.close(); } };
    const aLease = leaseRow();
    expect(await until(b.leader, 6_000)).toBe(true); // polling deadline is only a failure bound
    const bLease = leaseRow();
    expect(bLease.holder).not.toBe(aLease.holder);
    expect(bLease.acquired_at).toBeGreaterThan(aLease.expires_at); // B took over only after A's lease had expired

    const db = new DatabaseSync(join(dir, 'mia.db'), { readOnly: true });
    try {
      const w = db.prepare("SELECT ref, ts FROM journal WHERE summary='lease-fixture write' ORDER BY ts, rowid").all() as { ref: string; ts: number }[];
      const ids = [...new Set(w.map((x) => x.ref))];
      expect(ids).toHaveLength(2);
      const lastA = Math.max(...w.filter((x) => x.ref === ids[0]).map((x) => x.ts)); const firstB = Math.min(...w.filter((x) => x.ref === ids[1]).map((x) => x.ts));
      expect(firstB).toBeGreaterThan(lastA); // B never wrote while A could
      expect(w.findIndex((x) => x.ref === ids[1])).toBe(w.filter((x) => x.ref === ids[0]).length); // two contiguous blocks
      expect(firstB - lastA).toBeGreaterThanOrEqual(TTL - 300);
      const takeover = db.prepare("SELECT summary FROM journal WHERE summary LIKE 'Engine lease acquired by %' ORDER BY ts").all() as { summary: string }[];
      expect(takeover).toHaveLength(2);
    } finally { db.close(); }
  }, 30_000);
});
