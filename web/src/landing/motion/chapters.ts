/** The five narrative chapters, in scroll order. Weights are the master prompt's proposed scroll allocation. */
export type ChapterId = 'arrival' | 'meet' | 'brainos' | 'action' | 'journey';

export interface Chapter {
  id: ChapterId;
  number: string;
  title: string;
  district: string;
  /** Proposed share of the page's narrative scroll (start, end), 0–1. Tuned per viewport, not enforced. */
  allocation: readonly [number, number];
}

export const CHAPTERS: readonly Chapter[] = [
  { id: 'arrival', number: '01', title: 'The Arrival', district: 'The Signal District', allocation: [0, 0.16] },
  { id: 'meet', number: '02', title: 'Meet MIA', district: 'The Intelligence District', allocation: [0.16, 0.36] },
  { id: 'brainos', number: '03', title: 'Enter BrainOS', district: 'The Cognitive Lab', allocation: [0.36, 0.6] },
  { id: 'action', number: '04', title: 'Intelligence in Action', district: 'The Trading Studio', allocation: [0.6, 0.86] },
  { id: 'journey', number: '05', title: 'Begin Your Journey', district: 'The Next Horizon', allocation: [0.86, 1] },
];

export const CHAPTER_IDS = CHAPTERS.map((c) => c.id);
