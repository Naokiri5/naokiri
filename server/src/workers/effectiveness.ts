import { all } from '../db/db.js';
import { WORKERS } from './registry.js';

/**
 * Honest worker accounting (MIA 4.2 Finding A). "Registered" is not "productive":
 * - capability comes from the definition (DATA_DRIVEN / CONSTANT_RULE / PROVIDER_BLOCKED);
 * - productivity is measured from recorded evaluations (worker_stats): a worker is PRODUCTIVE only if it has cast at
 *   least one SUPPORT or OPPOSE vote, ALWAYS_ABSTAINED if it has run but never voted, NOT_YET_EVALUATED otherwise.
 * Constant-rule workers vote by construction and add no market information; they are reported separately so their
 * votes are never mistaken for independent confirmation. Since R-12 (coordinator v1.1.0) the QCI coordinator itself counts
 * only DATA_DRIVEN workers as evidence and counts each dependency group once across domains.
 */
export function workerEffectiveness() {
  const stats = new Map(all<{ worker_id: string; support: number; oppose: number; abstain: number; failed: number }>('SELECT * FROM worker_stats').map((s) => [s.worker_id, s]));
  const rows = WORKERS.map((w) => {
    const s = stats.get(w.id); const runs = s ? s.support + s.oppose + s.abstain + s.failed : 0;
    const status = !s || runs === 0 ? 'NOT_YET_EVALUATED' : s.support + s.oppose > 0 ? 'PRODUCTIVE' : 'ALWAYS_ABSTAINED';
    return { id: w.id, name: w.name, domain: w.domain, capability: w.capability, status, runs, voteRate: runs ? (s!.support + s!.oppose) / runs : null, failed: s?.failed ?? 0 };
  });
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return {
    summary: {
      registered: rows.length,
      dataDriven: count((r) => r.capability === 'DATA_DRIVEN'),
      constantRule: count((r) => r.capability === 'CONSTANT_RULE'),
      providerBlocked: count((r) => r.capability === 'PROVIDER_BLOCKED'),
      productiveDataDriven: count((r) => r.capability === 'DATA_DRIVEN' && r.status === 'PRODUCTIVE'),
      alwaysAbstained: count((r) => r.status === 'ALWAYS_ABSTAINED'),
      notYetEvaluated: count((r) => r.status === 'NOT_YET_EVALUATED'),
    },
    workers: rows,
    note: 'Counts are measured from recorded evaluations. Consensus thresholds are research defaults, not calibrated probabilities.',
  };
}
