#!/usr/bin/env node
/**
 * Run release-gate QA against a private snapshot of the selected Git commit with its locked dependencies.
 * Preserve the test process outcome and the hash of its JSON report so a run-level failure cannot certify a release.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(serverDir, '..');
const dataDir = process.env.MIA_DATA_DIR ? resolve(process.env.MIA_DATA_DIR) : join(repoDir, 'data');
const qaDir = join(dataDir, 'qa');
const reportPath = join(qaDir, 'test-results.json');
const outcomePath = join(qaDir, 'test-run.json');
const invocation = ['vitest', 'run'];

if (process.argv.length > 2) {
  console.error('Release QA runs the full suite. For test filters or other Vitest options, use npm test -w server -- <options>.');
  process.exit(1);
}

mkdirSync(qaDir, { recursive: true });
const runDir = mkdtempSync(join(qaDir, '.run-'));
const runReport = join(runDir, 'report.json');
const runOutcome = join(runDir, 'outcome.json');
const startedAt = Date.now();
let snapshotDir;
let commit = null;
let exitCode = 1;
let signal = null;

try {
  commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: repoDir, encoding: 'utf8' }).trim();
  snapshotDir = mkdtempSync(join(tmpdir(), 'mia-qa-'));
  const archive = join(runDir, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, commit], { cwd: repoDir, stdio: 'inherit' });
  execFileSync('tar', ['-xf', archive, '-C', snapshotDir], { stdio: 'inherit' });

  const env = {
    ...process.env,
    MIA_BUILD_SHA: commit,
    MIA_DATA_DIR: join(snapshotDir, 'data'),
    MIA_OFFLINE: '1',
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
  };
  delete env.MIA_LIVE_TESTS;
  delete env.NODE_PATH;

  const npmArgs = ['--prefix', snapshotDir, 'ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  const npmCommand = process.env.npm_execpath ? process.execPath : 'npm';
  const installArgs = process.env.npm_execpath ? [process.env.npm_execpath, ...npmArgs] : npmArgs;
  execFileSync(npmCommand, installArgs, { cwd: snapshotDir, stdio: 'inherit', env });

  const snapshotServer = join(snapshotDir, 'server');
  const vitestPackage = createRequire(join(snapshotServer, 'package.json')).resolve('vitest/package.json');
  const vitest = join(dirname(vitestPackage), 'vitest.mjs');
  const result = spawnSync(process.execPath, [vitest, 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${runReport}`], {
    cwd: snapshotServer, stdio: 'inherit', env,
  });
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
  signal = result.signal;
} catch (error) {
  console.error('Could not complete release QA:', error.message);
}

try {
  const reportSha256 = existsSync(runReport) ? createHash('sha256').update(readFileSync(runReport)).digest('hex') : null;
  const outcome = { exitCode, signal, startedAt, finishedAt: Date.now(), reportSha256, commit, source: 'git-archive-v1', node: process.version, invocation };
  writeFileSync(runOutcome, JSON.stringify(outcome, null, 2) + '\n');
  if (reportSha256) renameSync(runReport, reportPath);
  else rmSync(reportPath, { force: true });
  renameSync(runOutcome, outcomePath);
} finally {
  rmSync(runDir, { recursive: true, force: true });
  if (snapshotDir) rmSync(snapshotDir, { recursive: true, force: true });
}
process.exitCode = exitCode;
