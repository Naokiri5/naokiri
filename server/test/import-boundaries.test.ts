import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THINK slice 2 (MIA-THINK-029, 091, 092): repository-wide import boundaries, enforced in the required CI test job.
 *
 *  1. Evidence and research code (workers, QCI, providers, research, knowledge, chart, features, regime, safety, news,
 *     whales, lab, journal, notify, the THINK certificate/profit lab) cannot reach exec/, wallet/ or portfolio/ at
 *     runtime, directly or transitively. Type-only imports are erased at runtime and are ignored.
 *  2. Functions that change orders, positions, mode, risk policy or wallet state may be imported only by an explicit
 *     allow-list. Trader Joe may only pause; the integrity monitor may only protect positions.
 * A new import that crosses these lines fails CI and needs a reviewed change to this allow-list.
 */
const SRC = normalize(join(dirname(fileURLToPath(import.meta.url)), '../src'));
const rel = (abs: string) => relative(SRC, abs).split('\\').join('/');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : []; });
}
interface Imp { target: string; names: string[]; namespace: boolean }
/** Runtime imports of one file (static, dynamic and re-exports); `import type` / all-type specifier lists are skipped. */
function runtimeImports(file: string): Imp[] {
  const src = readFileSync(file, 'utf8'); const out: Imp[] = [];
  const resolve = (spec: string) => rel(normalize(join(dirname(file), spec.replace(/\.js$/, '.ts'))));
  // `[^;]*?` keeps a clause inside one statement, so a non-relative import cannot swallow the next one.
  const stmt = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"](\.[^'"]+)['"]/g;
  for (const m of src.matchAll(stmt)) {
    if (m[2]) continue; // import type / export type
    const clause = m[3].trim();
    const ns = /^\*\s+as\s+\w+/.test(clause) || clause === '*';
    const braces = clause.match(/\{([\s\S]*)\}/)?.[1] ?? '';
    const specs = braces.split(',').map((s) => s.trim()).filter(Boolean);
    const valueSpecs = specs.filter((s) => !s.startsWith('type ')).map((s) => s.split(/\s+as\s+/)[0].trim());
    const hasDefault = /^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause) && !clause.startsWith('{');
    if (!ns && !hasDefault && specs.length && !valueSpecs.length) continue; // only `type` specifiers
    out.push({ target: resolve(m[4]), names: valueSpecs, namespace: ns });
  }
  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) out.push({ target: resolve(m[1]), names: [], namespace: true });
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) out.push({ target: resolve(m[1]), names: [], namespace: false });
  return out;
}

const FILES = tsFiles(SRC);
const GRAPH = new Map(FILES.map((f) => [rel(f), runtimeImports(f)]));
function reachable(from: string): Set<string> {
  const seen = new Set<string>(); const stack = [from];
  while (stack.length) for (const i of GRAPH.get(stack.pop()!) ?? []) if (!seen.has(i.target)) { seen.add(i.target); stack.push(i.target); }
  return seen;
}

const EVIDENCE_ROOTS = ['workers/', 'qci/', 'providers/', 'research/', 'knowledge/', 'chart/', 'features/', 'regime/', 'safety/', 'news/', 'whales/', 'lab/', 'journal/', 'notify/', 'decision/certificate.ts', 'decision/profitLab.ts'];
const FORBIDDEN_FOR_EVIDENCE = ['exec/', 'wallet/', 'portfolio/'];

