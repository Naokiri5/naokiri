import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, normalize, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { config, REPO_ROOT } from '../src/config.js';
import { run } from '../src/db/db.js';
import { PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import * as gates from '../src/qa/gates.js';
import { freshDb } from './helpers.js';

const ref = { file: 'server/test/quality.test.ts', fullName: 'data quality gate (Part 32.2) fresh multi-source data is OK' };
function report(refs: readonly { file: string; fullName: string }[] = [ref]) {
  const files = [...new Set(refs.map(r => r.file))];
  return {
    success: true, startTime: 1_800_000_000_000,
    numTotalTests: refs.length, numPassedTests: refs.length, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: files.length, numPassedTestSuites: files.length, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: files.map(file => ({ name: join(REPO_ROOT, file), status: 'passed', assertionResults: refs.filter(r => r.file === file).map(r => ({ fullName: r.fullName, status: 'passed' })) })),
  };
}

describe('test-derived release gate evidence', () => {
  it('exports the exact file/fullName evidence evaluator', () => {
    expect(gates.evaluateTestEvidence).toBeTypeOf('function');
    expect(gates.TEST_GATE_REQUIREMENTS).toHaveProperty('G09');
  });

  it('passes only a complete matching run and names the assertion', () => {
    const result = gates.evaluateTestEvidence(report(), [ref]);
    expect(result.status).toBe('PASS');
    expect(result.evidence).toContain(ref.file);
    expect(result.evidence).toContain(ref.fullName);
    expect(result.evidence).toContain('passed');
  });

  it.each([
    ref.file, './' + ref.file, 'test/quality.test.ts', './test/quality.test.ts',
    join(REPO_ROOT, ref.file).replaceAll('\\', '/'), join(REPO_ROOT, ref.file).replaceAll('/', '\\'),
    'server/test/../test/quality.test.ts',
  ])('normalizes repository and server-relative reporter paths: %s', path => {
    const input = report(); input.testResults[0].name = path;
    expect(gates.evaluateTestEvidence(input, [ref]).status).toBe('PASS');
  });

  it.each(['quality.test.ts', 'other/test/quality.test.ts', 'server/test/quality.test.ts.copy', 'server/test/other.test.ts'])('does not match a basename or wrong file: %s', path => {
    const input = report(); input.testResults[0].name = path;
    expect(gates.evaluateTestEvidence(input, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('assertion missing') });
  });

  it.each([
    ['missing', null, 'report missing'], ['undefined', undefined, 'report missing'],
    ['string', '{bad json', 'report must be an object'], ['array', [], 'report must be an object'],
    ['empty object', {}, 'startTime'], ['boolean', true, 'report must be an object'],
  ])('rejects %s evidence with a diagnostic and citation', (_label, input, reason) => {
    const result = gates.evaluateTestEvidence(input, [ref]);
    expect(result.status).toBe('PENDING'); expect(result.evidence).toContain(reason);
    expect(result.evidence).toContain(ref.file); expect(result.evidence).toContain(ref.fullName);
  });

  it.each([undefined, null, '2026-11-17', NaN, Infinity, -1, 8.64e15 + 1])('rejects invalid startTime %s without throwing', startTime => {
    const result = gates.evaluateTestEvidence({ ...report(), startTime }, [ref]);
    expect(result).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('startTime') });
  });

  it.each([
    'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
    'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites',
  ])('rejects malformed %s counters', field => {
    for (const value of [undefined, null, '0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = gates.evaluateTestEvidence({ ...report(), [field]: value }, [ref]);
      expect(result.status, `${field}=${value}`).toBe('PENDING'); expect(result.evidence).toContain(field);
    }
  });

  it.each([false, undefined, null, 1, 'true'])('requires success === true, received %s', success => {
    expect(gates.evaluateTestEvidence({ ...report(), success }, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('success must be true') });
  });

  it.each([
    ['test count mismatch', { numTotalTests: 2 }, 'test counters do not sum'],
    ['suite count mismatch', { numTotalTestSuites: 2 }, 'suite counters do not sum'],
    ['assertion count mismatch', { numTotalTests: 2, numPassedTests: 2 }, 'assertion counts do not match'],
    ['empty', { numTotalTests: 0, numPassedTests: 0, numTotalTestSuites: 0, numPassedTestSuites: 0, testResults: [] }, 'nonempty'],
    ['no results', { testResults: [] }, 'nonempty'],
    ['missing results', { testResults: undefined }, 'testResults must be an array'],
    ['bad results', { testResults: {} }, 'testResults must be an array'],
    ['bad suite', { testResults: [null] }, 'testResults[0]'],
    ['missing file', { testResults: [{ assertionResults: [] }] }, 'name'],
    ['missing assertions', { testResults: [{ name: ref.file }] }, 'assertionResults'],
    ['bad assertion', { testResults: [{ name: ref.file, assertionResults: [null] }] }, 'assertionResults[0]'],
    ['missing name', { testResults: [{ name: ref.file, assertionResults: [{ status: 'passed' }] }] }, 'fullName'],
    ['missing status', { testResults: [{ name: ref.file, assertionResults: [{ fullName: ref.fullName }] }] }, 'status'],
    ['unknown status', { testResults: [{ name: ref.file, assertionResults: [{ fullName: ref.fullName, status: 'success' }] }] }, 'unknown assertion status'],
    ['unknown suite status', { testResults: [{ name: ref.file, status: 'success', assertionResults: [{ fullName: ref.fullName, status: 'passed' }] }] }, 'unknown suite status'],
  ])('rejects %s', (_label, patch, reason) => {
    const result = gates.evaluateTestEvidence({ ...report(), ...patch }, [ref]);
    expect(result.status).toBe('PENDING'); expect(result.evidence).toContain(reason);
    expect(result.evidence).toContain(ref.fullName);
  });

  it.each(['skipped', 'pending', 'todo', 'failed'])('does not certify a required %s assertion', status => {
    const input = report(); input.testResults[0].assertionResults[0].status = status;
    input.numPassedTests = 0;
    if (status === 'failed') input.numFailedTests = 1;
    else if (status === 'todo') input.numTodoTests = 1;
    else input.numPendingTests = 1;
    const result = gates.evaluateTestEvidence(input, [ref]);
    expect(result.status).toBe('PENDING'); expect(result.evidence).toContain(ref.file);
    expect(result.evidence).toContain(ref.fullName); expect(result.evidence).toContain(status);
  });

  it.each(['suite', 'assertion'])('safely rejects malformed %s status objects without calling their methods', kind => {
    const input = report();
    const status = { toString: null, valueOf: null };
    const malformed = kind === 'suite'
      ? { ...input.testResults[0], status }
      : { ...input.testResults[0], assertionResults: [{ fullName: ref.fullName, status }] };
    expect(gates.evaluateTestEvidence({ ...input, testResults: [malformed] }, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining(`unknown ${kind} status`) });
  });

  it('does not match a test-name substring', () => {
    const input = report(); input.testResults[0].assertionResults[0].fullName += ' extra';
    expect(gates.evaluateTestEvidence(input, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('assertion missing') });
  });

  it('does not accept the right name in the wrong file when the right file has another test', () => {
    const input = report([ref, { file: 'server/test/api.test.ts', fullName: ref.fullName }]);
    input.testResults[0].assertionResults[0].fullName = 'another assertion';
    expect(gates.evaluateTestEvidence(input, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('assertion missing') });
  });

  it.each([false, true])('rejects duplicate assertions, including across repeated file results (%s)', separate => {
    const input = report();
    input.numTotalTests++; input.numPassedTests++;
    if (separate) {
      input.testResults.push(structuredClone(input.testResults[0]));
      input.numTotalTestSuites++; input.numPassedTestSuites++;
    } else input.testResults[0].assertionResults.push({ ...input.testResults[0].assertionResults[0] });
    expect(gates.evaluateTestEvidence(input, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('duplicate assertion (2 matches)') });
  });

  it('requires every cited source file to exist even when the report claims it passed', () => {
    const missing = { file: 'server/test/absent-s5.test.ts', fullName: 'nonexistent source test' };
    const result = gates.evaluateTestEvidence(report([missing]), [missing]);
    expect(result.status).toBe('PENDING'); expect(result.evidence).toContain('source file missing');
    expect(result.evidence).toContain(missing.file); expect(result.evidence).toContain(missing.fullName);
  });

  it('does not certify an empty requirement list', () => {
    expect(gates.evaluateTestEvidence(report(), []).status).toBe('PENDING');
  });

  it('requires the global counters to agree with assertion statuses', () => {
    const input = { ...report(), numPassedTests: 0, numPendingTests: 1 };
    expect(gates.evaluateTestEvidence(input, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('assertion counts do not match') });
  });

  it('rejects unrelated failed tests and failed suites even when all citations passed', () => {
    const input = report([ref, { file: 'server/test/api.test.ts', fullName: 'unrelated failure' }]);
    input.testResults[1].assertionResults[0].status = 'failed'; input.numPassedTests--; input.numFailedTests++;
    expect(gates.evaluateTestEvidence(input, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('numFailedTests must be zero') });
    const suiteFailure = { ...report(), numPassedTestSuites: 0, numFailedTestSuites: 1 };
    expect(gates.evaluateTestEvidence(suiteFailure, [ref])).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('numFailedTestSuites must be zero') });
    const inconsistent = report(); inconsistent.testResults[0].status = 'failed';
    expect(gates.evaluateTestEvidence(inconsistent, [ref]).status).toBe('PENDING');
  });

  it('allows unrelated skipped assertions without treating them as cited passes', () => {
    const input = report([ref, { file: 'server/test/api.test.ts', fullName: 'unrelated skipped test' }]);
    input.testResults[1].assertionResults[0].status = 'skipped'; input.numPassedTests--; input.numPendingTests++;
    expect(gates.evaluateTestEvidence(input, [ref]).status).toBe('PASS');
  });
});

