#!/usr/bin/env node
/**
 * Read-only, comment-aware TypeScript import reachability audit complementing scripts/inventory.mjs.
 *
 * Starts from the REAL server entrypoints (main.ts, index.ts, backup-cli.ts).
 * This is an indicator of disconnected code, not proof that a feature runs.
 * No files are deleted or executed. By default it reports; --strict is opt-in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Mask comments without altering quoted strings or newlines. This is a bounded
 * static import scan, not a full source-code parser or runtime execution proof.
 * TypeScript 7 no longer publishes its classic JavaScript compiler AST API.
 */
function stripComments(source) {
  let output = '';
  let state = 'code';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; output += '\n'; }
      else output += ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { output += '  '; i++; state = 'code'; }
      else output += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      output += ch;
      if (ch === '\\' && i + 1 < source.length) { output += source[++i]; continue; }
      if ((state === 'single' && ch === "'") ||
          (state === 'double' && ch === '"') ||
          (state === 'template' && ch.charCodeAt(0) === 96)) state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { output += '  '; i++; state = 'line'; continue; }
    if (ch === '/' && next === '*') { output += '  '; i++; state = 'block'; continue; }
    if (ch === "'") state = 'single';
    else if (ch === '"') state = 'double';
    else if (ch.charCodeAt(0) === 96) state = 'template';
    output += ch;
  }
  return output;
}

/**
 * Tokenize enough TypeScript source to recognize module edges without evaluating
 * source and without the removed TypeScript 7 JavaScript compiler API.
 * Strings and comments are isolated so fake import text cannot become an edge.
 * This remains a conservative advisory reachability scan, not a full parser.
 */
function tokenizeImports(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i], next = text[i + 1];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && next === '/') {
      i = text.indexOf('\n', i + 2);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    // Ignore template string bodies: imports inside text are not module edges.
    if (ch.charCodeAt(0) === 96) {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text.charCodeAt(i++) === 96) break;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let value = '';
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < text.length) {
          i++;
          value += text[i++];
        } else value += text[i++];
      }
      if (i < text.length) i++;
      out.push({ type: 'string', value });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let word = ch;
      i++;
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) word += text[i++];
      out.push({ type: 'id', value: word });
      continue;
    }
    if ('(){};,.'.includes(ch)) out.push({ type: 'punct', value: ch });
    i++;
  }
  return out;
}

function relativeImports(filename) {
  const tokens = tokenizeImports(fs.readFileSync(filename, 'utf8'));
  const result = [];
  const add = (token) => {
    if (token?.type === 'string' && token.value.startsWith('.')) result.push(token.value);
  };
  const val = (index) => tokens[index]?.value;
  const fromAfter = (at) => {
    // Handle import type { X } from './x' and export * from './x'.
    // End at statement boundary; no trailing JS string can be mistaken for it.
    for (let j = at + 1; j < Math.min(tokens.length, at + 120); j++) {
      if (val(j) === 'from' && tokens[j + 1]?.type === 'string') { add(tokens[j + 1]); break; }
      if (val(j) === ';' || val(j) === 'import' || val(j) === 'export') break;
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = val(i);
    if (t === 'import') {
      if (val(i + 1) === '(') add(tokens[i + 2]);
      else if (tokens[i + 1]?.type === 'string') add(tokens[i + 1]);
      else if (val(i + 1) !== '.') fromAfter(i);
    } else if (t === 'export') {
      fromAfter(i);
    } else if (t === 'require' && val(i + 1) === '(') {
      add(tokens[i + 2]);
    } else if (t === 'new' && val(i + 1) === 'URL' && val(i + 2) === '(' &&
      val(i + 4) === ',' && val(i + 5) === 'import' && val(i + 6) === '.' &&
      val(i + 7) === 'meta' && val(i + 8) === '.' && val(i + 9) === 'url') {
      add(tokens[i + 3]);
    }
  }
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
  const result = rootArg ? auditReachableEngines(root, ['index.ts']) : auditReachableEngines(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else {
    console.log(`MIA source reachability: ${result.reachableCount}/${result.totalCount} modules; ${result.orphans.length} disconnected; ${result.unresolved.length} unresolved relative imports.`);
    for (const filename of result.orphans) console.log('  DISCONNECTED ' + filename);
    for (const filename of result.unresolved) console.log('  UNRESOLVED ' + filename);
  }
  if (process.argv.includes('--strict') && (result.orphans.length || result.unresolved.length)) process.exitCode = 1;
}
