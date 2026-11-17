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
function fill(id: string, orderId: string, qty: number, price: number, fee: number, ts: number) {
  run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', id, orderId, qty, price, fee, 'TAKER', ts);
}
describe('paper execution quality projection', () => {
  beforeEach(() => freshDb());
  it('keeps absent executions empty and bounds queries', () => {
    expect(executionQuality().orders).toEqual([]);
    for (const n of [0,501,1.5,NaN]) expect(() => executionQuality(n)).toThrow();
  });
  it('uses fills rather than cached order averages and excludes other accounts', () => {
    for (const [id,account] of [['a','paper-bot'],['b','external']]) run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,id,id,account,'binance-paper','BTCUSDT','BUY','MARKET',2,'FILLED','ENTRY',100,200);
    run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)','f1','a',1,100,0.1,'TAKER',110);
    run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)','f2','a',1,102,0.1,'TAKER',120);
    const r=executionQuality(); expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toMatchObject({ averageFillPrice:101,filledQty:2,fees:0.2,firstFillDelayMs:10,lastRecordedFillDelayMs:20,adverseSlippageBps:null });
  });
  it('calculates adverse slippage with the correct sign for both sides and weighted partial fills', () => {
    decision('ref', JSON.stringify({ entryRef: 100, strategy: { id: 'trend' } }));
    order('buy', { side: 'BUY', status: 'PARTIAL', decisionId: 'ref' });
    order('sell', { side: 'SELL', decisionId: 'ref' });
    fill('buy-2', 'buy', 1, 103, 0.2, 120); fill('buy-1', 'buy', 1, 101, 0.1, 110);
    fill('sell-1', 'sell', 2, 99, 0.3, 115);
    const byId = Object.fromEntries(executionQuality().orders.map(o => [o.orderId, o]));
    expect(byId.buy).toMatchObject({ status: 'PARTIAL', strategyId: 'trend', averageFillPrice: 102, expectedPrice: 100, fillCount: 2, firstFillDelayMs: 10, lastRecordedFillDelayMs: 20 });
    expect(byId.buy.fees).toBeCloseTo(0.3); expect(byId.buy.adverseSlippageBps).toBeCloseTo(200);
    expect(byId.sell.adverseSlippageBps).toBeCloseTo(100);
  });
  it('leaves missing references, invalid sides and unfilled order metrics unknown', () => {
    decision('ref', JSON.stringify({ entryRef: 100 })); decision('bad', '{not json');
    order('rejected', { status: 'REJECTED', decisionId: 'ref' });
    order('cancelled', { status: 'CANCELLED', decisionId: 'bad' }); fill('cancelled-fill', 'cancelled', 1, 101, 0.1, 110);
    order('exit', { purpose: 'EXIT', decisionId: 'ref' }); fill('exit-fill', 'exit', 1, 101, 0.1, 110);
    order('unknown-side', { side: 'UNKNOWN', decisionId: 'ref' }); fill('unknown-fill', 'unknown-side', 1, 101, 0.1, 110);
    order('missing', { decisionId: 'no-such-decision' }); fill('missing-fill', 'missing', 1, 101, 0.1, 110);
    const byId = Object.fromEntries(executionQuality().orders.map(o => [o.orderId, o]));
    expect(byId.rejected).toMatchObject({ filledQty: 0, averageFillPrice: null, adverseSlippageBps: null, firstFillDelayMs: null, lastRecordedFillDelayMs: null });
    for (const id of ['cancelled', 'exit', 'missing']) expect(byId[id]).toMatchObject({ expectedPrice: null, adverseSlippageBps: null });
    expect(byId['unknown-side'].adverseSlippageBps).toBeNull();
  });
  it('uses a stable bounded window when orders share a timestamp', () => {
    order('b'); order('c', { createdAt: 101 }); order('a');
    expect(executionQuality(2).orders.map(o => o.orderId)).toEqual(['c', 'a']);
    expect(executionQuality(3).orders.map(o => o.orderId)).toEqual(['c', 'a', 'b']);
  });
});
