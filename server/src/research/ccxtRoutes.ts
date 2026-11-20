/** Owner-authenticated, read-only CCXT research routes (GET only; strict query validation; no trading surface). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as cx from './ccxtResearch.js';

const exchange = z.object({ exchange: z.enum(cx.CCXT_EXCHANGES) }).strict();
const symbol = z.string().min(3).max(45);

export async function ccxtRoutes(app: FastifyInstance) {
  app.get('/api/research/ccxt', async () => cx.ccxtOverview());
  app.get('/api/research/ccxt/:exchange/markets', async (req) => {
    const { exchange: id } = exchange.parse(req.params);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }).strict().parse(req.query);
    return cx.ccxtMarkets(id, q.limit ?? 50);
  });
  app.get('/api/research/ccxt/:exchange/ticker', async (req) => {
    const { exchange: id } = exchange.parse(req.params);
    const q = z.object({ symbol }).strict().parse(req.query);
    return cx.ccxtTicker(id, q.symbol);
  });
  app.get('/api/research/ccxt/:exchange/orderbook', async (req) => {
    const { exchange: id } = exchange.parse(req.params);
    const q = z.object({ symbol, limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(req.query);
    return cx.ccxtOrderBook(id, q.symbol, q.limit ?? 20);
  });
  app.get('/api/research/ccxt/:exchange/candles', async (req) => {
    const { exchange: id } = exchange.parse(req.params);
    const q = z.object({ symbol, timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }).strict().parse(req.query);
    return cx.ccxtCandles(id, q.symbol, q.timeframe ?? '1h', q.limit ?? 100);
  });
}
