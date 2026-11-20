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
    expect(a.groups).toBe(1); // was 4 independent votes before R-12
    expect(by.volatility.score).toBe(1);
    // v3 (MA-03): each domain's counts are its OWN packets (coverage); only the credited domain carries a score.
    for (const d of ['volatility', 'liquidity', 'structure', 'risk']) expect(by[d].support).toBe(1);
    for (const d of ['liquidity', 'structure', 'risk']) { expect(by[d].score).toBeNull(); expect(by[d].sharedGroups).toBe(1); }
    // Weighted support reflects one domain's weight, not four.
    const four = aggregate(['volatility', 'liquidity', 'structure', 'risk'].map((d) => pkt({ evidence_domain: d, dependency_group: `own.${d}` })), all);
    expect(a.weightedSupport).toBeLessThan(four.weightedSupport);
  });
  it('MA-03: another domain\'s worker can never cover a required domain', () => {
    // Depth book unavailable: liquidity's own worker abstains; an execution worker in the shared `cross` group supports.
    const a = aggregate([
      pkt({ worker_id: 'W-LIQ-08', evidence_domain: 'liquidity', dependency_group: 'cross', stance: 'ABSTAIN' }),
      pkt({ worker_id: 'W-EXE-07', evidence_domain: 'execution', dependency_group: 'cross', stance: 'SUPPORT' }),
    ], all);
    const by = Object.fromEntries(a.domains.map((d) => [d.domain, d]));
    expect(by.liquidity.support + by.liquidity.oppose).toBe(0); // was 1: liquidity "covered" by execution's packet
    expect(by.execution.support).toBe(1); expect(by.execution.score).toBe(1); // the vote goes to the domain that actually voted
    expect(a.groups).toBe(1);
  });
  it('MA-12: a group is scored only from its credited domain — no cross-domain averaging', () => {
    const a = aggregate([
      pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'book', stance: 'OPPOSE' }),
    ], all);
    const by = Object.fromEntries(a.domains.map((d) => [d.domain, d]));
    expect(by.flow.score).toBe(1);              // was 0: liquidity's OPPOSE was averaged into flow's vote
    expect(by.liquidity.oppose).toBe(1);        // liquidity's adverse evidence still counts as its own coverage
    expect(a.groups).toBe(1);
  });
  it('an abstain-only domain does not claim a group away from the domain that voted', () => {
    const a = aggregate([
      pkt({ evidence_domain: 'trend', dependency_group: 'macd.1h', stance: 'ABSTAIN' }),
      pkt({ evidence_domain: 'momentum', dependency_group: 'macd.1h', stance: 'OPPOSE' }),
    ], all);
    const by = Object.fromEntries(a.domains.map((d) => [d.domain, d]));
    expect(by.momentum.score).toBe(-1); expect(by.trend.score).toBeNull(); expect(by.trend.sharedGroups).toBe(1);
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

describe('100-agent audit, Squad D findings', () => {
  it('D-01: adverse evidence from a domain whose group vote went elsewhere still counts as opposition', () => {
    // Real registry shape: the `book` group is credited to flow (first in DOMAINS); liquidity's own readings oppose.
    const a = aggregate([
      pkt({ worker_id: 'W-FLW-10', evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' }),
      ...['W-LIQ-01', 'W-LIQ-02', 'W-LIQ-03', 'W-LIQ-07'].map((id) => pkt({ worker_id: id, evidence_domain: 'liquidity', dependency_group: 'book', stance: 'OPPOSE' })),
    ], all);
    const by = Object.fromEntries(a.domains.map((d) => [d.domain, d]));
    expect(a.weightedOpposition).toBeGreaterThan(0);   // was 0: four adverse liquidity readings vanished
    expect(by.liquidity.score).toBe(-1);                 // shown as liquidity's (adverse) reading
    expect(a.groups).toBe(1);                            // still one vote for the group
    // R-02: opposition is bounded and the same adverse group is not double counted beyond each domain's weight.
    const both = aggregate([
      pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'OPPOSE' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'book', stance: 'OPPOSE' }),
      ...['trend', 'momentum', 'volatility', 'structure', 'regime', 'news', 'risk', 'execution'].flatMap((d) => [
        pkt({ evidence_domain: d, dependency_group: `own.${d}`, stance: 'OPPOSE' }),
        pkt({ evidence_domain: d, dependency_group: 'book', stance: 'OPPOSE' }),
      ]),
    ], all);
    expect(both.weightedOpposition).toBeLessThanOrEqual(1);
    expect(both.weightedOpposition + both.weightedSupport).toBeLessThanOrEqual(1 + 1e-12);
    // Supportive readings in a credited-elsewhere group are NOT double counted.
    const b = aggregate([
      pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'book', stance: 'SUPPORT' }),
    ], all);
    const one = aggregate([pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' })], all);
    expect(b.weightedSupport).toBe(one.weightedSupport);
  });
  it('CodeRabbit #45: supportive votes in another group cannot erase a domain\'s adverse shared evidence', () => {
    // flow/book supports (the group is credited to flow), liquidity/book opposes, liquidity/cross supports.
    const mixed = aggregate([
      pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'book', stance: 'OPPOSE' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'cross', stance: 'SUPPORT' }),
    ], all);
    const withoutAdverse = aggregate([
      pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'cross', stance: 'SUPPORT' }),
    ], all);
    expect(mixed.weightedOpposition).toBeGreaterThan(0);                            // was 0: the cross support filled liquidity's room
    expect(mixed.weightedSupport).toBeLessThan(withoutAdverse.weightedSupport);     // the adverse reading now weighs against support
    expect(mixed.weightedOpposition + mixed.weightedSupport).toBeLessThanOrEqual(1 + 1e-12);
    // Shared SUPPORT is still never counted twice: a supportive shadow adds nothing.
    const supportiveShadow = aggregate([
      pkt({ evidence_domain: 'flow', dependency_group: 'book', stance: 'SUPPORT' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'book', stance: 'SUPPORT' }),
      pkt({ evidence_domain: 'liquidity', dependency_group: 'cross', stance: 'SUPPORT' }),
    ], all);
    expect(supportiveShadow.weightedSupport).toBe(withoutAdverse.weightedSupport);
  });
  it('D-03: duplicate packets from one worker cannot inflate the response ratio', () => {
    const many = Array.from({ length: 10 }, () => pkt({ worker_id: dataWorkers[0].id }));
    expect(responseRatio([dataWorkers[0].id, dataWorkers[1].id], many)).toBe(0.5); // was 5
  });
});
