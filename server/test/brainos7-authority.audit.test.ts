import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { describe, expect, it } from 'vitest';

/**
 * BrainOS research authority audit. Use the already locked Oxc/ESTree parser
 * from Rolldown (test only); TS7 remains the canonical typechecker.
 * This is a CI architecture invariant, NOT a hostile-code sandbox.
 */
type Ast = { type: string; start?: number; [key: string]: any };
const SOURCE_ROOT = realpathSync(fileURLToPath(new URL('../src/', import.meta.url)));
const COGNITIVE = 'knowledge/cognitive/';
const sourceExt = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const blockedPath = /^(?:exec|execution|risk|portfolio|wallet|security|qa|ops|decision|joe|bot|auth)\//;
const blockedCore = /^(?:core\/(?:mode|settings|audit|signing)|lab\/lab|db\/migrations)\./;
const forbidden = new Set([
  'placeOrder','submitEntry','submitOrder','cancelOrder','cancelAllOpenOrders','cancelAllOrders',
  'closePosition','forceExit','emergencyFlatten','flattenAll','setLeverage','reserveCapitalEnvelope',
  'recordFill','ledger','appendLedgerEntry','writeLedger','acceptPolicy','setStrategyStatus','updateControl',
  'setSetting','openDb','triggerSweep','mutateRisk','mutateRiskLimits','updateRiskCap','commitLedgerEntry',
  'executeTreasurySweep','unlockLiveMode','executeTrade','assertLiveModeUnlocked','evaluateRisk',
  'require','createRequire','eval','Function',
]);
const authorityFields = new Set(['financialAuthority','executionAuthority','canRequestFinancialAction','tradingAuthority','allowLiveExecution']);
const external = new Set(['node:crypto','node:events','@anthropic-ai/sdk']);
// These two shared infrastructure owners are deliberately terminal boundaries,
// not claims that their internal code is read-only. Only reviewed named
// imports at exact paths are allowed. A new caller needs explicit review.
const trusted: Record<string, Record<string, readonly string[]>> = {
  'db/db.ts': {
    'knowledge/cognitive/books.ts': ['get','all'],
    'knowledge/retrieval.ts': ['get','all','getDb'],
  },
  'config.ts': {
    'knowledge/providers.ts': ['config'],
    'providers/http.ts': ['config'],
  },
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error('Unreviewed cognitive symlink: ' + p);
    return e.isDirectory() ? filesUnder(p) : sourceExt.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  }).sort();
}
const keyOf = (p: string) => relative(SOURCE_ROOT, p).split(sep).join('/');
const isNode = (v: unknown): v is Ast => !!v && typeof v === 'object' && typeof (v as Ast).type === 'string';
function visit(n: Ast, fn: (n: Ast, parent?: Ast) => void, parent?: Ast) {
  fn(n,parent);
  for (const [k,v] of Object.entries(n)) {
    if (['parent','loc','range'].includes(k)) continue;
    if (Array.isArray(v)) { for (const x of v) if (isNode(x)) visit(x,fn,n); }
    else if (isNode(v)) visit(v,fn,n);
  }
}
const nameOf = (n?: Ast): string | undefined =>
  n?.type === 'Identifier' ? n.name : n?.type === 'Literal' && typeof n.value === 'string' ? n.value : undefined;
const literal = (n?: Ast): string | undefined =>
  n?.type === 'Literal' && typeof n.value === 'string' ? n.value : undefined;
function unwrap(n?: Ast): Ast | undefined {
  while(n && ['TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression'].includes(n.type)) n=n.expression;
  return n;
}
function isFalse(n?: Ast) { const x=unwrap(n); return x?.type==='Literal' && x.value===false; }

