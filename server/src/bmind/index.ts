/**
 * MIA 5.0 B-MIND (M5-U03a) public surface. Read-only behavioral evidence: no orders, no policy changes, no secrets.
 * Not wired into workers, QCI, decisions or the OMS yet; wiring is a later, separately reviewed PR (M5-U05/U06).
 */
export * from './contracts.js';
export { EMOTION_ATLAS, MIA_INPUT_BASELINE, baselineCapabilities, constructById, constructCoverage } from './atlas.js';
export type { ConstructCoverage, CoverageState } from './atlas.js';
export { checkObservation, independentSources } from './observation.js';
export type { ObservationCheck, ObservationReason } from './observation.js';
