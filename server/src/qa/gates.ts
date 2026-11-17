import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { config, REPO_ROOT } from '../config.js';
import { all, get } from '../db/db.js';
import { currentPolicy } from '../risk/policy.js';
import { verifyAuditChain } from '../core/audit.js';
import { WORKERS } from '../workers/registry.js';
import { reconcile } from '../portfolio/calendar.js';

/** Part 12.7 release gates. Evidence-driven; manual gates can only be satisfied by humans outside this app. */
export interface Gate { id: string; name: string; status: 'PASS' | 'FAIL' | 'PENDING' | 'NOT_CERTIFIED' | 'NOT_IMPLEMENTED'; evidence: string }
export interface TestRef { file: string; fullName: string }

const marketTests: readonly TestRef[] = [
  ...['fresh multi-source data is OK', 'stale quote fails closed', 'cross-venue deviation fails', 'missing instrument fails'].map(title => ({ file: 'server/test/quality.test.ts', fullName: `data quality gate (Part 32.2) ${title}` })),
  { file: 'server/test/live.providers.test.ts', fullName: 'live providers (read-only) fetches real data from every key-free provider' },
  { file: 'server/test/live.providers.test.ts', fullName: 'live paper execution (real order book, simulated fills) enters and exits BTCUSDT against the live Binance book and reconciles' },
];
const workerTests: readonly TestRef[] = [
  { file: 'server/test/qci.test.ts', fullName: 'QCI (Part 29) every applicable worker returns a schema-valid, signed packet' },
];
const joeTests: readonly TestRef[] = [
  { file: 'server/test/api.test.ts', fullName: 'HTTP API (auth, permissions, release gate) Trader Joe has no order/limit/mode/withdraw tools and refuses such commands' },
];
const emergencyTests: readonly TestRef[] = [
  { file: 'server/test/oms.test.ts', fullName: 'Paper OMS lifecycle (Parts 17/20/26/27) emergency stop: blocks, cancels, verifies protection, does not auto-close' },
  { file: 'server/test/api.test.ts', fullName: 'HTTP API (auth, permissions, release gate) risk-increasing actions require step-up; risk-reducing ones do not' },
];

