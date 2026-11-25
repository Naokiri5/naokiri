import { Aureus } from '../components/Aureus';
import { StreetSign, Sticker } from '../components/Campaign';
import { MASCOT } from '../brand';
import type { CharacterState } from '../motion/characterStates';
import { cssVars } from '../css';

const ROLES = [
  { name: 'AUREUS', role: 'Public guide. Explains the story; has no order authority.' },
  { name: 'Trader Joe', role: 'In-app assistant for explanations, summaries and lessons.' },
  { name: 'BrainOS', role: 'The one central intelligence that evaluates markets.' },
  { name: 'Risk gate', role: 'Deterministic and fail-closed. It always has the final say.' },
];

const DETAILS = [
  { title: 'Listens first', body: 'Headphones on. Perception starts with clean, fresh market data.', pos: '86% 21%' },
  { title: 'Keeps time', body: 'Stale data is rejected, never guessed. Timing is part of risk.', pos: '67% 55%' },
  { title: 'Packs light', body: 'The bag only carries what the risk policy allows.', pos: '84% 66%' },
];

/** Chapter 02 — The Intelligence District. AUREUS is fully revealed in front of the THINK backplate. */
export function MeetMia({ reduced, state }: { reduced: boolean; state: CharacterState }) {
  return <section id="meet" data-chapter="meet" className="v5-ch v5-meet" aria-labelledby="v5-meet-title">
    <div className="v5-curtain" aria-hidden="true"><span /><span /></div>
    <p className="v5-backplate" aria-hidden="true">THINK</p>
    <div className="v5-wrap v5-meet-grid">
      <div className="v5-meet-copy">
        <p className="v5-kicker"><span className="v5-tag v5-tag-blue">02 · Meet MIA</span></p>
        <h2 id="v5-meet-title" className="v5-h2">Meet the intelligence behind MIA.</h2>
        <p className="v5-lede">AUREUS is the face of MIA AI: a calm, curious guide who shows you how the system thinks. The character explains. It never trades.</p>
        <dl className="v5-roles">{ROLES.map((r) => <div key={r.name}><dt>{r.name}</dt><dd>{r.role}</dd></div>)}</dl>
      </div>
      <div className="v5-meet-stage">
        <Aureus variant="hero" state={state} reduced={reduced} />
        <StreetSign className="v5-meet-sign" />
        <span className="v5-portal-seed" aria-hidden="true" />
        <Sticker name="loop" className="v5-st v5-st-c" />
      </div>
    </div>
    <ul className="v5-wrap v5-details" aria-label="Details from the AUREUS design">
      {DETAILS.map((d, i) => <li key={d.title} data-reveal="" style={cssVars({ '--i': i })}>
        <div className="v5-detail-crop" aria-hidden="true" style={{ backgroundImage: `url(${MASCOT.src})`, backgroundPosition: d.pos }} />
        <div><h3>{d.title}</h3><p>{d.body}</p></div>
      </li>)}
    </ul>
  </section>;
}
