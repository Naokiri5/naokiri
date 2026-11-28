import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/config.js';
import { P0_REQUIRED_TESTS } from '../src/qa/gates.js';
import { makeP0Manifest, P0_SEEDS, verifyP0Evidence } from '../src/qa/p0Evidence.js';

const SHA = 'a'.repeat(40);
const files = [...new Set(P0_REQUIRED_TESTS.map(ref => ref.file))];
function report(startTime: number) {
  return {
    startTime, success: true, numTotalTests: P0_REQUIRED_TESTS.length, numPassedTests: P0_REQUIRED_TESTS.length,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: files.length, numPassedTestSuites: files.length, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: files.map(file => ({ name: file, status: 'passed', assertionResults: P0_REQUIRED_TESTS
      .filter(ref => ref.file === file).map(ref => ({ fullName: ref.fullName, status: 'passed' })) })),
  };
}
const sample = () => P0_SEEDS.map((_, i) => report(1_800_000_000_000 + i * 1000));
const encode = (reports: ReturnType<typeof sample>) => reports.map(r => JSON.stringify(r));
function verify(reports: ReturnType<typeof sample>) {
  const raw = encode(reports);
  return verifyP0Evidence(SHA, makeP0Manifest(SHA, raw), raw);
}

describe('three-pass P0 evidence contract', () => {
  it('accepts three distinct complete reports of the exact revision without authorizing LIVE', () => {
    expect(verify(sample())).toEqual({ ok: true, sha: SHA, seeds: [...P0_SEEDS], passedPerRun: P0_SEEDS.map(() => P0_REQUIRED_TESTS.length) });
  });

  it.each([
    ['failed test', (r: ReturnType<typeof report>) => { r.success = false; r.numFailedTests = 1; }],
    ['skipped assertion', (r: ReturnType<typeof report>) => { r.testResults[0].assertionResults[0].status = 'skipped'; r.numPassedTests--; r.numPendingTests++; }],
    ['missing file', (r: ReturnType<typeof report>) => { r.testResults.pop(); }],
    ['duplicate file', (r: ReturnType<typeof report>) => { r.testResults.push(structuredClone(r.testResults[0])); }],
    ['empty suite', (r: ReturnType<typeof report>) => { r.testResults[0].assertionResults = []; }],
    ['malformed counter', (r: ReturnType<typeof report>) => { r.numPassedTests = NaN; }],
    ['missing critical assertion', (r: ReturnType<typeof report>) => { r.testResults[0].assertionResults[0].fullName = 'unrelated passing assertion'; }],
  ] as const)('fails closed for %s in any run', (_label, corrupt) => {
    for (let index = 0; index < P0_SEEDS.length; index++) {
      const reports = sample(); corrupt(reports[index]);
      expect(verify(reports).ok).toBe(false);
    }
  });

  it('rejects missing passes, altered hashes, duplicated runs, wrong seeds and stale revision', () => {
    const reports = sample(), raw = encode(reports), manifest = makeP0Manifest(SHA, raw);
    expect(verifyP0Evidence(SHA, manifest, raw.slice(1)).ok).toBe(false);
    expect(verifyP0Evidence(SHA, manifest, [raw[0] + ' ', raw[1], raw[2]]).ok).toBe(false);
    expect(verifyP0Evidence('b'.repeat(40), manifest, raw).ok).toBe(false);
    expect(verifyP0Evidence(SHA, { ...manifest, passes: [...manifest.passes].reverse() }, raw).ok).toBe(false);
    expect(verify([reports[0], reports[0], reports[2]]).ok).toBe(false);
    expect(verify([reports[1], reports[0], reports[2]]).ok).toBe(false);
    expect(verifyP0Evidence(SHA, manifest, ['not-json!', raw[1], raw[2]]).ok).toBe(false);
  });

  it('rejects unrelated skipped tests even when every critical assertion passed', () => {
    const reports = sample(), r = reports[0];
    r.testResults[0].assertionResults.push({ fullName: 'unrelated skipped test', status: 'skipped' });
    r.numTotalTests++; r.numPendingTests++;
    expect(verify(reports)).toMatchObject({ ok: false, reason: expect.stringContaining('skipped') });
  });

  it.skipIf(process.platform === 'win32')('the promotion script refuses even valid P0 evidence and cannot run arm or rollback hooks', () => {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const dir = mkdtempSync(join(tmpdir(), 'mia-p0-promotion-'));
    try {
      const raw = encode(sample());
      const sentinel = join(dir, 'must-not-exist');
      for (const [index, seed] of P0_SEEDS.entries()) writeFileSync(join(dir, `p0-${seed}.json`), raw[index]);
      writeFileSync(join(dir, 'p0-manifest.json'), JSON.stringify(makeP0Manifest(sha, raw)));
      const options = { cwd: REPO_ROOT, encoding: 'utf8' as const, env: { ...process.env,
        MIA_OWNER_LIVE_ACK: '1', ARM_LIVE_CMD: `touch "${sentinel}"`, ROLLBACK_CMD: `touch "${sentinel}"` }, timeout: 15_000 };
      const run = () => spawnSync('bash', ['scripts/promote-live-bounded.sh', dir, sha], options);
      const result = run();
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('offline P0 only');
      expect(result.stderr).toContain('BOUNDED_LIVE is hard-locked');
      expect(existsSync(sentinel)).toBe(false);
      writeFileSync(join(dir, 'p0-13702.json'), '{}');
      const invalid = run();
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('P0 evidence rejected');
      expect(existsSync(sentinel)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
