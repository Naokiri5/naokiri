import { all, get, getDb } from '../db/db.js';
import { embedder, fromBlob, cosine } from './providers.js';

/**
 * Retrieval (Part 2 Layer 2): keyword (FTS5/BM25), vector ("semantic"; lexical with the default local embedder), and
 * hybrid (reciprocal-rank fusion), with document/author/discipline/chapter/concept/evidence filters. Every hit carries
 * its source. Failed documents are excluded so a failed extraction is never presented as knowledge.
 */
export type Mode = 'keyword' | 'semantic' | 'hybrid';
export interface Filters { documentId?: string; author?: string; discipline?: string; chapter?: string; conceptId?: string; evidenceClass?: string }
export interface Hit { chunkId: string; score: number; documentId: string; title: string | null; filename: string; authors: string | null; edition: string | null; published: string | null;
  discipline: string | null; evidenceClass: string; documentStatus: string; chapter: string | null; heading: string | null; pageStart: number | null; pageEnd: number | null; kind: string; excerpt: string; source: string }

/** Safe FTS5 query: user text is reduced to quoted terms, so FTS syntax in the query cannot be injected. */
export function ftsQuery(q: string, op: 'OR' | 'AND' = 'OR') {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).slice(0, 24).map((w) => `"${w.replace(/"/g, '')}"`);
  return words.join(` ${op} `);
}
function filterSql(f: Filters) {
  const w = ["d.status NOT IN ('FAILED')"]; const p: unknown[] = [];
  if (f.documentId) { w.push('d.id = ?'); p.push(f.documentId); }
  if (f.author) { w.push('lower(d.authors) LIKE ?'); p.push(`%${f.author.toLowerCase()}%`); }
  if (f.discipline) { w.push('d.discipline = ?'); p.push(f.discipline); }
  if (f.chapter) { w.push('lower(k.chapter) LIKE ?'); p.push(`%${f.chapter.toLowerCase()}%`); }
  if (f.evidenceClass) { w.push('d.evidence_class = ?'); p.push(f.evidenceClass); }
  if (f.conceptId) { w.push('k.id IN (SELECT chunk_id FROM kb_concept_sources WHERE concept_id = ?)'); p.push(f.conceptId); }
  return { where: w.join(' AND '), params: p };
}
const COLS = `k.id chunk_id, k.text, k.chapter, k.heading, k.page_start, k.page_end, k.kind, d.id document_id, d.title, d.filename, d.authors, d.edition, d.published, d.discipline, d.evidence_class, d.status`;
function toHit(r: any, score: number): Hit {
  const page = r.page_start ? (r.page_end && r.page_end !== r.page_start ? `pp. ${r.page_start}–${r.page_end}` : `p. ${r.page_start}`) : r.chapter ? `chapter “${r.chapter}”` : 'no page reference (reflowable format)';
  return { chunkId: r.chunk_id, score, documentId: r.document_id, title: r.title, filename: r.filename, authors: r.authors, edition: r.edition, published: r.published, discipline: r.discipline,
    evidenceClass: r.evidence_class, documentStatus: r.status, chapter: r.chapter, heading: r.heading, pageStart: r.page_start, pageEnd: r.page_end, kind: r.kind, excerpt: r.text.slice(0, 900),
    source: `${r.title ?? r.filename}${r.authors ? ` — ${r.authors}` : ''}${r.edition ? `, ${r.edition}` : ''}${r.published ? ` (${String(r.published).slice(0, 4)})` : ''}, ${page}` };
}

export function keywordSearch(q: string, f: Filters = {}, limit = 20): Hit[] {
  const fq = ftsQuery(q); if (!fq) return [];
  const { where, params } = filterSql(f);
  return all<any>(`SELECT ${COLS}, bm25(kb_chunks_fts) s FROM kb_chunks_fts JOIN kb_chunks k ON k.id = kb_chunks_fts.chunk_id JOIN kb_documents d ON d.id = k.document_id
    WHERE kb_chunks_fts MATCH ? AND ${where} ORDER BY s LIMIT ?`, fq, ...params, Math.min(100, limit)).map((r) => toHit(r, -r.s));
}
export function semanticSearch(q: string, f: Filters = {}, limit = 20): Hit[] {
  if (!q.trim()) return [];
  const emb = embedder(); const qv = emb.embed([q])[0]; const { where, params } = filterSql(f);
  const top: { id: string; s: number }[] = [];
  // Streamed scan: rows are read one at a time, so memory stays flat as the library grows.
  for (const r of iterate(`SELECT e.chunk_id, e.vector FROM kb_embeddings e JOIN kb_chunks k ON k.id = e.chunk_id JOIN kb_documents d ON d.id = k.document_id WHERE e.provider = ? AND ${where}`, emb.id, ...params)) {
    const s = cosine(qv, fromBlob(r.vector)); if (s <= 0) continue;
    if (top.length < limit) { top.push({ id: r.chunk_id, s }); top.sort((a, b) => b.s - a.s); } else if (s > top[top.length - 1].s) { top[top.length - 1] = { id: r.chunk_id, s }; top.sort((a, b) => b.s - a.s); }
  }
  return top.map((t) => toHit(get<any>(`SELECT ${COLS} FROM kb_chunks k JOIN kb_documents d ON d.id = k.document_id WHERE k.id = ?`, t.id), t.s));
}
function* iterate(sql: string, ...params: unknown[]): Generator<any> { yield* getDb().prepare(sql).iterate(...(params as any[])) as Iterable<any>; }

/** Reciprocal-rank fusion of keyword and vector rankings (k = 60). */
export function hybridSearch(q: string, f: Filters = {}, limit = 20): Hit[] {
  const a = keywordSearch(q, f, 50), b = semanticSearch(q, f, 50); const score = new Map<string, number>(); const byId = new Map<string, Hit>();
  [a, b].forEach((list) => list.forEach((h, i) => { score.set(h.chunkId, (score.get(h.chunkId) ?? 0) + 1 / (60 + i + 1)); byId.set(h.chunkId, h); }));
  return [...score.entries()].sort((x, y) => y[1] - x[1]).slice(0, limit).map(([id, s]) => ({ ...byId.get(id)!, score: s }));
}
export function search(q: string, mode: Mode = 'hybrid', f: Filters = {}, limit = 20) {
  const hits = mode === 'keyword' ? keywordSearch(q, f, limit) : mode === 'semantic' ? semanticSearch(q, f, limit) : hybridSearch(q, f, limit);
  return { query: q, mode, embedding: { provider: embedder().id, semantic: embedder().semantic }, hits };
}
/** Full passage with its source — the citation endpoint. */
export function citation(chunkId: string) {
  const r = get<any>(`SELECT ${COLS}, k.seq FROM kb_chunks k JOIN kb_documents d ON d.id = k.document_id WHERE k.id = ?`, chunkId); if (!r) return null;
  const h = toHit(r, 0); return { ...h, text: r.text, seq: r.seq };
}
