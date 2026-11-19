/**
 * Owner-authenticated, read-only Vike research routes. They run inside the API plugin, so the existing auth gate
 * (session required on every /api route) and error mapping apply. No public proxy: every route maps to one fixed,
 * allowlisted Vike endpoint with validated parameters. Responses never contain the API key or a presigned download
 * link, and nothing here feeds the executable market-price cache, the scanner or the OMS.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as vike from '../providers/vike.js';
import { providers } from '../providers/http.js';

/** Runs a provider call; synchronous validation errors become rejections so the API error handler maps them (400/503). */
const run = <T>(p: () => Promise<T>) => { try { return p(); } catch (e) { return Promise.reject(e); } };
const chain = z.enum(['ethereum', 'bsc', 'base', 'hyperevm']).optional();
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();

export async function vikeRoutes(app: FastifyInstance) {
  app.get('/api/research/vike/status', async () => {
    const p = providers().find((x) => x.id === vike.VIKE_PROVIDER);
    return { provider: vike.VIKE_PROVIDER, configured: !!process.env.MIA_VIKE_API_KEY?.trim(), status: p?.status ?? 'UNKNOWN', lastOkAt: p?.lastOkAt ?? null,
      lastError: p?.lastError ?? null, kind: 'RESEARCH_ONLY', note: 'Vike data is research evidence only. It cannot place, approve or size a trade.' };
  });
  app.get('/api/research/vike/search', async (req) => {
    const q = z.object({ q: z.string().min(1).max(256), limit: int(1, 20) }).strict().parse(req.query);
    return run(() => vike.searchVike(q.q, q.limit ?? 10));
  });
  app.get('/api/research/vike/tokens', async (req) => {
    const q = z.object({ chain, window: z.enum(['24h', '7d', '30d', '90d']).optional(), sort: z.enum(['volume', 'net_inflow', 'holders', 'smart_inflow']).optional(),
      minVolumeUsd: z.coerce.number().min(0).max(1e12).optional(), limit: int(1, 100) }).strict().parse(req.query);
    return run(() => vike.getVikeOnchainTokenScreener(q));
  });
  app.get('/api/research/vike/wallets', async (req) => {
    const q = z.object({ chain, window: z.enum(['24h', '7d', '30d', '90d', 'all']).optional(), sort: z.enum(['volume', 'inflow', 'outflow', 'net_flow', 'tx_count']).optional(), size: int(1, 20) }).strict().parse(req.query);
    return run(() => vike.discoverVikeWallets(q));
  });
  app.get('/api/research/vike/hyperliquid/ohlcv', async (req) => {
    const q = z.object({ symbol: z.string().min(1).max(80).regex(/^[A-Za-z0-9:_.-]+$/), interval: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).optional(),
      market: z.enum(['perp', 'spot']).optional(), limit: int(1, 5000) }).strict().parse(req.query);
    return run(() => vike.getVikeHyperliquidCandles(q.symbol, q));
  });
  app.get('/api/research/vike/predictfun', async (req) => {
    const q = z.object({ status: z.enum(['open', 'closed', 'resolved']).optional(), q: z.string().min(1).max(200).optional(), sort: z.enum(['volume_24h', 'newest']).optional(), limit: int(1, 100) }).strict().parse(req.query);
    return run(() => vike.getVikePredictFunMarkets(q));
  });
  app.get('/api/research/vike/polymarket', async (req) => {
    const q = z.object({ query: z.string().min(1).max(150).optional(), active: z.enum(['true', 'false']).optional(), limit: int(1, 100), offset: int(0, 10_000) }).strict().parse(req.query);
    return run(() => vike.getVikePolymarketMarkets({ ...q, active: q.active === undefined ? undefined : q.active === 'true' }));
  });
  /** Archive METADATA only: the presigned download link is stripped and never leaves the server. */
  app.get('/api/research/vike/polymarket/archive', async (req) => {
    const q = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), stream: z.enum(['book_events', 'trades', 'l1_quotes']), asset: z.string().min(1).max(60).optional(), tenor: z.string().min(1).max(24).optional() }).strict().parse(req.query);
    return run(() => vike.resolveVikePolymarketArchive(q));
  });
}
