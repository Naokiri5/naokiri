import { executionQuality } from './execution.js';
import { strategyOutcomeSummary, tradeOutcomes, verifyTradeOutcomes } from './tradeOutcomes.js';
import { intelligenceEvaluation } from './evaluation.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../core/audit.js';
import { memoryDetail, correctEvent, verifyMemory } from './memory.js';
import { ditasOverview, runDecisionTwin, similarEnvironments, addForecast, addOutcome, calibrationFor } from './service.js';

/** Registered on existing authenticated API instance; state changes inherit its CSRF boundary. */
export async function ditasRoutes(app: FastifyInstance) {
  app.get('/api/ditas/execution', async req => executionQuality(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query).limit));
  // Closed-trade learning records: read-only evidence, never trading authority.
  app.get('/api/ditas/trade-outcomes', async req => tradeOutcomes(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query).limit));
  app.get('/api/ditas/trade-outcomes/summary', async () => strategyOutcomeSummary());
  app.get('/api/ditas/trade-outcomes/verify', async () => verifyTradeOutcomes());
  app.get('/api/ditas/evaluation', async () => intelligenceEvaluation());
  const id = z.string().min(1).max(150);
  const params = (r: any) => z.object({ id }).parse(r.params).id;
  const candle = z.object({ t: z.number().int().nonnegative(), o: z.number().positive(), h: z.number().positive(), l: z.number().positive(), c: z.number().positive(), v: z.number().nonnegative(), closeTime: z.number().optional() });
  app.get('/api/ditas', async req => ditasOverview(z.object({ cohort: z.string().max(1000).optional() }).parse(req.query).cohort));
  app.get('/api/ditas/verify', async () => verifyMemory());
  app.get('/api/ditas/events/:id', async (req, reply) => { const d = memoryDetail(params(req)); return d ?? reply.code(404).send({ error: 'event not found' }); });
  app.get('/api/ditas/events/:id/similar', async req => similarEnvironments(params(req)));
  app.post('/api/ditas/events/:id/corrections', async req => {
    const b = z.object({ reason: z.string().trim().min(1).max(1000), correction: z.string().trim().min(1).max(5000) }).strict().parse(req.body);
    const result = correctEvent(params(req), b.reason, b.correction); audit('owner', 'ditas.correction', { eventId: result.id, parentEventId: result.parentEventId }); return result;
  });
  app.post('/api/ditas/twins', async req => {
    const b = z.object({ eventId: id, candles: z.array(candle).min(1).max(2000), sourceReference: z.string().trim().min(1).max(500), assumptions: z.object({ feeRate: z.number().min(0).max(0.1), spreadBps: z.number().min(0).max(1000), slippageBps: z.number().min(0).max(1000), notional: z.number().positive().max(100000000), maxParticipationRate: z.number().positive().max(1), entryDelayBars: z.number().int().min(1).max(100).optional() }).strict() }).strict().parse(req.body);
    const result = runDecisionTwin(b.eventId, b.candles, b.assumptions, b.sourceReference); audit('owner', 'ditas.twin', { id: result.id, eventId: b.eventId }); return result;
  });
  app.post('/api/ditas/forecasts', async req => {
    const b = z.object({ eventId: id, probability: z.number().min(0).max(1), targetAt: z.number().int().positive(), referencePrice: z.number().positive(), modelVersion: z.string().trim().min(1).max(100), promptVersion: z.string().trim().min(1).max(100) }).strict().parse(req.body);
    const result = addForecast(b.eventId, b.probability, b.targetAt, b.referencePrice, b.modelVersion, b.promptVersion); audit('owner', 'ditas.forecast', { id: result.id }); return result;
  });
  app.post('/api/ditas/outcomes', async req => {
    const b = z.object({ forecastId: id, observedPrice: z.number().positive(), observedAt: z.number().int().positive(), sourceReference: z.string().trim().min(1).max(500) }).strict().parse(req.body);
    const result = addOutcome(b.forecastId, b.observedPrice, b.observedAt, b.sourceReference); audit('owner', 'ditas.outcome', { id: result.id, forecastId: result.forecastId }); return result;
  });
  app.get('/api/ditas/calibration', async req => calibrationFor(z.object({ cohort: z.string().max(1000).optional() }).parse(req.query).cohort));
}
