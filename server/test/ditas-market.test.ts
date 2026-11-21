import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprint, compareFingerprints } from '../src/ditas/fingerprint.js';
import { returnHealth, strategyPassports } from '../src/ditas/passports.js';
import { FeatureEngine } from '../src/features/indicators.js';
import type { WorkerContext } from '../src/workers/types.js';
import { freshDb, synthCandles } from './helpers.js';
import { run, get, J } from '../src/db/db.js';
import { strategyStats } from '../src/lab/lab.js';

const H = 3_600_000, T = 400 * H;
function context(): WorkerContext {
  const engine = new FeatureEngine(); engine.ingest(synthCandles(400, { t0: 0, seed: 5 }));
  return {
    candidate: { id: 'candidate', eventId: 'event', traceId: 'trace', instrumentId: 'crypto:binance:TESTUSDT', symbol: 'TESTUSDT', base: 'TEST', market: 'crypto', venue: 'binance', strategyId: 'trend_pullback', strategyVersion: '1.0.0', interval: '1h', regime: 'RANGE', createdAt: T,
      signal: { direction: 'long', entryRef: 100, stop: 95, targets: [{ r: 2, fraction: 1 }], maxHoldBars: 24, trailAfterR: null, trigger: 'fixture', invalidation: 'fixture', reasons: ['fixture'] } },
    f: { '1h': engine.last }, btc1h: null, btc4h: null,
    ticker: { last: 100, changePct: 0, quoteVolume: 1e6, trades: 1000, high: 102, low: 98 },
    impact: { spreadBps: 2, impactBps: 5, depth1pct: 100000, filledFully: true, bookImbalance: 0.5 },
    intendedNotional: 1000, feeRate: 0.001,
    quality: { status: 'OK', quoteAgeMs: 0, candleAgeMs: 0, bookAgeMs: 0, sources: ['fixture'], independentSources: 1, maxDeviationPct: null, issues: [] },
    safety: { status: 'PASS', eligibleForAutomation: true, reasons: [], checks: [] } as unknown as WorkerContext['safety'],
    news: null, prints: null, corrToBtc: null, strategyStats: null,
  };
}

describe('market DNA', () => {
  it('is deterministic, finite, normalized, explicit about missing context and pure', () => {
    const ctx = context(), before = structuredClone(ctx), result = fingerprint(ctx);
    expect(result).toEqual(fingerprint(ctx)); expect(ctx).toEqual(before);
    expect(result).toMatchObject({ version: 'market-dna-v1', asOf: T, instrumentId: ctx.candidate.instrumentId });
    expect(result.missing).toEqual(expect.arrayContaining(['macro', 'fundamentals', 'correlationToBtc']));
    for (const value of Object.values(result.metrics)) if (value != null) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
  });
  it('does not include unclosed feature observations or accept a timestamp before capture', () => {
    const ctx = context(); ctx.f['1h']!.t = T;
    expect(fingerprint(ctx).metrics.momentum).toBeNull();
    expect(fingerprint(ctx).regime).toBe('UNKNOWN');
    expect(() => fingerprint(ctx, T - 1)).toThrow(/precedes/);
  });
  it('compares common observations and reports coverage without treating missing as zero', () => {
    const f = fingerprint(context()), compared = compareFingerprints(f, structuredClone(f));
    expect(compared.similarity).toBe(1); expect(compared.coverage).toBeLessThan(1);
    const sparse = { ...f, metrics: { ...f.metrics } };
    for (const k of Object.keys(sparse.metrics)) sparse.metrics[k] = null;
    sparse.metrics.spread = 0;
    expect(compareFingerprints(f, sparse)).toMatchObject({ similarity: null, comparable: false });
    expect(compareFingerprints(f, { ...f, dataQuality: 'FAIL' }).similarity).toBeNull();
  });
  it('cannot compare different normalization versions or timeframes', () => {
    const f = fingerprint(context());
    expect(compareFingerprints(f, { ...f, timeframe: '4h' }).similarity).toBeNull();
    expect(compareFingerprints(f, { ...f, version: 'future' as any }).similarity).toBeNull();
  });
});

