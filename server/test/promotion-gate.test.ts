import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedBacktestFixture } from './helpers.js';
import { setStrategyStatus, seedStrategies, MIN_PROMOTION_OOS_TRADES } from '../src/lab/lab.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { all } from '../src/db/db.js';

/** F-01 (100-agent audit, Squad F): PAPER promotion needs real out-of-sample evidence or an audited owner override. */
const id = STRATEGIES[0].id;
describe('strategy promotion evidence gate (F-01)', () => {
  beforeEach(() => { freshDb(); seedStrategies(); });
  it('one out-of-sample trade is not enough', () => {
    seedBacktestFixture(id, 1);
    expect(() => setStrategyStatus('owner', id, 'PAPER')).toThrow(/≥ 30 out-of-sample trades/);
  });
  it(`${MIN_PROMOTION_OOS_TRADES} positive-expectancy OOS trades are enough`, () => {
    seedBacktestFixture(id, MIN_PROMOTION_OOS_TRADES);
    expect(() => setStrategyStatus('owner', id, 'PAPER')).not.toThrow();
  });
  it('the owner can override with an explicit reason, which is audited', () => {
    seedBacktestFixture(id, 1);
    expect(() => setStrategyStatus('owner', id, 'PAPER', 'OVERRIDE')).toThrow(); // a bare keyword is not a reason
    setStrategyStatus('owner', id, 'PAPER', 'OVERRIDE: paper-only trial to collect evidence');
    expect(all<any>("SELECT action FROM audit_log WHERE action='strategy.promotion.override'")).toHaveLength(1);
  });
});
