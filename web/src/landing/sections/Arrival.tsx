import { Aureus } from '../components/Aureus';
import { SignalTape, SignalTerminal, Sticker } from '../components/Campaign';
import { Icon } from '../components/Icon';
import { MagneticCta } from '../components/MagneticCta';
import type { CharacterState } from '../motion/characterStates';
import { cssVars } from '../css';

/** Chapter 01 — The Signal District. The exact slogan is the hero; AUREUS stays partially concealed. */
export function Arrival({ reduced, state }: { reduced: boolean; state: CharacterState }) {
  return <section id="top" data-chapter="arrival" className="v5-ch v5-arrival" aria-labelledby="v5-arrival-title">
    <div className="v5-halftone" aria-hidden="true" />
    <div className="v5-wrap v5-arrival-grid">
      <div className="v5-arrival-copy">
        <p className="v5-kicker"><span className="v5-tag">01 · The awakening of intelligence</span></p>
        <h1 id="v5-arrival-title" className="v5-hero-title">
          <span className="v5-line" style={cssVars({ '--i': 0 })}><span>Trading</span></span>{' '}
          <span className="v5-line" style={cssVars({ '--i': 1 })}><span className="v5-hl-pink">reimagined</span></span>{' '}
          <span className="v5-line" style={cssVars({ '--i': 2 })}><span>for the age of</span></span>{' '}
          <span className="v5-line" style={cssVars({ '--i': 3 })}><span className="v5-hl-blue">intelligence</span></span>
        </h1>
        <p className="v5-lede v5-enter" style={cssVars({ '--i': 5 })}>Discover a new generation of trading intelligence, designed to observe, reason, adapt and act within defined risk controls.</p>
        <div className="v5-actions v5-enter" style={cssVars({ '--i': 6 })}>
          <MagneticCta href="#brainos" reduced={reduced}>Explore MIA BrainOS</MagneticCta>
          <a className="v5-btn v5-btn-outline v5-btn-lg" href="#meet"><span className="v5-btn-inner">Discover the experience</span></a>
        </div>
        <p className="v5-footnote v5-enter" style={cssVars({ '--i': 7 })}><Icon name="lock" size={16} />Paper-trading build · live execution locked</p>
      </div>
      <div className="v5-arrival-art" aria-hidden="true">
        <span className="v5-arch" />
        <SignalTape className="v5-arrival-tape" />
        <div className="v5-peek"><Aureus variant="peek" state={state} reduced={reduced} priority caption={false} decorative /></div>
        <SignalTerminal className="v5-terminal" />
        <Sticker name="aperture" className="v5-st v5-st-a" />
        <Sticker name="arc" className="v5-st v5-st-b" />
      </div>
    </div>
    <a className="v5-scrollcue" href="#meet"><Icon name="arrowDown" size={18} />Scroll to meet AUREUS</a>
  </section>;
}
