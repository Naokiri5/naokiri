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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.MIA_DATA_DIR ? resolve(process.env.MIA_DATA_DIR) : resolve(serverDir, '..', 'data');
const qaDir = join(dataDir, 'qa'); mkdirSync(qaDir, { recursive: true });
const reportPath = join(qaDir, 'test-results.json'); const outcomePath = join(qaDir, 'test-run.json');
// A stale outcome must never pair with a new report: remove both before the run.
rmSync(outcomePath, { force: true }); rmSync(reportPath, { force: true });

const vitest = join(dirname(createRequire(join(serverDir, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs'); // bin is not an exported subpath
const startedAt = Date.now();
const r = spawnSync(process.execPath, [vitest, 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`, ...process.argv.slice(2)], {
  cwd: serverDir, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') },
});
const exitCode = r.status ?? 1;
const outcome = { exitCode, signal: r.signal ?? null, startedAt, finishedAt: Date.now(),
  reportSha256: existsSync(reportPath) ? createHash('sha256').update(readFileSync(reportPath)).digest('hex') : null };
writeFileSync(`${outcomePath}.partial`, JSON.stringify(outcome, null, 2) + '\n'); renameSync(`${outcomePath}.partial`, outcomePath);
process.exit(exitCode);
