import { search, readBookCoverage, readBookChunkHash } from '../retrieval.js';
import type { BrainKnowledgeClaim, CognitiveEvidenceClass } from './contracts.js';

/**
 * One source of truth: existing kb_documents/chunks/catalog. No new 'academy'
 * database, and no claim that 100 books were ingested merely because titles exist.
 */
export interface BrainBookCoverage {
  targetBooks: 100;
  catalogTitles: number;
  uploadedDocuments: number;
  indexedDocuments: number;
  partiallyIndexedDocuments: number;
  needsReviewDocuments: number;
  failedDocuments: number;
  citedPassages: number;
  readyCatalogBooks: number;
  memorySource: 'EXISTING_KB_TABLES';
}
export function brainBookCoverage(): BrainBookCoverage {
  const { d, catalog, citations, linked } = readBookCoverage();
  return { targetBooks: 100, catalogTitles:catalog, uploadedDocuments:d.uploaded,
    indexedDocuments:d.indexed_count??0,partiallyIndexedDocuments:d.partial_count??0,
    needsReviewDocuments:d.review_count??0,failedDocuments:d.failed_count??0,
    citedPassages:citations,readyCatalogBooks:linked,memorySource:'EXISTING_KB_TABLES' };
}
const EVIDENCE: CognitiveEvidenceClass[] = [
  'MATHEMATICAL_DEFINITION','EMPIRICAL_FINDING','AUTHOR_INTERPRETATION',
  'TRADING_HEURISTIC','MIA_EXPERIMENT','UNVERIFIED_HYPOTHESIS',
];

/**
 * Read indexed authorized book passages with real page + chunk hashes.
 * An extracted passage is UNVERIFIED by default, even if the document's
 * declared evidence class is EMPIRICAL_FINDING. No fake summaries or citations.
 */
export function retrieveBrainBookClaims(query: string, limit = 8): BrainKnowledgeClaim[] {
  if (!query.trim()) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_BOOK_RETRIEVAL_LIMIT');
  const hits = search(query,'hybrid',{},limit).hits;
  const claims: BrainKnowledgeClaim[] = [];
  for (const hit of hits) {
    if (hit.documentStatus !== 'INDEXED' && hit.documentStatus !== 'PARTIALLY_INDEXED')
      continue;
    if (!Number.isSafeInteger(hit.pageStart) || (hit.pageStart ?? 0) < 1) continue;
    const stored = readBookChunkHash(hit.chunkId,hit.documentId);
    if (!stored?.hash) continue;
    claims.push({
      claimId: 'passage:'+hit.chunkId,
      sourceDocumentId:hit.documentId,sourcePage:hit.pageStart!,
      sourceHash:stored.hash,conceptId:hit.discipline??'unclassified',
      claim:hit.excerpt, evidenceClass:EVIDENCE.includes(hit.evidenceClass as CognitiveEvidenceClass)
        ? hit.evidenceClass as CognitiveEvidenceClass : 'UNVERIFIED_HYPOTHESIS',
      contradictions:[], validationStatus:'UNVERIFIED',effectiveWeight:0,
    });
  }
  return claims;
}
/** No indexed book is ever treated as a trade signal or an executable strategy. */
export const BOOK_MEMORY_AUTHORITY = 'RESEARCH_CONTEXT_ONLY' as const;
