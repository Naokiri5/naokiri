#!/usr/bin/env node
/**
 * Read-only, TypeScript-AST reachability audit complementing scripts/inventory.mjs.
 *
 * Starts from the REAL server entrypoints (main.ts, index.ts, backup-cli.ts).
 * This is an indicator of disconnected code, not proof that a feature runs.
 * No files are deleted or executed. By default it reports; --strict is opt-in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUDED_DIRS = new Set(['__tests__', '__mocks__', 'bench', 'chaos']);
const IGNORE_SUFFIX = /\.(?:test|spec|d)\.ts$/;

function collect(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) collect(full, root, out);
    else if (entry.isFile() && entry.name.endsWith('.ts') && !IGNORE_SUFFIX.test(entry.name)) out.push(full);
  }
  return out;
}

function relativeImports(filename) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result = [];
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node) && node.text.startsWith('.')) result.push(node.text);
  };
  const walk = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const expr = node.expression;
      if (expr.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expr) && expr.text === 'require')) add(node.arguments[0]);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' && node.arguments && node.arguments.length >= 2 &&
      node.arguments[1].getText(source) === 'import.meta.url') add(node.arguments[0]);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return result;
}

function resolveImport(from, specifier, files) {
  const target = path.resolve(path.dirname(from), specifier);
  const ext = target.replace(/\.(?:js|mjs|cjs)$/, '');
  const candidates = [target, target + '.ts', ext + '.ts', path.join(target, 'index.ts'), path.join(ext, 'index.ts')];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/** Missing entrypoints fail; disconnected islands and missing relative imports are separately reported. */
export function auditReachableEngines(srcRoot = path.join(ROOT, 'server/src'), entrypoints = [
  'main.ts', 'index.ts', 'ops/backup-cli.ts',
]) {
  const root = path.resolve(srcRoot);
  const allFiles = collect(root, root, []).sort();
  const fileSet = new Set(allFiles);
  const queue = entrypoints.map((name) => path.resolve(root, name));
  for (const entry of queue) if (!fileSet.has(entry)) throw new Error('source entrypoint is missing');
  const visited = new Set();
  const unresolved = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    for (const specifier of relativeImports(file)) {
      const target = resolveImport(file, specifier, fileSet);
      if (target) { if (!visited.has(target)) queue.push(target); }
      else {
        // Non-TypeScript imports (e.g. JSON) and optional platform assets need separate inventory review.
        if (/\.(?:json|node|wasm|css|png|svg)$/.test(specifier)) continue;
        unresolved.add(path.relative(root, file).replaceAll(path.sep, '/') + ' -> ' + specifier);
      }
    }
  }
  return {
    totalCount: allFiles.length,
    reachableCount: visited.size,
    orphans: allFiles.filter((file) => !visited.has(file)).map((file) => path.relative(root, file).replaceAll(path.sep, '/')),
    unresolved: [...unresolved].sort(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootArg = process.argv.find((a) => a.startsWith('--root='));
  const root = rootArg ? rootArg.slice('--root='.length) : path.join(ROOT, 'server/src');
  const roots = process.argv.includes('--root=') ? ['index.ts'] : undefined;
  const result = auditReachableEngines(root, roots ?? (rootArg ? ['index.ts'] : undefined));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else {
    console.log(`MIA source reachability: ${result.reachableCount}/${result.totalCount} modules; ${result.orphans.length} disconnected; ${result.unresolved.length} unresolved relative imports.`);
    for (const filename of result.orphans) console.log('  DISCONNECTED ' + filename);
    for (const filename of result.unresolved) console.log('  UNRESOLVED ' + filename);
  }
  if (process.argv.includes('--strict') && (result.orphans.length || result.unresolved.length)) process.exitCode = 1;
}
