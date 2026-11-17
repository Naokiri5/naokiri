import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DISCIPLINES, EVIDENCE_CLASSES, disciplineIds, type EvidenceClass } from './taxonomy.js';
import { LIMITS } from './extract.js';
import { catalog, importCatalog, uploadDocument, listDocuments, documentDetail, reprocessDocument, updateDocumentMeta, libraryStats } from './store.js';
import { listConcepts, conceptDetail, createConcept, addClaim, conflicts, researchSpec } from './concepts.js';
import { search, ask, citation } from './search.js';
import { runExperiment, listExperiments, experimentDetail, compareStrategies, paperExperimentStatus, candleInventory } from './research.js';
import { memoryOverview } from './memory.js';
import { domainKnowledge } from './integration.js';

/**
 * Academy API. Registered inside the authenticated API plugin, so every route inherits the session check and the
 * CSRF header requirement for state changes. Handlers only validate and delegate to the knowledge services.
 */
export async function knowledgeRoutes(app: FastifyInstance) {
  const id = z.string().min(1).max(150);
  const pid = (r: any) => z.object({ id }).parse(r.params).id;
  const evidence = z.enum(EVIDENCE_CLASSES as [EvidenceClass, ...EvidenceClass[]]);
  const discipline = z.enum(disciplineIds as [string, ...string[]]);
  const filters = z.object({ documentId: id.optional(), author: z.string().max(200).optional(), discipline: discipline.optional(), chapter: z.string().max(200).optional(), conceptId: id.optional(), evidenceClass: evidence.optional() });
  const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { statusCode: 404 });

  // Binary uploads: raw bytes with the filename in a header. Scoped to this route's content type only.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: LIMITS.maxUploadBytes }, (_req, body, done) => done(null, body));

  app.get('/api/academy/stats', async () => libraryStats());
  app.get('/api/academy/disciplines', async () => DISCIPLINES);
  app.get('/api/academy/catalog', async () => catalog());
  app.post('/api/academy/catalog/import', async (req) => {
    const rows = z.array(z.object({ title: z.string().trim().min(1).max(300), authors: z.string().trim().min(1).max(300), discipline, notes: z.string().max(1000).optional() }).strict()).min(1).max(500).parse(req.body);
    return importCatalog('owner', rows);
  });
  app.post('/api/academy/documents', { bodyLimit: LIMITS.maxUploadBytes }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw Object.assign(new Error('send the file as application/octet-stream'), { statusCode: 415 });
    const q = z.object({ catalogId: id.optional(), discipline: discipline.optional(), evidenceClass: evidence.optional() }).parse(req.query);
    const raw = req.headers['x-filename']; const filename = z.string().min(1).max(500).parse(typeof raw === 'string' ? decodeURIComponent(raw) : undefined);
    return uploadDocument('owner', req.body, filename, q);
  });
  app.get('/api/academy/documents', async () => listDocuments());
  app.get('/api/academy/documents/:id', async (req) => documentDetail(pid(req)) ?? Promise.reject(notFound('document')));
  app.post('/api/academy/documents/:id/reprocess', async (req) => reprocessDocument('owner', pid(req)));
  app.patch('/api/academy/documents/:id', async (req) => {
    const s = z.string().trim().max(300);
    const b = z.object({ title: s.optional(), authors: s.optional(), edition: s.optional(), publisher: s.optional(), published: s.optional(), discipline: discipline.optional(), evidence_class: evidence.optional() }).strict().parse(req.body);
    return updateDocumentMeta('owner', pid(req), b);
  });

  app.get('/api/academy/search', async (req) => {
    const q = z.object({ q: z.string().trim().min(1).max(500), mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid'), limit: z.coerce.number().int().min(1).max(100).default(20) }).merge(filters).parse(req.query);
    const { q: text, mode, limit, ...f } = q; return search(text, mode, f, limit);
  });
  app.post('/api/academy/ask', async (req) => { const b = z.object({ question: z.string().trim().min(3).max(1000), filters: filters.optional() }).strict().parse(req.body); return ask(b.question, b.filters ?? {}); });
  app.get('/api/academy/citations/:id', async (req) => citation(pid(req)) ?? Promise.reject(notFound('passage')));

  app.get('/api/academy/concepts', async () => listConcepts());
  app.get('/api/academy/concepts/:id', async (req) => conceptDetail(pid(req)) ?? Promise.reject(notFound('concept')));
  app.post('/api/academy/concepts', async (req) => createConcept('owner', req.body));
  app.post('/api/academy/claims', async (req) => {
    const b = z.object({ conceptId: id, chunkId: id, proposition: z.string().trim().min(3).max(500), stance: z.enum(['SUPPORTS', 'CONTRADICTS', 'QUALIFIES']), evidenceClass: evidence, quote: z.string().trim().min(3).max(2000) }).strict().parse(req.body);
    return addClaim('owner', b);
  });
  app.get('/api/academy/conflicts', async (req) => conflicts(z.object({ conceptId: id.optional() }).parse(req.query).conceptId));
  app.get('/api/academy/concepts/:id/research-spec', async (req) => {
    const q = z.object({ symbol: z.string().regex(/^[A-Z0-9]{5,20}$/).optional(), interval: z.enum(['15m', '1h', '4h']).optional(), strategyId: z.string().max(60).optional() }).parse(req.query);
    return researchSpec(pid(req), q);
  });

  const interval = z.enum(['15m', '1h', '4h']);
  app.post('/api/academy/experiments', async (req) => {
    const b = z.object({ kind: z.enum(['volatility_clustering', 'return_autocorrelation', 'strategy_walkforward']), symbol: z.string().regex(/^[A-Z0-9]{5,20}$/), interval, bars: z.number().int().min(500).max(8000).optional(), strategyId: z.string().max(60).optional(), conceptId: id.optional(), seed: z.number().int().min(0).max(2 ** 31).optional() }).strict().parse(req.body);
    return runExperiment('owner', b);
  });
  app.get('/api/academy/experiments', async () => listExperiments());
  app.get('/api/academy/experiments/:id', async (req) => experimentDetail(pid(req)) ?? Promise.reject(notFound('experiment')));
  app.post('/api/academy/strategy-comparison', async (req) => { const b = z.object({ symbol: z.string().regex(/^[A-Z0-9]{5,20}$/), interval: interval.default('1h'), bars: z.number().int().min(1500).max(8000).default(4000) }).strict().parse(req.body); return compareStrategies('owner', b.symbol, b.interval, b.bars); });
  app.get('/api/academy/paper-experiment', async () => paperExperimentStatus());
  app.get('/api/academy/candles', async () => candleInventory());
  app.get('/api/academy/memory', async () => memoryOverview());
  app.get('/api/academy/domain-concepts', async () => domainKnowledge());
}
