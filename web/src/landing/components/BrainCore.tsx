import { useEffect, useRef, useState } from 'react';
import type { SceneStore } from '../motion/sceneController';

/**
 * Lazy WebGL host for the BrainOS core. The SVG fallback renders first (and stays for no-WebGL, load failure or
 * context loss); three.js is fetched only when Chapter 03 approaches the viewport.
 */
export function BrainCore({ store, reduced }: { store: SceneStore; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'fallback'>('idle');

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let disposed = false;
    let handle: { dispose(): void } | null = null;
    const compact = window.matchMedia?.('(max-width: 760px)').matches ?? false;
    const load = () => {
      import('./brainCoreScene').then(({ mountBrainCore }) => {
        if (disposed) return;
        handle = mountBrainCore({
          canvas: el, reduced, compact,
          getProgress: () => store.get().pin.brainos,
          subscribe: (fn) => store.subscribe(fn),
          onReady: () => { if (!disposed) setStatus('ready'); },
          onFail: () => { if (!disposed) setStatus('fallback'); },
        });
      }).catch(() => { if (!disposed) setStatus('fallback'); });
    };
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); load(); } }, { rootMargin: '800px 0px' })
      : null;
    if (io) io.observe(el); else load();
    return () => { disposed = true; io?.disconnect(); handle?.dispose(); setStatus('idle'); };
  }, [store, reduced]);

  return <div className="v5-core" data-status={status}>
    <CoreFallback />
    <canvas ref={canvas} className="v5-core-canvas" aria-hidden="true" />
  </div>;
}

/** Static topology equivalent of the WebGL core (also the reduced-capability path). */
function CoreFallback() {
  const nodes = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2; const r = i % 3 === 0 ? 118 : i % 3 === 1 ? 96 : 132;
    return { x: 160 + Math.cos(a) * r, y: 160 + Math.sin(a) * r * 0.92, c: i % 2 ? '#8FD3F4' : '#F48BB8' };
  });
  return <svg className="v5-core-fallback" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="v5-core-g" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#FFF5F7" /><stop offset=".45" stopColor="#F9C6DC" /><stop offset="1" stopColor="#8FD3F4" /></radialGradient>
      <radialGradient id="v5-core-n" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#F48BB8" /><stop offset="1" stopColor="#8FD3F4" stopOpacity=".7" /></radialGradient>
    </defs>
    <circle cx="160" cy="160" r="104" fill="url(#v5-core-g)" opacity=".75" />
    <circle cx="160" cy="160" r="42" fill="url(#v5-core-n)" opacity=".9" />
    <path d="M58 214A112 112 0 0 1 238 62" fill="none" stroke="#2B2430" strokeWidth="2.5" strokeLinecap="round" />
    <ellipse cx="160" cy="160" rx="150" ry="52" fill="none" stroke="#8FD3F4" strokeWidth="1.5" transform="rotate(-24 160 160)" />
    {nodes.map((n, i) => <g key={i}><line x1="160" y1="160" x2={n.x} y2={n.y} stroke="#8E8196" strokeOpacity=".28" /><circle cx={n.x} cy={n.y} r="4.5" fill={n.c} stroke="#2B2430" strokeWidth="1" /></g>)}
  </svg>;
}
