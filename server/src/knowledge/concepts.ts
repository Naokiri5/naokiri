import { z } from 'zod';
import { all, get, run, tx, J, P } from '../db/db.js';
import { uid } from '../core/util.js';
import { audit } from '../core/audit.js';
import { CONCEPT_CARDS, DISCIPLINES, EVIDENCE_CLASSES, STRATEGY_CONCEPTS, disciplineIds, type ConceptCard, type EvidenceClass } from './taxonomy.js';
import { currentPolicy, DEFAULT_POLICY } from '../risk/policy.js';
import { strategyById } from '../lab/strategies.js';

/**
 * Knowledge interpretation (Part 2 Layer 3, Part 8). Concept cards are linked to source passages; claims keep their
 * source, evidence class and stance; disagreements are reported side by side and never merged into one verdict.
 */
export const ConceptCardSchema = z.object({
  name: z.string().min(2).max(120), discipline: z.enum(disciplineIds as [string, ...string[]]), evidenceClass: z.enum(EVIDENCE_CLASSES as [EvidenceClass, ...EvidenceClass[]]),
  explanation: z.string().min(10).max(4000), formula: z.string().max(1000).optional(),
  inputs: z.array(z.string().max(300)).max(30), assumptions: z.array(z.string().max(300)).max(30), appliesWhen: z.array(z.string().max(300)).max(30),
  failsWhen: z.array(z.string().max(300)).max(30), applications: z.array(z.string().max(300)).max(30), risks: z.array(z.string().max(300)).max(30),
  related: z.array(z.string().max(120)).max(30), keywords: z.array(z.string().min(2).max(60)).min(1).max(30),
  experiment: z.enum(['volatility_clustering', 'return_autocorrelation', 'strategy_walkforward']).optional(), miaComponents: z.array(z.string().max(200)).max(20),
});
const conceptId = (name: string) => `con_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48)}`;

