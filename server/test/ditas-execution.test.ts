import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { run } from '../src/db/db.js';
import { executionQuality } from '../src/ditas/execution.js';
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
});
