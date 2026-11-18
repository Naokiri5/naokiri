#!/usr/bin/env node
/**
 * QA run that records its own outcome next to the Vitest JSON report (release-gate evidence).
 * The JSON reporter does not capture run-level failures (e.g. an unhandled rejection outside any assertion), so its
 * `success` flag alone could make gates PASS after a failed run. This wrapper writes data/qa/test-run.json with the
 * process exit code and the sha256 of the report it produced; qa/gates.ts accepts the report only when that file says
 * the run exited 0 AND the hash matches the report on disk (CodeRabbit PR #13).
 *   npm run qa -w server
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.MIA_DATA_DIR ? resolve(process.env.MIA_DATA_DIR) : resolve(serverDir, '..', 'data');
const qaDir = join(dataDir, 'qa'); mkdirSync(qaDir, { recursive: true });
const reportPath = join(qaDir, 'test-results.json'); const outcomePath = join(qaDir, 'test-run.json');
// Each run hashes its own private report. The public pair remains hash-checked by the release gate.
const runDir = mkdtempSync(join(qaDir, '.run-'));
const runReport = join(runDir, 'report.json');
const runOutcome = join(runDir, 'outcome.json');

const vitest = join(dirname(createRequire(join(serverDir, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs'); // bin is not an exported subpath
const git = (...a) => { const g = spawnSync('git', a, { cwd: serverDir, encoding: 'utf8' }); return g.status === 0 ? g.stdout.trim() : null; };
/** Endpoint snapshots identify the revision and tracked status. They cannot detect edits restored between snapshots. */
const identity = () => ({ head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain') });
const before = identity();
const startedAt = Date.now();
const r = spawnSync(process.execPath, [vitest, 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${runReport}`, ...process.argv.slice(2)], {
  cwd: serverDir, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') },
});
const exitCode = r.status ?? 1;
const after = identity();
const outcome = { exitCode, signal: r.signal ?? null, startedAt, finishedAt: Date.now(),
  reportSha256: existsSync(runReport) ? createHash('sha256').update(readFileSync(runReport)).digest('hex') : null,
  // Evidence is bound to the exact commit and a clean tree (blueprint Q-01); gates reject any other build.
  // dirty = unknown (null) without git; otherwise true unless the tree was clean AND identical before and after the run.
  commit: before.head === after.head ? after.head : null,
  dirty: before.status === null || after.status === null ? null : before.status.length > 0 || after.status.length > 0 || before.status !== after.status || before.head !== after.head,
  node: process.version, invocation: ['vitest', 'run', ...process.argv.slice(2)] };
try {
  writeFileSync(runOutcome, JSON.stringify(outcome, null, 2) + '\n');
  if (outcome.reportSha256) renameSync(runReport, reportPath);
  else rmSync(reportPath, { force: true });
  renameSync(runOutcome, outcomePath);
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
process.exit(exitCode);
