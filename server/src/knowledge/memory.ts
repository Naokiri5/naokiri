import { get } from '../db/db.js';
import { brainOverview } from './brain.js';
import { brainBookCoverage } from './cognitive/books.js';

/**
 * Memory architecture (Part 9). MIA does not keep a second memory store: each category A–F maps onto the table that
 * already owns that information, with an explicit freshness/retention policy. Counts are measured, never estimated.
 */
interface Category { id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; name: string; holds: string; stores: string[]; freshness: string; mutable: string }
export const MEMORY_CATEGORIES: Category[] = [
  { id: 'A', name: 'Permanent knowledge', holds: 'Source documents, passages, concept cards, citations', stores: ['kb_documents', 'kb_document_files', 'kb_chunks', 'kb_concepts', 'kb_concept_sources'],
    freshness: 'Permanent; originals never modified. Re-extraction replaces derived passages only.', mutable: 'Derived rows on reprocess; originals immutable' },
  { id: 'B', name: 'Research memory', holds: 'Experiments, hypotheses, verdicts, data hashes, limitations', stores: ['research_experiments', 'backtests', 'research_candles'],
    freshness: 'Permanent and immutable (DB trigger blocks updates). Candle store refreshed on demand.', mutable: 'Never (experiments)' },
  { id: 'C', name: 'Market-state memory', holds: 'Pre-decision snapshots, regimes, consensus evidence', stores: ['ditas_snapshots', 'consensus_records'],
    freshness: 'Point-in-time; valid only for the moment recorded. Live state is recomputed, never read from memory.', mutable: 'Never' },
  { id: 'D', name: 'Decision memory', holds: 'Decisions, rejections, no-signal events, corrections', stores: ['decisions', 'ditas_events'],
    freshness: 'Append-only; corrections are new linked events.', mutable: 'Append-only' },
  { id: 'E', name: 'Outcome & calibration memory', holds: 'Paper orders, fills, positions, ledger, forecast outcomes', stores: ['orders', 'fills', 'positions', 'ledger_entries', 'ditas_forecasts', 'ditas_outcomes'],
    freshness: 'Authoritative paper accounting; calibration recomputed from outcomes.', mutable: 'Ledger append-only' },
  { id: 'F', name: 'Owner & conversation memory', holds: 'Journal, settings, chat, audit trail', stores: ['journal', 'settings', 'chat', 'audit_log'],
    freshness: 'Owner-controlled; audit log append-only.', mutable: 'Journal/settings editable; audit never' },
];
const KNOWN = new Set(MEMORY_CATEGORIES.flatMap((c) => c.stores));
const count = (table: string) => { if (!KNOWN.has(table)) throw new Error('unknown store'); return get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n; };

export function memoryOverview() {
  return {
    categories: MEMORY_CATEGORIES.map((c) => ({ ...c, records: Object.fromEntries(c.stores.map((s) => [s, count(s)])) })),
    authority: 'Memory is evidence. No memory category can authorize a trade; the deterministic decision engine and risk gate remain authoritative.',
    internalIntelligence: brainOverview(),
    cognitiveBookCoverage: brainBookCoverage(),
  };
}