export function seedConcepts() {
  for (const c of CONCEPT_CARDS) run('INSERT OR IGNORE INTO kb_concepts(id,name,discipline,origin,evidence_class,card,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', conceptId(c.name), c.name, c.discipline, 'CURATED', c.evidenceClass, J(c), Date.now(), Date.now());
}
export function createConcept(actor: string, input: unknown) {
  if (actor !== 'owner') throw new Error('only the owner may add concepts');
  const card = ConceptCardSchema.parse(input);
  const id = conceptId(card.name); if (get('SELECT 1 FROM kb_concepts WHERE id=? OR name=?', id, card.name)) throw new Error('a concept with this name already exists');
  run('INSERT INTO kb_concepts(id,name,discipline,origin,evidence_class,card,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, card.name, card.discipline, 'OWNER', card.evidenceClass, J(card), Date.now(), Date.now());
  audit(actor, 'kb.concept.create', { id }); relinkAll(id);
  return conceptDetail(id);
}

const ftsQuery = (kw: string[]) => kw.map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
const DEFINES = (name: string) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/)[0]}[\\w\\s()-]{0,40}\\b(?:is|are)\\s+(?:defined as|the|a|an|given by|measured)`, 'i');
const POS = /\b(evidence (?:shows|suggests|supports)|robust|persistent|well[- ]documented|consistently|significant(?:ly)?|works|profitable)\b/i;
const NEG = /\b(no (?:evidence|support)|not (?:supported|significant|robust|profitable)|fails?|failed|does not (?:hold|work|persist)|spurious|disappear(?:s|ed)?|myth|overstated)\b/i;

/** Link one document's passages to every concept by keyword (FTS), record definitions, and extract CANDIDATE claims. */
/** Idempotent: re-linking replaces this document's AUTO_CANDIDATE claims for the concepts being linked (owner claims are kept). */
export function linkDocumentConcepts(documentId: string, conceptIds?: string[]) {
  const concepts = conceptIds ? all<any>(`SELECT * FROM kb_concepts WHERE id IN (${conceptIds.map(() => '?').join(',') || "''"})`, ...conceptIds) : all<any>('SELECT * FROM kb_concepts');
  const doc = get<any>('SELECT evidence_class FROM kb_documents WHERE id=?', documentId);
  tx(() => {
    for (const c of concepts) {
      run("DELETE FROM kb_claims WHERE document_id=? AND concept_id=? AND origin='AUTO_CANDIDATE'", documentId, c.id);
      const card: ConceptCard = P(c.card);
      const rows = all<any>(`SELECT k.id, k.text, k.page_start, bm25(kb_chunks_fts) s FROM kb_chunks_fts f JOIN kb_chunks k ON k.id = f.chunk_id
        WHERE kb_chunks_fts MATCH ? AND k.document_id = ? ORDER BY s LIMIT 25`, ftsQuery(card.keywords), documentId);
      for (const r of rows) {
        const defines = DEFINES(card.name).test(r.text);
        run('INSERT OR REPLACE INTO kb_concept_sources(concept_id, chunk_id, relation, score) VALUES (?,?,?,?)', c.id, r.id, defines ? 'DEFINES' : 'DISCUSSES', -r.s);
        for (const sentence of r.text.split(/(?<=[.!?])\s+/)) {
          if (sentence.length > 400 || !card.keywords.some((k) => sentence.toLowerCase().includes(k.toLowerCase()))) continue;
          const neg = NEG.test(sentence), pos = POS.test(sentence); if (neg === pos) continue;
          run('INSERT INTO kb_claims(id,concept_id,proposition,stance,evidence_class,chunk_id,document_id,page,quote,origin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            uid('clm'), c.id, `${c.name} holds / is effective`, neg ? 'CONTRADICTS' : 'SUPPORTS', doc?.evidence_class ?? 'AUTHOR_INTERPRETATION', r.id, documentId, r.page_start, sentence.trim(), 'AUTO_CANDIDATE', Date.now());
        }
      }
    }
  });
}
export function unlinkDocument(documentId: string) {
  run("DELETE FROM kb_claims WHERE document_id=? AND origin='AUTO_CANDIDATE'", documentId);
  run('UPDATE kb_claims SET chunk_id=NULL WHERE document_id=?', documentId); // owner claims keep quote + page as provenance
  run('DELETE FROM kb_concept_sources WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id=?)', documentId);
}
/** Link one (new) concept across all indexed documents without touching other concepts' claims. */
function relinkAll(conceptId: string) { for (const d of all<{ id: string }>("SELECT id FROM kb_documents WHERE status NOT IN ('FAILED','INGESTION_PENDING','PROCESSING')")) linkDocumentConcepts(d.id, [conceptId]); }

/** Owner-recorded claim from a specific passage (the reliable path; auto candidates are only hints). */
export function addClaim(actor: string, input: { conceptId: string; chunkId: string; proposition: string; stance: 'SUPPORTS' | 'CONTRADICTS' | 'QUALIFIES'; evidenceClass: EvidenceClass; quote: string }) {
  if (actor !== 'owner') throw new Error('only the owner may record claims');
  const chunk = get<any>('SELECT * FROM kb_chunks WHERE id=?', input.chunkId); if (!chunk) throw new Error('passage not found');
  if (!get('SELECT 1 FROM kb_concepts WHERE id=?', input.conceptId)) throw new Error('concept not found');
  if (!chunk.text.includes(input.quote.trim())) throw new Error('quote must appear verbatim in the cited passage');
  const id = uid('clm');
  run('INSERT INTO kb_claims(id,concept_id,proposition,stance,evidence_class,chunk_id,document_id,page,quote,origin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, input.conceptId, input.proposition.trim(), input.stance, input.evidenceClass, chunk.id, chunk.document_id, chunk.page_start, input.quote.trim(), 'OWNER', Date.now());
  audit(actor, 'kb.claim.add', { id, conceptId: input.conceptId });
  return { id };
}

const sourceLabel = (d: any, page: number | null) => `${d.title ?? d.filename}${d.authors ? ` — ${d.authors}` : ''}${d.edition ? `, ${d.edition}` : ''}${d.published ? ` (${String(d.published).slice(0, 4)})` : ''}${page ? `, p. ${page}` : ''}`;

/** Conflicting claims: same concept and proposition, opposing stances, from different documents. Never merged. */
export function conflicts(conceptIdFilter?: string) {
  const claims = all<any>(`SELECT c.*, d.title, d.filename, d.authors, d.edition, d.published FROM kb_claims c LEFT JOIN kb_documents d ON d.id = c.document_id
    ${conceptIdFilter ? 'WHERE c.concept_id = ?' : ''} ORDER BY c.created_at`, ...(conceptIdFilter ? [conceptIdFilter] : []));
  const groups = new Map<string, any[]>();
  for (const c of claims) { const k = `${c.concept_id}|${c.proposition.toLowerCase()}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const out = [];
  for (const g of groups.values()) {
    const sup = g.filter((c) => c.stance === 'SUPPORTS'), con = g.filter((c) => c.stance === 'CONTRADICTS');
    if (!sup.length || !con.length || new Set(g.map((c) => c.document_id)).size < 2) continue;
    const concept = get<any>('SELECT name, card FROM kb_concepts WHERE id=?', g[0].concept_id); const card: ConceptCard = P(concept.card);
    const view = (c: any) => ({ id: c.id, stance: c.stance, evidenceClass: c.evidence_class, origin: c.origin, quote: c.quote, source: sourceLabel(c, c.page), published: c.published });
    out.push({
      concept: concept.name, proposition: g[0].proposition, supporting: sup.map(view), contradicting: con.map(view),
      autoCandidatesOnly: g.every((c) => c.origin === 'AUTO_CANDIDATE'),
      resolution: [
        card.experiment ? `Run the "${card.experiment}" experiment on the relevant market/timeframe and record the result as MIA_EXPERIMENT evidence.` : 'Define a measurable hypothesis and test it out-of-sample.',
        'Compare the sources\' assumptions, sample periods, markets and publication dates; newer data or different regimes often explain disagreement.',
        'Prefer empirical findings with stated methodology over interpretations and heuristics; check replication status.',
      ],
    });
  }
  return out;
}

