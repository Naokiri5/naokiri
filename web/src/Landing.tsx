import { useEffect, useMemo, useRef } from 'react';
import './landing/landing.css';
import { EntryProvider } from './landing/components/EntryShell';
import { ChapterRail, LandingFooter, LandingNav } from './landing/components/LandingChrome';
import { characterStateFor } from './landing/motion/characterStates';
import { SceneStore, useReducedMotion, useSceneController, useSceneValue } from './landing/motion/sceneController';
import { SLOGAN } from './landing/brand';
import { Arrival } from './landing/sections/Arrival';
import { MeetMia } from './landing/sections/MeetMia';
import { EnterBrainOS } from './landing/sections/EnterBrainOS';
import { IntelligenceInAction, stepForProgress } from './landing/sections/IntelligenceInAction';
import { BeginJourney } from './landing/sections/BeginJourney';

/**
 * MIA AI public landing page — V5 "Intelligence Unleashed" (pastel streetwear × retro-futuristic intelligence).
 * Five chapters, one scroll controller, one WebGL scene. Public and isolated: it calls no API, shows no account
 * data and can only hand off to /app, where the existing Privy sign-in and server authorization run.
 */
export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const store = useMemo(() => new SceneStore(), []);
  const [reduced, setReduced] = useReducedMotion();
  const active = useSceneController(root, store);
  const character = useSceneValue(store, (s) => characterStateFor(s.active, s.view[s.active], s.active === 'action' ? s.tracks.product ?? 0 : s.pin[s.active]));
  const scrolled = useSceneValue(store, (s) => s.view.arrival > 0.56);
  const productStep = useSceneValue(store, (s) => stepForProgress(s.tracks.product ?? 0));
  useEffect(() => {
    const previous = document.title;
    document.title = `MIA AI — ${SLOGAN}`;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousMeta = meta?.content;
    if (meta) meta.content = 'MIA AI: one central trading intelligence that observes, reasons and acts within deterministic risk controls. Paper-trading build; live execution locked.';
    return () => { document.title = previous === `MIA AI — ${SLOGAN}` ? 'MIA AI — Terminal' : previous; if (meta && previousMeta) meta.content = previousMeta; };
  }, []);

  return <EntryProvider reduced={reduced}>
    <div ref={root} className="v5" data-motion={reduced ? 'reduced' : 'full'}>
      <a href="#v5-content" className="v5-skip">Skip to content</a>
      <LandingNav scrolled={scrolled} />
      <ChapterRail active={active} />
      <main id="v5-content" className="v5-main">
        <Arrival reduced={reduced} state={character} />
        <MeetMia reduced={reduced} state={character} />
        <EnterBrainOS store={store} reduced={reduced} />
        <IntelligenceInAction scrollStep={productStep} />
        <BeginJourney reduced={reduced} state={character} />
      </main>
      <LandingFooter reduced={reduced} onReduced={setReduced} />
    </div>
  </EntryProvider>;
}