interface Edge { specifier: string; names: string[]; namedOnly: boolean; line: number }
interface Scan { edges: Edge[]; violations: string[] }
function inspectAst(file: string, source: string, cognitive: boolean): Scan {
  const parsed = parseSync(file, source, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' });
  if (parsed.errors.length) return { edges: [], violations: [file + ': parse failed: ' + JSON.stringify(parsed.errors)] };
  const edges: Edge[] = [], violations: string[] = [];
  const line = (n: Ast) => source.slice(0,n.start ?? 0).split('\n').length;
  const bad = (n: Ast, why: string) => violations.push(file+':'+line(n)+': '+why);
  visit(parsed.program as unknown as Ast, (n, parent) => {
    if (['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(n.type) && n.source) {
      if (n.importKind==='type' || n.exportKind==='type') return;
      const all: Ast[] = n.specifiers ?? [];
      const specs = all.filter(s => s.importKind !== 'type' && s.exportKind !== 'type');
      // Mixed inline type specifiers are erased; side-effect imports are not.
      if (all.length && !specs.length) return;
      const specifier = literal(n.source);
      if (!specifier) { bad(n,'nonliteral module specifier'); return; }
      const namedOnly = n.type==='ImportDeclaration' && specs.length>0 && specs.every(s=>s.type==='ImportSpecifier');
      edges.push({specifier, names: specs.map(s=>nameOf(s.imported ?? s.local) ?? '*'), namedOnly, line:line(n)});
    }
    if (n.type==='ImportExpression' || n.type==='TSImportEqualsDeclaration' ||
        (n.type==='CallExpression' && n.callee?.type==='Import'))
      bad(n,'dynamic or CommonJS module loading is not permitted');
    // Check references as well as direct calls: catches aliases, destructuring,
    // optional chaining, namespace access and literal computed member names.
    if (cognitive && n.type==='Identifier' && forbidden.has(n.name)) {
      // A declaration in a type-only import is harmless; runtime code is not.
      if (!(parent?.type==='ImportSpecifier' && parent.importKind==='type'))
        bad(n,'restricted identifier '+n.name);
    }
    if (cognitive && n.type==='MemberExpression' && n.computed && forbidden.has(nameOf(n.property) ?? ''))
      bad(n,'restricted computed member '+nameOf(n.property));
    if (cognitive && n.type==='Property' && authorityFields.has(nameOf(n.key) ?? '') &&
        !isFalse(n.value)) bad(n,'authority field must remain literal false: '+nameOf(n.key));
    if (cognitive && n.type==='AssignmentExpression' && n.left?.type==='MemberExpression' &&
        authorityFields.has(nameOf(n.left.property) ?? '') && !isFalse(n.right))
      bad(n,'authority mutation: '+nameOf(n.left.property));
    if (cognitive && n.type==='Identifier' && n.name==='globalThis')
      bad(n,'global authority access is not permitted');
    if (!cognitive && n.type==='Identifier' && ['require','createRequire','eval'].includes(n.name))
      bad(n,'unreviewed module loading reference '+n.name);
  });
  return {edges,violations};
}

function auditGraph(roots: readonly string[], load: (file: string)=>string | undefined) {
  const seen = new Set<string>(), failures: string[] = [];
  const scan = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source=load(file);
    if (source===undefined) { failures.push(chain.join(' -> ')+': unresolved source'); return; }
    const result=inspectAst(file,source,file.startsWith(COGNITIVE));
    failures.push(...result.violations.map(x=>chain.join(' -> ')+': '+x));
    for (const edge of result.edges) {
      const prefix=chain.join(' -> ')+':'+edge.line+': ';
      if (!edge.specifier.startsWith('.')) {
        if (!external.has(edge.specifier) || (file.startsWith(COGNITIVE) && edge.specifier!=='node:crypto'))
          failures.push(prefix+'unreviewed external import '+edge.specifier);
        continue;
      }
      // Actual NodeNext source roots use explicit .js specifiers for .ts.
      const target=keyOf(resolve(SOURCE_ROOT,dirname(file),edge.specifier.replace(/\.js$/,'.ts')));
      if (target.startsWith('../') || blockedPath.test(target) || blockedCore.test(target)) {
        failures.push(prefix+'restricted dependency '+target); continue;
      }
      if (Object.hasOwn(trusted,target)) {
        const allowed=trusted[target][file] ?? [];
        if (!edge.namedOnly || !edge.names.length || edge.names.some(n=>!allowed.includes(n)))
          failures.push(prefix+'unreviewed privileged bridge '+target+' ['+edge.names.join(',')+']');
        continue;
      }
      scan(target,[...chain,target]);
    }
  };
  for (const root of roots) scan(root,[root]);
  return { files:[...seen].sort(), violations:failures };
}
function loadSource(file: string) {
  const p=resolve(SOURCE_ROOT,file);
  if (!existsSync(p) || !sourceExt.test(file)) return undefined;
  const real=realpathSync(p);
  if (real!==p || !real.startsWith(SOURCE_ROOT+sep)) return undefined;
  return readFileSync(real,'utf8');
}
describe('BrainOS 7 research-only single-authority AST audit',()=>{
  it('recursively audits the production cognitive graph with no boundary violations',()=>{
    const roots=filesUnder(join(SOURCE_ROOT,COGNITIVE)).map(keyOf);
    expect(roots.length).toBeGreaterThanOrEqual(9);
    const result=auditGraph(roots,loadSource);
    expect(result.files).toContain('knowledge/retrieval.ts');
    expect(result.files).toContain('workers/registry.ts');
    expect(result.violations).toEqual([]);
  });
  const file=COGNITIVE+'fixture.ts';
  const fixture = (code: string, extra: Record<string,string>={}) =>
    auditGraph([file],p=>({[file]:code,...extra})[p]).violations;
  it('catches aliased, namespace, side-effect and re-exported financial imports',()=>{
    for(const code of [
      "import { submitEntry as harmless } from '../../exec/oms.js'; harmless();",
      "import * as x from '../../risk/gate.js';",
      "import '../../portfolio/ledger.js';",
      "export { updateControl as harmless } from '../../core/mode.js';",
    ]) expect(fixture(code).length).toBeGreaterThan(0);
  });
  it('rejects transitive restricted imports and unresolved local dependencies',()=>{
    expect(fixture("import { helper } from './helper.js';",{
      [COGNITIVE+'helper.ts']:"export { submitEntry as helper } from '../../exec/oms.js';",
    }).join()).toContain('restricted dependency exec/oms.ts');
    expect(fixture("import './missing.js';").join()).toContain('unresolved source');
  });
  it('rejects dynamic, computed and indirect module loading and restricted references',()=>{
    for(const code of [
      "import('../../exec/oms.js');", "const p = './x.js'; import(p);",
      "const r = require; r('./x.js');", "const x = api.submitEntry; x();",
      "api['cancelOrder']();", "const { submitOrder: f } = api; f();",
      "globalThis['require']('./x.js');",
    ]) expect(fixture(code).length).toBeGreaterThan(0);
  });
  it('rejects unreviewed database access and authority escalation',()=>{
    for(const code of [
      "import { run as safe } from '../../db/db.js';",
      "import { getDb } from '../../db/db.js';",
      "const x = { financialAuthority: true };",
      "const x = { tradingAuthority: enabled };",
      "ctx.executionAuthority = true;",
    ]) expect(fixture(code).length).toBeGreaterThan(0);
  });
  it('does not confuse comments, strings or type-only module imports with runtime calls',()=>{
    expect(fixture("// submitOrder()\nconst text = 'placeOrder()';\nimport type { DecisionReport } from '../../decision/engine.js';\nconst x = { financialAuthority: false as const };")).toEqual([]);
    expect(fixture("import { type DecisionReport } from '../../decision/engine.js';")).toEqual([]);
    expect(fixture("const broken = ;").join()).toContain('parse failed');
  });
});