export function listConcepts() {
  return all<any>(`SELECT c.id, c.name, c.discipline, c.origin, c.evidence_class, c.card,
      (SELECT COUNT(*) FROM kb_concept_sources s WHERE s.concept_id = c.id) sources,
      (SELECT COUNT(*) FROM kb_concept_sources s WHERE s.concept_id = c.id AND s.relation='DEFINES') definitions,
      (SELECT COUNT(*) FROM kb_claims k WHERE k.concept_id = c.id) claims,
      (SELECT COUNT(*) FROM research_experiments e WHERE e.concept_id = c.id) experiments
    FROM kb_concepts c ORDER BY c.discipline, c.name`).map((c) => { const card = P<ConceptCard>(c.card); return { ...c, card: undefined, explanation: card.explanation, experiment: card.experiment ?? null, related: card.related }; });
}
export function findConcept(idOrName: string) { return get<any>('SELECT * FROM kb_concepts WHERE id=? OR lower(name)=lower(?)', idOrName, idOrName); }
export function conceptDetail(idOrName: string) {
  const c = findConcept(idOrName); if (!c) return null;
  const card: ConceptCard = P(c.card);
  const sources = all<any>(`SELECT s.relation, s.score, k.id chunk_id, k.text, k.page_start, k.page_end, k.chapter, k.heading, d.id document_id, d.title, d.filename, d.authors, d.edition, d.published, d.evidence_class, d.status
    FROM kb_concept_sources s JOIN kb_chunks k ON k.id = s.chunk_id JOIN kb_documents d ON d.id = k.document_id WHERE s.concept_id = ? ORDER BY s.relation = 'DEFINES' DESC, s.score DESC LIMIT 30`, c.id)
    .map((r) => ({ relation: r.relation, chunkId: r.chunk_id, documentId: r.document_id, documentStatus: r.status, evidenceClass: r.evidence_class, chapter: r.chapter, heading: r.heading, pageStart: r.page_start, pageEnd: r.page_end, source: sourceLabel(r, r.page_start), excerpt: r.text.slice(0, 700) }));
  const claims = all<any>('SELECT c.*, d.title, d.filename, d.authors, d.edition, d.published FROM kb_claims c LEFT JOIN kb_documents d ON d.id = c.document_id WHERE c.concept_id=? ORDER BY c.created_at DESC LIMIT 100', c.id)
    .map((x) => ({ id: x.id, proposition: x.proposition, stance: x.stance, evidenceClass: x.evidence_class, origin: x.origin, quote: x.quote, chunkId: x.chunk_id, source: x.document_id ? sourceLabel(x, x.page) : null }));
  const experiments = all<any>('SELECT id, created_at, kind, hypothesis, verdict FROM research_experiments WHERE concept_id=? ORDER BY created_at DESC', c.id);
  return { id: c.id, name: c.name, discipline: c.discipline, disciplineName: DISCIPLINES.find((d) => d.id === c.discipline)?.name, origin: c.origin, evidenceClass: c.evidence_class, card,
    sourceStatus: sources.length ? `${sources.length} linked passage(s)` : 'no supporting source yet — upload a document that covers this concept', sources, claims, conflicts: conflicts(c.id), experiments };
}

