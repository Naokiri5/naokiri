import { useEffect, useRef, useState } from 'react';
import type { JoeState } from './JoeStateMapper';
import { JoeStudio, type MonitorId } from './studio';
import { JoeFallback } from './JoeFallback';

/**
 * WebGL canvas for Trader Joe's studio. Loaded lazily (its own chunk with three.js), so the rest of MIA never waits
 * on 3D. The render loop runs only while the canvas is on screen and the tab is visible; with reduced motion it
 * draws a single still frame per state change instead of animating. Any WebGL failure falls back to static art.
 */
export default function TraderJoeScene({ state, reducedMotion, onMonitor }: {
  state: JoeState;
  reducedMotion: boolean;
  onMonitor: (monitor: MonitorId) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const studio = useRef<JoeStudio | null>(null);
  const [failed, setFailed] = useState(false);
  const stateRef = useRef(state); stateRef.current = state;
  const motionRef = useRef(reducedMotion); motionRef.current = reducedMotion;
  /** Redraw now and resume the loop if it may run; replaced by the mounted studio. */
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    let s: JoeStudio;
    try { s = new JoeStudio(el); } catch { setFailed(true); return; }
    studio.current = s;
    let frame = 0; let visible = true; let onScreen = true;
    const draw = () => { s.setState(stateRef.current, performance.now()); s.render(performance.now() / 1000, !motionRef.current); };
    const loop = () => { frame = 0; draw(); schedule(); };
    const schedule = () => { if (!frame && visible && onScreen && !motionRef.current) frame = requestAnimationFrame(loop); };
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    const resize = () => { s.resize(el.clientWidth, el.clientHeight); draw(); };
    const sizer = new ResizeObserver(resize); sizer.observe(el);
    const seen = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; if (onScreen) schedule(); else stop(); });
    seen.observe(el);
    const vis = () => { visible = document.visibilityState === 'visible'; if (visible) schedule(); else stop(); };
    document.addEventListener('visibilitychange', vis);
    const lost = (event: Event) => { event.preventDefault(); stop(); kick.current = () => {}; onScreen = false; setFailed(true); };
    el.addEventListener('webglcontextlost', lost);
    resize(); schedule();
    kick.current = () => { draw(); schedule(); };
    return () => {
      stop(); sizer.disconnect(); seen.disconnect();
      document.removeEventListener('visibilitychange', vis); el.removeEventListener('webglcontextlost', lost);
      kick.current = () => {}; s.dispose(); studio.current = null;
    };
  }, []);

  // A state or motion-preference change redraws once (reduced motion) or resumes the loop.
  useEffect(() => { kick.current(); }, [state, reducedMotion]);

  if (failed) return <JoeFallback caption="3D view unavailable on this device." />;
  return <canvas ref={canvas} className="mia-joe-canvas" aria-hidden="true"
    onClick={(event) => {
      const s = studio.current; if (!s) return;
      const r = event.currentTarget.getBoundingClientRect();
      const hit = s.pick(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
      if (hit) onMonitor(hit);
    }} />;
}
