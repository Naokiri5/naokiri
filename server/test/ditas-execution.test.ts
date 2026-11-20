import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { run } from '../src/db/db.js';
import { executionQuality } from '../src/ditas/execution.js';

function order(id: string, opts: { side?: string; status?: string; purpose?: string; decisionId?: string; createdAt?: number } = {}) {
  run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,decision_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, id, 'paper-bot', 'binance-paper', 'BTCUSDT', opts.side ?? 'BUY', 'MARKET', 2,
    opts.status ?? 'FILLED', opts.purpose ?? 'ENTRY', opts.decisionId ?? null, opts.createdAt ?? 100, 200);
}
function decision(id: string, report: string) {
  run(`INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)`,
    id, 'candidate', 'BTCUSDT', 'crypto', 'long', 'test', 'APPROVE', 90, report);
}
function fill(id: string, orderId: string, qty: number, price: number, fee: number, ts: number, liquidity = 'TAKER') {
  run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', id, orderId, qty, price, fee, liquidity, ts);
}
describe('paper execution quality projection', () => {
  beforeEach(() => freshDb());
  it('keeps absent executions empty and bounds queries', () => {
    expect(executionQuality()).toMatchObject({
      label: 'PAPER', orders: [],
      summary: { orderCount: 0, filledOrderCount: 0, comparableOrderCount: 0, meanCostIncludingFeesBps: null },
    });
    for (const n of [0, 501, 1.5, NaN]) expect(() => executionQuality(n)).toThrow();
  });
  it('uses fills rather than cached order averages and excludes other accounts', () => {
    order('a');
    order('b', { createdAt: 105 });
    run('UPDATE orders SET filled_qty=?, avg_price=?, fees=? WHERE id=?', 1, 900, 3, 'a');
    run('UPDATE orders SET account=? WHERE id=?', 'external', 'b');
    fill('f1', 'a', 1, 100, 0.1, 110, 'MAKER');
    fill('f2', 'a', 1, 102, 0.1, 120);
    fill('external-fill', 'b', 1, 120, 1, 110);
    const result = executionQuality(1);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      orderId: 'a', averageFillPrice: 101, filledQty: 2, fees: 0.2, firstFillDelayMs: 10,
      lastRecordedFillDelayMs: 20, adverseSlippageBps: null, costIncludingFeesBps: null,
      liquidity: { maker: 1, taker: 1, unknown: 0 },
    });
    expect(result.orders[0].feeBps).toBeCloseTo(0.2 / 202 * 10_000);
    expect(result.summary).toEqual({ orderCount: 1, filledOrderCount: 1, comparableOrderCount: 0, meanCostIncludingFeesBps: null });
  });
  it('calculates adverse slippage with the correct sign for both sides and weighted partial fills', () => {
    decision('ref', JSON.stringify({ entryRef: 100, strategy: { id: 'trend' } }));
    order('buy', { side: 'BUY', status: 'PARTIAL', decisionId: 'ref' });
    order('sell', { side: 'SELL', decisionId: 'ref' });
    fill('buy-2', 'buy', 0.5, 104, 0.2, 120);
    fill('buy-1', 'buy', 1, 101, 0.1, 110);
    fill('sell-1', 'sell', 2, 99, 0.3, 115);
    const byId = Object.fromEntries(executionQuality().orders.map(o => [o.orderId, o]));
    expect(byId.buy).toMatchObject({
      status: 'PARTIAL', strategyId: 'trend', averageFillPrice: 102, expectedPrice: 100, filledQty: 1.5,
      fillCount: 2, firstFillDelayMs: 10, lastRecordedFillDelayMs: 20,
    });
    expect(byId.buy.fees).toBeCloseTo(0.3);
    expect(byId.buy.adverseSlippageBps).toBeCloseTo(200);
    expect(byId.sell.adverseSlippageBps).toBeCloseTo(100);
    expect(byId.buy.costIncludingFeesBps).toBeCloseTo(220);
    expect(byId.sell.costIncludingFeesBps).toBeCloseTo(115);
  });
  it('averages comparable signed costs equally per order and keeps unknown liquidity', () => {
    decision('ref', JSON.stringify({ entryRef: 100 }));
    order('improved-buy', { status: 'PARTIAL', decisionId: 'ref' });
    fill('buy-fill', 'improved-buy', 0.5, 98, 0.05, 110, 'UNCLASSIFIED');
    order('improved-sell', { side: 'SELL', decisionId: 'ref' });
    fill('sell-fill', 'improved-sell', 2, 101, 0, 110);
    order('unbenchmarked');
    fill('unbenchmarked-fill', 'unbenchmarked', 1, 100, 0.1, 110);
    order('unfilled', { status: 'CANCELLED', decisionId: 'ref' });

    const result = executionQuality();
    const byId = Object.fromEntries(result.orders.map(o => [o.orderId, o]));
    expect(byId['improved-buy'].liquidity).toEqual({ maker: 0, taker: 0, unknown: 1 });
    expect(byId['improved-buy'].costIncludingFeesBps).toBeCloseTo(-190);
    expect(byId['improved-sell'].feeBps).toBe(0);
    expect(byId['improved-sell'].costIncludingFeesBps).toBeCloseTo(-100);
    expect(result.summary).toMatchObject({ orderCount: 4, filledOrderCount: 3, comparableOrderCount: 2 });
    expect(result.summary.meanCostIncludingFeesBps).toBeCloseTo(-145);
  });
  it('leaves missing references, invalid sides and unfilled order metrics unknown', () => {
    decision('ref', JSON.stringify({ entryRef: 100 }));
    decision('bad', '{not json');
    order('rejected', { status: 'REJECTED', decisionId: 'ref' });
    order('cancelled', { status: 'CANCELLED', decisionId: 'bad' });
    fill('cancelled-fill', 'cancelled', 1, 101, 0.1, 110);
    order('exit', { purpose: 'EXIT', decisionId: 'ref' });
    fill('exit-fill', 'exit', 1, 101, 0.1, 110);
    order('unknown-side', { side: 'UNKNOWN', decisionId: 'ref' });
    fill('unknown-fill', 'unknown-side', 1, 101, 0.1, 110);
    order('missing', { decisionId: 'no-such-decision' });
    fill('missing-fill', 'missing', 1, 101, 0.1, 110);
    const byId = Object.fromEntries(executionQuality().orders.map(o => [o.orderId, o]));
    expect(byId.rejected).toMatchObject({
      filledQty: 0, averageFillPrice: null, adverseSlippageBps: null, firstFillDelayMs: null,
      lastRecordedFillDelayMs: null, liquidity: { maker: 0, taker: 0, unknown: 0 }, feeBps: null,
    });
    for (const id of ['cancelled', 'exit', 'missing']) expect(byId[id]).toMatchObject({ expectedPrice: null, adverseSlippageBps: null });
    expect(byId['unknown-side'].adverseSlippageBps).toBeNull();
    for (const projectedOrder of Object.values(byId)) expect(projectedOrder.costIncludingFeesBps).toBeNull();
  });
  it('uses a stable bounded window when orders share a timestamp', () => {
    decision('ref', JSON.stringify({ entryRef: 100 }));
    order('b', { decisionId: 'ref' });
    order('c', { createdAt: 101 });
    order('a');
    fill('older-fill', 'b', 1, 100, 0, 110);
    const bounded = executionQuality(2);
    expect(bounded.orders.map(o => o.orderId)).toEqual(['c', 'a']);
    expect(bounded.summary).toEqual({ orderCount: 2, filledOrderCount: 0, comparableOrderCount: 0, meanCostIncludingFeesBps: null });
    const expanded = executionQuality(3);
    expect(expanded.orders.map(o => o.orderId)).toEqual(['c', 'a', 'b']);
    expect(expanded.summary).toEqual({ orderCount: 3, filledOrderCount: 1, comparableOrderCount: 1, meanCostIncludingFeesBps: 0 });
  });
});
