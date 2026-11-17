import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { run } from '../src/db/db.js';
import { WORKERS } from '../src/workers/registry.js';
import { workerEffectiveness } from '../src/workers/effectiveness.js';
import type { WorkerContext } from '../src/workers/types.js';

const breadthWorker = WORKERS.find((w) => w.name === 'Market breadth')!;
const ctx = (breadth: WorkerContext['breadth']) => ({ breadth } as unknown as WorkerContext);

describe('worker effectiveness (registered ≠ productive)', () => {
  beforeEach(() => freshDb());
  it('market breadth uses real advance/decline data and abstains when it is thin or stale', () => {
    const now = Date.now();
    expect(breadthWorker.capability).toBe('DATA_DRIVEN');
    expect(breadthWorker.evaluate(ctx({ universe: 100, advancers: 70, decliners: 30, asOf: now })).stance).toBe('SUPPORT');
    expect(breadthWorker.evaluate(ctx({ universe: 100, advancers: 20, decliners: 80, asOf: now })).stance).toBe('OPPOSE');
    expect(breadthWorker.evaluate(ctx({ universe: 100, advancers: 45, decliners: 55, asOf: now })).stance).toBe('ABSTAIN');
    expect(breadthWorker.evaluate(ctx({ universe: 10, advancers: 9, decliners: 1, asOf: now })).reasons[0]).toMatch(/fewer than 30/);
    expect(breadthWorker.evaluate(ctx({ universe: 100, advancers: 90, decliners: 10, asOf: now - 600_000 })).reasons[0]).toMatch(/stale/);
    expect(breadthWorker.evaluate(ctx(undefined)).stance).toBe('ABSTAIN');
  });
  it('classifies every worker; provider-blocked and constant-rule workers are counted separately', () => {
    const e = workerEffectiveness();
    expect(e.summary.registered).toBe(100);
    expect(e.summary.dataDriven + e.summary.constantRule + e.summary.providerBlocked).toBe(100);
    expect(e.summary.providerBlocked).toBe(11); // 5 news roles awaiting providers + 6 on-chain roles
    expect(WORKERS.filter((w) => w.capability === 'CONSTANT_RULE').map((w) => w.name).sort()).toEqual(['Fee tier', 'Liquidation/leverage', 'Stop executable (spot stop)']);
    expect(e.summary.notYetEvaluated).toBe(100);
  });
  it('productivity is measured from recorded evaluations, not assumed', () => {
    const [a, b] = WORKERS.filter((w) => w.capability === 'DATA_DRIVEN');
    run('INSERT INTO worker_stats(worker_id, support, oppose, abstain, failed, updated_at) VALUES (?,?,?,?,?,?)', a.id, 3, 1, 6, 0, 1);
    run('INSERT INTO worker_stats(worker_id, support, oppose, abstain, failed, updated_at) VALUES (?,?,?,?,?,?)', b.id, 0, 0, 9, 0, 1);
    const e = workerEffectiveness(); const row = (id: string) => e.workers.find((w) => w.id === id)!;
    expect(row(a.id)).toMatchObject({ status: 'PRODUCTIVE', runs: 10, voteRate: 0.4 });
    expect(row(b.id)).toMatchObject({ status: 'ALWAYS_ABSTAINED', voteRate: 0 });
    expect(e.summary).toMatchObject({ productiveDataDriven: 1, alwaysAbstained: 1, notYetEvaluated: 98 });
  });
});
