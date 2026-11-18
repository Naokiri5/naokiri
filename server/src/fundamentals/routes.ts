import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { secCik, secFilings, secUnavailable } from '../providers/sec.js';

/** Registered inside the owner-authenticated API plugin. */
export async function filingRoutes(app: FastifyInstance) {
  app.get('/api/research/filings/:cik', async (req, reply) => {
    const { cik } = z.object({ cik: secCik }).parse(req.params);
    const { asOf, limit } = z.object({
      asOf: z.iso.datetime().optional(),
      limit: z.string().regex(/^(?:[1-9]\d?|100)$/).transform(Number).default(30),
    }).parse(req.query);
    const now = Date.now();
    if (asOf !== undefined && Date.parse(asOf) > now) return reply.code(400).send({ error: 'asOf must be at or before the current time' });
    const unavailable = secUnavailable();
    if (unavailable) return reply.code(503).send({ source: 'sec_edgar', status: 'UNAVAILABLE', error: unavailable });
    return secFilings(cik, new Date(asOf ?? now).toISOString(), limit);
  });
}