export const TEST_GATE_REQUIREMENTS = {
  G01: [...marketTests, ...workerTests, ...joeTests, ...emergencyTests, { file: 'server/test/static.test.ts', fullName: 'static UI serving serves index, assets and SPA routes' }],
  G02: marketTests,
  G03: workerTests,
  G04: joeTests,
  G09: emergencyTests,
} satisfies Record<string, readonly TestRef[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedTestPath(path: string) {
  const normalized = posix.normalize(path.replaceAll('\\', '/'));
  if (normalized.startsWith('test/')) return `server/${normalized}`;
  return normalized;
}

export function evaluateTestEvidence(report: unknown, refs: readonly TestRef[]): Pick<Gate, 'status' | 'evidence'> {
  const citations = refs.map(ref => `${ref.file} :: ${ref.fullName}`).join('; ');
  const pending = (reason: string): Pick<Gate, 'status' | 'evidence'> => ({ status: 'PENDING', evidence: `${reason}${citations ? `; required assertions: ${citations}` : ''}` });
  if (!refs.length) return pending('no required assertions');
  for (const ref of refs) {
    try {
      if (!statSync(join(REPO_ROOT, ref.file)).isFile()) return pending(`${ref.file} :: ${ref.fullName}: source file missing`);
    } catch { return pending(`${ref.file} :: ${ref.fullName}: source file missing`); }
  }
  if (report == null) return pending('report missing; run `npm run qa -w server` to record evidence');
  if (!isRecord(report)) return pending('report must be an object');
  if (typeof report.startTime !== 'number' || !Number.isFinite(report.startTime) || report.startTime < 0 || !Number.isFinite(new Date(report.startTime).getTime())) return pending('startTime must be a finite valid timestamp');

  const counterFields = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'] as const;
  const counts = {} as Record<(typeof counterFields)[number], number>;
  for (const field of counterFields) {
    const value = report[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return pending(`${field} must be a nonnegative safe integer`);
    counts[field] = value;
  }
  if (counts.numTotalTests !== counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + counts.numTodoTests) return pending('test counters do not sum to numTotalTests');
  if (counts.numTotalTestSuites !== counts.numPassedTestSuites + counts.numFailedTestSuites + counts.numPendingTestSuites) return pending('suite counters do not sum to numTotalTestSuites');
  if (!Array.isArray(report.testResults)) return pending('testResults must be an array');
  if (!counts.numTotalTests || !counts.numTotalTestSuites || !report.testResults.length) return pending('report must contain nonempty test results and suites');

  const assertions: { file: string; fullName: string; status: string }[] = [];
  const failedSuites: string[] = [];
  for (const [index, suite] of report.testResults.entries()) {
    const location = `testResults[${index}]`;
    if (!isRecord(suite)) return pending(`${location} must be an object`);
    if (typeof suite.name !== 'string' || !suite.name.trim()) return pending(`${location}.name must be a nonempty file path`);
    if (!Array.isArray(suite.assertionResults)) return pending(`${location}.assertionResults must be an array`);
    if (suite.status !== undefined && suite.status !== 'passed' && suite.status !== 'failed') return pending(`${location}: unknown suite status ${typeof suite.status === 'string' ? suite.status : typeof suite.status}`);
    if (suite.status === 'failed') failedSuites.push(suite.name);
    for (const [assertionIndex, assertion] of suite.assertionResults.entries()) {
      const assertionLocation = `${location}.assertionResults[${assertionIndex}]`;
      if (!isRecord(assertion)) return pending(`${assertionLocation} must be an object`);
      if (typeof assertion.fullName !== 'string' || !assertion.fullName.trim()) return pending(`${assertionLocation}.fullName must be a nonempty string`);
      if (typeof assertion.status !== 'string' || !['passed', 'failed', 'skipped', 'pending', 'todo'].includes(assertion.status)) return pending(`${suite.name} :: ${assertion.fullName}: unknown assertion status ${typeof assertion.status === 'string' ? assertion.status : typeof assertion.status}`);
      assertions.push({ file: normalizedTestPath(suite.name), fullName: assertion.fullName, status: assertion.status });
    }
  }

  const evidence = refs.map(ref => {
    const matches = assertions.filter(assertion => assertion.fullName === ref.fullName && (
      assertion.file === ref.file ||
      (posix.isAbsolute(assertion.file) || /^[A-Za-z]:\//.test(assertion.file)) && assertion.file.endsWith(`/${ref.file}`)
    ));
    const reason = !matches.length ? 'assertion missing' : matches.length > 1 ? `duplicate assertion (${matches.length} matches)` : matches[0].status;
    return { passed: matches.length === 1 && matches[0].status === 'passed', detail: `${ref.file} :: ${ref.fullName}: ${reason}` };
  });
  if (evidence.some(item => !item.passed)) return { status: 'PENDING', evidence: evidence.map(item => item.detail).join('; ') };
  if (
    assertions.length !== counts.numTotalTests ||
    assertions.filter(assertion => assertion.status === 'passed').length !== counts.numPassedTests ||
    assertions.filter(assertion => assertion.status === 'failed').length !== counts.numFailedTests ||
    assertions.filter(assertion => assertion.status === 'skipped' || assertion.status === 'pending').length !== counts.numPendingTests ||
    assertions.filter(assertion => assertion.status === 'todo').length !== counts.numTodoTests
  ) return pending('assertion counts do not match report counters');
  if (counts.numTotalTestSuites < report.testResults.length) return pending('numTotalTestSuites is smaller than the number of file results');
  if (counts.numFailedTests !== 0) return pending('numFailedTests must be zero (including unrelated tests)');
  if (counts.numFailedTestSuites !== 0) return pending('numFailedTestSuites must be zero (including unrelated suites)');
  if (failedSuites.length) return pending(`failed suite: ${failedSuites.join(', ')}`);
  if (report.success !== true) return pending('success must be true');
  return { status: 'PASS', evidence: `${counts.numPassedTests}/${counts.numTotalTests} automated tests passed, ${counts.numPendingTests + counts.numTodoTests} skipped/pending/todo (${new Date(report.startTime).toISOString()}); ${evidence.map(item => item.detail).join('; ')}` };
}

/**
 * Run-level outcome written by scripts/qa.mjs next to the report (CodeRabbit PR #13). The Vitest JSON report does not
 * record failures outside assertions (e.g. an unhandled rejection), so a report is accepted only when the run that
 * produced it exited 0 and the recorded sha256 matches the report text on disk. Returns a reason, or null when valid.
 */
export function runOutcomeProblem(outcome: unknown, reportText: string): string | null {
  if (!isRecord(outcome)) return 'run outcome missing or unreadable (data/qa/test-run.json); run `npm run qa -w server`';
  if (outcome.exitCode !== 0) return `QA run did not succeed (exit code ${String(outcome.exitCode)}${outcome.signal ? `, signal ${String(outcome.signal)}` : ''})`;
  if (typeof outcome.reportSha256 !== 'string' || outcome.reportSha256 !== createHash('sha256').update(reportText).digest('hex')) return 'run outcome does not belong to this report (sha256 mismatch)';
  return null;
}

export function releaseGates(report?: unknown) {
  const g: Gate[] = [];
  const resPath = join(config.dataDir, 'qa', 'test-results.json');
  let loadError: string | undefined;
  if (!arguments.length) {
    let json: string | undefined;
    try { json = readFileSync(resPath, 'utf8'); }
    catch (error) { loadError = isRecord(error) && error.code === 'ENOENT' ? `report missing: ${resPath}` : `report unreadable: ${resPath}`; }
    if (json !== undefined) {
      try { report = JSON.parse(json) as unknown; }
      catch { loadError = `report malformed JSON: ${resPath}`; }
      if (!loadError) {
        let outcome: unknown = null;
        try { outcome = JSON.parse(readFileSync(join(config.dataDir, 'qa', 'test-run.json'), 'utf8')); } catch { /* missing → reported below */ }
        const problem = runOutcomeProblem(outcome, json);
        if (problem) loadError = problem;
      }
    }
  }
  const testGate = (id: keyof typeof TEST_GATE_REQUIREMENTS): Pick<Gate, 'status' | 'evidence'> => {
    if (loadError) return { status: 'PENDING', evidence: `${loadError}; run \`npm run qa -w server\` to record evidence; required assertions: ${TEST_GATE_REQUIREMENTS[id].map(ref => `${ref.file} :: ${ref.fullName}`).join('; ')}` };
    return evaluateTestEvidence(report, TEST_GATE_REQUIREMENTS[id]);
  };
  const workflows = testGate('G01');
  g.push({ id: 'G01', name: 'Critical frontend & backend workflows pass', ...workflows, status: 'PENDING', evidence: `${workflows.evidence}; browser workflow coverage is not certified by this Vitest report` });
  g.push({ id: 'G02', name: 'Market data sources, timestamps & stale-data handling verified', ...testGate('G02') });
  const workers = testGate('G03');
  g.push({ id: 'G03', name: 'All 100 worker roles tested; health observable', ...workers, status: 'PENDING', evidence: `${workers.evidence}; ${WORKERS.length} workers registered (requires 100); current offline CEX test covers 94 of 100, six on-chain roles and complete health coverage remain unproven` });
  const joe = testGate('G04');
  g.push({ id: 'G04', name: 'Trader Joe factuality & authorization tests', ...joe, status: 'PENDING', evidence: `${joe.evidence}; authorization checks do not certify LLM factuality; human review is required` });
  const rec = reconcile();
  g.push({ id: 'G05', name: 'Entries, exits, fills, fees & PnL reconcile', status: rec.ok ? 'PASS' : 'FAIL', evidence: rec.detail });
  const ac = verifyAuditChain();
  g.push({ id: 'G06', name: 'Audit log integrity', status: ac.ok ? 'PASS' : 'FAIL', evidence: `${ac.entries} hash-chained entries${ac.ok ? ' verified' : `, broken at ${ac.brokenAt}`}` });
  g.push({ id: 'G07', name: 'Wallet permissions & signing isolation security tests', status: 'NOT_IMPLEMENTED', evidence: 'No signer exists in this build (by design). Requires isolated signer + external security test.' });
  g.push({ id: 'G08', name: 'No unresolved critical/high security findings', status: 'NOT_CERTIFIED', evidence: 'Requires independent security review.' });
  g.push({ id: 'G09', name: 'Emergency shutdown & recovery procedures pass', ...testGate('G09') });
  const first = get<{ t: number }>("SELECT MIN(opened_at) t FROM positions")?.t;
  const days = first ? (Date.now() - first) / 86400_000 : 0; const closed = get<{ n: number }>("SELECT COUNT(*) n FROM positions WHERE status='CLOSED'")!.n;
  g.push({ id: 'G10', name: '30-day paper-trading evaluation', status: days >= 30 && closed >= 50 ? 'PASS' : 'PENDING', evidence: `${days.toFixed(1)} days since first paper trade, ${closed} closed trades (needs ≥30 days, ≥50 trades)` });
  g.push({ id: 'G11', name: 'Risk policy reviewed and accepted by owner', status: currentPolicy() ? 'PASS' : 'PENDING', evidence: currentPolicy() ? `policy v${currentPolicy()!.version}` : 'not accepted' });
  g.push({ id: 'G12', name: 'Live venue adapter + transaction firewall implemented', status: 'NOT_IMPLEMENTED', evidence: 'Deliberately absent until gates G07–G10 pass.' });
  g.push({ id: 'G13', name: 'Independent Release Auditor go/no-go', status: 'NOT_CERTIFIED', evidence: 'Human sign-off required.' });
  g.push({ id: 'G14', name: 'Owner explicit authorization for live execution', status: 'PENDING', evidence: 'Can only be recorded after all other gates pass.' });
  const liveAllowed = g.every((x) => x.status === 'PASS');
  return { gates: g, liveAllowed, summary: `${g.filter((x) => x.status === 'PASS').length}/${g.length} gates passed — live execution ${liveAllowed ? 'ELIGIBLE' : 'LOCKED'}` };
}
export const openDefects = () => all('SELECT * FROM journal WHERE kind=? ORDER BY ts DESC LIMIT 50', 'RISK');
