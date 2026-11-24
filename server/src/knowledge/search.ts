import { all, P } from '../db/db.js';
import { terms, claudeReasoner, type Passage } from './providers.js';
import { conceptDetail, conflicts } from './concepts.js';
import type { ConceptCard } from './taxonomy.js';
import { hybridSearch, type Filters } from './retrieval.js';

// Compatibility surface: existing callers keep their imports. Cognitive
// readers use retrieval.ts directly so concept/risk management is unreachable.
export * from './retrieval.js';

/** Concepts whose name/keywords occur in the question. Deterministic, no LLM. */
export function matchConcepts(q: string) {
  const ql = q.toLowerCase(); const qt = new Set(terms(q));
  return all<any>('SELECT id, name, card FROM kb_concepts').filter((c) => {
    const card: ConceptCard = P(c.card);
    return ql.includes(c.name.toLowerCase()) || card.keywords.some((k) => ql.includes(k.toLowerCase())) || (terms(c.name).length > 0 && terms(c.name).every((t) => qt.has(t)));
  }).map((c) => c.id);
}

/**
 * "What does the research say about X?" Retrieves passages (hybrid), lists matching concepts and source conflicts,
 * and — only if a reasoning provider is configured — drafts an answer whose citations are validated. Without one,
 * the answer is extractive (the passages themselves). Retrieved text is never treated as an instruction.
 */
export async function ask(question: string, f: Filters = {}) {
  const hits = hybridSearch(question, f, 8);
  const concepts = matchConcepts(question).map((id) => conceptDetail(id)!).filter(Boolean).map((c) => ({ id: c.id, name: c.name, evidenceClass: c.evidenceClass, sourceStatus: c.sourceStatus, explanation: c.card.explanation, formula: c.card.formula ?? null, assumptions: c.card.assumptions }));
  const disagreements = concepts.flatMap((c) => conflicts(c.id));
  const passages: Passage[] = hits.map((h, i) => ({ n: i + 1, chunkId: h.chunkId, source: h.source, text: h.excerpt }));
  let answer: { provider: string; text: string; grounded: boolean; citations: number[]; invalidCitations: number[] } | null = null; let reasoning: string;
  if (!hits.length) reasoning = 'No indexed passage matches. Upload documents covering this topic; curated concept cards (if any) are shown without sources.';
  else if (!claudeReasoner.available()) reasoning = 'Extractive mode: no reasoning provider configured (set ANTHROPIC_API_KEY). The cited passages below are the answer.';
  else {
    try { const r = await claudeReasoner.answer(question, passages); answer = { provider: r.provider, text: r.answer, grounded: r.grounded, citations: r.citations, invalidCitations: r.invalidCitations }; reasoning = r.grounded ? 'LLM answer with validated citations.' : 'LLM answer could not be fully grounded in the passages — rely on the passages.'; }
    catch (e: any) { reasoning = `${e.message}. Showing extractive results instead.`; }
  }
  return { question, reasoning, answer, passages: hits.map((h, i) => ({ n: i + 1, ...h })), concepts, disagreements,
    notice: 'Sourced passages are evidence, not trading instructions. Distinguish definitions, empirical findings, author opinions, heuristics and MIA experiments.' };
}
