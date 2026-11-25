import { BrainCore } from '../components/BrainCore';
import { Icon } from '../components/Icon';
import type { SceneStore } from '../motion/sceneController';
import { cssVars } from '../css';

/** Every layer maps to code that exists in this repository; nothing here is invented telemetry. */
const LAYERS = [
  { n: '01', name: 'Perception', body: 'Market scanning, normalization and feed-health checks across supported public data sources.', status: 'In this build', at: 0.4 },
  { n: '02', name: 'Memory', body: 'Immutable decision memory keeps every pre-decision snapshot and its outcome for review.', status: 'In this build', at: 0.48 },
  { n: '03', name: 'Reasoning', body: '100 deterministic workers and 50 indicator specialists form evidence through QCI consensus.', status: 'In this build', at: 0.58 },
  { n: '04', name: 'Risk', body: 'A deterministic, fail-closed gate authorizes or vetoes. Missing, stale or inconsistent inputs mean no trade.', status: 'In this build', at: 0.7 },
  { n: '05', name: 'Execution', body: 'Authorized orders fill on paper against live order-book depth. Live venue execution is locked.', status: 'Paper only', at: 0.8 },
];

/** Chapter 03 — The Cognitive Lab. One pinned stage; the camera passes through the portal into the core. */
export function EnterBrainOS({ store, reduced }: { store: SceneStore; reduced: boolean }) {
  return <section id="brainos" data-chapter="brainos" className="v5-ch v5-brainos" aria-labelledby="v5-brainos-title">
    <div className="v5-pin">
      <div className="v5-portal" aria-hidden="true" />
      <div className="v5-brainos-grid">
        <header className="v5-brainos-head">
          <p className="v5-kicker"><span className="v5-tag v5-tag-cream">03 · Enter BrainOS</span></p>
          <h2 id="v5-brainos-title" className="v5-h2">One intelligence. An evolving understanding of the market.</h2>
          <p className="v5-lede">MIA BrainOS is one central intelligence, not a pile of disconnected bots. The core below is a visual metaphor, not live telemetry.</p>
        </header>
        <div className="v5-brainos-core"><BrainCore store={store} reduced={reduced} /></div>
        <ol className="v5-layers" aria-label="BrainOS layers">
          {LAYERS.map((l) => <li key={l.n} style={cssVars({ '--at': l.at })} data-layer={l.name.toLowerCase()}>
            <span className="v5-layer-n" aria-hidden="true">{l.n}</span>
            <div><h3>{l.name}</h3><p>{l.body}</p><span className="v5-chip">{l.status}</span></div>
          </li>)}
        </ol>
        <figure className="v5-blocked" style={cssVars({ '--at': 0.86 })}>
          <figcaption><span className="v5-mono-label">Illustrative example</span>A rejected decision stops at the risk gate.</figcaption>
          <ol>
            <li>Candidate</li>
            <li><Icon name="check" size={14} />Evidence</li>
            <li><Icon name="check" size={14} />Decision</li>
            <li className="is-x"><Icon name="cross" size={14} />Risk gate · order book too old</li>
            <li className="is-end">No trade</li>
          </ol>
        </figure>
      </div>
    </div>
  </section>;
}
