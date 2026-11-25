import { useEffect, useRef, useState, type RefObject } from 'react';
import { CHAPTER_IDS, type ChapterId } from './chapters';

/**
 * The landing page's single scroll owner (T01 Cinematic Scrollytelling).
 *
 * One passive scroll/resize listener schedules at most one animation frame. Each frame reads every chapter's
 * geometry once and writes two CSS custom properties per chapter:
 *   --view  0 → 1 while the chapter travels from entering the bottom edge to leaving the top edge
 *   --pin   0 → 1 across the chapter's sticky stage (stays 0 before, 1 after)
 * Every scroll-linked effect derives from these absolute values, so reversing, jumping, refreshing mid-page and
 * resizing always settle on the correct frame. Non-CSS consumers (the BrainOS WebGL core) read the same numbers
 * from the store. No other module listens to scroll.
 */
export interface SceneSnapshot {
  page: number;
  active: ChapterId;
  view: Record<ChapterId, number>;
  pin: Record<ChapterId, number>;
  /** Pinned progress of named sub-stages (`[data-track]`) inside a chapter. */
  tracks: Record<string, number>;
}

type Listener = (s: SceneSnapshot) => void;
const zeroes = () => Object.fromEntries(CHAPTER_IDS.map((id) => [id, 0])) as Record<ChapterId, number>;

export class SceneStore {
  private snapshot: SceneSnapshot = { page: 0, active: 'arrival', view: zeroes(), pin: zeroes(), tracks: {} };
  private listeners = new Set<Listener>();
  get(): SceneSnapshot { return this.snapshot; }
  set(next: SceneSnapshot) { this.snapshot = next; for (const l of this.listeners) l(next); }
  subscribe(l: Listener): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pure geometry → progress mapping, exported for unit tests. */
export function chapterProgress(top: number, height: number, viewport: number) {
  const view = clamp01((viewport - top) / (height + viewport));
  const travel = height - viewport;
  const pin = travel <= 1 ? (top <= 0 ? 1 : 0) : clamp01(-top / travel);
  return { view, pin };
}

/**
 * Subscribe a component to a derived value of the scene. Re-renders only when the selected value changes
 * (e.g. a chapter boundary or a product step), never once per animation frame.
 */
export function useSceneValue<T>(store: SceneStore, select: (s: SceneSnapshot) => T): T {
  const [value, setValue] = useState(() => select(store.get()));
  const selector = useRef(select);
  selector.current = select;
  useEffect(() => store.subscribe((s) => {
    const next = selector.current(s);
    setValue((prev) => (Object.is(prev, next) ? prev : next));
  }), [store]);
  return value;
}

const REDUCED_KEY = 'mia-landing-motion';

/** prefers-reduced-motion OR the visitor's own "Reduce motion" choice (kept in this browser only). */
export function useReducedMotion(): [boolean, (v: boolean) => void] {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [system, setSystem] = useState(() => !!query?.matches);
  const [choice, setChoice] = useState<boolean | null>(() => {
    try { const v = localStorage.getItem(REDUCED_KEY); return v === 'reduced' ? true : v === 'full' ? false : null; } catch { return null; }
  });
  useEffect(() => {
    if (!query) return;
    const on = () => setSystem(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  const set = (v: boolean) => {
    setChoice(v);
    try { localStorage.setItem(REDUCED_KEY, v ? 'reduced' : 'full'); } catch { /* storage unavailable: choice lasts for this visit */ }
  };
  return [choice ?? system, set];
}

/**
 * Mounts the controller on the landing root. Returns the active chapter (React state changes only on a chapter
 * boundary, never per frame). Also owns the one IntersectionObserver used for once-only `[data-reveal]` entrances.
 */
export function useSceneController(rootRef: RefObject<HTMLElement | null>, store: SceneStore): ChapterId {
  const [active, setActive] = useState<ChapterId>('arrival');
  const activeRef = useRef<ChapterId>('arrival');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const chapters = () => Array.from(root.querySelectorAll<HTMLElement>('[data-chapter]'));

    const update = () => {
      frame = 0;
      const vh = window.innerHeight || 1;
      const view = zeroes(); const pin = zeroes();
      let current: ChapterId = activeRef.current;
      for (const el of chapters()) {
        const id = el.dataset.chapter as ChapterId;
        const r = el.getBoundingClientRect();
        const p = chapterProgress(r.top, r.height, vh);
        view[id] = p.view; pin[id] = p.pin;
        el.style.setProperty('--view', p.view.toFixed(4));
        el.style.setProperty('--pin', p.pin.toFixed(4));
        if (r.top <= vh * 0.5 && r.bottom > vh * 0.5) current = id;
      }
      const tracks: Record<string, number> = {};
      for (const el of root.querySelectorAll<HTMLElement>('[data-track]')) {
        const r = el.getBoundingClientRect();
        const p = chapterProgress(r.top, r.height, vh).pin;
        tracks[el.dataset.track!] = p;
        el.style.setProperty('--pin', p.toFixed(4));
      }
      const max = document.documentElement.scrollHeight - vh;
      const page = max > 0 ? clamp01(window.scrollY / max) : 0;
      root.style.setProperty('--page', page.toFixed(4));
      store.set({ page, active: current, view, pin, tracks });
      if (current !== activeRef.current) { activeRef.current = current; setActive(current); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resize?.observe(root);
    update();

    const reveal = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { (e.target as HTMLElement).dataset.shown = 'true'; reveal?.unobserve(e.target); }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 })
      : null;
    for (const el of root.querySelectorAll<HTMLElement>('[data-reveal]')) {
      if (reveal) reveal.observe(el); else el.dataset.shown = 'true';
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      resize?.disconnect();
      reveal?.disconnect();
    };
  }, [rootRef, store]);

  return active;
}
