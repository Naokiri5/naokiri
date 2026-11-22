import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/index.js';
import { closeDb } from '../src/db/db.js';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { market } from '../src/market/store.js';
import { FEATURE_COUNT, FEATURE_SLOT_NAMES, FEATURE_BUCKETS, assertHp97Schema } from '../src/market/feature97.js';
import { hp97MarketSnapshot } from '../src/market/hp97.js';
import { deriveAutopilotStatus, type AutopilotInput } from '../src/ops/autopilotStatus.js';

describe('MIA 5.x HP97 canonical research projection', () => {
  beforeEach(() => { freshDb(); market.reset(); });
  it('preserves the exact 97 feature names and ten disjoint buckets', () => {
    expect(() => assertHp97Schema()).not.toThrow();
    expect(FEATURE_SLOT_NAMES).toHaveLength(FEATURE_COUNT);
    expect(FEATURE_BUCKETS).toHaveLength(10);
    expect(FEATURE_BUCKETS[0]).toMatchObject({ start: 0, end: 11 });
    expect(FEATURE_BUCKETS[9]).toMatchObject({ start: 89, end: 96 });
    expect(FEATURE_SLOT_NAMES[96]).toBe('RISK_GOVERNOR_BUDGET_UTIL');
  });
  it('projects observed book/closed-bar features and leaves unsupported venue data absent', () => {
    const { inst } = seedInstrument('ETHUSDT');
    const result = hp97MarketSnapshot(inst.id)!;
    expect(result.readOnly).toBe(true);
    expect(result.coverage.total).toBe(97);
    const byName = new Map(result.observations.map(x => [x.name, x]));
    expect(byName.get('BEST_BID')?.source).toContain('market.deep.book');
    expect(byName.get('BEST_ASK')!.value).toBeGreaterThan(byName.get('BEST_BID')!.value);
    expect(byName.get('SPREAD_BPS')!.value).toBeGreaterThan(0);
    expect(byName.get('BOOK_DEPTH_USD_1PCT')!.value).toBeGreaterThan(0);
    expect(byName.get('EMA_FAST_9')?.source).toContain('closed-1h');
    for (const name of ['JITO_BUNDLE_LAND_RATE','FUNDING_RATE_CURRENT','RUGCHECK_RISK_SCORE',
      'NET_EDGE_AFTER_COST_BPS','EMA_MEDIUM_21']) {
      expect(byName.has(name)).toBe(false);
      expect(result.absent).toContain(name);
    }
    expect(result.observations.every(x => Number.isFinite(x.value) && x.observedAtMs <= result.capturedAtMs)).toBe(true);
  });
  it('fails safe when execution book is stale instead of synthesizing microstructure', () => {
    const { inst,last } = seedInstrument('ETHUSDT');
    setBook(inst.id, last, Date.now() - 15 * 60_000);
    const result = hp97MarketSnapshot(inst.id)!;
    expect(result.observations.some(x => x.name === 'SPREAD_BPS')).toBe(false);
    expect(result.coverage.eligibleForSpotResearch).toBe(false);
    expect(result.coverage.requiredMissing).toContain('BOOK_DEPTH_USD_1PCT');
  });
  it('does not invent an instrument when the symbol is unknown', () => {
    expect(hp97MarketSnapshot('crypto:binance:UNKNOWN')).toBeNull();
  });
});

describe('MIA 5.x paper Autopilot state (advisory only)', () => {
  const ready = (): AutopilotInput => ({
    running:true,role:'LEADER',mode:'PAPER',emergency:false,pausedNewOrders:false,
    marketDataHealthy:true,positionMonitorHealthy:true,ledgerReconciled:true,policyAccepted:true,
    paperStrategyCount:1,openIncidents:0,
  });
  it('never claims authority to place a live trade', () => {
    expect(deriveAutopilotStatus(ready())).toMatchObject({
      state:'RUNNING',canAcceptAutomaticPaperEntries:true,canExecuteRealMoney:false,
    });
    expect(deriveAutopilotStatus({...ready(),mode:'BOUNDED_LIVE'})).toMatchObject({
      state:'BLOCKED',canExecuteRealMoney:false,
    });
  });
  it('reports pause, stale feeds and standby without bypassing controls', () => {
    expect(deriveAutopilotStatus({...ready(),emergency:true}).state).toBe('PAUSED');
    expect(deriveAutopilotStatus({...ready(),role:'STANDBY'}).state).toBe('WAITING');
    expect(deriveAutopilotStatus({...ready(),marketDataHealthy:false}).state).toBe('DEGRADED');
    expect(deriveAutopilotStatus({...ready(),ledgerReconciled:false}).state).toBe('BLOCKED');
    expect(deriveAutopilotStatus({...ready(),paperStrategyCount:0}).state).toBe('WAITING');
  });
});

describe('MIA 5.x owner-authenticated read-only endpoints', () => {
  it('requires the existing login for both status and HP97 evidence and returns no-store', async () => {
    closeDb(); freshDb(); market.reset(); seedInstrument('ETHUSDT');
    const app = await buildApp();
    try {
      for (const url of ['/api/autopilot/status','/api/market/hp97/ETHUSDT']) {
        expect((await app.inject({ url })).statusCode).toBe(401);
      }
      const login = await app.inject({method:'POST',url:'/api/auth/setup',payload:{password:'correct horse battery'}});
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const status = await app.inject({url:'/api/autopilot/status',headers:{cookie}});
      expect(status.statusCode).toBe(200);
      expect(status.headers['cache-control']).toBe('no-store');
      expect(status.json()).toMatchObject({readOnly:true,canExecuteRealMoney:false});
      const vector = await app.inject({url:'/api/market/hp97/ETHUSDT',headers:{cookie}});
      expect(vector.statusCode).toBe(200);
      expect(vector.headers['cache-control']).toBe('no-store');
      expect(vector.json().coverage.total).toBe(97);
      expect(vector.json().readOnly).toBe(true);
      expect((await app.inject({url:'/api/market/hp97/NOTREAL',headers:{cookie}})).statusCode).toBe(404);
    } finally { await app.close(); closeDb(); }
  });
});
