import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const serverDir = resolve(import.meta.dirname, '..');
const TTL = 1_500;
type State = { holds: boolean; epoch: number; alive: boolean; acked: boolean };

function holder(dataDir: string) {
  const state: State = { holds: false, epoch: 0, alive: true, acked: false };
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/lease-holder.ts'], {
    cwd: serverDir, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, MIA_DATA_DIR: dataDir, MIA_LEASE_TTL_MS: String(TTL), MIA_OFFLINE: '1', NODE_OPTIONS: '--disable-warning=ExperimentalWarning' },
  });
  let buf = '';
  child.stdout!.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop()!; for (const l of lines) if (l) Object.assign(state, JSON.parse(l), { acked: true }); });
  child.on('exit', () => { state.alive = false; state.holds = false; });
  return { child, state };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) return false; await sleep(25); } return true; }

describe('engine lease across real processes', () => {
  const kids: ChildProcess[] = [];
  afterEach(() => { for (const k of kids) k.kill('SIGKILL'); });

  it('exactly one process holds at any sample; after SIGKILL the other takes over with a higher epoch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mia-lease-proc-'));
    const a = holder(dir); kids.push(a.child);
    expect(await until(() => a.state.holds, 10_000)).toBe(true); // first process creates the schema
    const b = holder(dir); kids.push(b.child);
    expect(await until(() => b.state.acked, 10_000)).toBe(true); // B has opened the DB and made its first lease attempt
    expect(b.state).toMatchObject({ alive: true, holds: false, epoch: 0 });
    for (let i = 0; i < 60; i++) { // 3 s, two full TTLs
      await sleep(50);
      expect([a, b].filter((p) => p.state.holds).length).toBe(1);
    }
    const [owner, other] = a.state.holds ? [a, b] : [b, a];
    const epoch = owner.state.epoch;
    owner.child.kill('SIGKILL');
    const t0 = Date.now();
    expect(await until(() => other.state.holds, 6_000)).toBe(true);
    expect(other.state.epoch).toBeGreaterThan(epoch);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(TTL / 2); // waited out the TTL, did not jump in early
  }, 20_000);
});
