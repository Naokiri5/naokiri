#!/usr/bin/env node
// Machine-readable path inventory (MIA 4.2 Phase 0). Static scan of the working tree — no code is executed.
// Usage: node scripts/inventory.mjs > docs/engineering/inventory.json
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)); // decodes %20 etc. (paths with spaces)
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => relative(root, p);
const sha = (() => { try { return execSync('git rev-parse HEAD', { cwd: root }).toString().trim(); } catch { return null; } })();

const modules = walk(join(root, 'server/src')).filter((p) => p.endsWith('.ts')).sort().map((p) => {
  const src = readFileSync(p, 'utf8');
  const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]).filter((m) => m.startsWith('.'));
  const exports = [...src.matchAll(/^export (?:async )?(?:function\*?|const|class|interface|type|let)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  return { path: rel(p), area: rel(p).split('/')[2], lines: src.split('\n').length, imports, exports, routes };
});
const mig = readFileSync(join(root, 'server/src/db/migrations.ts'), 'utf8');
const migrations = [...mig.matchAll(/CREATE (?:VIRTUAL )?TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)].map((m) => m[1]);
const tests = [...walk(join(root, 'server/test')), ...walk(join(root, 'e2e'))].filter((p) => /\.(test|spec)\.ts$/.test(p)).sort().map((p) => {
  const src = readFileSync(p, 'utf8');
  return { path: rel(p), cases: (src.match(/\bit\(|\btest\(/g) ?? []).length };
});
const pages = walk(join(root, 'web/src/pages')).filter((p) => p.endsWith('.tsx')).map(rel).sort();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

process.stdout.write(JSON.stringify({
  generatedFrom: { commit: sha, note: 'static scan of the working tree at this commit; uncommitted changes would also be included' },
  runtime: { node: pkg.engines?.node ?? null, workspaces: pkg.workspaces ?? [] },
  summary: { modules: modules.length, routes: modules.reduce((n, m) => n + m.routes.length, 0), tables: migrations.length, testFiles: tests.length, testCases: tests.reduce((n, t) => n + t.cases, 0), pages: pages.length },
  areas: Object.fromEntries([...new Set(modules.map((m) => m.area))].map((a) => [a, modules.filter((m) => m.area === a).map((m) => m.path)])),
  modules, tables: migrations, tests, pages,
}, null, 2) + '\n');
