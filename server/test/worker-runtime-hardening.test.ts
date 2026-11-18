import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { runOne, POOL } from '../src/workers/runtime.js';
import { WORKERS } from '../src/workers/registry.js';
import { market } from '../src/market/store.js';
import type { WorkerDef } from '../src/workers/types.js';

/** Squads C and J (100-agent audit): worker deadline, mandatory checks, adverse-evidence and crash fixes. */
const candidate = (id: string, last: number, over: any = {}): any => ({ id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr1', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
  signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: [], ...over }, regime: 'TREND_UP', createdAt: Date.now() });
const byName = (n: string) => WORKERS.find((w) => w.name === n)!;

describe('worker runtime and evidence hardening', () => {
  beforeEach(() => { freshDb(); market.reset(); });
  it('C-03/J-01: a synchronous worker slower than the deadline is a DEADLINE failure', async () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 11 });
    const slow: WorkerDef = { ...WORKERS[0], id: 'W-TST-99', evaluate: () => { const end = performance.now() + POOL.deadlineMs + 50; while (performance.now() < end) { /* busy */ } return { stance: 'SUPPORT', features: {}, reasons: ['late'] }; } };
    const r = await runOne(slow, buildContext(candidate(inst.id, last)));
    expect(r).toMatchObject({ failed: 'DEADLINE' }); // used to return the late result
  });
  it('C-01: an abstaining mandatory check (regime unknown) means NO_QUORUM, naming the check', async () => {
    const { inst, last } = seedInstrument('ADAUSDT', { seed: 5 });
    const c = candidate(inst.id, last); c.regime = 'UNKNOWN';
    const rec = await runConsensus(buildContext(c));
    if (rec.state !== 'VETOED') { // a safety veto would take precedence; the seeded asset is verified, so expect NO_QUORUM
      expect(rec.state).toBe('NO_QUORUM');
      expect(rec.reason_codes.join()).toMatch(/mandatory check W-REG-\d+/);
    } else throw new Error(`unexpected veto: ${rec.reason_codes.join('; ')}`);
  });
  it('C-06: a book that cannot absorb the intended size is adverse evidence with a veto, not "no data"', () => {
    const w = byName('Impact at intended size');
    const ctx: any = { impact: { filledFully: false, impactBps: Infinity, spreadBps: 2 } };
    expect(w.evaluate(ctx)).toMatchObject({ stance: 'OPPOSE', veto: true });
  });
  it('C-07: the cost worker never supports a stop at or above entry', async () => {
    const { inst, last } = seedInstrument('SOLUSDT', { seed: 3 });
    const ctx = buildContext(candidate(inst.id, last, { stop: last * 1.01 }));
    expect(byName('Round-trip cost in R').evaluate(ctx)).toMatchObject({ stance: 'OPPOSE', veto: true });
  });
  it('C-04: workers abstain instead of throwing on missing targets or safety checks', async () => {
    const { inst, last } = seedInstrument('XRPUSDT', { seed: 4 });
    const ctx: any = buildContext(candidate(inst.id, last, { targets: [] }));
    ctx.safety = { ...ctx.safety, checks: undefined };
    for (const w of WORKERS) expect(() => w.evaluate(ctx), w.id).not.toThrow();
  });
});
