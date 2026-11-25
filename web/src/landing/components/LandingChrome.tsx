import { useEffect, useState, type MouseEvent } from 'react';
import { BrandLogo } from './BrandLogo';
import { Icon } from './Icon';
import { useEntry } from './EntryShell';
import { CHAPTERS, type ChapterId } from '../motion/chapters';
import { SLOGAN } from '../brand';

const LINKS = [
  { href: '#meet', label: 'Meet MIA' },
  { href: '#brainos', label: 'BrainOS' },
  { href: '#fast', label: 'FAST & DEEP' },
  { href: '#guardian', label: 'Guardian' },
];

/** Plain left-clicks open the entry shell; modified clicks keep normal link behavior (new tab, etc.). */
function useEnterClick() {
  const { enter } = useEntry();
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault(); enter(e.currentTarget);
  };
}

export function LandingNav({ scrolled }: { scrolled: boolean }) {
  const [open, setOpen] = useState(false);
  const enterClick = useEnterClick();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  return <header className={`v5-nav ${scrolled ? 'is-scrolled' : ''}`}>
    <a href="#top" className="v5-nav-brand" aria-label="MIA AI — back to top"><BrandLogo variant="compact" tone="black" width={160} /></a>
    <nav className="v5-nav-links" aria-label="Landing navigation">{LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</nav>
    <a className="v5-btn v5-btn-pink v5-btn-md v5-nav-cta" href="/app" onClick={enterClick}><span className="v5-btn-inner">Enter MIA<Icon name="arrow" size={16} /></span></a>
    <button type="button" className="v5-nav-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="v5-mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'}>
      <Icon name={open ? 'close' : 'menu'} size={22} />
    </button>
    {open && <nav id="v5-mobile-nav" className="v5-mobile-nav" aria-label="Mobile landing navigation">
      {LINKS.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
      <a href="/app" className="v5-btn v5-btn-pink v5-btn-md" onClick={(e) => { setOpen(false); enterClick(e); }}><span className="v5-btn-inner">Enter MIA<Icon name="arrow" size={16} /></span></a>
    </nav>}
  </header>;
}

/** Chapter indicator: where the visitor is in the five-part story. Links jump to each chapter. */
export function ChapterRail({ active }: { active: ChapterId }) {
  return <nav className="v5-rail" aria-label="Chapters">
    <ol>{CHAPTERS.map((c) => <li key={c.id}>
      <a href={c.id === 'arrival' ? '#top' : `#${c.id}`} aria-current={active === c.id ? 'step' : undefined}>
        <span className="v5-rail-num">{c.number}</span><span className="v5-rail-title">{c.title}</span>
      </a>
    </li>)}</ol>
  </nav>;
}

export function LandingFooter({ reduced, onReduced }: { reduced: boolean; onReduced: (v: boolean) => void }) {
  const enterClick = useEnterClick();
  return <footer className="v5-footer">
    <div className="v5-footer-top">
      <div className="v5-footer-brand"><BrandLogo variant="compact" tone="white" width={200} /><p>{SLOGAN}</p></div>
      <nav aria-label="Footer"><h3>Product</h3><a href="#brainos">MIA BrainOS</a><a href="#fast">FAST &amp; DEEP</a><a href="#guardian">Guardian</a><a href="/app" onClick={enterClick}>Enter MIA</a></nav>
      <nav aria-label="Company"><h3>Company</h3><a href="#meet">Meet AUREUS</a><a href="https://github.com/Naokiri5/naokiri" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        <button type="button" className="v5-linkbtn" aria-pressed={reduced} onClick={() => onReduced(!reduced)}>{reduced ? 'Turn motion back on' : 'Reduce motion'}</button></nav>
      <div className="v5-footer-risk"><h3>Trading-risk disclosure</h3>
        <p>MIA AI is a paper-trading and research build. Balances, orders and results in MIA are simulated against live order books; no real funds are used and live venue execution is locked.</p>
        <p>Nothing on this page is investment advice or a trading signal. Demo charts are illustrative fixtures. Markets are uncertain and MIA does not guarantee returns.</p>
      </div>
    </div>
    <div className="v5-footer-bottom"><span>© {new Date().getFullYear()} MIA AI</span><span>{SLOGAN}™</span><span>Privacy and terms: pending legal review</span></div>
  </footer>;
}
