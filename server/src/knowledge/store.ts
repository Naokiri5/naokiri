import { all, get, run, tx, J, P } from '../db/db.js';
import { uid, sha256 } from '../core/util.js';
import { audit } from '../core/audit.js';
import { bus } from '../core/bus.js';
import { extract, detectFormat, ExtractionError, EXTRACTOR_VERSION, LIMITS, type DocMeta, type Extracted } from './extract.js';
import { chunkDocument, hashText, type ChunkState } from './chunk.js';
import { embedder, toBlob } from './providers.js';
import { PRIORITY_CATALOG, disciplineIds, EVIDENCE_CLASSES, type EvidenceClass } from './taxonomy.js';
import { linkDocumentConcepts, unlinkDocument } from './concepts.js';

/**
 * Knowledge ingestion and catalog (Parts 2 and 4). The original file is stored once and never modified; chunks,
 * embeddings and concept links are DERIVED data that re-processing may replace. A document is only ever reported
 * as indexed after its chunks are committed.
 */
export type DocStatus = 'INGESTION_PENDING' | 'PROCESSING' | 'INDEXED' | 'PARTIALLY_INDEXED' | 'FAILED' | 'NEEDS_REVIEW';
export const PDF_BATCH_PAGES = 40;
const sha = sha256; // shared helper (core/util.ts)
const event = (documentId: string, ev: string, detail?: unknown) => run('INSERT INTO kb_document_events(document_id, ts, event, detail) VALUES (?,?,?,?)', documentId, Date.now(), ev, detail === undefined ? null : J(detail));

// ── catalog ─────────────────────────────────────────────────────────────────
export function seedCatalog() {
  for (const [i, b] of PRIORITY_CATALOG.entries()) run('INSERT OR IGNORE INTO kb_catalog(id,title,authors,discipline,priority,added_at) VALUES (?,?,?,?,?,?)', `cat_${sha(`${b.title}|${b.authors}`).slice(0, 16)}`, b.title, b.authors, b.discipline, i + 1, Date.now());
}
export function importCatalog(actor: string, rows: { title: string; authors: string; discipline: string; notes?: string }[]) {
  if (actor !== 'owner') throw new Error('only the owner may edit the catalog');
  let added = 0;
  tx(() => {
    for (const r of rows) {
      if (!disciplineIds.includes(r.discipline)) throw new Error(`unknown discipline "${r.discipline}"`);
      added += Number(run('INSERT OR IGNORE INTO kb_catalog(id,title,authors,discipline,notes,added_at) VALUES (?,?,?,?,?,?)', `cat_${sha(`${r.title}|${r.authors}`).slice(0, 16)}`, r.title.trim(), r.authors.trim(), r.discipline, r.notes ?? null, Date.now()).changes);
    }
  });
  audit(actor, 'kb.catalog.import', { rows: rows.length, added });
  return { added, skippedDuplicates: rows.length - added };
}
/** Catalog with a derived status. A listing never counts as "read": only committed chunks do. */
export function catalog() {
  return all<any>(`SELECT c.*, d.status doc_status, d.filename, (SELECT COUNT(*) FROM kb_chunks k WHERE k.document_id = c.document_id) chunks
    FROM kb_catalog c LEFT JOIN kb_documents d ON d.id = c.document_id ORDER BY c.priority IS NULL, c.priority, c.discipline, c.title`)
    .map((r) => ({ ...r, status: r.document_id ? (r.doc_status as string) : 'AWAITING_DOCUMENT' }));
}

