import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { closeDb, run } from '../src/db/db.js';
import { freshDb, ownerSetupPayload } from './helpers.js';

describe('paper execution API boundary', () => {
  let app: Awaited<ReturnType<typeof buildApp>>, cookie: string;
  beforeEach(async () => {
    freshDb(false); app = await buildApp();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ownerSetupPayload('execution integration owner') });
    expect(setup.statusCode).toBe(200); cookie = String(setup.headers['set-cookie']).split(';')[0];
  });
  afterEach(async () => { await app.close(); closeDb(); });

  it('requires authentication and validates the requested window', async () => {
    expect((await app.inject({ url: '/api/ditas/execution' })).statusCode).toBe(401);
    for (const limit of ['0', '501', '1.5', 'abc', '']) {
      expect((await app.inject({ url: `/api/ditas/execution?limit=${limit}`, headers: { cookie } })).statusCode, limit).toBe(400);
    }
    for (const limit of [1, 500]) {
      const result = await app.inject({ url: `/api/ditas/execution?limit=${limit}`, headers: { cookie } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ label: 'PAPER', orders: [],
        summary: { orderCount: 0, filledOrderCount: 0, comparableOrderCount: 0, meanCostIncludingFeesBps: null } });
    }
  });

  it('returns only the bounded paper account window to authenticated callers', async () => {
    for (const [id, account, timestamp] of [['old', 'paper-bot', 100], ['new', 'paper-bot', 200], ['external', 'external', 300]] as const) {
      run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, id, account, 'binance-paper', 'BTCUSDT', 'BUY', 'MARKET', 1, 'REJECTED', 'ENTRY', timestamp, timestamp);
    }
    const result = await app.inject({ url: '/api/ditas/execution?limit=1', headers: { cookie } });
    expect(result.statusCode).toBe(200);
    expect(result.json().orders.map((o: { orderId: string }) => o.orderId)).toEqual(['new']);
    expect(result.json()).toMatchObject({
      orders: [{ orderId: 'new', feeBps: null, costIncludingFeesBps: null, liquidity: { maker: 0, taker: 0, unknown: 0 } }],
      summary: { orderCount: 1, filledOrderCount: 0, comparableOrderCount: 0, meanCostIncludingFeesBps: null },
    });
  });

});
