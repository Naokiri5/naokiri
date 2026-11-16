import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { all, get } from '../db/db.js';
import { currentPolicy } from '../risk/policy.js';
import { verifyAuditChain } from '../core/audit.js';
import { WORKERS } from '../workers/registry.js';
import { reconcile } from '../portfolio/calendar.js';

/** Part 12.7 release gates. Evidence-driven; manual gates can only be satisfied by humans outside this app. */
export interface Gate { id: string; name: string; status: 'PASS' | 'FAIL' | 'PENDING' | 'NOT_CERTIFIED' | 'NOT_IMPLEMENTED'; evidence: string }
export function releaseGates() {
  const g: Gate[] = [];
  const resPath = join(config.dataDir, 'qa', 'test-results.json');
  let tests: any = null; try { if (existsSync(resPath)) tests = JSON.parse(readFileSync(resPath, 'utf8')); } catch { /* */ }
  g.push({ id: 'G01', name: 'Critical frontend & backend workflows pass', status: tests ? (tests.numFailedTests === 0 ? 'PASS' : 'FAIL') : 'PENDING', evidence: tests ? `${tests.numPassedTests}/${tests.numTotalTests} automated tests passed (${new Date(tests.startTime).toISOString()})` : 'run `npm run qa` to record evidence' });
  g.push({ id: 'G02', name: 'Market data sources, timestamps & stale-data handling verified', status: tests ? (tests.numFailedTests === 0 ? 'PASS' : 'FAIL') : 'PENDING', evidence: 'quality.test.ts + live.providers.test.ts (opt-in live run)' });
  g.push({ id: 'G03', name: 'All 100 worker roles tested; health observable', status: WORKERS.length === 100 && tests?.numFailedTests === 0 ? 'PASS' : 'PENDING', evidence: `${WORKERS.length} workers registered; qci.test.ts exercises every worker` });
  g.push({ id: 'G04', name: 'Trader Joe factuality & authorization tests', status: tests?.numFailedTests === 0 ? 'PASS' : 'PENDING', evidence: 'joe.test.ts (authorization boundaries). Factuality of LLM answers needs human review.' });
  const rec = reconcile();
  g.push({ id: 'G05', name: 'Entries, exits, fills, fees & PnL reconcile', status: rec.ok ? 'PASS' : 'FAIL', evidence: rec.detail });
  const ac = verifyAuditChain();
  g.push({ id: 'G06', name: 'Audit log integrity', status: ac.ok ? 'PASS' : 'FAIL', evidence: `${ac.entries} hash-chained entries${ac.ok ? ' verified' : `, broken at ${ac.brokenAt}`}` });
  g.push({ id: 'G07', name: 'Wallet permissions & signing isolation security tests', status: 'NOT_IMPLEMENTED', evidence: 'No signer exists in this build (by design). Requires isolated signer + external security test.' });
  g.push({ id: 'G08', name: 'No unresolved critical/high security findings', status: 'NOT_CERTIFIED', evidence: 'Requires independent security review.' });
  g.push({ id: 'G09', name: 'Emergency shutdown & recovery procedures pass', status: tests?.numFailedTests === 0 ? 'PASS' : 'PENDING', evidence: 'oms.test.ts emergency semantics' });
  const first = get<{ t: number }>("SELECT MIN(opened_at) t FROM positions")?.t;
  const days = first ? (Date.now() - first) / 86400_000 : 0; const closed = get<{ n: number }>("SELECT COUNT(*) n FROM positions WHERE status='CLOSED'")!.n;
  g.push({ id: 'G10', name: '30-day paper-trading evaluation', status: days >= 30 && closed >= 50 ? 'PASS' : 'PENDING', evidence: `${days.toFixed(1)} days since first paper trade, ${closed} closed trades (needs ≥30 days, ≥50 trades)` });
  g.push({ id: 'G11', name: 'Risk policy reviewed and accepted by owner', status: currentPolicy() ? 'PASS' : 'PENDING', evidence: currentPolicy() ? `policy v${currentPolicy()!.version}` : 'not accepted' });
  g.push({ id: 'G12', name: 'Live venue adapter + transaction firewall implemented', status: 'NOT_IMPLEMENTED', evidence: 'Deliberately absent until gates G07–G10 pass.' });
  g.push({ id: 'G13', name: 'Independent Release Auditor go/no-go', status: 'NOT_CERTIFIED', evidence: 'Human sign-off required.' });
  g.push({ id: 'G14', name: 'Owner explicit authorization for live execution', status: 'PENDING', evidence: 'Can only be recorded after all other gates pass.' });
  const liveAllowed = g.every((x) => x.status === 'PASS');
  return { gates: g, liveAllowed, summary: `${g.filter((x) => x.status === 'PASS').length}/${g.length} gates passed — live execution ${liveAllowed ? 'ELIGIBLE' : 'LOCKED'}` };
}
export const openDefects = () => all('SELECT * FROM journal WHERE kind=? ORDER BY ts DESC LIMIT 50', 'RISK');