describe('release gate manifest and certification gaps', () => {
  beforeEach(() => freshDb());

  it('cites existing files and exact uniquely collected Vitest test names', () => {
    const refs = Object.values(gates.TEST_GATE_REQUIREMENTS).flat();
    const files = [...new Set(refs.map(r => r.file))];
    for (const file of files) expect(existsSync(join(REPO_ROOT, file)), file).toBe(true);
    const listed: { name: string; file: string }[] = JSON.parse(execFileSync(process.execPath, [
      join(REPO_ROOT, 'node_modules/vitest/vitest.mjs'), 'list', '--json', '--no-static-parse', ...files.map(file => relative(join(REPO_ROOT, 'server'), join(REPO_ROOT, file))),
    ], { cwd: join(REPO_ROOT, 'server'), env: { ...process.env, MIA_LIVE_TESTS: '1', MIA_OFFLINE: '1' }, encoding: 'utf8' }));
    for (const item of refs) {
      const file = join(REPO_ROOT, item.file);
      expect(listed.filter(test => normalize(test.file) === file && test.name.split(' > ').join(' ') === item.fullName), `${item.file}: ${item.fullName}`).toHaveLength(1);
    }
    expect(files).not.toContain('server/test/joe.test.ts');
    expect(gates.TEST_GATE_REQUIREMENTS.G09).toHaveLength(2);
    expect(gates.TEST_GATE_REQUIREMENTS.G09).toContainEqual({ file: 'server/test/api.test.ts', fullName: 'HTTP API (auth, permissions, release gate) risk-increasing actions require step-up; risk-reducing ones do not' });
  });

  it('keeps browser, worker coverage and factuality gaps pending even with complete automated evidence', () => {
    const input = report(gates.TEST_GATE_REQUIREMENTS.G01);
    const result = gates.releaseGates(input);
    for (const [id, reason] of [['G01', 'browser'], ['G03', '94 of 100'], ['G04', 'factuality']]) {
      expect(result.gates.find(g => g.id === id)).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining(reason) });
    }
    expect(result.gates.find(g => g.id === 'G02')?.status).toBe('PASS');
    expect(result.gates.find(g => g.id === 'G09')?.status).toBe('PASS');
    expect(result.liveAllowed).toBe(false);
  });

  it('keeps G02 pending in an offline report with skipped live provider assertions', () => {
    const input = report(gates.TEST_GATE_REQUIREMENTS.G01);
    const live = input.testResults.find(file => basename(file.name) === 'live.providers.test.ts')!;
    for (const assertion of live.assertionResults) { assertion.status = 'skipped'; input.numPassedTests--; input.numPendingTests++; }
    const gate = gates.releaseGates(input).gates.find(g => g.id === 'G02')!;
    expect(gate.status).toBe('PENDING'); expect(gate.evidence).toContain('live.providers.test.ts'); expect(gate.evidence).toContain('skipped');
  });

  it.each(gates.TEST_GATE_REQUIREMENTS.G09)('requires the exact G09 assertion: $fullName', missing => {
    const input = report(gates.TEST_GATE_REQUIREMENTS.G01.filter(item => item.file !== missing.file || item.fullName !== missing.fullName));
    const gate = gates.releaseGates(input).gates.find(g => g.id === 'G09')!;
    expect(gate.status).toBe('PENDING'); expect(gate.evidence).toContain(missing.fullName);
  });

  it('does not change unrelated predicates or unlock live execution for malformed reports', () => {
    const baseline = gates.releaseGates(report(gates.TEST_GATE_REQUIREMENTS.G01));
    for (const input of [null, {}, { ...report(), startTime: NaN }, { ...report(), numFailedTests: 1 }]) {
      const result = gates.releaseGates(input);
      expect(result.liveAllowed).toBe(false);
      for (const gate of result.gates.filter(g => !['G01', 'G02', 'G03', 'G04', 'G09'].includes(g.id))) expect(gate).toEqual(baseline.gates.find(g => g.id === gate.id));
      for (const id of ['G01', 'G02', 'G03', 'G04', 'G09']) expect(result.gates.find(g => g.id === id)?.status).toBe('PENDING');
    }
  });
});

