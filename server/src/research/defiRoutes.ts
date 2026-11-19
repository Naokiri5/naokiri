/** Owner-authenticated, read-only DeFi research routes: DefiLlama yields/TVL and Aave V3 flash-loan facts + calculator. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as llama from './defillama.js';
import * as aave from './aave.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
export async function defiRoutes(app: FastifyInstance) {
  app.get('/api/research/defi/yields', async (req) => {
    const q = z.object({ chain: z.string().max(40).optional(), project: z.string().max(60).optional(), stablecoin: bool.optional(), excludeFlagged: bool.optional(),
      minTvlUsd: z.coerce.number().min(0).max(1e13).optional(), sort: z.enum(['apy', 'tvlUsd']).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(req.query);
    return llama.yieldPools(q);
  });
  app.get('/api/research/defi/protocols', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), category: z.string().max(40).optional() }).strict().parse(req.query);
    return llama.topProtocols(q.limit ?? 25, q.category);
  });
  app.get('/api/research/defi/protocol/:slug/tvl', async (req) => {
    const { slug } = z.object({ slug: z.string().max(80) }).strict().parse(req.params);
    return llama.protocolTvl(slug);
  });
  app.get('/api/research/aave/flashloan', async (req) => {
    const q = z.object({ assets: z.string().regex(/^[A-Za-z0-9_.,]{1,200}$/).optional() }).strict().parse(req.query);
    return aave.flashLoanReserves(q.assets ? q.assets.split(',').filter(Boolean) : undefined);
  });
  app.get('/api/research/aave/flashloan/simulate', async (req) => {
    const n = z.coerce.number();
    const q = z.object({ principalUsd: n, premiumBps: n, grossSpreadBps: n, dexFeeBps: n.optional(), slippageBps: n.optional(), gasUnits: n.optional(), gasPriceGwei: n.optional(), ethUsd: n.optional() }).strict().parse(req.query);
    return aave.flashLoanEconomics(q);
  });
}
