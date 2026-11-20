import { useEffect } from 'react';
import { Link } from 'react-router-dom';

/** Presentation-only: no trading API, cookies, mode or market data. */
export function useLandingExperience(enabled: boolean) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.palazzo-v2');
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!enabled || reduced) {
      root.querySelectorAll<HTMLElement>('[data-palazzo-reveal]').forEach((node) => node.classList.add('is-visible'));
      root.style.setProperty('--scroll-progress', '0');
      return;
    }
    const selectors = [
      '.palazzo-hero-content', '.palazzo-philosophy-inner', '.palazzo-section-heading',
      '.palazzo-engine-card', '.palazzo-guardian-copy', '.palazzo-guardian-art',
      '.palazzo-joe-copy', '.palazzo-joe-window', '.palazzo-terminal',
      '.palazzo-stage', '.palazzo-roadmap-grid article', '.palazzo-closing h2',
      '.palazzo-thesis h2', '.palazzo-thesis .palazzo-thesis-copy',
    ];
    const targets = Array.from(root.querySelectorAll<HTMLElement>(selectors.join(',')));
    targets.forEach((node) => {
      node.dataset.palazzoReveal = '';
      if (node.getBoundingClientRect().top < window.innerHeight * 0.9) node.classList.add('is-visible');
    });
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(
      (entries, currentObserver) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            currentObserver.unobserve(entry.target);
          }
        }
      }, { threshold: 0.09, rootMargin: '0px 0px -30px 0px' },
    ) : null;
    if (observer) targets.forEach((node) => observer.observe(node));
    else targets.forEach((node) => node.classList.add('is-visible'));

    const hero = root.querySelector<HTMLElement>('.palazzo-hero');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let frame = 0;
    let scrollFrame = 0;
    let x = 0.5;
    let y = 0.5;
    const pointer = (event: PointerEvent) => {
      if (!finePointer || !hero || event.pointerType === 'touch') return;
      const box = hero.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      x = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(box.width, 1)));
      y = Math.max(0, Math.min(1, (event.clientY - box.top) / Math.max(box.height, 1)));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--pointer-x', (x * 100).toFixed(2) + '%');
        root.style.setProperty('--pointer-y', (y * 100).toFixed(2) + '%');
        root.style.setProperty('--tilt-x', ((0.5 - y) * 8).toFixed(2) + 'deg');
        root.style.setProperty('--tilt-y', ((x - 0.5) * 9).toFixed(2) + 'deg');
        frame = 0;
      });
    };
    const updateScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        root.style.setProperty('--scroll-progress', String(Math.min(1, window.scrollY / maxScroll)));
        scrollFrame = 0;
      });
    };
    if (finePointer) hero?.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('resize', updateScroll, { passive: true });
    updateScroll();
    return () => {
      observer?.disconnect();
      if (finePointer) hero?.removeEventListener('pointermove', pointer);
      window.removeEventListener('scroll', updateScroll);
      window.removeEventListener('resize', updateScroll);
      if (frame) cancelAnimationFrame(frame);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      targets.forEach((node) => { node.classList.remove('is-visible'); delete node.dataset.palazzoReveal; });
    };
  }, [enabled]);
}

const editorial = ['OBSERVE', 'INTERROGATE', 'CHALLENGE', 'VERIFY', 'DISCIPLINE'];

export function EditorialMarquee() {
  return <div className="palazzo-editorial-rail" aria-label="Observe, interrogate, challenge, verify, discipline">
    <span className="palazzo-rail-index" aria-hidden="true">MIA / MANIFESTO 01—05</span>
    <div className="palazzo-editorial-rail-window">
      <div className="palazzo-editorial-rail-track" aria-hidden="true">
        {[0, 1, 2].map((i) => <span className="palazzo-editorial-rail-group" key={i}>{editorial.map((word) => <span key={word}><i>✳</i>{word}</span>)}</span>)}
      </div>
    </div>
    <span className="palazzo-rail-index palazzo-rail-end" aria-hidden="true">SCROLL TO EXPLORE ↘</span>
  </div>;
}

export function ResearchThesis() {
  return <section className="palazzo-thesis" aria-labelledby="palazzo-thesis-title">
    <div className="palazzo-thesis-top"><span>INTERLUDE / 001</span><span>MIA / THE THINKING PROCESS</span></div>
    <div className="palazzo-thesis-layout">
      <div className="palazzo-thesis-sigil" aria-hidden="true">
        <div className="palazzo-thesis-orbit palazzo-thesis-orbit-one" />
        <div className="palazzo-thesis-orbit palazzo-thesis-orbit-two" />
        <span>Ⅲ</span>
        <small>CURATED INTELLIGENCE</small>
      </div>
      <div className="palazzo-thesis-copy">
        <span className="palazzo-kicker">A MANIFESTO FOR RESEARCH</span>
        <h2 id="palazzo-thesis-title">NOT EVERY<br /><em>SIGNAL</em><br />DESERVES<br /><em>ACTION.</em></h2>
        <p>Real discipline is knowing when not to act. MIA separates observation from authority, and research evidence from execution.</p>
        <Link to="/app" className="palazzo-thesis-link">ENTER THE RESEARCH TERMINAL <span aria-hidden="true">↗</span></Link>
      </div>
    </div>
    <div className="palazzo-thesis-foot"><span>01 — OBSERVE</span><span>02 — QUESTION</span><span>03 — EVALUATE</span><span>04 — VETO IF REQUIRED</span></div>
  </section>;
}

export function MotionSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <button type="button" className="palazzo-motion-switch" aria-label={enabled ? 'Turn off visual motion' : 'Turn on visual motion'} aria-pressed={enabled} onClick={onToggle} title="Toggle visual motion">
    <span className="palazzo-motion-led" aria-hidden="true" /><span>MOTION {enabled ? 'ON' : 'OFF'}</span>
  </button>;
}

export function ScrollProgress() {
  return <div className="palazzo-reading-progress" aria-hidden="true"><div /></div>;
}
