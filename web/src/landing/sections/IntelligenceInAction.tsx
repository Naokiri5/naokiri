import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { PIPELINE, ProductPreview } from '../components/ProductPreview';
import { Sticker } from '../components/Campaign';
import { cssVars } from '../css';

const MODES = [
  { id: 'fast', word: 'FAST', title: 'Memecoin intelligence', tone: 'pink', motion: 'Responsive',
    points: ['Liquidity and executable depth', 'Token-safety screening', 'Volume, spread and slippage awareness', 'Compact, quick evaluation cycles'],
    today: 'Today the paper engine applies verified liquidity, spread, depth and pump screens to spot markets. Memecoin venues are not connected yet.' },
  { id: 'deep', word: 'DEEP', title: 'Futures intelligence', tone: 'blue', motion: 'Analytical',
    points: ['Structured strategy evaluation', 'Market context and regime', 'Risk-aware sizing', 'Walk-forward research before promotion'],
    today: 'Futures venues are not connected in this build. Strategy Lab walk-forward testing already runs on real spot history.' },
] as const;

const SAFEGUARDS: Array<{ name: string; state: 'verified' | 'proposed' }> = [
  { name: 'Market-data freshness gate', state: 'verified' },
  { name: 'Executable book depth and age (60 s default)', state: 'verified' },
  { name: 'Exposure and open-risk limits', state: 'verified' },
  { name: 'Daily, weekly and drawdown circuit breakers', state: 'verified' },
  { name: 'Emergency pause and stop', state: 'verified' },
  { name: 'Owner two-factor step-up for risk changes', state: 'verified' },
  { name: 'Tamper-evident audit and decision memory', state: 'verified' },
  { name: 'Live execution locked by release gates', state: 'verified' },
  { name: 'Token-safety scoring for FAST', state: 'proposed' },
  { name: 'Margin and liquidation guards for DEEP', state: 'proposed' },
];

/** Maps pinned progress across the product stage to one of the five pipeline steps. */
export const stepForProgress = (pin: number) => Math.min(PIPELINE.length - 1, Math.max(0, Math.floor(((pin - 0.04) / 0.9) * PIPELINE.length)));

