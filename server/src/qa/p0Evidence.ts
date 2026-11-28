import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { evaluateTestEvidence, P0_REQUIRED_TESTS } from './gates.js';

export const P0_SEEDS = [13701, 13702, 13703] as const;
export const P0_SCHEMA = 'mia.p0.offline.v1';
export const reportDigest = (json: string) => createHash('sha256').update(json).digest('hex');
const shaPattern = /^[a-f0-9]{40}$/;
const files = [...new Set(P0_REQUIRED_TESTS.map(ref => ref.file))];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function makeP0Manifest(sha: string, reports: readonly string[]) {
  if (!shaPattern.test(sha) || reports.length !== P0_SEEDS.length) throw new Error('invalid revision or P0 report count');
  return { schema: P0_SCHEMA, sha, passes: P0_SEEDS.map((seed, index) => ({ seed, sha256: reportDigest(reports[index]) })) };
}

/** Evidence of an offline run, not an authenticated production attestation or execution permit. */
export function verifyP0Evidence(expectedSha: string, manifest: unknown, reports: readonly string[]) {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (!shaPattern.test(expectedSha) || !record(manifest) || manifest.schema !== P0_SCHEMA || manifest.sha !== expectedSha ||
      !Array.isArray(manifest.passes) || manifest.passes.length !== P0_SEEDS.length || reports.length !== P0_SEEDS.length)
    return fail('missing/mismatched revision, schema or pass count');
  const digests = new Set<string>(), starts = new Set<number>();
  const counts: number[] = [];
  let previousStart = -1;
  let expectedAssertions: string | undefined;
  for (const [index, seed] of P0_SEEDS.entries()) {
    const pass: unknown = manifest.passes[index];
    const raw = reports[index];
    if (typeof raw !== 'string' || !record(pass) || pass.seed !== seed || pass.sha256 !== reportDigest(raw))
      return fail(`seed ${seed}: report digest or seed mismatch`);
    const digest = reportDigest(raw);
    if (digests.has(digest)) return fail(`seed ${seed}: duplicate report`);
    digests.add(digest);
    let report: unknown;
    try { report = JSON.parse(raw); } catch { return fail(`seed ${seed}: malformed JSON`); }
    const evidence = evaluateTestEvidence(report, P0_REQUIRED_TESTS);
    if (evidence.status !== 'PASS') return fail(`seed ${seed}: ${evidence.evidence}`);
    if (!record(report) || !Array.isArray(report.testResults) || typeof report.startTime !== 'number' ||
        report.numPendingTests !== 0 || report.numTodoTests !== 0 || report.numPendingTestSuites !== 0)
      return fail(`seed ${seed}: skipped/pending/todo tests are not allowed`);
    if (starts.has(report.startTime) || report.startTime <= previousStart) return fail(`seed ${seed}: reused or out-of-order start time`);
    starts.add(report.startTime);
    previousStart = report.startTime;
    const seenFiles = new Set<string>();
    const allNames: string[] = [];
    for (const suite of report.testResults) {
      if (!record(suite) || typeof suite.name !== 'string' || suite.status !== 'passed' ||
          !Array.isArray(suite.assertionResults) || !suite.assertionResults.length)
        return fail(`seed ${seed}: missing or invalid file results`);
      const path = posix.normalize(suite.name.replaceAll('\\', '/'));
      const file = files.find(f => path === f || `server/${path}` === f ||
        ((posix.isAbsolute(path) || /^[A-Za-z]:\//.test(path)) && path.endsWith(`/${f}`)));
      if (!file || seenFiles.has(file)) return fail(`seed ${seed}: unexpected or duplicate file result`);
      seenFiles.add(file);
      const names = new Set<string>();
      for (const assertion of suite.assertionResults) {
        if (!record(assertion) || typeof assertion.fullName !== 'string' || assertion.status !== 'passed' || names.has(assertion.fullName))
          return fail(`seed ${seed}: non-passing or duplicate assertion in ${file}`);
        names.add(assertion.fullName);
        allNames.push(JSON.stringify([file, assertion.fullName]));
      }
    }
    if (seenFiles.size !== files.length) return fail(`seed ${seed}: incomplete file coverage`);
    const actualAssertions = JSON.stringify(allNames.sort());
    if (expectedAssertions !== undefined && actualAssertions !== expectedAssertions)
      return fail(`seed ${seed}: assertion coverage changed between passes`);
    expectedAssertions = actualAssertions;
    counts.push(Number(report.numPassedTests));
  }
  if (!counts.every(count => count === counts[0])) return fail('inconsistent assertion counts between passes');
  return { ok: true as const, sha: expectedSha, seeds: [...P0_SEEDS], passedPerRun: counts };
}
