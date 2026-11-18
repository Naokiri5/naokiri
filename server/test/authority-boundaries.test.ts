import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SyntaxKind, isCallExpression, isExportDeclaration, isExternalModuleReference,
  isIdentifier, isImportDeclaration, isImportEqualsDeclaration, isNamedExports,
  isNamedImports, isNoSubstitutionTemplateLiteral, isStringLiteral, skipOuterExpressions, type Node, type SourceFile,
} from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';
import { describe, expect, it } from 'vitest';

const OMS = 'exec/oms.ts';
const JOE = 'joe/joe.ts';
const JOE_OMS = ['listPositions', 'pauseNewOrders'];
const OMS_CALLERS = new Map<string, readonly string[] | '*'>([
  ['api/routes.ts', '*'], // The authenticated owner routes use an OMS namespace import.
  ['bot/bot.ts', ['submitEntry', 'queueForApproval', 'monitorPositions', 'expireApprovals']],
  ['ops/integrity.ts', ['protectPositions']],
  [JOE, JOE_OMS],
]);

const READABLE_APIS = new Map<string, readonly string[]>([
  ['core/mode.ts', ['getControl', 'displayMode']],
  // Claude's safety branch also reads the most recent valid policy for protective exits.
  ['risk/policy.ts', ['currentPolicy', 'exitPolicy', 'DEFAULT_POLICY', 'policyHistory', 'RiskPolicy']],
  ['portfolio/ledger.ts', ['PAPER_ACCOUNT', 'accountState', 'cashBalance', 'totalDeposits', 'openPositions', 'markPrice']],
  ['lab/lab.ts', ['fetchHistory', 'listStrategies', 'listBacktests', 'strategyStats', 'paperStats', '_universeSymbols']],
  ['wallet/wallet.ts', ['NETWORKS', 'toChecksum', 'validateAddress', 'withdrawalFrozen']],
]);

const EVIDENCE_ROOT = /^(workers|providers|news|whales|knowledge|ditas|fundamentals|chart|features|qci|decision|wallet|market|hunt|social|joe|regime|safety)\//;

interface ImportEdge {
  from: string;
  line: number;
  to: string | null;
  names: readonly string[] | null;
  kind: 'import' | 're-export' | 'loader';
}

function runtimeImports(file: SourceFile, from: string): ImportEdge[] {
  const imports: ImportEdge[] = [];
  function add(site: Node, specifier: Node | undefined, names: ImportEdge['names'], kind: ImportEdge['kind']) {
    const target = specifier && skipOuterExpressions(specifier);
    imports.push({
      from, kind, names,
      line: file.getLineAndCharacterOfPosition(site.getStart(file)).line + 1,
      to: target && (isStringLiteral(target) || isNoSubstitutionTemplateLiteral(target)) ? target.text : null,
    });
  }
  function visit(node: Node): void {
    if (isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.phaseModifier === SyntaxKind.TypeKeyword) return;
      const bindings = clause?.namedBindings;
      if (!clause || (bindings && !isNamedImports(bindings))) {
        add(node, node.moduleSpecifier, null, 'import');
        return;
      }
      const names = clause.name ? ['default'] : [];
      if (bindings && isNamedImports(bindings)) {
        names.push(...bindings.elements.filter(specifier => !specifier.isTypeOnly)
          .map(specifier => (specifier.propertyName ?? specifier.name).text));
        if (!names.length && bindings.elements.length) return; // Only type specifiers.
      }
      add(node, node.moduleSpecifier, names.length ? names : null, 'import');
      return;
    }
    if (isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      const clause = node.exportClause;
      const named = clause && isNamedExports(clause);
      const names = named ? clause.elements.filter(specifier => !specifier.isTypeOnly)
        .map(specifier => (specifier.propertyName ?? specifier.name).text) : null;
      if (!named || names?.length || !clause.elements.length) add(node, node.moduleSpecifier, names, 're-export');
      return;
    }
    if (isImportEqualsDeclaration(node) && !node.isTypeOnly && isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, null, 'loader');
      return;
    }
    if (isCallExpression(node)) {
      const callee = skipOuterExpressions(node.expression);
      if (callee.kind === SyntaxKind.ImportKeyword || (isIdentifier(callee) && callee.text === 'require')) {
        add(node, node.arguments[0], null, 'loader');
      }
    }
    node.forEachChild(visit);
  }
  visit(file);
  return imports;
}

/** Resolve repository ESM source names, including the emitted extension used by NodeNext. */
function localTarget(importer: string, specifier: string, modules: ReadonlyMap<string, readonly ImportEdge[]>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const path = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const sourcePath = path.replace(/\.([mc]?)js$/, '.$1ts');
  return [path, sourcePath].find(name => modules.has(name));
}

