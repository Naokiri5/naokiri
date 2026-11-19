import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus, validatePacket, aggregate } from '../src/qci/coordinator.js';
import { dispatch } from '../src/workers/runtime.js';
import { WORKERS } from '../src/workers/registry.js';
import { EvidencePacket } from '../src/qci/schemas.js';
import { sign } from '../src/core/signing.js';
import { market } from '../src/market/store.js';
import { decide } from '../src/decision/engine.js';
import type { Candidate } from '../src/workers/types.js';

function candidate(id: string, last: number): Candidate {
  return { id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr1', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
    signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: [] }, regime: 'TREND_UP', createdAt: Date.now() };
}
describe('QCI (Part 29)', () => {
  beforeAll(() => { freshDb(); market.reset(); seedInstrument('BTCUSDT'); });
  it('every applicable worker returns a schema-valid, signed packet', async () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 11 });
    const ctx = buildContext(candidate(inst.id, last));
    const { eligible, results } = await dispatch(ctx);
    expect(WORKERS).toHaveLength(100);
    expect(eligible).toBe(94); // 6 on-chain workers not applicable to CEX spot
    for (const r of results) { expect('failed' in r).toBe(false); expect(EvidencePacket.safeParse((r as any).packet).success).toBe(true); }
  });
  it('rejects forged, replayed, and out-of-scope packets', async () => {
    const { inst, last } = seedInstrument('SOLUSDT', { seed: 5 });
    const c = candidate(inst.id, last); const { results } = await dispatch(buildContext(c));
    const good = results[0] as any;
    expect(typeof validatePacket(good, c.id)).toBe('object');
    expect(validatePacket(good, c.id)).toBe('REPLAY');
    const forged = { packet: { ...good.packet, packet_id: 'ev_forged0001', stance: 'SUPPORT' }, sig: good.sig };
    expect(validatePacket(forged, c.id)).toBe('SIGNATURE_INVALID');
    const other = { packet: { ...good.packet, packet_id: 'ev_other00001' } }; (other as any).sig = sign(other.packet);
    expect(validatePacket(other, 'cand_different')).toBe('SCOPE_MISMATCH');
    expect(validatePacket({ packet: { foo: 1 }, sig: 'x' }, c.id)).toBe('SCHEMA_INVALID');
  });
  it('dependency groups are not independent votes', () => {
    const base: any = { evidence_domain: 'trend', stance: 'SUPPORT' };
    const ten = Array.from({ length: 10 }, () => ({ ...base, dependency_group: 'same' }));
    const one = [{ ...base, dependency_group: 'same' }];
    const a = aggregate(ten, new Set(['trend'])), b = aggregate(one, new Set(['trend']));
    expect(a.weightedSupport).toBe(b.weightedSupport);
  });
  it('produces a consensus record with explicit state, expiry, and calibration label', async () => {
    const { inst, last } = seedInstrument('XRPUSDT', { seed: 9 });
    const rec = await runConsensus(buildContext(candidate(inst.id, last)));
    expect(['STRONG_CONSENSUS', 'MIXED_CONSENSUS', 'NO_QUORUM', 'VETOED']).toContain(rec.state);
    expect(rec.method.calibration).toBe('NOT_CALIBRATED');
    expect(Date.parse(rec.expires_at)).toBeGreaterThan(Date.parse(rec.created_at));
    expect(rec.challenge.map((c) => c.reviewer).sort()).toEqual(['BEAR', 'BULL', 'CONTRARIAN', 'DATA_AUDITOR', 'EXECUTION']);
  });
  it('asset-safety failure vetoes regardless of bullish evidence', async () => {
    const { inst, last } = seedInstrument('JUNKUSDT', { seed: 3, quoteVolume: 100_000 });
    const c = candidate(inst.id, last); const ctx = buildContext(c);
    const rec = await runConsensus(ctx);
    expect(rec.state).toBe('VETOED');
    const rep = decide(c, ctx, rec, null, 0);
    expect(rep.decision).toBe('REJECTED');
    expect(rep.finalDecision).toBe('REJECT');
  });
  it('no order book: consensus cannot reach a trade state on borrowed liquidity coverage (MA-03)', async () => {
    const { inst, last } = seedInstrument('DOTUSDT', { seed: 6 });
    market.deep.get(inst.id)!.book = null;
    const c = candidate(inst.id, last); const rec = await runConsensus(buildContext(c));
    expect(rec.method.id).toBe('domain-capped-weighted-v3');
    expect(['NO_QUORUM', 'VETOED']).toContain(rec.state);
  });
  it('D-06: a consensus that cannot be stored never permits a trade', async () => {
    const { run } = await import('../src/db/db.js');
    const { inst, last } = seedInstrument('LINKUSDT', { seed: 7 });
    run("CREATE TRIGGER block_consensus BEFORE INSERT ON consensus_records BEGIN SELECT RAISE(ABORT, 'disk full (test)'); END");
    try {
      const rec = await runConsensus(buildContext(candidate(inst.id, last)));
      expect(rec.state).toBe('NO_QUORUM');
      expect(rec.reason_codes.join()).toMatch(/CONSENSUS_NOT_PERSISTED/);
    } finally { run('DROP TRIGGER block_consensus'); }
  });
  it('stale data fails closed', async () => {
    const { inst, last } = seedInstrument('ADAUSDT', { seed: 4 });
    market.tickers.get(inst.id)!.receivedAt = Date.now() - 10 * 60_000;
    const c = candidate(inst.id, last); const ctx = buildContext(c);
    const rec = await runConsensus(ctx);
    expect(rec.state).toBe('VETOED');
    expect(decide(c, ctx, rec, null, 0).decision).toBe('INSUFFICIENT_DATA');
  });
});
