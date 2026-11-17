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
    expect(breadthWorker.evaluate(ctx({ universe: 100, advancers: 90, decliners: 10, asOf: now + 600_000 })).stance).toBe('ABSTAIN'); // future-dated

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

describe('market breadth input', () => {
  it('counts only tickers from the latest batch with a valid provider timestamp', async () => {
    const { market } = await import('../src/market/store.js'); const { marketBreadth } = await import('../src/market/bubbles.js');
    market.reset(); const now = Date.now(); market.tickersFetchedAt = now;
    const t = (sym: string, changePct: number, receivedAt: number, providerTs: number) => market.tickers.set(`crypto:binance:${sym}`, { instrumentId: `crypto:binance:${sym}`, symbol: sym, base: sym.replace('USDT', ''), quote: 'USDT', last: 1, bid: 1, ask: 1, changePct, quoteVolume: 5e6, high: 1, low: 1, open: 1, trades: 1, providerTs, receivedAt, source: 'binance' } as any);
    t('AAAUSDT', 2, now, now); t('BBBUSDT', -1, now, now);
    t('OLDUSDT', 5, now - 60_000, now - 60_000); // left over from an earlier batch
    t('FUTUSDT', 5, now, now + 600_000); // provider timestamp in the future
    t('STLUSDT', 5, now, now - 3_600_000); // provider timestamp an hour old
    expect(marketBreadth()).toMatchObject({ universe: 2, advancers: 1, decliners: 1, asOf: now });
  });
});
