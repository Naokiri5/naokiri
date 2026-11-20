import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { freshDb, seedInstrument, ownerSetupPayload } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus } from '../src/qci/coordinator.js';
import { market } from '../src/market/store.js';
import { decide } from '../src/decision/engine.js';
import { run, get } from '../src/db/db.js';
import { replayDecision, ReplayError } from '../src/ditas/replay.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import { readFileSync } from 'node:fs';

/** THINK track A (MIA-THINK-003, 010, 075): recorded decisions replay deterministically from frozen DITAS snapshots. */
const candidate = (id: string, last: number): any => ({ id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr-replay', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
  signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: ['fixture'] }, regime: 'TREND_UP', createdAt: Date.now() });
async function recordDecision(symbol: string, seed: number, opts: any = {}) {
  const { inst, last } = seedInstrument(symbol, { seed, ...opts });
  const c = candidate(inst.id, last); const ctx = buildContext(c);
  return { rep: decide(c, ctx, await runConsensus(ctx), null, 0), inst };
}

describe('Decision evidence replay from DITAS snapshots', () => {
  beforeEach(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });

  it('a recorded decision replays to the same consensus evidence (REPRODUCED)', async () => {
    const { rep } = await recordDecision('ETHUSDT', 11);
    const r = replayDecision(rep.id);
    expect(r.snapshotVerified).toBe(true);
    expect(r.differences).toEqual([]);
    expect(r.status).toBe('REPRODUCED');
    expect(r.compared.workersEvaluated).toBeGreaterThan(80);
    expect(r.evaluationClock).toBeTypeOf('number');
  });

  it('vetoed and stale decisions also reproduce, including the veto set', async () => {
    const { rep: vetoed } = await recordDecision('JUNKUSDT', 3, { quoteVolume: 100_000 });
    const a = replayDecision(vetoed.id);
    expect(a.status).toBe('REPRODUCED'); expect(a.vetoes.recorded.length).toBeGreaterThan(0); expect(a.vetoes.replayed).toEqual(a.vetoes.recorded);
    const { inst, last } = seedInstrument('ADAUSDT', { seed: 4 });
    market.tickers.get(inst.id)!.receivedAt = Date.now() - 10 * 60_000;
    const c = candidate(inst.id, last); const ctx = buildContext(c); const stale = decide(c, ctx, await runConsensus(ctx), null, 0);
    expect(replayDecision(stale.id).status).toBe('REPRODUCED');
  });

  it('no look-ahead: changing the live market after the decision does not change the replay (MIA-THINK-003)', async () => {
    const { rep, inst } = await recordDecision('SOLUSDT', 5);
    const before = replayDecision(rep.id);
    market.tickers.get(inst.id)!.last *= 0.5;            // live data moves on
    market.deep.get(inst.id)!.book = null;
    market.deep.get(inst.id)!.engines['1h'].candles.splice(0);
    const after = replayDecision(rep.id);
    expect(after.status).toBe('REPRODUCED');
    expect(after.weighted).toEqual(before.weighted);
  });

  it('replay is deterministic over time: the evaluation clock comes from the record, not the wall clock', async () => {
    const { rep } = await recordDecision('XRPUSDT', 9);
    const a = replayDecision(rep.id);
    const realNow = Date.now; Date.now = () => realNow() + 24 * 3600_000; // replay a day later
    try { expect(replayDecision(rep.id)).toEqual(a); } finally { Date.now = realNow; }
  });

  it('a tampered snapshot is refused (NOT_REPLAYABLE), never replayed', async () => {
    const { rep } = await recordDecision('DOGEUSDT', 8);
    const ev = get<{ snapshot_id: string }>("SELECT snapshot_id FROM ditas_events WHERE decision_id=? AND kind='DECISION'", rep.id)!;
    const tamper = "UPDATE ditas_snapshots SET payload = replace(payload, '\"regime\"', '\"regimE\"') WHERE id=?";
    expect(() => run(tamper, ev.snapshot_id)).toThrow(/DITAS records are immutable/); // first line of defence: DB trigger
    // An attacker with file access bypasses the trigger; the replay's own hash check must still refuse.
    run('DROP TRIGGER ditas_snapshots_no_update');
    try { run(tamper, ev.snapshot_id); } finally {
      run("CREATE TRIGGER ditas_snapshots_no_update BEFORE UPDATE ON ditas_snapshots BEGIN SELECT RAISE(ABORT, 'DITAS records are immutable'); END");
    }
    const r = replayDecision(rep.id);
    expect(r).toMatchObject({ status: 'NOT_REPLAYABLE', snapshotVerified: false });
    expect(r.reasons.join()).toMatch(/hash does not match/);
  });

  it('a corrupted recorded consensus is detected as DIVERGED, with the differing domain named', async () => {
    const { rep } = await recordDecision('LINKUSDT', 7);
    const row = get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', rep.consensus.id)!;
    const rec = JSON.parse(row.record); rec.domains[0].support += 3; rec.weighted_support += 0.5;
    run('UPDATE consensus_records SET record=? WHERE id=?', JSON.stringify(rec), rep.consensus.id);
    const r = replayDecision(rep.id);
    expect(r.status).toBe('DIVERGED');
    expect(r.differences).toEqual(expect.arrayContaining([expect.objectContaining({ domain: rec.domains[0].domain, field: 'support' })]));
  });

  it('unknown decisions are a 404-style error', () => { expect(() => replayDecision('dec_nope')).toThrow(ReplayError); });

  it('replay has no side effects and imports nothing that can trade (static)', () => {
    const src = readFileSync(new URL('../src/ditas/replay.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\brun\(|['"`](INSERT|UPDATE|DELETE)\s|\bsign\(|runOne|flushWorkerStats|releaseQuarantine|quarantined\.(add|delete)/);
    expect(src).not.toMatch(/from '\.\.\/(exec|portfolio|wallet|risk)\//);
  });
});

describe('GET /api/decisions/:id/replay', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = ''; let id = '';
  beforeEach(async () => {
    if (app) return;
    freshDb(); market.reset(); failureGate.reset(); seedInstrument('BTCUSDT');
    id = (await recordDecision('ETHUSDT', 11)).rep.id;
    app = await buildApp();
    cookie = String((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: { 'content-type': 'application/json' }, payload: ownerSetupPayload('replay route owner') })).headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app?.close(); });
  it('owner-only, read-only, 404 for unknown', async () => {
    expect((await app.inject({ url: `/api/decisions/${id}/replay` })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/decisions/dec_nope/replay', headers: { cookie } })).statusCode).toBe(404);
    const r = await app.inject({ url: `/api/decisions/${id}/replay`, headers: { cookie } });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ status: 'REPRODUCED', decisionId: id });
  });
});
