/**
 * MIA SECURE Omega custom security rules (MIA-SEC-xxx), enforced as architecture tests over the real source tree.
 * Each rule is a function from scanned files to violations, run against the codebase (must be clean) and against a
 * small synthetic tree that breaks it (must be caught), so a rule can never pass vacuously.
 * Static rules prove which modules and names code refers to; runtime behaviour is covered by the OMS, risk, auth and
 * API tests listed in docs/engineering/MIA_SECURE_OMEGA_EVIDENCE_MATRIX.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importClosure, scanTree, type FileScan } from './ast-scan.js';

type Tree = Map<string, FileScan>;
const SERVER = fileURLToPath(new URL('../src/', import.meta.url));
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));

/** Functions that place, change or settle orders, move money, or change risk, policy, strategy or mode authority. */
const MUTATORS = ['submitEntry', 'executeExit', 'closePosition', 'closeAllPositions', 'emergencyStop', 'queueForApproval',
  'decideApproval', 'cancelPendingEntries', 'ledger', 'acceptPolicy', 'setStrategyStatus', 'updateControl', 'monitorPositions'];
const SIGNERS = ['Keypair', 'signTransaction', 'signAllTransactions', 'sendTransaction', 'sendRawTransaction', 'signMessage', 'signTypedData', 'mnemonicToSeed', 'fromSecretKey'];
const SIGNING_PACKAGES = ['@solana/web3.js', 'ethers', 'viem', 'web3', 'tweetnacl', 'bip39', '@privy-io/server-auth', '@privy-io/node'];

const importsOf = (f: FileScan, names: readonly string[]) =>
  [...f.importedNames].flatMap(([from, ns]) => ns.filter((n) => names.includes(n)).map((n) => `${f.file} imports ${n} from ${from}`));
const under = (t: Tree, ...dirs: string[]) => [...t.values()].filter((f) => dirs.some((d) => f.file.startsWith(d)));