describe('strategy passports and current-version health', () => {
  beforeEach(() => freshDb(false));
  it('maps lifecycle read-only, publishes rules and keeps empty health unknown', () => {
    const p = strategyPassports()[0];
    expect(p).toMatchObject({ id: 'trend_pullback', version: '1.0.0', currentStatus: 'RESEARCH', ditasState: 'RESEARCH' });
    expect(p.rules.entry.length).toBeGreaterThan(0);
    expect(p.paperHealth).toMatchObject({ status: 'INSUFFICIENT_SAMPLE', expectancyR: null, samples: 0 });
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', p.id)!.status).toBe('RESEARCH');
  });
  it('does not mix current-version OOS performance with a newer old-version backtest', () => {
    const result = (version: string, r: number) => ({ strategyVersion: version, trades: [{ segment: 'OOS', entryT: 1, exitT: 2, entry: 100, exit: 100 + r, r, bars: 1 }] });
    run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)', 'current', 'trend_pullback', 1, 'fixture', '1h', J(result('1.0.0', 2)));
    run('INSERT INTO backtests(id,strategy_id,created_at,instrument,interval,result) VALUES (?,?,?,?,?,?)', 'old', 'trend_pullback', 2, 'fixture', '1h', J(result('0.9.0', -9)));
    expect(strategyStats('trend_pullback')).toMatchObject({ trades: 1, expectancyR: 2 });
  });
  it('excludes legacy and mismatched paper versions instead of certifying them', () => {
    const insert = (id: string, version: string | null, r: number) => {
      const decision = version == null ? null : `d-${id}`;
      if (decision) run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)', decision, id, 'fixture', 'crypto', 'LONG', 'trend_pullback', 'PAPER_TRADE', 1, J({ strategy: { version } }));
      run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk,decision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, 'paper-bot', 'fixture', 'crypto', 'LONG', 'trend_pullback', 0, 100, 95, 95, '{}', 'CLOSED', 1, 2, r * 5, 0, 5, decision);
    };
    insert('known', '1.0.0', 1); insert('legacy', null, -10); insert('old', '0.9.0', 20);
    const health = strategyPassports()[0].paperHealth;
    expect(health).toMatchObject({ samples: 1, expectancyR: 1, excludedUnknownVersion: 1, excludedOtherVersion: 1, status: 'INSUFFICIENT_SAMPLE' });
    expect(health.expectancyCi95).toBeNull();
  });
  it('uses only canonical PAPER closes for the latest 30-trade research window', () => {
    const seed = (id: string, account: string, closedAt: number, r: number, version = '1.0.0') => {
      const decisionId = 'decision-' + id;
      run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
        decisionId, id, 'fixture', 'crypto', 'LONG', 'trend_pullback', 'PAPER_TRADE', 1, J({ strategy: { version } }));
      run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk,decision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, account, 'fixture', 'crypto', 'LONG', 'trend_pullback', 0, 100, 95, 95, '{}', 'CLOSED',
        1, closedAt, r * 5, 0, 5, decisionId);
    };
    seed('old-profitable', 'paper-bot', 1, 100);
    for (let i = 0; i < 30; i++) seed('paper-' + i, 'paper-bot', 100 + i, -0.25);
    for (let i = 0; i < 5; i++) seed('live-' + i, 'live-account', 300 + i, 1000);
    const p = strategyPassports()[0];
    expect(p.paperHealth.samples).toBe(31);
    expect(p.rolling30Paper).toMatchObject({
      samples: 30, observedClosedPositions: 30, complete: true,
      environment: 'PAPER', certification: 'NOT_CERTIFIED',
      canAuthorizeLive: false, evidence: 'CLOSED_POSITION_PROXY_NOT_VERIFIED_VENUE_FILLS',
    });
    expect(p.rolling30Paper.expectancyR).toBeCloseTo(-0.25);
    expect(p.paperHealth.expectancyR).toBeGreaterThan(0);
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', 'trend_pullback')!.status).toBe('RESEARCH');
  });

  it('does not backfill a malformed recent trade with older profitable trades', () => {
    const seed = (i: number, version: string | null) => {
      const id = 'paper-' + i, decisionId = version == null ? null : 'decision-' + id;
      if (decisionId) run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
        decisionId, id, 'fixture', 'crypto', 'LONG', 'trend_pullback', 'PAPER_TRADE', 1, J({ strategy: { version } }));
      run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk,decision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, 'paper-bot', 'fixture', 'crypto', 'LONG', 'trend_pullback', 0, 100, 95, 95, '{}',
        'CLOSED', 1, 100 + i, 5, 0, 5, decisionId);
    };
    for (let i = 0; i < 30; i++) seed(i, '1.0.0');
    seed(30, null); // newest close has no authenticated version
    const p = strategyPassports()[0];
    expect(p.paperHealth.samples).toBe(30);
    expect(p.rolling30Paper).toMatchObject({
      samples: 29, observedClosedPositions: 30, complete: false,
      canAuthorizeLive: false, certification: 'NOT_CERTIFIED',
      status: 'INSUFFICIENT_SAMPLE',
    });
  });

  it('requires sufficient outcomes before a degraded review and never promotes', () => {
    expect(returnHealth([-1])).toMatchObject({ status: 'INSUFFICIENT_SAMPLE', expectancyCi95: null });
    expect(returnHealth(Array(30).fill(-1))).toMatchObject({ status: 'DEGRADED_REVIEW', expectancyCi95: { low: -1, high: -1 } });
    expect(returnHealth([NaN, Infinity])).toMatchObject({ samples: 0, expectancyR: null });
  });
});
