/**
 * Minimal static scan for architecture-rule tests: the module imports and the identifiers a source file references.
 * Uses the same Oxc parser (rolldown/utils) as brainos7-authority.audit.test.ts. An architecture invariant check for CI,
 * not a sandbox: it proves which modules and names code refers to, not what arbitrary code could do at runtime.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseSync } from 'rolldown/utils';

type Ast = { type: string; start?: number; [key: string]: any };
const sourceExt = /\.(?:ts|tsx|mts|js|mjs)$/;

export interface FileScan {
  /** Path relative to the scanned root, with forward slashes. */
  file: string;
  /** Runtime module specifiers (type-only imports excluded). */
  imports: string[];
  /** Runtime imports that resolve to files, relative to the root. */
  resolved: string[];
  /** Runtime names imported from each relative module, keyed by resolved path ('*' for namespace or side-effect imports). */
  importedNames: Map<string, string[]>;
  /** Every identifier name referenced in runtime code, including property keys and member names. */
  identifiers: Set<string>;
  /** Raw source, for textual checks such as `process.env`. */
  source: string;
}

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(p);
    return sourceExt.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  }).sort();
}

const isNode = (v: unknown): v is Ast => !!v && typeof v === 'object' && typeof (v as Ast).type === 'string';
function visit(n: Ast, fn: (n: Ast, parent?: Ast) => void, parent?: Ast) {
  fn(n, parent);
  for (const [k, v] of Object.entries(n)) {
    if (k === 'parent' || k === 'loc' || k === 'range') continue;
    if (Array.isArray(v)) { for (const x of v) if (isNode(x)) visit(x, fn, n); } else if (isNode(v)) visit(v, fn, n);
  }
}

export function scanFile(root: string, path: string): FileScan {
  const source = readFileSync(path, 'utf8');
  const parsed = parseSync(path, source, { lang: path.endsWith('.tsx') ? 'tsx' : 'ts' });
  if (parsed.errors.length) throw new Error(`${path}: parse failed`);
  const imports: string[] = [], identifiers = new Set<string>(), named: [string, string[]][] = [];
  visit(parsed.program as unknown as Ast, (n, parent) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) {
      if (n.importKind === 'type' || n.exportKind === 'type') return;
      const specs: Ast[] = n.specifiers ?? [];
      if (specs.length && specs.every((s) => s.importKind === 'type' || s.exportKind === 'type')) return;
      if (typeof n.source.value === 'string') {
        imports.push(n.source.value);
        const runtime = specs.filter((x) => x.importKind !== 'type' && x.exportKind !== 'type');
        named.push([n.source.value, runtime.length ? runtime.map((x) => x.type === 'ImportSpecifier' || x.type === 'ExportSpecifier' ? String(x.imported?.name ?? x.local?.name) : '*') : ['*']]);
      }
    }
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal' && typeof n.source.value === 'string') imports.push(n.source.value);
    if (n.type === 'Identifier' && !(parent?.type === 'ImportSpecifier' && parent.importKind === 'type')) identifiers.add(n.name);
  });
  const toKey = (spec: string) => relative(root, resolve(dirname(path), spec.replace(/\.js$/, '.ts'))).split(sep).join('/');
  const resolved = imports.filter((x) => x.startsWith('.')).map(toKey);
  const importedNames = new Map<string, string[]>();
  for (const [spec, names] of named) if (spec.startsWith('.')) importedNames.set(toKey(spec), [...(importedNames.get(toKey(spec)) ?? []), ...names]);
  return { file: relative(root, path).split(sep).join('/'), imports, resolved, importedNames, identifiers, source };
}

export function scanTree(root: string): Map<string, FileScan> {
  return new Map(sourceFiles(root).map((p) => { const s = scanFile(root, p); return [s.file, s]; }));
}

/** Files reachable from `start` through relative runtime imports, including `start`. */
export function importClosure(scans: Map<string, FileScan>, start: string): Set<string> {
  const seen = new Set<string>(), queue = [start];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f) || !scans.has(f)) continue;
    seen.add(f);
    queue.push(...scans.get(f)!.resolved);
  }
  return seen;
}
