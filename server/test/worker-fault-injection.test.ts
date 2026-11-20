import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { POOL, quarantined, releaseQuarantine } from '../src/workers/runtime.js';
import { WORKERS } from '../src/workers/registry.js';
import { market } from '../src/market/store.js';
import { decide } from '../src/decision/engine.js';
import { get } from '../src/db/db.js';
import { buildCertificate } from '../src/decision/certificate.js';
import type { WorkerDef } from '../src/workers/types.js';

/**
 * THINK slice 2 (MIA-THINK-015, 016, 028): worker fault injection through the REAL consensus + decision path.
 * A crashing worker must never crash the ensemble, must be quarantined after repeated faults, and a failed or
 * quarantined MANDATORY check must stop the candidate from reaching a trade state. The certificate must show it.
 */
const candidate = (id: string, last: number): any => ({ id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr-fault', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
  signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: ['fixture'] }, regime: 'TREND_UP', createdAt: Date.now() });
const byName = (n: string) => WORKERS.find((w) => w.name === n)!;

/** Make one worker throw for the duration of a test, restoring it (and its quarantine state) afterwards. */
const sabotaged: { w: WorkerDef; original: WorkerDef['evaluate'] }[] = [];
function sabotage(w: WorkerDef, how: 'throw' | 'garbage' = 'throw') {
  sabotaged.push({ w, original: w.evaluate });
  w.evaluate = how === 'throw' ? () => { throw new Error('injected fault'); } : () => ({ stance: 'MAYBE', features: {}, reasons: [] } as any);
}

describe('worker fault injection (real coordinator)', () => {
  beforeEach(() => { freshDb(); market.reset(); });
  afterEach(() => {
    for (const { w, original } of sabotaged.splice(0)) { w.evaluate = original; releaseQuarantine('owner', w.id); }
  });

  it('a crashing non-mandatory worker is counted as failed; the coordinator survives (MIA-THINK-015)', async () => {
    const w = WORKERS.find((x) => !x.mandatory && x.domain === 'trend')!; sabotage(w);
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 11 });
    const rec = await runConsensus(buildContext(candidate(inst.id, last)));
    expect(rec.workers.failed).toBe(1);
    expect(['STRONG_CONSENSUS', 'MIXED_CONSENSUS', 'NO_QUORUM', 'VETOED']).toContain(rec.state);
  });

  it('a crashing MANDATORY check means NO_QUORUM naming the check, and the decision cannot enter (MIA-THINK-016)', async () => {
    const w = byName('Round-trip cost in R'); expect(w.mandatory).toBe(true); sabotage(w);
    const { inst, last } = seedInstrument('XRPUSDT', { seed: 9 });
    const c = candidate(inst.id, last); const ctx = buildContext(c);
    const rec = await runConsensus(ctx);
    expect(rec.state).toBe('NO_QUORUM');
    expect(rec.reason_codes.join(' ')).toContain(`mandatory check ${w.id}`);
    const rep = decide(c, ctx, rec, null, 0);
    expect(rep.finalDecision).not.toBe('ENTER');
    expect(rep.direction).toBe('NO_POSITION');
  });

  it(`after ${POOL.quarantineAfterFailures} faults the worker is quarantined; still NO_QUORUM; the certificate shows it (MIA-THINK-028)`, async () => {
    const w = byName('Spread'); expect(w.mandatory).toBe(true); sabotage(w);
    const { inst, last } = seedInstrument('SOLUSDT', { seed: 5 });
    for (let i = 0; i < POOL.quarantineAfterFailures; i++) await runConsensus(buildContext(candidate(inst.id, last)));
    expect(quarantined.has(w.id)).toBe(true);

    const c = candidate(inst.id, last); const ctx = buildContext(c);
    const rec = await runConsensus(ctx);
    expect(rec.workers.quarantined).toBe(1); expect(rec.workers.failed).toBe(0); // quarantined workers are not even run
    expect(rec.state).toBe('NO_QUORUM');
    const rep = decide(c, ctx, rec, null, 0);
    expect(rep.finalDecision).not.toBe('ENTER');

    const row = get<{ report: string; consensus_id: string }>('SELECT report, consensus_id FROM decisions WHERE id=?', rep.id)!;
    const cons = get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', row.consensus_id)!.record;
    const cert = buildCertificate(row.report, cons);
    expect(cert.coverage.workers!.quarantined).toBe(1);
    expect(cert.verdict.noTradeReasons).toContain('QCI_NO_QUORUM');
    expect(cert.uncertainty.join(' ')).toMatch(/1 were quarantined/);
  });

  it('only the owner can release a quarantined worker; after release it runs again', async () => {
    const w = byName('Spread'); sabotage(w);
    const { inst, last } = seedInstrument('ADAUSDT', { seed: 4 });
    for (let i = 0; i < POOL.quarantineAfterFailures; i++) await runConsensus(buildContext(candidate(inst.id, last)));
    expect(quarantined.has(w.id)).toBe(true);
    expect(() => releaseQuarantine('bot', w.id)).toThrow(/only the owner/);
    expect(quarantined.has(w.id)).toBe(true);
    const { original } = sabotaged[0]; w.evaluate = original; // fix the worker, then the owner releases it
    releaseQuarantine('owner', w.id);
    const rec = await runConsensus(buildContext(candidate(inst.id, last)));
    expect(rec.workers.quarantined).toBe(0); expect(rec.workers.failed).toBe(0);
  });

  it('a worker returning a malformed result is rejected before aggregation, never counted as a vote (MIA-THINK-022)', async () => {
    const w = WORKERS.find((x) => !x.mandatory && x.domain === 'momentum')!; sabotage(w, 'garbage');
    const { inst, last } = seedInstrument('DOGEUSDT', { seed: 8 });
    const rec = await runConsensus(buildContext(candidate(inst.id, last)));
    expect(rec.workers.rejected_packets).toBe(1);
  });

  it('many simultaneous faults never crash consensus and never yield a trade state', async () => {
    const victims = WORKERS.filter((x) => x.domain !== 'onchain').filter((_, i) => i % 3 === 0); // a third of the pool
    victims.forEach((v) => sabotage(v));
    const { inst, last } = seedInstrument('LINKUSDT', { seed: 7 });
    const c = candidate(inst.id, last); const ctx = buildContext(c);
    const rec = await runConsensus(ctx);
    expect(rec.workers.failed).toBe(victims.length);
    expect(rec.state).not.toBe('STRONG_CONSENSUS');
    expect(decide(c, ctx, rec, null, 0).finalDecision).not.toBe('ENTER');
  });
});