describe('G10 prospective paper evaluation', () => {
  const day = 86_400_000;
  const recordPosition = (id: string, account: string, openedAt: number, closedAt: number | null) => {
    run(`INSERT INTO positions (id, account, instrument, market, direction, strategy, qty, entry_price, stop_price,
      initial_stop, targets, status, opened_at, closed_at, planned_risk)
      VALUES (?, ?, 'crypto:binance:BTCUSDT', 'crypto', 'LONG', 'trend_pullback', 0, 100, 90, 90, '[]', 'CLOSED', ?, ?, 10)`,
    id, account, openedAt, closedAt);
  };

  beforeEach(() => freshDb());

  it('keeps historical trades pending even when more than a month has elapsed without activity', () => {
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      const openedAt = now - 60 * day + i * 60_000;
      recordPosition(`historical-${i}`, PAPER_ACCOUNT, openedAt, openedAt + 60_000);
    }
    const gate = gates.releaseGates(null).gates.find(g => g.id === 'G10');
    expect(gate).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('50 recorded closed paper trades') });
    expect(gate?.evidence).toContain('60.0 elapsed days since first recorded paper entry');
    expect(gate?.evidence).toContain('Prospective supervision');
  });

  it('reports only historical paper positions with admissible timestamps', () => {
    const now = Date.now();
    recordPosition('paper-valid', PAPER_ACCOUNT, now - 2 * day, now - day);
    recordPosition('other-account', 'foreign-fixture', now - 180 * day, now - day);
    recordPosition('paper-future-open', PAPER_ACCOUNT, now + day, now + 2 * day);
    recordPosition('paper-future-close', PAPER_ACCOUNT, now - day, now + day);
    recordPosition('paper-inverted', PAPER_ACCOUNT, now - day, now - 2 * day);
    recordPosition('paper-no-close-time', PAPER_ACCOUNT, now - day, null);
    const gate = gates.releaseGates(null).gates.find(g => g.id === 'G10');
    expect(gate).toMatchObject({ status: 'PENDING', evidence: expect.stringContaining('1 recorded closed paper trade') });
    expect(gate?.evidence).toContain('2.0 elapsed days since first recorded paper entry');
  });
});

