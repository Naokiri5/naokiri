import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeP0Manifest, P0_SEEDS, verifyP0Evidence } from './p0Evidence.js';

try {
  const [command, directory, sha, ...rest] = process.argv.slice(2);
  if (!directory || !sha || rest.length || !['record', 'verify'].includes(command))
    throw new Error('Usage: verify-p0-evidence.ts record|verify REPORT_DIR EXPECTED_SHA');
  const reports = P0_SEEDS.map(seed => readFileSync(join(directory, `p0-${seed}.json`), 'utf8'));
  const path = join(directory, 'p0-manifest.json');
  const manifest: unknown = command === 'record' ? makeP0Manifest(sha, reports) : JSON.parse(readFileSync(path, 'utf8'));
  const result = verifyP0Evidence(sha, manifest, reports);
  if (!result.ok) throw new Error(result.reason);
  if (command === 'record') writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, scope: 'offline P0 only; LIVE not certified' }));
} catch (error) {
  console.error('P0 evidence rejected:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
