import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { buildContext } from '../src/market/scanner.js';
import { runConsensus, aggregate } from '../src/qci/coordinator.js';
import { discountSupport, storedSupportDiscounts, SUPPORT_DISCOUNT_KEY, type StoredSupportDiscounts } from '../src/qci/supportDiscount.js';
import { WORKERS, DOMAINS } from '../src/workers/registry.js';
import { setSetting } from '../src/core/settings.js';
import { market } from '../src/market/store.js';
import { get, run, P } from '../src/db/db.js';
import type { EvidencePacket } from '../src/qci/schemas.js';
import type { Candidate } from '../src/workers/types.js';

function candidate(id: string, last: number): Candidate {
  return { id: `cand_${Math.random().toString(36).slice(2, 10)}`, eventId: 'ev1', traceId: 'tr1', instrumentId: id, symbol: id.split(':')[2], base: id.split(':')[2].replace('USDT', ''), market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h',
    signal: { direction: 'long', entryRef: last, stop: last * 0.97, targets: [{ r: 1.5, fraction: 0.5 }, { r: 3, fraction: 0.5 }], maxHoldBars: 48, trailAfterR: 1, trigger: 't', invalidation: 'i', reasons: [] }, regime: 'TREND_UP', createdAt: Date.now() };
}
const discountAll = (version = (w: (typeof WORKERS)[number]) => w.version): StoredSupportDiscounts =>
  ({ computedAt: 1, workers: WORKERS.map((w) => ({ workerId: w.id, workerVersion: version(w), supports: 30, winRateUpper: 0.1, baseWinRateLower: 0.4 })) });

/** Deterministic generator, so the property check is reproducible. */
function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }

describe('QCI support discount', () => {
  beforeEach(() => { freshDb(); market.reset(); });

  it('never raises support, never touches the input packets, and keeps OPPOSE and vetoes', () => {
    const r = rng(7); const stances = ['SUPPORT', 'OPPOSE', 'ABSTAIN'] as const;
    for (let round = 0; round < 500; round++) {
      const packets = Array.from({ length: 1 + Math.floor(r() * 40) }, (_, i) => ({ worker_id: `W${i}`, worker_version: '1', evidence_domain: DOMAINS[Math.floor(r() * DOMAINS.length)],
        dependency_group: `g${Math.floor(r() * 6)}`, stance: stances[Math.floor(r() * 3)], veto: r() < 0.05 })) as unknown as EvidencePacket[];
      const before = JSON.stringify(packets);
      const stored = { computedAt: 1, workers: packets.filter(() => r() < 0.4).map((p) => ({ workerId: p.worker_id, workerVersion: '1', supports: 30, winRateUpper: 0.1, baseWinRateLower: 0.4 })) };
      const { scored, discounted } = discountSupport(packets, stored);
      const domains = new Set(DOMAINS);
      const a = aggregate(packets, domains), b = aggregate(scored, domains);
      expect(b.weightedSupport).toBeLessThanOrEqual(a.weightedSupport + 1e-12);
      expect(b.weightedOpposition).toBeGreaterThanOrEqual(a.weightedOpposition - 1e-12);
      const missing = (x: typeof a) => x.domains.filter((d) => d.required && d.support + d.oppose === 0).map((d) => d.domain);
      expect(missing(b)).toEqual(expect.arrayContaining(missing(a)));
      expect(JSON.stringify(packets)).toBe(before);
      expect(scored.filter((p) => p.veto).length).toBe(packets.filter((p) => p.veto).length);
      expect(scored.filter((p) => p.stance === 'OPPOSE').length).toBe(packets.filter((p) => p.stance === 'OPPOSE').length);
      expect(discounted.length).toBe(packets.filter((p) => p.stance === 'SUPPORT' && stored.workers.some((w) => w.workerId === p.worker_id)).length);
    }
  });

  it('scores discounted SUPPORT as ABSTAIN, records it, and stores the signed packets unchanged', async () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 11 });
    const baseline = await runConsensus(buildContext(candidate(inst.id, last)));
    expect(baseline.support_discounts).toEqual([]);
    setSetting(SUPPORT_DISCOUNT_KEY, discountAll());
    const rec = await runConsensus(buildContext(candidate(inst.id, last)));
    expect(rec.method.id).toBe('domain-capped-weighted-v2');
    expect(rec.weighted_support).toBe(0);
    expect(rec.state).not.toBe('STRONG_CONSENSUS');
    expect(rec.support_discounts!.length).toBeGreaterThan(0);
    const stored = P<{ packets: EvidencePacket[] }>(get<{ record: string }>('SELECT record FROM consensus_records WHERE id=?', rec.consensus_id)!.record);
    expect(stored.packets.filter((p) => p.stance === 'SUPPORT').length).toBe(rec.support_discounts!.length);
  });

  it('keeps a veto when every worker is discounted', async () => {
    setSetting(SUPPORT_DISCOUNT_KEY, discountAll());
    const { inst, last } = seedInstrument('JUNKUSDT', { seed: 3, quoteVolume: 100_000 });
    expect((await runConsensus(buildContext(candidate(inst.id, last)))).state).toBe('VETOED');
  });

  it('applies only to the measured worker version, and ignores a missing or malformed list', async () => {
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 11 });
    setSetting(SUPPORT_DISCOUNT_KEY, discountAll(() => '0.0.0-old'));
    expect((await runConsensus(buildContext(candidate(inst.id, last)))).support_discounts).toEqual([]);
    run('UPDATE settings SET value=? WHERE key=?', '{not json', SUPPORT_DISCOUNT_KEY);
    expect(storedSupportDiscounts()).toBeNull();
    expect((await runConsensus(buildContext(candidate(inst.id, last)))).support_discounts).toEqual([]);
    setSetting(SUPPORT_DISCOUNT_KEY, { computedAt: 1, workers: [{ workerId: 'W', workerVersion: 1 }] });
    expect(storedSupportDiscounts()).toBeNull();
  });
});
