import { useEffect, useRef } from 'react';
import { MASCOT } from '../brand';
import { STATE_CAPTION, type CharacterState } from '../motion/characterStates';

type Variant = 'peek' | 'hero' | 'guide' | 'welcome';

/**
 * AUREUS, rendered from the single approved master image. The state machine changes framing and gaze only.
 * Pointer response (hero variant) is limited to a few pixels, fine pointers only, and off for reduced motion.
 */
export function Aureus({ state, variant, reduced, priority = false, caption = true, decorative = false }:
  { state: CharacterState; variant: Variant; reduced: boolean; priority?: boolean; caption?: boolean; decorative?: boolean }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || variant !== 'hero' || reduced || !window.matchMedia?.('(pointer: fine)').matches) return;
    let frame = 0; let x = 0; let y = 0;
    const apply = () => { frame = 0; el.style.setProperty('--gx', x.toFixed(3)); el.style.setProperty('--gy', y.toFixed(3)); };
    const move = (e: PointerEvent) => {
      x = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      y = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (frame) cancelAnimationFrame(frame); el.style.removeProperty('--gx'); el.style.removeProperty('--gy'); };
  }, [variant, reduced]);

  return <figure ref={ref} className={`v5-aureus v5-aureus-${variant}`} data-state={state} aria-hidden={decorative || undefined}>
    <div className="v5-aureus-pose">
      <img src={MASCOT.src} srcSet={MASCOT.srcSet} sizes={variant === 'peek' ? '(max-width: 760px) 60vw, 380px' : '(max-width: 760px) 80vw, 560px'}
        width={MASCOT.width} height={MASCOT.height} alt={decorative ? '' : MASCOT.alt}
        loading={priority ? 'eager' : 'lazy'} decoding="async" draggable={false} />
    </div>
    {caption && <figcaption className="v5-aureus-state" aria-hidden="true"><span className="v5-dot" />AUREUS · {STATE_CAPTION[state]}</figcaption>}
  </figure>;
}