function trackedModules(server: string): Map<string, ImportEdge[]> {
  const config = join(server, 'tsconfig.json');
  const api = new API({ cwd: server });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    try {
      const project = snapshot.getProject(config);
      if (!project) throw new Error(`Could not inspect TypeScript project ${config}`);
      const src = join(server, 'src');
      const modules = new Map<string, ImportEdge[]>();
      for (const path of project.program.getSourceFileNames()) {
        const name = relative(src, path).split(sep).join('/');
        if (isAbsolute(name) || name.startsWith('../')) continue;
        const file = project.program.getSourceFile(path);
        if (file && !file.isDeclarationFile) modules.set(name, runtimeImports(file, name));
      }
      return modules;
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

function allows(edge: ImportEdge, names: readonly string[] | '*' | undefined): boolean {
  if (edge.kind !== 'import') return false;
  if (names === '*') return true;
  return !!names && !!edge.names?.length && edge.names.every(name => names.includes(name));
}

function authorityViolations(modules: ReadonlyMap<string, readonly ImportEdge[]>): string[] {
  const issues = new Set<string>();
  type Link = { edge: ImportEdge; target: string };
  const local = new Map<string, Link[]>();
  const label = ({ from, line, names }: ImportEdge) => `${from}:${line} [${names?.join(', ') || '*'}]`;

  for (const [from, imports] of modules) {
    const links: Link[] = [];
    for (const edge of imports) {
      if (edge.to === null) {
        issues.add(`${label(edge)} has a computed module target`);
        continue;
      }
      if (!edge.to.startsWith('.') && !edge.to.startsWith('/') && !edge.to.startsWith('#') && !edge.to.startsWith('file:')) continue;
      const target = localTarget(from, edge.to, modules);
      if (!target) {
        issues.add(`${label(edge)} has an unresolved local runtime dependency ${edge.to}`);
        continue;
      }
      if (target === OMS && !allows(edge, OMS_CALLERS.get(from))) {
        issues.add(`Unauthorized OMS dependency: ${label(edge)} -> ${target}`);
      }
      links.push({ edge, target });
    }
    local.set(from, links);
  }

  for (const root of local.keys()) {
    if (!EVIDENCE_ROOT.test(root)) continue;
    const pending = [[root]];
    const seen = new Set([root]);
    for (const path of pending) {
      for (const { edge, target } of local.get(path.at(-1)!) ?? []) {
        const describePath = () => [...path.slice(0, -1), label(edge), target].join(' -> ');
        if (target === OMS) {
          // Joe can use the two existing capabilities directly. Do not walk into OMS internals.
          if (root !== JOE || edge.from !== JOE || !allows(edge, JOE_OMS)) {
            issues.add(`Evidence reaches OMS: ${describePath()}`);
          }
          continue;
        }
        const allowed = READABLE_APIS.get(target);
        if (allowed && !allows(edge, allowed)) {
          issues.add(`Evidence reaches a privileged API: ${describePath()}`);
        }
        if (!seen.has(target)) {
          seen.add(target);
          pending.push([...path, target]);
        }
      }
    }
  }
  return [...issues].sort();
}

describe('execution authority boundaries', () => {
  it('keeps workers, feeds, research, and Trader Joe outside privileged execution paths', () => {
    const server = fileURLToPath(new URL('../', import.meta.url));
    const modules = trackedModules(server);
    for (const name of [OMS, JOE, 'workers/runtime.ts', 'news/news.ts', 'whales/prints.ts', 'bot/bot.ts', 'api/routes.ts']) {
      expect(modules.has(name), `expected authority graph to include ${name}`).toBe(true);
    }
    expect(authorityViolations(modules)).toEqual([]);
  });

  it('catches transitive access, re-exports, aliased privileges, and dynamic loaders', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'mia-authority-'));
    try {
      writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*'] }));
      const sources = {
        'exec/oms.ts': 'export const submitEntry = () => 0; export const listPositions = () => []; export type PaperOrder = string;',
        'core/mode.ts': 'export const updateControl = () => 0;',
        'bot/bot.ts': "import { submitEntry } from '../exec/oms.js'; export const startBot = submitEntry;",
        'news/news.ts': "export { forward } from '../utility.js';",
        'utility.ts': "export { submitEntry as forward } from './exec/oms.js';",
        'workers/runtime.ts': "import type { PaperOrder } from '../exec/oms.js'; export type { PaperOrder } from '../exec/oms.js';",
        'market/cexActivity.ts': "import { startBot } from '../bot/bot.js'; export const onActivity = startBot;",
        'whales/prints.ts': "export const load = () => import('../exec/oms.js' as string);",
        'joe/joe.ts': "import { listPositions } from '../exec/oms.js'; import { updateControl as readStatus } from '../core/mode.js';",
        'chart/dynamic.ts': 'export const load = (path: string) => import(path);',
      };
      for (const [name, content] of Object.entries(sources)) {
        const path = join(fixture, 'src', name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      expect(authorityViolations(trackedModules(fixture))).toEqual([
        'Evidence reaches OMS: market/cexActivity.ts -> bot/bot.ts:1 [submitEntry] -> exec/oms.ts',
        'Evidence reaches OMS: news/news.ts -> utility.ts:1 [submitEntry] -> exec/oms.ts',
        'Evidence reaches OMS: whales/prints.ts:1 [*] -> exec/oms.ts',
        'Evidence reaches a privileged API: joe/joe.ts:1 [updateControl] -> core/mode.ts',
        'Unauthorized OMS dependency: utility.ts:1 [submitEntry] -> exec/oms.ts',
        'Unauthorized OMS dependency: whales/prints.ts:1 [*] -> exec/oms.ts',
        'chart/dynamic.ts:1 [*] has a computed module target',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
