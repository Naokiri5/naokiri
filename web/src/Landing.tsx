import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, MiaWordmark, type IconName } from './brand';
import { useMiaTheme } from './theme';
import { AtelierStory, type IntelligenceMode } from './AtelierStory';
import miaImage from './assets/mia-companion.webp';
import './landing.css';

const navigation = [
  { label: 'The Atelier', target: 'philosophy' },
  { label: 'Intelligence', target: 'engine' },
  { label: 'Trader Joe', target: 'joe' },
  { label: 'Safety', target: 'guardian' },
];

const highlights: { label: string; detail: string; icon: IconName; target: string; mode?: IntelligenceMode }[] = [
  { label: 'FAST Intelligence', detail: 'Market discovery', icon: 'bolt', target: 'engine', mode: 'fast' },
  { label: 'DEEP Intelligence', detail: 'Strategy research', icon: 'layers', target: 'engine', mode: 'deep' },
  { label: 'Guardian', detail: 'Built-in risk controls', icon: 'shield', target: 'guardian' },
];

function HeroArt({ mode, setMode }: { mode: IntelligenceMode; setMode: (mode: IntelligenceMode) => void }) {
  return <div className="atelier-hero-art" data-mode={mode} aria-label="MIA character and intelligence modes">
    <svg className="atelier-orbit" viewBox="0 0 624 556" aria-hidden="true">
      <g fill="none" stroke="currentColor">
        <circle cx="325" cy="266" r="225" opacity=".42" strokeDasharray="1.4 4.8" />
        <circle cx="325" cy="266" r="200" opacity=".28" />
        <circle cx="325" cy="266" r="163" opacity=".19" />
        <ellipse cx="325" cy="266" rx="259" ry="148" transform="rotate(-33 325 266)" opacity=".28" />
        <ellipse cx="325" cy="266" rx="263" ry="143" transform="rotate(27 325 266)" opacity=".16" />
        <path d="M325 20v492M61 266h528" opacity=".18" strokeDasharray="2 7" />
        <path d="M325 32v17m0 434v17m-233-234h17m432 0h17M492 95l-9 9m-316 321-9 9M158 95l9 9m316 321 9 9" opacity=".65" />
      </g>
      <g fill="currentColor">
        <circle cx="476" cy="99" r="3" /><circle cx="171" cy="382" r="2" /><circle cx="515" cy="360" r="3" />
        <circle cx="248" cy="53" r="1.7" /><circle cx="65" cy="161" r="1.5" /><circle cx="142" cy="455" r="1.5" />
        <circle cx="572" cy="127" r="1.5" /><circle cx="507" cy="491" r="1.4" />
      </g>
      <path d="M530 71l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6ZM112 351l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6 1.6-4.4Z" fill="currentColor" />
    </svg>
    <div className="atelier-hero-shadow" aria-hidden="true" />
    <div className="atelier-hero-companion">
      <img className="atelier-hero-mia" src={miaImage} alt="MIA, a hovering pearl and lavender robot with a luminous lime visor" width="1080" height="1080" fetchPriority="high" />
      <span className="atelier-hero-signal" aria-hidden="true"><Icon name={mode === 'fast' ? 'spark' : 'network'} size={26} /></span>
    </div>
    <div className="atelier-hero-modes" role="group" aria-label="Preview intelligence modes">
      <button type="button" className="atelier-holo holo-fast" aria-label="Preview FAST" aria-pressed={mode === 'fast'} onClick={() => setMode('fast')}>
        <span className="atelier-icon-tile"><Icon name="bolt" size={20} /></span>
        <span><strong>FAST</strong><small>Discovery radar</small></span>
      </button>
      <button type="button" className="atelier-holo holo-deep" aria-label="Preview DEEP" aria-pressed={mode === 'deep'} onClick={() => setMode('deep')}>
        <span className="atelier-icon-tile"><Icon name="layers" size={20} /></span>
        <span><strong>DEEP</strong><small>Strategy architect</small></span>
      </button>
    </div>
    <span className="atelier-art-caption"><span aria-hidden="true" />MIA / INTELLIGENCE COMPANION</span>
  </div>;
}