/** Functions that change orders, positions, mode, policy or wallet state. */
const MUTATORS: Record<string, string[]> = {
  'exec/oms.ts': ['submitEntry', 'queueForApproval', 'decideApproval', 'expireApprovals', 'monitorPositions', 'executeExit', 'cancelPendingEntries', 'protectPositions', 'closeAllPositions', 'closePosition', 'emergencyStop', 'pauseNewOrders'],
  'core/mode.ts': ['updateControl'],
  'risk/policy.ts': ['acceptPolicy'],
  'wallet/wallet.ts': ['addAddress', 'removeAddress', 'verifyAddress', 'setWithdrawalFreeze', 'previewWithdrawal'],
};
/** Who may import which mutators ('*' = whole module, for the owner-authenticated HTTP surface). */
const ALLOWED: Record<string, Record<string, string[] | '*'>> = {
  'api/routes.ts': { 'exec/oms.ts': '*', 'core/mode.ts': '*', 'risk/policy.ts': '*', 'wallet/wallet.ts': '*' },
  'bot/bot.ts': { 'exec/oms.ts': ['submitEntry', 'queueForApproval', 'monitorPositions', 'expireApprovals'] },
  'joe/joe.ts': { 'exec/oms.ts': ['pauseNewOrders'] },           // Trader Joe: read, explain, alert, pause only
  'ops/integrity.ts': { 'exec/oms.ts': ['protectPositions'] },   // risk-reducing only
  'exec/environment.ts': { 'exec/oms.ts': ['submitEntry', 'closePosition'] }, // Paper adapter wraps the canonical OMS
  'exec/oms.ts': { 'core/mode.ts': ['updateControl'] },          // pauseNewOrders / emergencyStop only (risk-reducing)
};

describe('Import boundaries (static, runtime imports only)', () => {
  it('the parser sees the real graph (sanity)', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(GRAPH.get('bot/bot.ts')!.some((i) => i.target === 'exec/oms.ts' && i.names.includes('submitEntry'))).toBe(true);
    expect(GRAPH.get('decision/certificate.ts')!.some((i) => i.target === 'decision/engine.ts')).toBe(false); // type-only import ignored
  });

  it('evidence and research code cannot reach exec/, wallet/ or portfolio/ (MIA-THINK-029)', () => {
    const violations: string[] = [];
    for (const f of GRAPH.keys()) {
      if (!EVIDENCE_ROOTS.some((r) => f.startsWith(r))) continue;
      for (const t of reachable(f)) if (FORBIDDEN_FOR_EVIDENCE.some((x) => t.startsWith(x))) violations.push(`${f} -> ${t}`);
    }
    expect(violations).toEqual([]);
  });

  it('only allow-listed modules import functions that change orders, mode, policy or wallets (MIA-THINK-091/092)', () => {
    const violations: string[] = [];
    for (const [f, imports] of GRAPH) {
      for (const i of imports) {
        const mut = MUTATORS[i.target]; if (!mut || f === i.target) continue;
        const allowed = ALLOWED[f]?.[i.target];
        if (allowed === '*') continue;
        if (i.namespace) { violations.push(`${f} imports all of ${i.target}`); continue; }
        for (const n of i.names) if (mut.includes(n) && !(allowed ?? []).includes(n)) violations.push(`${f} imports ${n} from ${i.target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the allow-list itself stays minimal: Trader Joe can only pause, never trade, change mode or policy', () => {
    expect(ALLOWED['joe/joe.ts']).toEqual({ 'exec/oms.ts': ['pauseNewOrders'] });
    const joe = GRAPH.get('joe/joe.ts')!;
    expect(joe.filter((i) => MUTATORS[i.target]).flatMap((i) => i.names.filter((n) => MUTATORS[i.target].includes(n)))).toEqual(['pauseNewOrders']);
  });

  it('a seeded violation is detected (the guard is not vacuous)', () => {
    GRAPH.set('workers/__probe__.ts', [{ target: 'exec/oms.ts', names: ['submitEntry'], namespace: false }]);
    try {
      expect([...reachable('workers/__probe__.ts')]).toContain('exec/oms.ts');
      const allowed = ALLOWED['workers/__probe__.ts']?.['exec/oms.ts'];
      expect(allowed).toBeUndefined();
    } finally { GRAPH.delete('workers/__probe__.ts'); }
  });
});