/** Chapter 04 — The Trading Studio. One sticky product stage, then FAST/DEEP, Guardian and the product trio. */
export function IntelligenceInAction({ scrollStep }: { scrollStep: number }) {
  const [manual, setManual] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [session, setSession] = useState<'idle' | 'running'>('idle');
  useEffect(() => { setManual(null); }, [scrollStep]);
  const step = manual ?? scrollStep;

  return <section id="action" data-chapter="action" className="v5-ch v5-action" aria-labelledby="v5-action-title">
    <div className="v5-action-track" data-track="product">
      <div className="v5-action-pin">
        <div className="v5-wrap v5-action-grid">
          <div className="v5-action-copy">
            <p className="v5-kicker"><span className="v5-tag">04 · Intelligence in action</span></p>
            <h2 id="v5-action-title" className="v5-h2">From observation to disciplined action.</h2>
            <ol className="v5-pipeline">
              {PIPELINE.map((p, i) => <li key={p.key} data-current={i === step || undefined}>
                <button type="button" aria-pressed={i === step} onClick={() => setManual(i)}>
                  <span className="v5-pipeline-key">{String(i + 1).padStart(2, '0')} {p.key}</span>
                  <span className="v5-pipeline-body">{p.body}</span>
                </button>
              </li>)}
            </ol>
            <div className="v5-action-controls">
              <button type="button" className={`v5-toggle ${blocked ? 'is-on' : ''}`} aria-pressed={blocked} onClick={() => setBlocked(!blocked)}>
                <Icon name={blocked ? 'cross' : 'shield'} size={16} />{blocked ? 'Showing a blocked trade' : 'Show a blocked trade'}
              </button>
              <span className="v5-mono-label">Public demo · local fixtures · cannot place orders</span>
            </div>
          </div>
          <ProductPreview step={step} blocked={blocked} />
        </div>
      </div>
    </div>

    <div className="v5-wrap v5-modes">
      {MODES.map((m, i) => <article key={m.id} id={m.id} className={`v5-mode v5-mode-${m.tone}`} data-reveal="" style={cssVars({ '--i': i })} aria-labelledby={`v5-${m.id}-title`}>
        <div className="v5-mode-top"><span className="v5-chip v5-chip-cream">Planned mode · not live</span><span className="v5-mono-label">{m.motion} motion</span></div>
        <p className="v5-mode-word" aria-hidden="true">{m.word}</p>
        <h3 id={`v5-${m.id}-title`}><span className="v5-sr">{m.word}: </span>{m.title}</h3>
        <ul>{m.points.map((p) => <li key={p}><Icon name="arrow" size={16} />{p}</li>)}</ul>
        <p className="v5-mode-today">{m.today}</p>
      </article>)}
      <p className="v5-modes-note" data-reveal="" style={cssVars({ '--i': 2 })}><Sticker name="fork" className="v5-st-inline" />FAST and DEEP are two styles of the same BrainOS, under the same risk gate. No separate brains, no promised speed or results.</p>
    </div>

    <section id="guardian" className="v5-wrap v5-guardian" aria-labelledby="v5-guardian-title">
      <div className="v5-guardian-copy">
        <p className="v5-kicker"><span className="v5-tag v5-tag-cream">Guardian</span></p>
        <h3 id="v5-guardian-title" className="v5-h3">The risk gate has the final word.</h3>
        <p>Every candidate passes one deterministic gate. If an input is missing, stale, inconsistent or outside policy, the answer is no trade and the reason is logged.</p>
      </div>
      <div className="v5-gate" role="group" aria-label="Guardian risk gate diagram">
        <div className="v5-gate-in"><span className="v5-mono-label">Input</span><strong>Candidate decision</strong><small>evidence + proposed size</small></div>
        <ul className="v5-gate-checks">{SAFEGUARDS.map((s) => <li key={s.name} data-state={s.state}>
          <Icon name={s.state === 'verified' ? 'check' : 'spark'} size={15} /><span>{s.name}</span><em>{s.state === 'verified' ? 'In build' : 'Proposed'}</em>
        </li>)}</ul>
        <div className="v5-gate-out">
          <div className="is-ok"><Icon name="check" size={16} /><span><strong>Authorized</strong> paper order</span></div>
          <div className="is-no"><Icon name="cross" size={16} /><span><strong>Rejected</strong> no trade, reason logged</span></div>
        </div>
      </div>
    </section>

    <div className="v5-wrap v5-trio">
      <article className="v5-trio-card" data-reveal="" style={cssVars({ '--i': 0 })}>
        <span className="v5-mono-label">Autopilot</span><h3>Run sessions inside your limits.</h3>
        <p>Session status, environment and risk information in one place.</p>
        <div className="v5-demo-session" role="group" aria-label="Autopilot demo controls (local only)">
          <span className={`v5-session-state is-${session}`}>{session === 'running' ? 'Demo session running' : 'Demo session idle'}</span>
          <button type="button" className="v5-btn v5-btn-pink v5-btn-sm" disabled={session === 'running'} onClick={() => setSession('running')}><span className="v5-btn-inner"><Icon name="play" size={14} />Run Session</span></button>
          <button type="button" className="v5-btn v5-btn-cream v5-btn-sm" disabled={session === 'idle'} onClick={() => setSession('idle')}><span className="v5-btn-inner"><Icon name="stop" size={14} />Close Session</span></button>
        </div>
        <small>Public demo: changes this page only. Real sessions need sign-in, an accepted risk policy and paper mode.</small>
      </article>
      <article className="v5-trio-card v5-trio-blue" data-reveal="" style={cssVars({ '--i': 1 })}>
        <span className="v5-mono-label">Smart Portfolio</span><h3>Positions, exposure and reports.</h3>
        <div className="v5-exposure" role="img" aria-label="Illustrative exposure split: 32% asset A, 21% asset B, 47% cash">
          <span style={cssVars({ '--w': '32%' })}>A 32%</span><span style={cssVars({ '--w': '21%' })}>B 21%</span><span style={cssVars({ '--w': '47%' })}>Cash 47%</span>
        </div>
        <small>Illustrative split, not account data.</small>
      </article>
      <article className="v5-trio-card v5-trio-cream" data-reveal="" style={cssVars({ '--i': 2 })}>
        <span className="v5-mono-label">Trader Joe</span><h3>Explanations, not orders.</h3>
        <p className="v5-joe-q">Why was my last trade skipped?</p>
        <p className="v5-joe-a">The risk gate rejected it: the order book was older than the 60 second limit, so no order was sent.</p>
        <small>Example dialogue. Joe has no order authority; conversational mode needs a server API key.</small>
      </article>
    </div>
  </section>;
}
