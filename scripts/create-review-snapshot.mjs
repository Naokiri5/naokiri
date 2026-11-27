#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parseArgs } from 'node:util';

const MAX_FILES = 1_200;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_TREE_BYTES = 4 * 1024 * 1024;
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SOURCE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx|css)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SENSITIVE_SEGMENT = /^(?:\.(?:env|npmrc|netrc|git|ssh|aws|secrets)|secrets?|credentials?|private[-_.]?keys?|wallet[-_.]?backups?|data|customer[-_.]?data|account[-_.]?data|node_modules|dist|coverage|build|logs?|test-results|playwright-report)(?:$|[._-])/i;
const EXCLUSIONS = [
  'environment files and credentials', 'private keys and wallet backups', 'databases and local storage',
  'production logs and customer or account data', 'dependencies and generated files',
  'unlisted paths, binary files, links and oversize files',
];

function git(args, { input, maxBuffer = MAX_TREE_BYTES, optional = false } = {}) {
  try {
    return execFileSync('git', ['--no-replace-objects', ...args], {
      input, maxBuffer, timeout: 20_000, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (error) {
    if (optional && error.status === 1) return null;
    throw new Error('A required local Git command failed or exceeded its limit');
  }
}

function resolveCommit(ref) {
  const sha = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).toString().trim();
  if (!HASH.test(sha)) throw new Error('Git did not return a valid commit SHA');
  return sha;
}

function repositoryName() {
  const origin = git(['config', '--local', '--get', 'remote.origin.url'], { optional: true })?.toString().trim();
  if (!origin) return 'local';
  let path;
  if (origin.startsWith('git@github.com:')) path = origin.slice('git@github.com:'.length);
  else {
    try {
      const remote = new URL(origin);
      if (remote.hostname === 'github.com') path = remote.pathname.replace(/^\//, '');
    } catch { return 'local'; }
  }
  const name = path?.replace(/\.git$/, '');
  return name && /^[\w.-]+\/[\w.-]+$/.test(name) ? name : 'local';
}

function category(path) {
  if (path.length > 240 || !/^[A-Za-z0-9_./@-]+$/.test(path) || path.split('/').some(segment => SENSITIVE_SEGMENT.test(segment))) return null;
  if (/^(?:README|AGENTS|CLAUDE|GEMINI)\.md$/.test(path) || /^(?:docs|\.claude\/(?:agents|rules|skills))\/.+\.md$/.test(path)) return 'documentation';
  if (/^\.github\/(?:dependabot\.yml|workflows\/[\w.-]+\.ya?ml)$/.test(path)) return 'workflow';
  if (/^(?:(?:server|web)\/)?(?:package(?:-lock)?\.json|tsconfig(?:\.[\w-]+)?\.json)$/.test(path) || ['.gitignore', '.nvmrc'].includes(path)) return 'configuration';
  if (/^(?:(?:server\/)?scripts\/.+\.(?:mjs|sh)|security\/semgrep\/.+\.ya?ml)$/.test(path)) return 'tooling';
  if (/^(?:server\/test|e2e)\//.test(path) && SOURCE.test(path) || /^web\/src\//.test(path) && TEST.test(path)) return 'test';
  if (path.startsWith('server/src/') && SOURCE.test(path)) return 'server';
  if (path.startsWith('web/src/') && SOURCE.test(path)) return 'web';
  return null;
}

function listFiles(sha) {
  return git(['ls-tree', '-r', '-l', '--full-tree', '-z', sha]).toString().split('\0').flatMap(entry => {
    const tab = entry.indexOf('\t');
    if (tab === -1) return [];
    const path = entry.slice(tab + 1);
    const kind = category(path);
    if (!kind) return [];
    const [mode, type, oid, rawSize] = entry.slice(0, tab).trim().split(/ +/);
    const sizeBytes = Number(rawSize);
    if (type !== 'blob' || !['100644', '100755'].includes(mode) || !HASH.test(oid) ||
        !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_FILE_BYTES) return [];
    return [{ path, category: kind, oid, sizeBytes }];
  });
}

function readFiles(entries) {
  const total = entries.reduce((bytes, file) => bytes + file.sizeBytes, 0);
  if (entries.length > MAX_FILES || total > MAX_TOTAL_BYTES) throw new Error('Reviewable Git files exceed the snapshot budget');
  if (!entries.length) return [];
  const batch = git(['cat-file', '--batch'], {
    input: `${entries.map(file => file.oid).join('\n')}\n`,
    maxBuffer: total + entries.length * 180,
  });
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let offset = 0;
  return entries.flatMap(({ path, oid, category, sizeBytes }) => {
    const headerEnd = batch.indexOf(10, offset);
    const contentEnd = headerEnd + 1 + sizeBytes;
    if (headerEnd < 0 || batch[contentEnd] !== 10 || batch.toString('ascii', offset, headerEnd) !== `${oid} blob ${sizeBytes}`) {
      throw new Error('Git returned an unexpected blob record');
    }
    const bytes = batch.subarray(headerEnd + 1, contentEnd);
    offset = contentEnd + 1;
    if (bytes.includes(0)) return [];
    let source;
    try { source = utf8.decode(bytes); } catch { return []; }
    const file = { path, sha256: createHash('sha256').update(bytes).digest('hex'), category, sizeBytes };
    return [{ file, testSource: category === 'test' && TEST.test(path) ? source : null }];
  });
}

const withoutSourceExtension = path => path.replace(/\.[cm]?[jt]sx?$/, '');

function relevantTests(contents, changed) {
  const changedModules = new Set([...changed].map(withoutSourceExtension));
  return contents.flatMap(({ file, testSource }) => {
    if (testSource === null) return [];
    if (changed.has(file.path)) return [file.path];
    const imports = testSource.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)(['"])(\.\.?\/[^'"\s]+)\1/g);
    for (const [, , target] of imports) {
      const module = withoutSourceExtension(posix.join(posix.dirname(file.path), target));
      if (changedModules.has(module) || changedModules.has(`${module}/index`)) return [file.path];
    }
    return [];
  }).sort();
}

function snapshot(ref, base) {
  const commitSha = resolveCommit(ref);
  const baseSha = base === undefined
    ? git(['rev-list', '--parents', '-n', '1', commitSha]).toString().trim().split(' ')[1]
    : resolveCommit(base);
  const diffArgs = baseSha ? ['diff', baseSha, commitSha] : ['diff-tree', '--root', '--no-commit-id', '-r', commitSha];
  const changedPaths = git([...diffArgs, '--no-ext-diff', '--no-renames', '--name-only', '-z', '--']).toString().split('\0');
  // Deleted text files may be useful in a review. Check the base blob against the same rules before disclosing its path.
  const deleted = baseSha ? new Set(git([...diffArgs, '--no-ext-diff', '--no-renames', '--name-only', '--diff-filter=D', '-z', '--'])
    .toString().split('\0')) : new Set();
  const current = listFiles(commitSha);
  const former = deleted.size > 1 ? listFiles(baseSha).filter(file => deleted.has(file.path)) : [];
  const contents = readFiles([...current, ...former]);
  const reviewed = new Set(contents.map(({ file }) => file.path));
  const changed = new Set(changedPaths.filter(path => reviewed.has(path)));
  const live = contents.filter(({ file }) => !deleted.has(file.path));
  return {
    schemaVersion: 1, repository: repositoryName(), commitSha, generatedAt: new Date().toISOString(),
    files: live.map(({ file }) => file).sort((left, right) => left.path < right.path ? -1 : Number(left.path > right.path)),
    changedFiles: [...changed].sort(), relevantTests: relevantTests(live, changed), excludedCategories: EXCLUSIONS,
  };
}

let values;
try {
  ({ values } = parseArgs({ options: {
    commit: { type: 'string', default: 'HEAD' }, base: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } }));
} catch {
  console.error('Usage: node scripts/create-review-snapshot.mjs [--commit <ref>] [--base <ref>]');
  process.exitCode = 1;
}

if (values?.help) console.log('Usage: node scripts/create-review-snapshot.mjs [--commit <ref>] [--base <ref>]');
else if (values) {
  try { console.log(JSON.stringify(snapshot(values.commit, values.base), null, 2)); }
  catch (error) {
    console.error(`Review snapshot failed: ${error.message}`);
    process.exitCode = 1;
  }
}
