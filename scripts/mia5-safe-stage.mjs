#!/usr/bin/env node
/**
 * Safe, idempotent MIA5-ID-01..12 source staging.
 *
 * Extracts every literal, single-quoted heredoc from the exact archived user
 * payload WITHOUT EXECUTING the original overwriting installer. Canonical
 * server/index.ts, Fastify, risk and OMS are never written by this script.
 *
 * --skip-tests: stage only.
 * Default: stage and verify the adapted suite in CPU-isolated Vitest.
 */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--skip-tests')) {
  console.error('Usage: node scripts/mia5-safe-stage.mjs [--skip-tests]');
  process.exit(2);
}
const skipTests = args.includes('--skip-tests');
const sourcePath = join(root, 'docs/source-archive/MIA5_20261121_ORIGINAL_BOOTSTRAP_DO_NOT_RUN.sh.txt');
const stageRoot = join(root, 'data/mia5-source-staging');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(sourcePath);
const expectedHash = '87760d51b4c40a592d545f6ccfbde15e85f726a8bc06ab2838771cf9d44f8561';
if (digest(source) !== expectedHash)
  throw new Error('Archived user source SHA-256 mismatch. Refusing to stage altered payloads.');
const content = source.toString('utf8');
const lines = content.split(/\r\n|\n/);
const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^sync_file "(MIA5-ID-(\d{2}))" "([^"]+)" <<'EOF_MIA5_ID_(\d{2})'$/);
  if (!m) continue;
  const [, id, idNumber, relative, markerNumber] = m;
  if (idNumber !== markerNumber || !/^(server|web|\.github)\//.test(relative) ||
    relative.split('/').some(part => part === '..' || part === '.' || !part))
    throw new Error('Unsafe or malformed source destination: ' + relative);
  const marker = 'EOF_MIA5_ID_' + idNumber;
  const begin = i + 1;
  while (++i < lines.length && lines[i] !== marker) {}
  if (i === lines.length) throw new Error('Unterminated literal heredoc: ' + id);
  // Preserve original CRLF payloads and their trailing newline.
  const data = Buffer.from(lines.slice(begin, i).join('\r\n') + '\r\n', 'utf8');
  blocks.push({ id, relative, data });
}
if (blocks.length !== 12 || new Set(blocks.map(b => b.id)).size !== 12 ||
  blocks.some((b, idx) => b.id !== 'MIA5-ID-' + String(idx + 1).padStart(2, '0')))
  throw new Error('Expected exactly 12 ordered and unique MIA5 payloads');
let created = 0, updated = 0, unchanged = 0;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const { id, relative, data } of blocks) {
  const destination = resolve(stageRoot, id, relative);
  if (!destination.startsWith(resolve(stageRoot) + sep))
    throw new Error('Refusing path outside staging root: ' + relative);
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination) && digest(readFileSync(destination)) === digest(data)) {
    unchanged++;
    console.log('[' + id + '] UNCHANGED ' + destination);
    continue;
  }
  if (existsSync(destination)) {
    let backup = destination + '.bak.' + timestamp;
    let suffix = 1;
    while (existsSync(backup)) backup = destination + '.bak.' + timestamp + '.' + suffix++;
    copyFileSync(destination, backup);
    updated++;
    console.log('[' + id + '] UPDATED   ' + destination + ' (backup ' + backup + ')');
  } else {
    created++;
    console.log('[' + id + '] CREATED   ' + destination);
  }
  const temp = destination + '.tmp-' + process.pid + '-' + id.replace(/[^a-z0-9]/gi, '');
  try {
    writeFileSync(temp, data, { flag: 'wx' });
    renameSync(temp, destination);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
console.log('MIA5 stage summary:', { created, updated, unchanged, fullSourceSha256: expectedHash });
console.log('Original 12 payloads are STAGED ONLY; canonical MIA files were not overwritten.');
if (skipTests) process.exit(0);
const result = spawnSync('npm', ['exec', '--workspace=@mia/server', '--',
  'vitest', 'run', 'test/miaChaosSuite.test.ts', '--no-file-parallelism',
  '--bail=1', '--reporter=verbose'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', MIA_EXECUTION_MODE: 'PAPER' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
