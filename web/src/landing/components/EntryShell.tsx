import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';

/**
 * Authentication handoff (T07 + T19). An explicit "Enter MIA" activation morphs the clicked control into a branded
 * entry shell, then routes to /app, where the EXISTING Privy wallet sign-in and server authorization run.
 * This shell never authenticates, never imitates a wallet dialog, and scrolling can never open it.
 *
 * Phases: idle → requested → (navigate to /app). Cancel or Escape returns to idle and restores focus and scroll.
 */
type Phase = 'idle' | 'requested';
interface EntryApi { enter: (origin?: HTMLElement | null) => void; phase: Phase }
const EntryContext = createContext<EntryApi>({ enter: () => undefined, phase: 'idle' });
export const useEntry = () => useContext(EntryContext);

const HANDOFF_MS = 700;
const NAME = 'mia-entry';
type StartViewTransition = (cb: () => void) => { finished: Promise<void> };

export function EntryProvider({ children, reduced, target = '/app' }: { children: ReactNode; reduced: boolean; target?: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const navigate = useNavigate();
  const origin = useRef<HTMLElement | null>(null);
  const scrollY = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const phaseRef = useRef<Phase>('idle');

  const enter = useCallback((from?: HTMLElement | null) => {
    if (phaseRef.current !== 'idle') return; // duplicate clicks are ignored
    phaseRef.current = 'requested';
    origin.current = from ?? (document.activeElement as HTMLElement | null);
    scrollY.current = window.scrollY;
    const show = () => flushSync(() => setPhase('requested'));
    const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition?.bind(document);
    if (start && !reduced && from) {
      from.style.setProperty('view-transition-name', NAME);
      start(() => { from.style.removeProperty('view-transition-name'); show(); });
    } else show();
    timer.current = window.setTimeout(() => navigate(target), reduced ? 120 : HANDOFF_MS);
  }, [navigate, reduced, target]);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    phaseRef.current = 'idle';
    setPhase('idle');
    window.scrollTo({ top: scrollY.current });
    origin.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return <EntryContext.Provider value={{ enter, phase }}>
    {children}
    {phase === 'requested' && <EntryShell onCancel={cancel} />}
  </EntryContext.Provider>;
}

function EntryShell({ onCancel }: { onCancel: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    card.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);
  return <div className="v5-entry" role="presentation">
    <div ref={card} className="v5-entry-card" role="dialog" aria-modal="true" aria-labelledby="v5-entry-title" aria-describedby="v5-entry-desc"
      tabIndex={-1} style={{ viewTransitionName: NAME }}>
      <BrandLogo variant="symbol" tone="black" width={56} />
      <p className="v5-entry-eyebrow">MIA AI · Secure access</p>
      <h2 id="v5-entry-title">Opening secure sign-in</h2>
      <p id="v5-entry-desc">Next you will connect your wallet with Privy. Signing in proves who you are; it does not authorize trading.
        This build trades on paper only and live execution stays locked.</p>
      <div className="v5-entry-progress" role="status" aria-live="polite"><span />Preparing the MIA terminal…</div>
      <button type="button" className="v5-btn v5-btn-cream v5-btn-md" onClick={onCancel}><span className="v5-btn-inner">Cancel</span></button>
    </div>
  </div>;
}