export const RULES = {
  /** MIA-SEC-001: no code can sign or send a transaction (no signer exists in this build). */
  'MIA-SEC-001': (t: Tree) => [...t.values()].flatMap((f) => [
    ...SIGNERS.filter((n) => f.identifiers.has(n)).map((n) => `${f.file} references ${n}`),
    ...f.imports.filter((i) => SIGNING_PACKAGES.some((p) => i === p || i.startsWith(p + '/'))).map((i) => `${f.file} imports ${i}`),
  ]),
  /** MIA-SEC-002: Trader Joe may read and may pause new orders (risk-reducing); it cannot place or change anything. */
  'MIA-SEC-002': (t: Tree) => under(t, 'joe/').flatMap((f) => [
    ...importsOf(f, MUTATORS),
    ...[...(f.importedNames.get('exec/oms.ts') ?? [])].filter((n) => !['listPositions', 'pauseNewOrders'].includes(n)).map((n) => `${f.file} imports ${n} from exec/oms.ts`),
  ]),
  /** MIA-SEC-003 / 005: every entry goes through one path: the gated bot lane or the OMS owner-approval path. */
  'MIA-SEC-003': (t: Tree) => [...t.values()].filter((f) => f.identifiers.has('submitEntry') && !['bot/bot.ts', 'exec/oms.ts'].includes(f.file))
    .map((f) => `${f.file} references submitEntry`),
  /** MIA-SEC-006: the browser bundle never imports server code or reads server environment variables. */
  'MIA-SEC-006': (t: Tree) => [...t.values()].flatMap((f) => [
    ...f.imports.filter((i) => /(^|\/)server\//.test(i) || /^\.\.\/\.\.\/\.\./.test(i)).map((i) => `${f.file} imports ${i}`),
    // Code access only: help text may name a setting the administrator configures; it never contains its value.
    // A free `process.` reference (Node global), not a property such as `data.process` on API data.
    ...(/(?<![\w.$])process\s*\./.test(f.source) ? [`${f.file} references the Node process global`] : []),
    ...[...f.source.matchAll(/import\.meta\.env\.(\w+)/g)].map((m) => m[1]).filter((k) => !/^(VITE_\w+|MODE|DEV|PROD|BASE_URL|SSR)$/.test(k))
      .map((k) => `${f.file} reads import.meta.env.${k}`),
  ]),
  /** MIA-SEC-009: learning and evaluation modules cannot promote strategies, change policy or touch money. */
  'MIA-SEC-009': (t: Tree) => ['ditas/tradeOutcomes.ts', 'ditas/evaluation.ts', 'ditas/evidenceChain.ts', 'ditas/reflect.ts',
    'workers/reliability.ts', 'workers/effectiveness.ts', 'lab/qualification.ts', 'lab/overfitting.ts']
    .flatMap((file) => (t.get(file) ? importsOf(t.get(file)!, MUTATORS) : [`${file} missing`])),
  /** MIA-SEC-010 / 011: workers and QCI produce evidence only: no financial or authority mutators, no risk gate. */
  'MIA-SEC-011': (t: Tree) => under(t, 'workers/', 'qci/').flatMap((f) => [
    ...importsOf(f, MUTATORS),
    ...f.resolved.filter((r) => r.startsWith('exec/') || r === 'risk/gate.ts').map((r) => `${f.file} imports ${r}`),
  ]),
  /** MIA-SEC-012: market data and news cannot reach the decision, risk or execution modules. */
  'MIA-SEC-012': (t: Tree) => under(t, 'providers/', 'news/').flatMap((f) =>
    [...importClosure(t, f.file)].filter((r) => r.startsWith('exec/') || r.startsWith('decision/') || r === 'risk/gate.ts').map((r) => `${f.file} reaches ${r}`)),
};

describe('MIA SECURE Omega security rules on the real source tree', () => {
  const server = scanTree(SERVER), web = scanTree(WEB);
  it.each(Object.keys(RULES).filter((r) => r !== 'MIA-SEC-006'))('%s holds for server/src', (rule) => {
    expect(RULES[rule as keyof typeof RULES](server)).toEqual([]);
  });
  it('MIA-SEC-001 holds for web/src and no signing package is a dependency', () => {
    expect(RULES['MIA-SEC-001'](web)).toEqual([]);
    for (const pkg of ['../package.json', '../../web/package.json', '../../package.json']) {
      const deps = Object.keys({ ...JSON.parse(readFileSync(fileURLToPath(new URL(pkg, import.meta.url)), 'utf8')).dependencies });
      expect(deps.filter((d) => SIGNING_PACKAGES.includes(d)), pkg).toEqual([]);
    }
  });
  it('MIA-SEC-006 holds for web/src', () => { expect(RULES['MIA-SEC-006'](web)).toEqual([]); });
  it('scans a meaningful tree', () => { expect(server.size).toBeGreaterThan(100); expect(web.size).toBeGreaterThan(10); });
});

describe('each rule catches a deliberate violation', () => {
  let root = '';
  const tree = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(root, 'case-'));
    for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); }
    return scanTree(dir);
  };
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'mia-sec-')); });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ['MIA-SEC-001', { 'exec/venue.ts': "import { Keypair } from '@solana/web3.js';\nexport const k = Keypair.generate();" }],
    ['MIA-SEC-002', { 'joe/joe.ts': "import { submitEntry } from '../exec/oms.js';\nexport const x = submitEntry;", 'exec/oms.ts': 'export function submitEntry() {}' }],
    ['MIA-SEC-003', { 'choice/fast.ts': "import { submitEntry } from '../exec/oms.js';\nsubmitEntry();", 'exec/oms.ts': 'export function submitEntry() {}' }],
    ['MIA-SEC-006', { 'pages/Bad.tsx': "import { config } from '../../../server/src/config.js';" }],
    ['MIA-SEC-006', { 'pages/Env.tsx': 'export const k = process.env.MIA_SECRET;' }],
    ['MIA-SEC-006', { 'pages/Meta.tsx': 'export const k = import.meta.env.MIA_PRIVY_SECRET;' }],
    ['MIA-SEC-009', { 'lab/qualification.ts': "import { setStrategyStatus } from './lab.js';\nsetStrategyStatus();", 'ditas/tradeOutcomes.ts': '', 'ditas/evaluation.ts': '', 'ditas/evidenceChain.ts': '', 'ditas/reflect.ts': '', 'workers/reliability.ts': '', 'workers/effectiveness.ts': '', 'lab/overfitting.ts': '' }],
    ['MIA-SEC-011', { 'workers/w.ts': "import { evaluateRisk } from '../risk/gate.js';\nimport { ledger } from '../portfolio/ledger.js';\nledger(); evaluateRisk();", 'risk/gate.ts': 'export function evaluateRisk() {}', 'portfolio/ledger.ts': 'export function ledger() {}' }],
    ['MIA-SEC-012', { 'news/feed.ts': "import './relay.js';", 'news/relay.ts': "import { submitEntry } from '../exec/oms.js';", 'exec/oms.ts': 'export function submitEntry() {}' }],
  ] as const)('%s', (rule, files) => {
    expect(RULES[rule](tree(files)).length).toBeGreaterThan(0);
  });
});