describe('stored QA report loading', () => {
  const previous = config.dataDir;
  let dir: string;
  beforeEach(() => { freshDb(); dir = mkdtempSync(join(tmpdir(), 'mia-gates-')); config.dataDir = dir; });
  afterEach(() => { config.dataDir = previous; rmSync(dir, { recursive: true, force: true }); });

  it('returns pending with the report path when evidence is missing', () => {
    const gate = gates.releaseGates().gates[0];
    expect(gate.status).toBe('PENDING'); expect(gate.evidence).toContain(join(dir, 'qa', 'test-results.json')); expect(gate.evidence).toContain('missing');
  });

  it('returns pending rather than throwing for malformed JSON', () => {
    mkdirSync(join(dir, 'qa')); writeFileSync(join(dir, 'qa', 'test-results.json'), '{bad json');
    const gate = gates.releaseGates().gates[0];
    expect(gate.status).toBe('PENDING'); expect(gate.evidence).toContain('report malformed JSON');
  });

  it('identifies unreadable reports separately from malformed JSON', () => {
    mkdirSync(join(dir, 'qa', 'test-results.json'), { recursive: true });
    const gate = gates.releaseGates().gates[0];
    expect(gate.status).toBe('PENDING'); expect(gate.evidence).toContain('report unreadable');
    expect(gate.evidence).not.toContain('malformed JSON');
  });

  it('loads a valid saved report without depending on the launch directory', () => {
    mkdirSync(join(dir, 'qa')); writeFileSync(join(dir, 'qa', 'test-results.json'), JSON.stringify(report(gates.TEST_GATE_REQUIREMENTS.G01)));
    expect(gates.releaseGates().gates.find(g => g.id === 'G09')?.status).toBe('PASS');
  });
});