// ── upload ──────────────────────────────────────────────────────────────────
export interface UploadOptions { catalogId?: string; discipline?: string; evidenceClass?: EvidenceClass }
export function uploadDocument(actor: string, bytes: Buffer, filename: string, opts: UploadOptions = {}) {
  if (actor !== 'owner') throw new Error('only the owner may upload documents');
  const safeName = filename.replace(/[^\w.\- ()]/g, '_').slice(0, 160) || 'document';
  if (!bytes.length) throw new ExtractionError('file is empty', 'EMPTY');
  if (bytes.length > LIMITS.maxUploadBytes) throw new ExtractionError(`file exceeds ${Math.round(LIMITS.maxUploadBytes / 1048576)} MB`, 'TOO_LARGE');
  if (opts.discipline && !disciplineIds.includes(opts.discipline)) throw new Error(`unknown discipline "${opts.discipline}"`);
  if (opts.evidenceClass && !EVIDENCE_CLASSES.includes(opts.evidenceClass)) throw new Error('unknown evidence class');
  if (opts.catalogId && !get('SELECT 1 FROM kb_catalog WHERE id=?', opts.catalogId)) throw new Error('unknown catalog entry');
  const digest = sha(bytes);
  const dup = get<any>('SELECT id, status FROM kb_documents WHERE sha256=?', digest);
  if (dup) return { id: dup.id, duplicate: true, status: dup.status as DocStatus };
  const format = detectFormat(bytes, safeName); // throws UNSUPPORTED/CORRUPT before anything is stored
  const id = uid('doc'); const cat = opts.catalogId ? get<any>('SELECT * FROM kb_catalog WHERE id=?', opts.catalogId) : null;
  tx(() => {
    run(`INSERT INTO kb_documents(id,sha256,filename,format,size_bytes,title,authors,discipline,catalog_id,evidence_class,status,uploaded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, digest, safeName, format, bytes.length, cat?.title ?? null, cat?.authors ?? null, opts.discipline ?? cat?.discipline ?? null,
      opts.catalogId ?? null, opts.evidenceClass ?? 'AUTHOR_INTERPRETATION', 'INGESTION_PENDING', Date.now());
    run('INSERT INTO kb_document_files(document_id, bytes) VALUES (?,?)', id, bytes);
    if (cat) run('UPDATE kb_catalog SET document_id=? WHERE id=?', id, cat.id);
    event(id, 'UPLOADED', { filename: safeName, format, bytes: bytes.length });
  });
  audit(actor, 'kb.document.upload', { id, filename: safeName, format, sha256: digest });
  enqueue(id);
  return { id, duplicate: false, status: 'INGESTION_PENDING' as DocStatus };
}

// ── processing queue (sequential, resumable) ────────────────────────────────
const queue: string[] = []; let busy = false;
export function enqueue(id: string) { if (!queue.includes(id)) queue.push(id); void drain(); }
async function drain() {
  if (busy) return; busy = true;
  try { while (queue.length) { const id = queue.shift()!; await processDocument(id).catch(() => { /* recorded as FAILED inside */ }); } }
  finally { busy = false; }
}
/** On startup: resume anything left pending or mid-processing by a previous run. */
export function resumeIngestion() { for (const d of all<{ id: string }>("SELECT id FROM kb_documents WHERE status IN ('INGESTION_PENDING','PROCESSING') ORDER BY uploaded_at")) enqueue(d.id); }
export const waitForIdle = async () => { while (busy || queue.length) await new Promise((r) => setTimeout(r, 10)); };

function storeChunks(docId: string, chunks: ReturnType<typeof chunkDocument>['chunks']) {
  const emb = embedder(); const vectors = emb.embed(chunks.map((c) => `${c.chapter ?? ''} ${c.heading ?? ''}\n${c.text}`));
  tx(() => chunks.forEach((c, i) => {
    const cid = `chk_${docId.slice(4)}_${c.seq}`;
    run('INSERT INTO kb_chunks(id,document_id,seq,chapter,heading,page_start,page_end,kind,text,hash,tokens,extractor_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      cid, docId, c.seq, c.chapter, c.heading, c.pageStart, c.pageEnd, c.kind, c.text, c.hash, c.tokens, EXTRACTOR_VERSION);
    run('INSERT INTO kb_chunks_fts(text, heading, chunk_id) VALUES (?,?,?)', c.text, [c.chapter, c.heading].filter(Boolean).join(' — '), cid);
    run('INSERT INTO kb_embeddings(chunk_id, provider, dim, vector) VALUES (?,?,?,?)', cid, emb.id, emb.dim, toBlob(vectors[i]));
  }));
}

export async function processDocument(id: string) {
  const doc = get<any>('SELECT * FROM kb_documents WHERE id=?', id); if (!doc) return;
  const file = get<{ bytes: Uint8Array }>('SELECT bytes FROM kb_document_files WHERE document_id=?', id);
  if (!file) { run("UPDATE kb_documents SET status='FAILED', error=? WHERE id=?", 'original file missing', id); return; }
  const bytes = Buffer.from(file.bytes);
  const progress = P<any>(doc.progress, {}); const warnings: string[] = progress.warnings ?? [];
  run("UPDATE kb_documents SET status='PROCESSING', error=NULL, extractor_version=? WHERE id=?", EXTRACTOR_VERSION, id);
  bus.publish('knowledge', { id, status: 'PROCESSING' });
  try {
    let meta: DocMeta = {}; let pages: number | null = null; let unreadable: number[] = progress.unreadable ?? [];
    let state: ChunkState = progress.state ?? { seq: 0, chapter: null, heading: null };
    if (doc.format === 'pdf') {
      // Resumable: commit every PDF_BATCH_PAGES pages; a restart continues after progress.lastPage.
      let from = (progress.lastPage ?? 0) + 1; let total = progress.totalPages ?? Infinity;
      if (from > 1) event(id, 'RESUMED', { fromPage: from });
      while (from <= total) {
        const r: Extracted = await extract(bytes, doc.filename, { fromPage: from, toPage: from + PDF_BATCH_PAGES - 1, allowEmpty: true });
        total = r.pages ?? 0; pages = total; meta = { ...r.meta, ...meta }; unreadable = [...unreadable, ...r.unreadablePages];
        const res = chunkDocument(r.units, state); state = res.state;
        const lastPage = Math.min(total, from + PDF_BATCH_PAGES - 1);
        // Chunks and the resume checkpoint commit together: a crash can never store a batch without its progress
        // (which would duplicate passages on resume) or advance progress past uncommitted passages.
        tx(() => { storeChunks(id, res.chunks); run('UPDATE kb_documents SET progress=?, pages=? WHERE id=?', J({ lastPage, totalPages: total, state, unreadable }), total, id); });
        bus.publish('knowledge', { id, status: 'PROCESSING', page: lastPage, total });
        from = lastPage + 1;
        await new Promise((r2) => setImmediate(r2)); // keep the event loop responsive between batches
      }
      if (!get('SELECT 1 FROM kb_chunks WHERE document_id=? LIMIT 1', id)) throw new ExtractionError(`no extractable text in ${pages} page(s) — likely a scanned PDF; OCR is not configured`, 'EMPTY');
      if (unreadable.length) warnings.push(`${unreadable.length} page(s) had no extractable text (scanned images need OCR, which is not configured)`);
    } else {
      const r = await extract(bytes, doc.filename); meta = r.meta; warnings.push(...r.warnings);
      run('DELETE FROM kb_chunks_fts WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id=?)', id);
      run('DELETE FROM kb_embeddings WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id=?)', id);
      run('DELETE FROM kb_chunks WHERE document_id=?', id);
      storeChunks(id, chunkDocument(r.units).chunks);
    }
    // duplicate content (same text under a different file) and duplicate passages
    const hashes = all<{ hash: string }>('SELECT hash FROM kb_chunks WHERE document_id=? ORDER BY seq', id).map((h) => h.hash);
    const textHash = sha(hashes.join(''));
    const twin = get<any>("SELECT id FROM kb_documents WHERE text_hash=? AND id<>? AND status<>'FAILED'", textHash, id);
    const dupChunks = get<{ n: number }>('SELECT COUNT(*) n FROM kb_chunks a WHERE a.document_id=? AND EXISTS (SELECT 1 FROM kb_chunks b WHERE b.hash=a.hash AND b.document_id<>a.document_id)', id)!.n;
    if (dupChunks) warnings.push(`${dupChunks} passage(s) also appear in other documents`);
    const title = doc.title ?? meta.title ?? null;
    const needsReview = !!twin || !title;
    if (!title) warnings.push('title could not be identified; set it manually');
    const status: DocStatus = needsReview ? 'NEEDS_REVIEW' : unreadable.length ? 'PARTIALLY_INDEXED' : 'INDEXED';
    tx(() => {
      run(`UPDATE kb_documents SET status=?, title=?, authors=COALESCE(authors, ?), edition=COALESCE(edition, ?), publisher=COALESCE(publisher, ?), published=COALESCE(published, ?),
        pages=?, unreadable_pages=?, text_hash=?, duplicate_of=?, processed_at=?, progress=? WHERE id=?`, status, title, meta.authors ?? null, meta.edition ?? null, meta.publisher ?? null,
        meta.published ?? null, pages, J(unreadable), textHash, twin?.id ?? null, Date.now(), J({ done: true, warnings }), id);
      event(id, status, { chunks: hashes.length, warnings, duplicateOf: twin?.id ?? null });
    });
    linkDocumentConcepts(id);
    bus.publish('knowledge', { id, status });
    return status;
  } catch (e: any) {
    const msg = e instanceof ExtractionError ? `${e.code}: ${e.message}` : `PROCESSING_ERROR: ${String(e?.message ?? e).slice(0, 300)}`;
    run("UPDATE kb_documents SET status='FAILED', error=?, processed_at=? WHERE id=?", msg, Date.now(), id);
    event(id, 'FAILED', { error: msg });
    bus.publish('knowledge', { id, status: 'FAILED' });
    throw e;
  }
}

/** Re-process with the current extractor. The original file is kept; derived rows are replaced; history is logged. */
export function reprocessDocument(actor: string, id: string) {
  if (actor !== 'owner') throw new Error('only the owner may re-process documents');
  const doc = get<any>('SELECT * FROM kb_documents WHERE id=?', id); if (!doc) throw new Error('document not found');
  if (doc.status === 'PROCESSING') throw new Error('document is being processed');
  tx(() => {
    unlinkDocument(id);
    run('DELETE FROM kb_chunks_fts WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id=?)', id);
    run('DELETE FROM kb_embeddings WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id=?)', id);
    run('DELETE FROM kb_chunks WHERE document_id=?', id);
    run("UPDATE kb_documents SET status='INGESTION_PENDING', error=NULL, progress='{}', text_hash=NULL, duplicate_of=NULL WHERE id=?", id);
    event(id, 'REPROCESS_REQUESTED', { previousStatus: doc.status, previousExtractor: doc.extractor_version, extractor: EXTRACTOR_VERSION });
  });
  audit(actor, 'kb.document.reprocess', { id });
  enqueue(id);
  return { id, status: 'INGESTION_PENDING' as DocStatus };
}
/** Owner metadata correction. Recorded as an event so the extracted value is not silently lost. */
export function updateDocumentMeta(actor: string, id: string, patch: Partial<Record<'title' | 'authors' | 'edition' | 'publisher' | 'published' | 'discipline' | 'evidence_class', string>>) {
  if (actor !== 'owner') throw new Error('only the owner may edit metadata');
  const doc = get<any>('SELECT * FROM kb_documents WHERE id=?', id); if (!doc) throw new Error('document not found');
  if (patch.discipline && !disciplineIds.includes(patch.discipline)) throw new Error('unknown discipline');
  if (patch.evidence_class && !EVIDENCE_CLASSES.includes(patch.evidence_class as EvidenceClass)) throw new Error('unknown evidence class');
  const cols = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
  tx(() => {
    for (const c of cols) run(`UPDATE kb_documents SET ${c}=? WHERE id=?`, patch[c as keyof typeof patch], id);
    if (doc.status === 'NEEDS_REVIEW' && !doc.duplicate_of && (patch.title || doc.title)) run("UPDATE kb_documents SET status=? WHERE id=?", P<number[]>(doc.unreadable_pages, []).length ? 'PARTIALLY_INDEXED' : 'INDEXED', id);
    event(id, 'METADATA_EDITED', { before: Object.fromEntries(cols.map((c) => [c, doc[c]])), after: patch });
  });
  audit(actor, 'kb.document.meta', { id, fields: cols });
  return get('SELECT * FROM kb_documents WHERE id=?', id);
}

export function listDocuments() {
  return all<any>(`SELECT d.id,d.filename,d.format,d.size_bytes,d.title,d.authors,d.edition,d.publisher,d.published,d.discipline,d.catalog_id,d.evidence_class,d.status,d.error,
    d.pages,d.unreadable_pages,d.duplicate_of,d.progress,d.uploaded_at,d.processed_at,d.extractor_version,(SELECT COUNT(*) FROM kb_chunks k WHERE k.document_id=d.id) chunks
    FROM kb_documents d ORDER BY d.uploaded_at DESC`).map((d) => ({ ...d, unreadable_pages: P(d.unreadable_pages, []), progress: P(d.progress, {}) }));
}
export function documentDetail(id: string) {
  const d = listDocuments().find((x) => x.id === id); if (!d) return null;
  return { ...d, events: all('SELECT ts, event, detail FROM kb_document_events WHERE document_id=? ORDER BY id', id).map((e: any) => ({ ...e, detail: P(e.detail, null) })),
    chapters: all('SELECT chapter, MIN(page_start) page_start, MAX(page_end) page_end, COUNT(*) chunks FROM kb_chunks WHERE document_id=? GROUP BY chapter ORDER BY MIN(seq)', id) };
}
export function libraryStats() {
  const n = (sql: string, ...p: any[]) => get<{ n: number }>(sql, ...p)!.n;
  return {
    catalogued: n('SELECT COUNT(*) n FROM kb_catalog'),
    documents: n('SELECT COUNT(*) n FROM kb_documents'),
    fullyIndexed: n("SELECT COUNT(*) n FROM kb_documents WHERE status='INDEXED'"),
    partiallyIndexed: n("SELECT COUNT(*) n FROM kb_documents WHERE status='PARTIALLY_INDEXED'"),
    needsReview: n("SELECT COUNT(*) n FROM kb_documents WHERE status='NEEDS_REVIEW'"),
    failed: n("SELECT COUNT(*) n FROM kb_documents WHERE status='FAILED'"),
    pending: n("SELECT COUNT(*) n FROM kb_documents WHERE status IN ('INGESTION_PENDING','PROCESSING')"),
    catalogWithDocument: n('SELECT COUNT(*) n FROM kb_catalog WHERE document_id IS NOT NULL'),
    chunks: n('SELECT COUNT(*) n FROM kb_chunks'),
    embeddedChunks: n('SELECT COUNT(*) n FROM kb_embeddings'),
    concepts: n('SELECT COUNT(*) n FROM kb_concepts'),
    conceptsWithSources: n('SELECT COUNT(DISTINCT concept_id) n FROM kb_concept_sources'),
    claims: n('SELECT COUNT(*) n FROM kb_claims'),
    experiments: n('SELECT COUNT(*) n FROM research_experiments'),
    embeddingProvider: embedder().id, semanticEmbeddings: embedder().semantic, extractor: EXTRACTOR_VERSION,
  };
}
export const _hashText = hashText;
