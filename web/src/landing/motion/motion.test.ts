import { describe, expect, it } from 'vitest';
import { MOTION_REGISTRY } from './motionRegistry';
import { CHAPTERS, CHAPTER_IDS } from './chapters';
import { chapterProgress } from './sceneController';
import { characterStateFor, CHARACTER_STATES } from './characterStates';

describe('motion registry', () => {
  it('documents all twenty techniques exactly once with a fallback', () => {
    const ids = MOTION_REGISTRY.map((t) => t.id);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`));
    for (const t of MOTION_REGISTRY) {
      expect(t.fallback.length).toBeGreaterThan(5);
      expect(t.chapters.length).toBeGreaterThan(0);
      for (const c of t.chapters) expect(CHAPTER_IDS).toContain(c);
      if (t.status !== 'implemented') expect(t.note ?? t.fallback).toBeTruthy();
    }
  });

  it('keeps exactly five chapters with contiguous allocations', () => {
    expect(CHAPTERS).toHaveLength(5);
    expect(CHAPTERS[0].allocation[0]).toBe(0);
    expect(CHAPTERS[4].allocation[1]).toBe(1);
    for (let i = 1; i < CHAPTERS.length; i++) expect(CHAPTERS[i].allocation[0]).toBe(CHAPTERS[i - 1].allocation[1]);
  });
});

describe('chapter progress', () => {
  const vh = 800;
  it('maps visibility from entering the bottom to leaving the top', () => {
    expect(chapterProgress(800, 1000, vh).view).toBe(0);
    expect(chapterProgress(-1000, 1000, vh).view).toBe(1);
    expect(chapterProgress(-100, 1000, vh).view).toBeCloseTo(0.5, 5);
  });
  it('maps pinned progress across the sticky travel and clamps outside it', () => {
    expect(chapterProgress(100, 2400, vh).pin).toBe(0);
    expect(chapterProgress(-800, 2400, vh).pin).toBeCloseTo(0.5, 5);
    expect(chapterProgress(-5000, 2400, vh).pin).toBe(1);
  });
  it('treats a chapter no taller than the viewport as unpinned until it reaches the top', () => {
    expect(chapterProgress(10, 600, vh).pin).toBe(0);
    expect(chapterProgress(-1, 600, vh).pin).toBe(1);
  });
});

describe('AUREUS state machine', () => {
  it('is deterministic and only emits declared states', () => {
    for (const c of CHAPTER_IDS) for (let p = 0; p <= 1; p += 0.05) {
      const s = characterStateFor(c, p, p);
      expect(CHARACTER_STATES).toContain(s);
      expect(characterStateFor(c, p, p)).toBe(s);
    }
  });
  it('protects during the risk part of the product chapter', () => {
    expect(characterStateFor('action', 0, 0.9)).toBe('PROTECTING');
    expect(characterStateFor('meet', 0.9, 0)).toBe('OBSERVING');
  });
});