export default function Landing({ memberAccess = false }: { memberAccess?: boolean }) {
  const [mode, setMode] = useState<IntelligenceMode>('fast');
  const [menu, setMenu] = useState(false);
  const [theme, toggleTheme] = useMiaTheme();
  const [motionOff, setMotionOff] = useState(() => {
    try { return localStorage.getItem('mia-atelier-motion') === 'off'; }
    catch { return false; }
  });
  const toggleMotion = () => {
    try { localStorage.setItem('mia-atelier-motion', motionOff ? 'on' : 'off'); } catch { /* Storage can be unavailable. */ }
    setMotionOff(!motionOff);
  };
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenu(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menu]);

  return <div className="atelier" id="top" data-motion={motionOff ? 'off' : 'on'}>
    <a className="atelier-skip" href="#atelier-main">Skip to content</a>
    <header className="atelier-header">
      <div className="atelier-container atelier-header-row">
        <a href="#top" className="atelier-home" aria-label="MIA home"><MiaWordmark /></a>
        <nav className="atelier-nav" aria-label="Landing navigation">
          {navigation.map(({ label, target }) => <a key={target} href={'#' + target}>{label}</a>)}
        </nav>
        <div className="atelier-header-actions">
          <button className="atelier-icon-button" type="button" aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'} onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <Link className="atelier-button atelier-button-outline atelier-header-cta" to="/autopilot">Enter MIA <Icon name="arrow-up-right" size={15} /></Link>
          <button className="atelier-icon-button atelier-menu-toggle" type="button" ref={menuButton} aria-label={menu ? 'Close menu' : 'Open menu'}
            aria-expanded={menu} aria-controls="atelier-mobile-nav" onClick={() => setMenu(!menu)}><Icon name={menu ? 'close' : 'menu'} size={20} /></button>
        </div>
        <nav id="atelier-mobile-nav" className="atelier-mobile-nav" aria-label="Mobile landing navigation" hidden={!menu}>
          {navigation.map(({ label, target }) => <a key={target} href={'#' + target} onClick={() => setMenu(false)}>{label}</a>)}
          <Link to="/autopilot" onClick={() => setMenu(false)}>Enter MIA <Icon name="arrow-up-right" size={16} /></Link>
          {memberAccess && <Link to="/account" onClick={() => setMenu(false)}>Member sign-in <Icon name="arrow-up-right" size={16} /></Link>}
        </nav>
      </div>
    </header>

    <main id="atelier-main">
      <section className="atelier-masthead" aria-labelledby="atelier-hero-heading" data-mode={mode}>
        <div className="atelier-container atelier-hero">
          <div className="atelier-hero-copy">
            <div className="atelier-eyebrow"><Icon name="spark" size={15} /> The Living Intelligence Atelier</div>
            <h1 id="atelier-hero-heading"><span>One MIA.</span>{' '}<span>Two minds.</span>{' '}<em>Infinite possibilities.</em></h1>
            <p>MIA discovers market opportunities, reconstructs strategies, evaluates risk, and coordinates authorized trading through one unified intelligence system.</p>
            <div className="atelier-actions">
              <Link className="atelier-button atelier-button-primary" to="/autopilot">Enter MIA <Icon name="arrow-up-right" size={18} /></Link>
              <a className="atelier-button atelier-button-outline" href="#engine">Explore Intelligence <Icon name="arrow-down" size={16} /></a>
            </div>
            <a className="atelier-hero-lock" href="#guardian"><Icon name="lock" size={14} /> Live execution remains locked</a>
          </div>
          <HeroArt mode={mode} setMode={setMode} />
        </div>
        <div className="atelier-highlights">
          <div className="atelier-container atelier-highlights-row">
            {highlights.map(({ label, detail, icon, target, mode: highlightMode }) =>
              <a key={label} href={'#' + target} data-tone={highlightMode ?? 'guardian'} onClick={() => highlightMode && setMode(highlightMode)}>
                <span className="atelier-icon-tile"><Icon name={icon} size={20} /></span>
                <span><strong>{label}</strong><small>{detail}</small></span>
                <Icon name="chevron" size={16} />
              </a>)}
          </div>
        </div>
      </section>

      <AtelierStory mode={mode} setMode={setMode} />
    </main>

    <footer className="atelier-footer">
      <div className="atelier-container atelier-footer-row">
        <a href="#top" className="atelier-home" aria-label="MIA home"><MiaWordmark /></a>
        <p>Discover Faster. Think Deeper. Execute with Discipline.</p>
        <div className="atelier-footer-actions">
          {memberAccess && <Link to="/account">Member sign-in</Link>}
          <button type="button" className="atelier-button atelier-button-outline" aria-pressed={motionOff} onClick={toggleMotion}>Reduce motion</button>
          <a href="#top" className="atelier-button atelier-button-outline">Back to top <Icon name="arrow-up-right" size={15} /></a>
        </div>
      </div>
    </footer>
  </div>;
}
