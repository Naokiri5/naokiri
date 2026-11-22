import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './landing.css';
import { EditorialMarquee, MotionSwitch, ResearchThesis, ScrollProgress, useLandingExperience } from './LandingExperience';

type IconName = 'scan' | 'layers' | 'brain' | 'shield' | 'arrow' | 'lock' | 'chart' | 'spark' | 'check' | 'terminal' | 'menu' | 'close' | 'radar';

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<IconName, React.ReactNode> = {
    scan: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v5M12 18v5M1 12h5M18 12h5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    brain: <><path d="M12 7a4 4 0 0 0-7-2 4 4 0 0 0-1 6 4 4 0 0 0 2 7 4 4 0 0 0 6 2V7ZM12 7a4 4 0 0 1 7-2 4 4 0 0 1 1 6 4 4 0 0 1-2 7 4 4 0 0 1-6 2V7Z" /><path d="M7 10c3 0 3 4 1 4M17 10c-3 0-3 4-1 4M12 13v7" /></>,
    shield: <><path d="m12 2 9 4v6c0 5-4 8-9 10C7 20 3 17 3 12V6l9-4Z" /><path d="m8 12 3 3 5-6" /></>,
    arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    chart: <><path d="M3 20h18M6 16V9M11 16V4M16 16v-6M21 16v-9" /></>,
    spark: <><path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    terminal: <><rect x="2.5" y="3" width="19" height="18" rx="2" /><path d="m6.5 8 3 3-3 3M12 15h6" /></>,
    menu: <><path d="M3 7h18M3 12h18M3 17h18" /></>,
    close: <><path d="M5 5l14 14M19 5 5 19" /></>,
    radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="m12 12 7-7" /><circle cx="16" cy="8" r="1.5" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

const navItems = [
  { label: 'Philosophy', target: 'philosophy' },
  { label: 'Engine', target: 'engine' },
  { label: 'Guardian', target: 'guardian' },
  { label: 'Trader Joe', target: 'joe' },
  { label: 'Roadmap', target: 'roadmap' },
];

function HeroSculpture() {
  const curls = [
    [302, 176, 37], [347, 144, 39], [394, 130, 35], [444, 143, 42], [490, 171, 37],
    [281, 221, 32], [507, 215, 38], [297, 123, 24], [360, 98, 27], [425, 94, 25], [477, 115, 28],
  ];
  return <div className="palazzo-muse" aria-label="Original stylized marble sculpture representing intelligence" role="img">
    <span className="palazzo-arch palazzo-arch-one" aria-hidden="true" />
    <span className="palazzo-arch palazzo-arch-two" aria-hidden="true" />
    <svg className="palazzo-statue" viewBox="0 0 750 780" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="mia-marble" x1="0" x2="1" y1="0" y2=".55"><stop stopColor="#f8f0e5"/><stop offset=".36" stopColor="#cbbeb1"/><stop offset=".64" stopColor="#9b8f87"/><stop offset="1" stopColor="#4a4547"/></linearGradient>
        <linearGradient id="mia-hair" x1="0" x2="1"><stop stopColor="#e8ded0"/><stop offset=".46" stopColor="#a79b92"/><stop offset="1" stopColor="#4b4648"/></linearGradient>
        <linearGradient id="mia-cloth" x1="0" x2="1" y1=".2" y2="1"><stop stopColor="#9b555b"/><stop offset=".5" stopColor="#632d36"/><stop offset="1" stopColor="#240e18"/></linearGradient>
        <radialGradient id="mia-glow"><stop stopColor="#aa7a4f" stopOpacity=".28"/><stop offset="1" stopColor="#aa7a4f" stopOpacity="0"/></radialGradient>
        <pattern id="mia-veins" width="95" height="110" patternUnits="userSpaceOnUse"><path d="M-10 42Q30 30 55 0M15 118q33-54 87-63" fill="none" stroke="#756e69" strokeOpacity=".17" strokeWidth="1.3"/></pattern>
      </defs>
      <ellipse cx="397" cy="385" rx="310" ry="340" fill="url(#mia-glow)"/>
      <ellipse cx="386" cy="368" rx="278" ry="290" transform="rotate(-19 386 368)" fill="none" stroke="#b58c57" strokeOpacity=".6" strokeWidth="1.1"/>
      <ellipse cx="386" cy="368" rx="278" ry="290" transform="rotate(33 386 368)" fill="none" stroke="#b58c57" strokeOpacity=".28" strokeWidth=".6"/>
      <path d="M158 737Q178 638 270 603L336 558 362 494 446 493 483 564Q573 596 624 689L635 768 145 768Z" fill="url(#mia-marble)" stroke="#f1eae0" strokeOpacity=".22" strokeWidth="2"/>
      <path d="M158 737Q178 638 270 603L336 558 362 494 446 493 483 564Q573 596 624 689L635 768 145 768Z" fill="url(#mia-veins)"/>
      <path d="M321 572q60 94 133 29l-11-93-85-13Z" fill="url(#mia-marble)"/>
      <path d="M316 191Q351 166 431 174 503 194 510 276L496 403Q485 478 414 520 370 530 333 474L300 389 285 305Q281 247 316 191Z" fill="url(#mia-marble)" stroke="#f0e6d9" strokeOpacity=".26" strokeWidth="2"/>
      <path d="M316 191Q351 166 431 174 503 194 510 276L496 403Q485 478 414 520 370 530 333 474L300 389 285 305Q281 247 316 191Z" fill="url(#mia-veins)"/>
      {curls.map(([x, y, r], i) => <g key={i}><circle cx={x} cy={y} r={r} fill="url(#mia-hair)" stroke="#eee2d2" strokeOpacity=".24" strokeWidth="3"/><path d={'M' + (x-r/2) + ' ' + (y-5) + 'q' + r + ' ' + (-r) + ' ' + (r*.9) + ' ' + (r*.2)} fill="none" stroke="#f1eae0" strokeOpacity=".31" strokeWidth="7" strokeLinecap="round"/></g>)}
      <path d="M324 287q27-17 57-5M422 275q34-18 61-4" stroke="#5d5351" strokeWidth="9" fill="none" strokeLinecap="round"/>
      <path d="M329 304q21-10 49-1M429 297q23-13 45-6" stroke="#463f40" strokeWidth="5" strokeLinecap="round"/>
      <path d="M405 301q-18 53-19 85 14 12 31 1" fill="none" stroke="#70645d" strokeWidth="7" strokeLinecap="round"/>
      <path d="M371 432q42 17 82-9" stroke="#6b5550" strokeWidth="6" fill="none" strokeLinecap="round"/>
      <path d="M301 605q106 80 230 1 64 45 89 125l14 37H149q5-105 152-163Z" fill="url(#mia-cloth)"/>
      <path d="M194 708q132-92 268 22M287 626q95 72 231 60" stroke="#d19589" strokeOpacity=".35" strokeWidth="8" fill="none"/>
      <path d="M371 535q30 24 78 4" stroke="#eee3d5" strokeOpacity=".52" strokeWidth="3" fill="none"/>
      <path d="M137 382h526M395 67v634" stroke="#b58c57" strokeOpacity=".12" strokeWidth="1"/>
      <path d="M124 387h26m-13-13v26M605 171h30m-15-15v30" stroke="#dab17b" strokeWidth="1.5" />
    </svg>
    <span className="palazzo-orbit-label">OBSERVATION / RESEARCH / RISK</span>
    <span className="palazzo-muse-index">FIG. 01 — THE THINKING FORM</span>
  </div>;
}

const capabilities: Array<{ id: string; icon: IconName; name: string; detail: string }> = [
  { id: '01', icon: 'scan', name: 'Market Scanning', detail: 'Discover and organize markets with live-data research.' },
  { id: '02', icon: 'layers', name: 'Indicator Analysis', detail: 'Evaluate technical evidence through existing specialists.' },
  { id: '03', icon: 'brain', name: 'Worker Intelligence', detail: 'Coordinate deterministic workers through consensus research.' },
  { id: '04', icon: 'shield', name: 'Decision & Risk', detail: 'Maintain a deterministic, fail-closed risk boundary.' },
];

const stages = [
  { title: 'Market data', detail: 'Fresh observations and provider health checks form the evidence base.' },
  { title: 'Intelligence', detail: 'Workers and indicators analyze the evidence without placing orders.' },
  { title: 'Decision engine', detail: 'Research output is assembled into an explicit, traceable decision.' },
  { title: 'Risk gate', detail: 'Deterministic safeguards may veto a trade or reject stale inputs.' },
  { title: 'Authorized execution', detail: 'Existing paper execution follows policy; live execution remains locked.' },
];

function StageDiagram() {
  const [stage, setStage] = useState(3);
  return <div className="palazzo-stage">
    <div className="palazzo-stage-list" role="group" aria-label="Explore MIA architecture">
      {stages.map((item, i) => <button key={item.title} type="button" className={i === stage ? 'palazzo-stage-node selected' : 'palazzo-stage-node'} onClick={() => setStage(i)} aria-pressed={stage === i}>
        <span className="palazzo-stage-index">0{i + 1}</span><span>{item.title}</span>{i < stages.length - 1 && <span className="palazzo-stage-connector" aria-hidden="true">→</span>}
      </button>)}
    </div>
    <div className="palazzo-stage-detail" aria-live="polite"><span className="palazzo-kicker">SYSTEM NODE / 0{stage + 1}</span><h3>{stages[stage].title}</h3><p>{stages[stage].detail}</p></div>
  </div>;
}

function TerminalPreview() {
  return <div className="palazzo-terminal" aria-label="Conceptual preview of the MIA interface, no live account data">
    <div className="palazzo-terminal-bar"><span className="palazzo-terminal-logo">M</span><span>MIA / TERMINAL</span><span className="palazzo-terminal-mode">ILLUSTRATIVE PREVIEW · PAPER SYSTEM</span></div>
    <div className="palazzo-terminal-body">
      <aside className="palazzo-terminal-nav"><b>OVERVIEW</b><span className="active">⌁ Market Terminal</span><span>◈ Scanner</span><span>⬡ Intelligence</span><span>◇ Risk Center</span><span>⌘ Trader Joe</span></aside>
      <div className="palazzo-terminal-workspace">
        <div className="palazzo-terminal-eyebrow">RESEARCH ENVIRONMENT <span>NO LIVE METRICS SHOWN</span></div>
        <div className="palazzo-terminal-line"><span>Market intelligence</span><span className="palazzo-terminal-chip">EVIDENCE FIRST</span></div>
        <div className="palazzo-terminal-charts">
          <div className="palazzo-terminal-chart"><div className="palazzo-chart-grid" /><svg viewBox="0 0 460 170" preserveAspectRatio="none" aria-hidden="true"><path d="M0 132C48 122 42 91 84 98S148 147 189 97 233 79 266 90 337 30 378 54 433 28 460 18" fill="none" stroke="#b58c57" strokeWidth="2.5"/><path d="M0 132C48 122 42 91 84 98S148 147 189 97 233 79 266 90 337 30 378 54 433 28 460 18V170H0Z" fill="#b58c57" opacity=".065"/></svg><span>SCHEMATIC / NOT MARKET DATA</span></div>
          <div className="palazzo-terminal-signals"><span className="palazzo-terminal-signal-label">INTELLIGENCE LAYERS</span>{['Data quality', 'Evidence', 'Risk evaluation', 'Authorization'].map((s, i) => <div key={s}><span>{s}</span><span className="palazzo-signal-track"><i style={{ width: (38 + i * 16) + '%' }} /></span></div>)}<small>Design illustration only</small></div>
        </div>
      </div>
    </div>
  </div>;
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useLandingExperience(motionEnabled);
  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);
  useEffect(() => {
    document.title = 'MIA — The Art of Intelligent Decisions';
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = 'MIA: coordinated market research, evidence-driven intelligence and disciplined paper-trading risk controls.';
    return () => { document.title = 'MIA 4.1 Terminal'; };
  }, []);
  return <div className="palazzo palazzo-v2" data-motion={motionEnabled ? "on" : "off"}>
    <ScrollProgress />
    <a href="#palazzo-content" className="palazzo-skip">Skip to content</a>
    <header className="palazzo-header">
      <a href="#top" className="palazzo-brand" aria-label="MIA home"><span className="palazzo-brand-mark">Ⅲ</span><span className="palazzo-brand-name">MIA</span><span className="palazzo-brand-caption">MULTI-MARKET<br />INTELLIGENCE PLATFORM</span></a>
      <nav className="palazzo-nav" aria-label="Landing navigation">{navItems.map((item) => <a key={item.target} href={'#' + item.target}>{item.label}</a>)}</nav>
      <MotionSwitch enabled={motionEnabled} onToggle={() => setMotionEnabled((current) => !current)} />
      <Link className="palazzo-pill palazzo-enter palazzo-magnetic" to="/app">Enter Terminal <Icon name="arrow" size={17} /></Link>
      <button className="palazzo-mobile-toggle" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="palazzo-mobile-nav" aria-label={menuOpen ? 'Close menu' : 'Open menu'}><Icon name={menuOpen ? 'close' : 'menu'} /></button>
    </header>
    {menuOpen && <nav id="palazzo-mobile-nav" className="palazzo-mobile-nav" aria-label="Mobile landing navigation">{navItems.map((item) => <a key={item.target} href={'#' + item.target} onClick={() => setMenuOpen(false)}>{item.label}</a>)}<Link to="/app" onClick={() => setMenuOpen(false)}>Enter Terminal <Icon name="arrow" size={16}/></Link></nav>}
    <main className="palazzo-main" id="palazzo-content">
      <section className="palazzo-hero" id="top" aria-labelledby="palazzo-hero-heading">
        <div className="palazzo-hero-grid" aria-hidden="true" />
        <div className="palazzo-hero-lightwell" aria-hidden="true" />
        <div className="palazzo-hero-giant-index" aria-hidden="true">01</div>
        <div className="palazzo-hero-content">
          <div className="palazzo-eyebrow"><span className="palazzo-rule" /> MIA / INTELLIGENCE PLATFORM <span className="palazzo-rule" /></div>
          <div className="palazzo-hero-edition">A NEW ERA OF MARKET RESEARCH&nbsp; / &nbsp;EDITORIAL Nº 01</div>
          <h1 id="palazzo-hero-heading"><span className="palazzo-title-line">THE ART OF</span><span className="palazzo-title-line">INTELLIGENT</span><em className="palazzo-title-line">DECISIONS.</em></h1>
          <p className="palazzo-hero-description">Explore markets through coordinated intelligence, evidence-driven research, and disciplined risk controls.</p>
          <div className="palazzo-actions"><Link to="/app" className="palazzo-pill palazzo-pill-large palazzo-magnetic">Enter Terminal <Icon name="arrow" size={18} /></Link><a href="#philosophy" className="palazzo-outline">Explore MIA <Icon name="arrow" size={17} /></a></div>
          <div className="palazzo-hero-note"><span className="palazzo-small-dash" /> RESEARCH BEFORE EXECUTION <span className="palazzo-text-star">✳</span> PAPER-TRADING SYSTEM</div>
        </div>
        <div className="palazzo-sculpture-station"><HeroSculpture /><span className="palazzo-sculpture-caption" aria-hidden="true">MUSEUM OF INTELLIGENCE<br />ARTWORK Nº 001 / THE THINKING FORM</span></div>
        <div className="palazzo-hero-ticker" aria-label="Platform capabilities">{capabilities.map((item) => <div className="palazzo-ticker-item" key={item.id}><Icon name={item.icon} size={29} /><div><strong>{item.name}</strong><span>{item.detail.split('.')[0]}</span></div></div>)}</div>
      </section>

      <EditorialMarquee />
      <section className="palazzo-philosophy palazzo-section" id="philosophy"><div className="palazzo-philosophy-inner">
        <div><div className="palazzo-kicker palazzo-kicker-dark">02 / THE PHILOSOPHY</div><h2>Evidence.<br />Discipline.<br /><em>Intelligence.</em></h2></div>
        <div className="palazzo-philosophy-side"><div className="palazzo-da-vinci" aria-hidden="true"><div /><span>✧</span></div><p>Markets reward neither noise nor certainty. MIA is designed to put observation, multi-perspective analysis, and disciplined risk controls into one coordinated research process.</p><a href="#engine" className="palazzo-text-link">DISCOVER THE ENGINE <Icon name="arrow" size={18} /></a></div>
      </div></section>

      <ResearchThesis />
      <section className="palazzo-section palazzo-engine" id="engine"><div className="palazzo-section-top"><span className="palazzo-kicker">03 / THE INTELLIGENCE ENGINE</span><span className="palazzo-side-note">A RESEARCH FABRIC / NOT A PROFIT PROMISE</span></div><div className="palazzo-section-heading"><h2>From data to<br /><em>decision.</em></h2><p>Multiple layers of analysis are coordinated into research evidence. Existing workers and indicator specialists inform decisions; the risk gate remains authoritative.</p></div>
        <div className="palazzo-engine-grid">{capabilities.map((item) => <article key={item.id} className="palazzo-engine-card"><span className="palazzo-card-number">/{item.id}</span><div className="palazzo-engine-icon"><Icon name={item.icon} size={48}/></div><h3>{item.name}</h3><p>{item.detail}</p></article>)}</div>
      </section>

      <section className="palazzo-section palazzo-guardian" id="guardian"><div className="palazzo-guardian-art"><div className="palazzo-guardian-orbit" /><Icon name="shield" size={144} /><span>GUARDIAN / RISK FIRST</span></div><div className="palazzo-guardian-copy"><div className="palazzo-kicker">04 / THE GUARDIAN</div><h2>Trade with<br /><em>discipline.</em></h2><p>Opportunity is not authorization. MIA’s deterministic risk controls can reject a candidate when safeguards, data quality, or policy requirements are not met.</p><div className="palazzo-guard-list"><div><Icon name="scan" /><span>Data freshness checks</span></div><div><Icon name="shield" /><span>Central risk evaluation</span></div><div><Icon name="lock" /><span>Live execution remains locked</span></div></div></div></section>

      <section className="palazzo-section palazzo-joe" id="joe"><div className="palazzo-joe-copy"><div className="palazzo-kicker">05 / MEET TRADER JOE</div><h2>Intelligence<br />has a <em>voice.</em></h2><p>Ask, review, and explore system context. Trader Joe’s available command functions support workflows; conversational AI functions require their designated configuration.</p><Link className="palazzo-text-link" to="/app">OPEN MIA <Icon name="arrow" size={17}/></Link></div><div className="palazzo-joe-window" aria-label="Illustrative conversation preview"><div className="palazzo-joe-top"><span className="palazzo-joe-avatar">J</span><div><strong>TRADER JOE</strong><small>INTERFACE PREVIEW</small></div><span className="palazzo-joe-decoration">✳</span></div><div className="palazzo-joe-message user">What happens before a trade?</div><div className="palazzo-joe-message assistant"><span className="palazzo-joe-ai">JOE / EXAMPLE</span>Research evidence is reviewed, the decision engine evaluates the candidate, and deterministic risk controls decide whether paper execution is permitted.</div><div className="palazzo-joe-input">Illustrative interface · No live AI session <Icon name="arrow" size={16}/></div></div></section>

      <section className="palazzo-section palazzo-preview-section" id="preview"><div className="palazzo-section-top"><span className="palazzo-kicker">06 / PLATFORM PREVIEW</span><span className="palazzo-side-note">NO PRIVATE ACCOUNT DATA</span></div><h2>Clarity in every<br /><em>layer.</em></h2><p className="palazzo-preview-lede">A conceptual view of the existing terminal’s research workflow. The visual below is illustrative, not a representation of current market prices or account activity.</p><TerminalPreview /></section>

      <section className="palazzo-section palazzo-architecture" id="architecture"><div className="palazzo-section-top"><span className="palazzo-kicker">07 / THE SYSTEM ARCHITECTURE</span><span className="palazzo-side-note">EXPLORE THE RESEARCH PATH</span></div><h2>One connected<br /><em>line of thought.</em></h2><StageDiagram /></section>

      <section className="palazzo-section palazzo-roadmap" id="roadmap"><div className="palazzo-section-top"><span className="palazzo-kicker">08 / DEVELOPMENT ROADMAP</span><span className="palazzo-side-note">CAPABILITY STATUS / NOT PERFORMANCE DATA</span></div><h2>Built with intent.<br /><em>Released with care.</em></h2><div className="palazzo-roadmap-grid"><article><div className="palazzo-roadmap-tag existing"><Icon name="check" size={15} /> IMPLEMENTED IN REPOSITORY</div><h3>Research & paper system</h3><p>Market scanning, indicator specialists, coordinated intelligence, risk controls, paper OMS, portfolio tools, and core terminal pages.</p></article><article><div className="palazzo-roadmap-tag pending"><Icon name="layers" size={15} /> CONFIGURATION DEPENDENT</div><h3>Additional data sources</h3><p>Selected markets, social inputs, wallet intelligence, and conversational functions require credentials, licences, adapters, or verification.</p></article><article><div className="palazzo-roadmap-tag future"><Icon name="lock" size={15} /> NOT AVAILABLE FOR LIVE TRADING</div><h3>Real-money execution</h3><p>Live venue adapters, signing and independent release controls are not operational in this build. There is no live-trading authorization.</p></article></div></section>

      <section className="palazzo-closing"><div className="palazzo-kicker">09 / AN INVITATION TO THINK DIFFERENTLY</div><h2>THE FUTURE<br />IS <em>EXAMINED.</em></h2><p>Enter a more disciplined way to explore market intelligence.</p><Link to="/app" className="palazzo-pill palazzo-pill-large">Enter MIA <Icon name="arrow" size={19} /></Link><span className="palazzo-closing-orbit" aria-hidden="true" /></section>
    </main>
    <footer className="palazzo-footer"><a className="palazzo-footer-brand" href="#top"><span>Ⅲ</span> MIA <small>INTELLIGENCE PLATFORM</small></a><div className="palazzo-footer-links"><a href="#philosophy">Philosophy</a><a href="#engine">Engine</a><a href="#guardian">Guardian</a><a href="https://github.com/Naokiri5/naokiri" target="_blank" rel="noopener noreferrer">GitHub</a><Link to="/app">Terminal</Link></div><p>Market research is uncertain. Illustrations are not trading signals or investment advice. Paper results do not establish live performance. MIA does not guarantee returns.</p><div className="palazzo-footer-bottom"><span>© {new Date().getFullYear()} MIA</span><span>OBSIDIAN PALAZZO / RENAISSANCE BRUTALISM</span></div></footer>
  </div>;
}
