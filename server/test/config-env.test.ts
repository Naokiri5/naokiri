import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** MIA_ENGINE_LEASE_TTL_MS: '0' selects the default; nonzero values below 1 s are rejected (CodeRabbit PR #12). */
const load = (value: string) => spawnSync(process.execPath, ['--import', 'tsx', '-e', "const c = (await import('./src/config.ts')).config; console.log(JSON.stringify(c.engineLeaseTtlMs));"], {
  cwd: resolve(__dirname, '..'), env: { ...process.env, MIA_OFFLINE: '1', MIA_ENGINE_LEASE_TTL_MS: value, NODE_OPTIONS: '--disable-warning=ExperimentalWarning' }, encoding: 'utf8',
});
describe('engine lease TTL setting', () => {
  it('accepts the documented 0 sentinel and real values; rejects nonzero values under 1 s', () => {
    expect(load('0')).toMatchObject({ status: 0 }); expect(load('0').stdout.trim()).toBe('0');
    expect(load('5000').stdout.trim()).toBe('5000');
    const bad = load('500'); expect(bad.status).not.toBe(0); expect(bad.stderr).toMatch(/MIA_ENGINE_LEASE_TTL_MS must be an integer between 1000/);
  });
});
