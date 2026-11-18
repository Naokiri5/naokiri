import { describe, it, expect } from 'vitest';
import { aggregate, responseRatio } from '../src/qci/coordinator.js';
import { WORKERS } from '../src/workers/registry.js';

/** R-12 (owner-approved): one input = one vote across all domains; only data-driven workers are evidence. */
const constantWorker = WORKERS.find((w) => w.capability === 'CONSTANT_RULE')!;
const blockedWorker = WORKERS.find((w) => w.capability === 'PROVIDER_BLOCKED')!;
const dataWorkers = WORKERS.filter((w) => w.capability === 'DATA_DRIVEN');
const pkt = (o: Partial<any>): any => ({ worker_id: 'fixture', evidence_domain: 'trend', dependency_group: 'g', stance: 'SUPPORT', ...o });
const all = new Set(['trend', 'momentum', 'volatility', 'flow', 'liquidity', 'structure', 'regime', 'news', 'risk', 'execution']);

describe('QCI vote counting (R-12)', () => {
  it('a dependency group shared by several domains votes once, in its first domain', () => {
    // The same 24h-ticker input appears in volatility, liquidity, structure and risk.
    const shared = ['volatility', 'liquidity', 'structure', 'risk'].map((d) => pkt({ evidence_domain: d, dependency_group: 'ticker.24h' }));
    const a = aggregate(shared, all);
    const by = Object.fromEntries(a.domains.map((d) => [d.domain, d]));
    expect(a.groups).toBe(1); // was 4 independent votes before
    expect(by.volatility.score).toBe(1); expect(by.volatility.support).toBe(4);
    for (const d of ['liquidity', 'structure', 'risk']) { expect(by[d].score).toBeNull(); expect(by[d].sharedGroups).toBe(1); expect(by[d].support).toBe(0); }
    // Weighted support reflects one domain's weight, not four.
    const four = aggregate(['volatility', 'liquidity', 'structure', 'risk'].map((d) => pkt({ evidence_domain: d, dependency_group: `own.${d}` })), all);
    expect(a.weightedSupport).toBeLessThan(four.weightedSupport);
  });
  it('constant-rule workers never count as evidence or as required-domain coverage', () => {
    const a = aggregate([pkt({ worker_id: constantWorker.id, evidence_domain: 'execution', dependency_group: 'fee.tier' })], all);
    const ex = a.domains.find((d) => d.domain === 'execution')!;
    expect(ex.support + ex.oppose).toBe(0); expect(ex.score).toBeNull(); expect(ex.constantRule).toBe(1);
    expect(a.weightedSupport).toBe(0);
  });
  it('response ratio counts only data-driven workers; blocked and constant workers neither help nor hurt', () => {
    const ids = [dataWorkers[0].id, dataWorkers[1].id, blockedWorker.id, constantWorker.id];
    const packets = [pkt({ worker_id: dataWorkers[0].id, stance: 'ABSTAIN' }), pkt({ worker_id: blockedWorker.id, stance: 'ABSTAIN' }), pkt({ worker_id: constantWorker.id })];
    expect(responseRatio(ids, packets)).toBe(0.5); // 1 of 2 data-driven workers answered (an abstain is an answer)
    expect(responseRatio([blockedWorker.id, constantWorker.id], packets)).toBe(0); // no data-driven workers: no quorum
  });
  it('independent groups inside one domain still average (unchanged behaviour)', () => {
    const a = aggregate([pkt({ dependency_group: 'a', stance: 'SUPPORT' }), pkt({ dependency_group: 'b', stance: 'OPPOSE' })], new Set(['trend']));
    expect(a.domains[0].score).toBe(0); expect(a.groups).toBe(2);
  });
});
