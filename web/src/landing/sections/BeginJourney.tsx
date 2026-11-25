import { Aureus } from '../components/Aureus';
import { BrandLogo } from '../components/BrandLogo';
import { useEntry } from '../components/EntryShell';
import { MagneticCta } from '../components/MagneticCta';
import { cssVars } from '../css';
import type { CharacterState } from '../motion/characterStates';

/** Chapter 05 — The Next Horizon. Calm graphite close; the only path forward is an explicit Enter MIA click. */
export function BeginJourney({ reduced, state }: { reduced: boolean; state: CharacterState }) {
  const { enter, phase } = useEntry();
  return <section id="journey" data-chapter="journey" className="v5-ch v5-journey" aria-labelledby="v5-journey-title">
    <div className="v5-curtain-up" aria-hidden="true" />
    <div className="v5-wrap v5-journey-grid">
      <div className="v5-journey-copy">
        <p className="v5-kicker"><span className="v5-tag v5-tag-dark">05 · Begin your journey</span></p>
        <BrandLogo variant="compact" tone="white" width={200} className="v5-journey-logo" />
        <h2 id="v5-journey-title" className="v5-journey-title" data-reveal="">
          <span className="v5-line" style={cssVars({ '--i': 0 })}><span>Trading reimagined</span></span>{' '}
          <span className="v5-line" style={cssVars({ '--i': 1 })}><span>for the age of intelligence</span></span>
        </h2>
        <p className="v5-lede">A new approach to trading, built around adaptive intelligence and responsible automation.</p>
        <div className="v5-actions">
          <MagneticCta id="v5-enter-final" href="/app" reduced={reduced} onActivate={(el) => enter(el)}>{phase === 'requested' ? 'Opening…' : 'Enter MIA'}</MagneticCta>
          <a className="v5-btn v5-btn-ghost v5-btn-lg" href="#brainos"><span className="v5-btn-inner">Learn about BrainOS</span></a>
        </div>
        <p className="v5-footnote">Enter MIA opens Privy wallet sign-in. The terminal still requires server-side owner verification, and signing in never authorizes trading.</p>
      </div>
      <div className="v5-journey-art">
        <span className="v5-horizon-disc" aria-hidden="true" />
        <Aureus variant="welcome" state={state} reduced={reduced} caption={false} decorative />
      </div>
    </div>
  </section>;
}
