import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const auditScript = fileURLToPath(new URL('../../scripts/check-orphans.mjs', import.meta.url));
let root = '';
const write = (rel: string, code: string) => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
};
const run = (strict = false) => {
  const args = [auditScript, '--root=' + root, '--json', ...(strict ? ['--strict'] : [])];
  const p = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
  if (p.error) throw p.error;
  if (!p.stdout.trim()) throw new Error('reachability auditor produced no report: ' + p.stderr);
  return { status: p.status, report: JSON.parse(p.stdout) as { totalCount: number; reachableCount: number; orphans: string[]; unresolved: string[] } };
};

describe('read-only TypeScript module reachability audit', () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mia-orphans-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('recognizes static imports, re-exports, dynamic imports and worker URLs', () => {
    write('index.ts', `
      import type { Engine } from './runtime/engine.js';
      export * from './runtime/lib.js';
      export async function boot(): Promise<unknown> { return import('./runtime/async.js'); }
      export const worker = new URL('./workers/job.js', import.meta.url);
    `);
    write('runtime/engine.ts', 'export interface Engine {}');
    write('runtime/lib.ts', 'export const x = true;');
    write('runtime/async.ts', 'export const y = true;');
    write('workers/job.ts', 'export const ready = true;');
    write('workers/job.test.ts', 'export const testOnly = true;');
    write('bench/bench.ts', 'export const benchmarkOnly = true;');
    const r = run(true);
    expect(r.status).toBe(0);
    expect(r.report).toEqual({ totalCount: 5, reachableCount: 5, orphans: [], unresolved: [] });
  });

  it('finds a disconnected island even when its modules import each other', () => {
    write('index.ts', "export const booted = true;");
    write('draft/alpha.ts', "import { b } from './beta.js'; export const a = b;");
    write('draft/beta.ts', 'export const b = 42;');
    const r = run(true);
    expect(r.status).toBe(1);
    expect(r.report.orphans).toEqual(['draft/alpha.ts', 'draft/beta.ts']);
    expect(run(false).status).toBe(0); // informative by default; never gate existing staged work
  });

  it('reports unresolved imports separately rather than pretending modules run', () => {
    write('index.ts', "import './missing.js'; export const x = 1;");
    const r = run();
    expect(r.report.orphans).toEqual([]);
    expect(r.report.unresolved).toEqual(['index.ts -> ./missing.js']);
    expect(run(true).status).toBe(1);
  });

  it('ignores strings and comments that look like source imports', () => {
    write('index.ts', `// import './ghost.js'
      export const string = "import './phantom.js'";`);
    expect(run(true).report).toEqual({
      totalCount: 1, reachableCount: 1, orphans: [], unresolved: [],
    });
  });
});
