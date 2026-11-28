import { beforeEach, describe, it, expect } from 'vitest';
import { stepExit, newExitState } from '../src/lab/exits.js';
import { backtest, monteCarlo } from '../src/lab/backtest.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { checkStrategyHealth, paperStats, setStrategyStatus } from '../src/lab/lab.js';
import { getSetting } from '../src/core/settings.js';
import { get, J, run } from '../src/db/db.js';
import { strategyPassports } from '../src/ditas/passports.js';
import { PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { freshDb, synthCandles } from './helpers.js';

describe('exit capsule', () => {
  it('stop wins when stop and target are hit in the same bar; gap fills at open', () => {
    const s = newExitState(100, 95, 1, [{ r: 1, fraction: 1 }], null, 10);
    const f = stepExit(s, { o: 100, h: 106, l: 94, c: 100 }, 0);
    expect(f[0].reason).toBe('STOP');
    const g = newExitState(100, 95, 1, [{ r: 1, fraction: 1 }], null, 10);
    expect(stepExit(g, { o: 90, h: 91, l: 89, c: 90 }, 0)[0].price).toBe(90);
  });
  it('trailing only tightens; time stop fires', () => {
    const s = newExitState(100, 95, 1, [{ r: 3, fraction: 1 }], 1, 3);
    stepExit(s, { o: 100, h: 106, l: 100, c: 105 }); expect(s.stop).toBe(100);
    stepExit(s, { o: 105, h: 105, l: 101, c: 102 }); expect(s.stop).toBe(100);
    const f = stepExit(s, { o: 102, h: 103, l: 101, c: 102 }); expect(f[0].reason).toBe('TIME');
  });
});
describe('backtester', () => {
  it('runs every strategy with costs, IS/OOS split, no look-ahead', () => {
    const cs = synthCandles(2000, { drift: 0.0008, vol: 0.01, seed: 21 });
    for (const s of STRATEGIES) {
      const r = backtest(s, 'x', cs);
      expect(r.all.trades).toBe(r.inSample.trades + r.outOfSample.trades);
      for (const t of r.trades) { const idx = cs.findIndex((c) => c.t === t.entryT); expect(idx).toBeGreaterThan(0); }
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
  it('Monte Carlo is deterministic per seed and bounded', () => {
    const a = monteCarlo([1, -1, 2, -1, 0.5, -1], { seed: 3 })!, b = monteCarlo([1, -1, 2, -1, 0.5, -1], { seed: 3 })!;
    expect(a).toEqual(b); expect(a.maxDdP95).toBeGreaterThanOrEqual(a.maxDdP50);
  });
});

describe('paper strategy health', () => {
  const strategy = STRATEGIES[0];
  const now = Date.now();
  const instrument = 'crypto:binance:BTCUSDT';
  type Outcome = { account?: string; version?: string; decisionInstrument?: string; closedAt?: number; plannedRisk?: number; pnl?: number };
  beforeEach(() => freshDb());

  function recordLosses(outcome: Outcome = {}) {
    const { account = PAPER_ACCOUNT, version = strategy.version, decisionInstrument = instrument, closedAt = now - 1000, plannedRisk = 10, pnl = -10 } = outcome;
    for (let i = 0; i < 15; i++) {
      const decision = `decision-${i}`;
      run('INSERT INTO decisions (id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
        decision, `candidate-${i}`, decisionInstrument, 'crypto', 'LONG', strategy.id, 'PAPER_TRADE', now - 3000, J({ strategy: { id: strategy.id, version } }));
      run('INSERT INTO positions (id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk,decision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        `position-${i}`, account, instrument, 'crypto', 'LONG', strategy.id, 0, 100, 95, 95, '{}', 'CLOSED', now - 2000, closedAt, pnl, 0, plannedRisk, decision);
    }
  }

  it.each([
    { label: 'foreign account', outcome: { account: 'other-account' } },
    { label: 'obsolete version', outcome: { version: '0.9.0' } },
    { label: 'unrelated decision', outcome: { decisionInstrument: 'crypto:binance:ETHUSDT' } },
    { label: 'future closure', outcome: { closedAt: now + 3_600_000 } },
    { label: 'inverted closure', outcome: { closedAt: now - 2500 } },
    { label: 'non-finite return', outcome: { pnl: -Number.MAX_VALUE, plannedRisk: 0.5 } },
  ] satisfies { label: string; outcome: Outcome }[])('excludes $label from both the paper review and automated suspension', ({ outcome }) => {
    recordLosses(outcome);
    expect(checkStrategyHealth()).toEqual([]);
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', strategy.id)?.status).toBe('PAPER');
    expect(paperStats(strategy.id)).toBeNull();
    expect(strategyPassports()[0].paperHealth.samples).toBe(0);
  });

  it('suspends a PAPER strategy on eligible current-version outcomes once', () => {
    recordLosses();
    expect(paperStats(strategy.id)).toEqual({ trades: 15, expectancyR: -1, winRate: 0 });
    expect(strategyPassports()[0].paperHealth).toMatchObject({ samples: 15, expectancyR: -1 });
    expect(checkStrategyHealth()).toEqual([strategy.id]);
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', strategy.id)?.status).toBe('SUSPENDED');
    expect(getSetting('suspendedStrategies', [])).toEqual([strategy.id]);
    expect(checkStrategyHealth()).toEqual([]);
  });

  it.each(['RETIRED', 'RESEARCH', 'BACKTESTED'])('preserves the %s lifecycle state', (status) => {
    recordLosses();
    run('UPDATE strategies SET status=? WHERE id=?', status, strategy.id);
    expect(checkStrategyHealth()).toEqual([]);
    expect(get<{ status: string }>('SELECT status FROM strategies WHERE id=?', strategy.id)?.status).toBe(status);
  });
});

describe('atomic strategy lifecycle authority', () => {
  const id = STRATEGIES[0].id;
  beforeEach(() => freshDb());

  it('rolls back strategy status and suspension index if audit persistence fails', () => {
    const before = get('SELECT * FROM strategies WHERE id=?', id);
    const suspended = getSetting<string[]>('suspendedStrategies', []);
    // Force a late write failure, after both the lifecycle and suspension writes.
    run("CREATE TEMP TRIGGER fixture_reject_strategy_audit BEFORE INSERT ON audit_log WHEN NEW.action='strategy.status' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END");
    try {
      expect(() => setStrategyStatus('strategy-health-monitor', id, 'SUSPENDED')).toThrow('fixture audit failure');
      expect(get('SELECT * FROM strategies WHERE id=?', id)).toEqual(before);
      expect(getSetting<string[]>('suspendedStrategies', [])).toEqual(suspended);
    } finally {
      run('DROP TRIGGER fixture_reject_strategy_audit');
    }
    setStrategyStatus('strategy-health-monitor', id, 'SUSPENDED');
    expect(get('SELECT status FROM strategies WHERE id=?', id)).toEqual({status: 'SUSPENDED'});
    expect(getSetting<string[]>('suspendedStrategies', [])).toContain(id);
    expect(get("SELECT action FROM audit_log WHERE action='strategy.status'")).toEqual({action: 'strategy.status'});
  });

  it('never accepts a direct LIVE_CANDIDATE promotion, even from the owner', () => {
    expect(() => setStrategyStatus('owner', id, 'LIVE_CANDIDATE')).toThrow(/certification/);
    expect(get('SELECT status FROM strategies WHERE id=?', id)).toEqual({status: 'PAPER'});
  });
});