/** Part 5D research specification for a concept. Feeds knowledge/research.ts; never authorizes a trade. */
export function researchSpec(idOrName: string, opts: { symbol?: string; interval?: string; strategyId?: string } = {}) {
  const d = conceptDetail(idOrName); if (!d) throw new Error('concept not found');
  const pol = currentPolicy()?.policy ?? DEFAULT_POLICY;
  const kind = d.card.experiment ?? null;
  const strategyId = opts.strategyId ?? (kind === 'strategy_walkforward' ? 'trend_pullback' : Object.entries(STRATEGY_CONCEPTS).find(([, cs]) => cs.includes(d.name))?.[0]);
  const strat = strategyId ? strategyById(strategyId) : undefined;
  const symbol = (opts.symbol ?? 'BTCUSDT').toUpperCase(); const interval = opts.interval ?? '1h';
  const hypothesis = kind === 'volatility_clustering' ? `On ${symbol} ${interval} returns, absolute returns are positively autocorrelated at lags 1–10 beyond what a shuffled (i.i.d.) series shows.`
    : kind === 'return_autocorrelation' ? `On ${symbol} ${interval}, the lag-1..5 autocorrelation of returns differs from zero (${d.name === 'Mean reversion' ? 'negative ⇒ mean reversion' : 'positive ⇒ momentum'}).`
    : kind === 'strategy_walkforward' && strat ? `The ${strat.name} rule has positive expectancy after costs in every out-of-sample walk-forward window on ${symbol} ${interval}.`
    : `${d.name}: no executable test is defined yet; formulate a measurable hypothesis first.`;
  return {
    concept: d.name, conceptId: d.id, experimentKind: kind, hypothesis, testable: !!kind,
    sources: d.sources.slice(0, 8).map((s) => ({ source: s.source, chunkId: s.chunkId, relation: s.relation })),
    sourceStatus: d.sourceStatus, mathematicalSpecification: d.card.formula ?? d.card.explanation,
    requiredData: [`${symbol} ${interval} OHLCV candles (Binance public market data, stored in research_candles)`, ...d.card.inputs],
    entryConditions: strat ? strat.description : kind === 'strategy_walkforward' ? 'see strategy definition' : 'not a trading rule — statistical test only',
    exitConditions: strat ? 'strategy capsule exits (stop, targets, trailing, time stop) via lab/exits.ts' : 'n/a',
    positionSizing: `fixed fractional ${pol.riskPerTradePct}% risk per trade (risk policy); results reported in R so they are size-independent`,
    transactionCosts: { feeRatePerSide: pol.feeRate, slippageBps: 3, spreadBps: 2 },
    benchmark: kind === 'strategy_walkforward' ? 'buy-and-hold over each test window, and zero (cash)' : 'shuffled-return null distribution (same values, random order)',
    validation: kind === 'strategy_walkforward' ? 'rolling walk-forward: fixed-parameter rule, 5 sequential test windows, purge of trades overlapping a window boundary, embargo of 24 bars after each window'
      : 'statistic computed on the full sample and on a chronological first/second half split; compared with 200 shuffled series (seeded)',
    failureConditions: [...d.card.failsWhen, 'result not significant against the null', 'sign flips between halves or windows', 'too few observations or trades'],
    assumptions: d.card.assumptions, limitations: ['Historical results do not establish future profitability.', 'Single venue (Binance spot); survivorship bias in universe selection.'],
    authority: 'Research only. Any strategy derived from this must still pass the Strategy Lab promotion gate, the deterministic risk engine and paper trading. No live deployment.',
  };
}
