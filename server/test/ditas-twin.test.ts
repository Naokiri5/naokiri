import { describe, expect, it } from 'vitest';
import { simulateTwin, type TwinAssumptions, type TwinPlan } from '../src/ditas/twin.js';
import type { Candle } from '../src/market/types.js';

const H = 3_600_000;
const plan = (): TwinPlan => ({ instrumentId: 'test:fixture', decisionAt: H, timeframe: '1h', signal: { direction: 'long', entryRef: 100, stop: 95, targets: [{ r: 2, fraction: 1 }], maxHoldBars: 10, trailAfterR: null, trigger: 'fixture', invalidation: 'below stop', reasons: ['fixture only'] } });
const costs = (patch: Partial<TwinAssumptions> = {}): TwinAssumptions => ({ feeRate: 0, spreadBps: 0, slippageBps: 0, notional: 1000, maxParticipationRate: 0.1, availableNotional: 20_000, liquidityObservedAt: H, ...patch });
const bars = (...values: Partial<Candle>[]): Candle[] => values.map((c, i) => ({ t: H * (i + 1), o: 100, h: 105, l: 99, c: 101, v: 100, ...c }));

describe('DITAS Decision Twin', () => {
  it('uses shared conservative stop ordering and compares the no-trade baseline', () => {
    const r = simulateTwin(plan(), bars({ h: 112, l: 94 }), costs());
    expect(r.kind).toBe('HYPOTHETICAL'); expect(r.shadow.state).toBe('CLOSED');
    expect(r.shadow.fills[1].reason).toBe('STOP'); expect(r.shadow.netPnL).toBe(-50);
    expect(r.shadow.r).toBe(-1); expect(r.waitBaseline.netPnL).toBe(0); expect(r.comparison.waitAvoidedLoss).toBe(50);
  });
  it('includes entry/exit fees and spread/slippage exactly once', () => {
    const r = simulateTwin(plan(), bars({ o: 100, h: 120, l: 99, c: 115 }), costs({ feeRate: 0.001, spreadBps: 10, slippageBps: 5 }));
    const entry = 100 * 1.001, qty = 1000 / entry, exit = 110 * 0.999;
    expect(r.shadow.entryPrice).toBeCloseTo(entry);
    expect(r.shadow.netPnL).toBeCloseTo(qty * (exit - entry) - 1 - qty * exit * 0.001);
    expect(r.shadow.fees).toBeGreaterThan(1);
  });
  it('fills stop gaps at the adverse opening, not at the original stop', () => {
    const r = simulateTwin(plan(), bars({}, { o: 90, h: 93, l: 85, c: 89 }), costs());
    expect(r.shadow.fills[1].price).toBe(90); expect(r.shadow.netPnL).toBe(-100);
  });
  it('closes the full hypothetical position at the last accepted target', () => {
    const p = plan();
    p.signal.targets = [{ r: 1, fraction: 0.5 }, { r: 2, fraction: 0.4999999998 }];
    const result = simulateTwin(p, bars({ h: 112 }), costs()).shadow;
    expect(result).toMatchObject({ state: 'CLOSED', qtyOpen: 0 });
    expect(result.fills.filter(fill => fill.side === 'SELL').reduce((quantity, fill) => quantity + fill.qty, 0)).toBeCloseTo(result.qty, 10);
  });
  it('keeps delayed-entry targets frozen and compares a loss with waiting', () => {
    const r = simulateTwin(plan(), bars({ h: 103, l: 99 }, { o: 102, h: 111, l: 100, c: 110 }), costs());
    expect(r.shadow.state).toBe('CLOSED'); expect(r.counterfactual.state).toBe('CLOSED');
    expect(r.counterfactual.entryPrice).toBe(102); expect(r.counterfactual.fills[1].price).toBe(110);
    expect(r.comparison.delayedMinusShadow).toBeLessThan(0); expect(r.comparison.waitMissedGain).toBe(100);
  });
  it('reports open/censored outcomes without inventing a realized total return', () => {
    const r = simulateTwin(plan(), bars({ c: 103 }), costs({ feeRate: 0.001 }));
    expect(r.shadow.state).toBe('OPEN'); expect(r.shadow.netPnL).toBeNull(); expect(r.shadow.r).toBeNull();
    expect(r.shadow.realizedNetPnL).toBe(0); expect(r.shadow.unrealizedNetPnL).toBeCloseTo(27.97);
    expect(r.comparison.waitMissedGain).toBeNull();
  });
  it('requires contemporaneous liquidity evidence and never sizes using future candle volume', () => {
    const input = bars({ v: 1e12 });
    expect(simulateTwin(plan(), input, costs({ availableNotional: undefined })).shadow.state).toBe('NO_FILL');
    expect(simulateTwin(plan(), input, costs({ liquidityObservedAt: H + 1 })).shadow.state).toBe('NO_FILL');
    expect(simulateTwin(plan(), input, costs({ liquidityObservedAt: H - 180001 })).shadow.state).toBe('NO_FILL');
    const first = simulateTwin(plan(), input, costs({ availableNotional: 5000 }));
    input[0].v = 0;
    expect(simulateTwin(plan(), input, costs({ availableNotional: 5000 }))).toEqual(first);
    expect(first.shadow.partialEntry).toBe(true); expect(first.shadow.filledNotional).toBe(500);
  });
  it('abstains when an opening gap invalidates frozen targets or there is no future opening', () => {
    expect(simulateTwin(plan(), bars({ o: 111, h: 115, l: 110, c: 114 }), costs()).shadow.state).toBe('NO_FILL');
    expect(simulateTwin(plan(), [], costs()).shadow.state).toBe('NO_FILL');
  });
  it('does not mutate frozen plans or historical data', () => {
    const p = plan(), c = bars({ h: 120 }), a = costs(), original = structuredClone({ p, c, a });
    simulateTwin(p, c, a); expect({ p, c, a }).toEqual(original);
  });
  it('keeps partial-exit realized results separate from the censored remaining quantity', () => {
    const p = plan(); p.signal.targets = [{ r: 1, fraction: 0.5 }, { r: 2, fraction: 0.5 }];
    const r = simulateTwin(p, bars({ h: 106, l: 99, c: 102 }), costs()).shadow;
    expect(r.state).toBe('OPEN'); expect(r.qtyOpen).toBe(5); expect(r.realizedNetPnL).toBe(25);
    expect(r.unrealizedNetPnL).toBe(10); expect(r.netPnL).toBeNull();
  });
  it('applies the frozen maximum holding period using shared time exits', () => {
    const p = plan(); p.signal.maxHoldBars = 1;
    const r = simulateTwin(p, bars({}, { c: 103 }), costs()).shadow;
    expect(r.state).toBe('CLOSED'); expect(r.fills[1].reason).toBe('TIME'); expect(r.netPnL).toBe(30);
  });
  it('does not alter a completed shadow outcome based on later valid bars', () => {
    const first = simulateTwin(plan(), bars({ h: 112 }), costs()).shadow;
    const later = simulateTwin(plan(), bars({ h: 112 }, { o: 40, h: 50, l: 20, c: 30 }), costs()).shadow;
    expect(later).toEqual(first);
  });
  it('rejects arithmetic overflow rather than serializing non-finite returns as null', () => {
    const p = plan(); p.signal.entryRef = 1e-100; p.signal.stop = 0.5e-100;
    const cs = bars({ o: 1e-100, h: 1.1e-100, l: 0.9e-100, c: 1e-100 }, { o: 1e300, h: 1e300, l: 1e299, c: 1e300 });
    expect(() => simulateTwin(p, cs, costs())).toThrow(/overflow/);
  });
  it.each(['negativeFee', 'nanSlippage', 'tooMuchParticipation', 'zeroNotional', 'futurePlanLiquidityValue', 'zeroDelay'])('rejects invalid assumptions: %s', fault => {
    const a = costs();
    if (fault === 'negativeFee') a.feeRate = -1;
    if (fault === 'nanSlippage') a.slippageBps = NaN;
    if (fault === 'tooMuchParticipation') a.maxParticipationRate = 2;
    if (fault === 'zeroNotional') a.notional = 0;
    if (fault === 'futurePlanLiquidityValue') a.availableNotional = Infinity;
    if (fault === 'zeroDelay') a.entryDelayBars = 0;
    expect(() => simulateTwin(plan(), bars({}), a)).toThrow();
  });
  it.each(['past', 'gap', 'duplicate', 'badRange', 'badCloseTime', 'oversized'])('rejects invalid historical bars: %s', fault => {
    const cs = bars({}, {});
    if (fault === 'past') cs[0].t = H - 1;
    if (fault === 'gap') cs[1].t += H;
    if (fault === 'duplicate') cs[1].t = H;
    if (fault === 'badRange') cs[0].h = 90;
    if (fault === 'badCloseTime') cs[0].closeTime = 2 * H;
    if (fault === 'oversized') cs.push(...Array(2000).fill(cs[1]));
    expect(() => simulateTwin(plan(), cs, costs())).toThrow();
  });
});
