import { useRef, type MouseEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Primary call to action with optional magnetic response (T15). Only the inner label layer moves, by at most
 * 6 px, so the hit target, focus ring and accessible name never shift. Disabled for touch and reduced motion.
 */
export function MagneticCta({ href, children, onActivate, reduced, tone = 'pink', size = 'lg', id }:
  { href: string; children: ReactNode; onActivate?: (el: HTMLAnchorElement) => void; reduced: boolean; tone?: 'pink' | 'blue' | 'cream'; size?: 'md' | 'lg'; id?: string }) {
  const inner = useRef<HTMLSpanElement>(null);
  const fine = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
  const move = (e: MouseEvent<HTMLAnchorElement>) => {
    if (reduced || !fine || !inner.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * 12; const dy = ((e.clientY - r.top) / r.height - 0.5) * 10;
    inner.current.style.transform = `translate3d(${Math.max(-6, Math.min(6, dx)).toFixed(1)}px, ${Math.max(-5, Math.min(5, dy)).toFixed(1)}px, 0)`;
  };
  const reset = () => { if (inner.current) inner.current.style.transform = ''; };
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onActivate || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onActivate(e.currentTarget);
  };
  return <a id={id} href={href} className={`v5-btn v5-btn-${tone} v5-btn-${size}`} onMouseMove={move} onMouseLeave={reset} onBlur={reset} onClick={click}>
    <span ref={inner} className="v5-btn-inner">{children}<Icon name="arrow" size={18} /></span>
  </a>;
}
