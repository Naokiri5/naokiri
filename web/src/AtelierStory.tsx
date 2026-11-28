import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, MiaMark, type IconName } from './brand';
import miaImage from './assets/mia-companion.webp';
import joeImage from './assets/trader-joe.webp';

export type IntelligenceMode = 'fast' | 'deep';

const modes = {
  fast: {
    label: 'FAST', icon: 'bolt', promise: 'Discover the early signal.',
    description: 'Survey emerging markets for changes in liquidity, volume, and activity. Inspect the evidence that brought a candidate into view.',
    inputs: ['Liquidity', 'Volume', 'Market activity'],
  },
  deep: {
    label: 'DEEP', icon: 'layers', promise: 'Understand the bigger picture.',
    description: 'Read market structure across timeframes, compare strategy candidates, and document the levels that would invalidate an idea.',
    inputs: ['Market structure', 'Strategy validation', 'Risk scenarios'],
  },
} satisfies Record<IntelligenceMode, { label: string; icon: IconName; promise: string; description: string; inputs: string[] }>;

const decisionStages: { title: string; detail: string; icon: IconName }[] = [
  { title: 'Discover', detail: 'Start with a timestamped market observation and record its source.', icon: 'radar' },
  { title: 'Understand', detail: 'Compare the observation with market structure and related signals.', icon: 'layers' },
  { title: 'Evaluate', detail: 'Test the candidate against its evidence, assumptions, and risk limits.', icon: 'shield' },
  { title: 'Act', detail: 'Pass eligible decisions to the authorized workflow and record the outcome.', icon: 'compass' },
];

const engines: { name: string; description: string; icon: IconName }[] = [
  { name: 'Market data', description: 'Collect market observations with their source, timestamp, and freshness.', icon: 'radar' },
  { name: 'Strategy', description: 'Compare market structure and strategy evidence before proposing a decision.', icon: 'layers' },
  { name: 'Risk', description: 'Apply the account’s risk policy before any new entry can be authorized.', icon: 'shield' },
  { name: 'Execution', description: 'Record approved paper orders, fills, and position protection in the ledger.', icon: 'compass' },
];

const strategyStages = [
  { title: 'Market evidence', detail: 'This example starts with a series of higher lows. Each observation is tied to a closed candle.' },
  { title: 'Candidate strategy', detail: 'A paper strategy hypothesis sets a possible entry range near the previous level.' },
  { title: 'Risk analysis', detail: 'The lower band identifies where the hypothesis becomes invalid. Liquidity and risk limits also apply.' },
  { title: 'Trade plan', detail: 'The plan records entry, invalidation, and the conditions required before execution.' },
];

const questions = [
  { text: 'Why was the token rejected?', reply: 'The example order book was too thin for the proposed size. The strategy would wait for fresh depth that meets the risk policy.', evidence: 'Order book snapshot · Liquidity check' },
  { text: 'What is our biggest risk?', reply: 'The example account has more exposure to one asset than the others combined. I’d check that position against the account’s concentration limit.', evidence: 'Paper ledger · Exposure by asset' },
  { text: 'How does Paper work?', reply: 'Paper uses a simulated allocation and records simulated fills and fees in its own ledger. An accepted risk policy is required before paper execution.', evidence: 'Operating mode · Paper ledger' },
];

function StoryTitle({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return <div className="atelier-story-heading">
    <span className="atelier-section-label">{label}</span>
    <h2>{title}</h2>
    {children && <p>{children}</p>}
  </div>;
}

function ModePicker({ mode, setMode }: { mode: IntelligenceMode; setMode: (mode: IntelligenceMode) => void }) {
  return <div className="atelier-segment" role="group" aria-label="Intelligence comparison">
    {(Object.keys(modes) as IntelligenceMode[]).map((value) =>
      <button key={value} type="button" data-mode={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
        <Icon name={modes[value].icon} size={17} />{modes[value].label}
      </button>)}
  </div>;
}

function Radar() {
  return <div className="atelier-radar" aria-hidden="true">
    <span className="atelier-radar-sweep" />
    <span className="atelier-radar-dot radar-dot-1" /><span className="atelier-radar-dot radar-dot-2" />
    <span className="atelier-radar-dot radar-dot-3" /><span className="atelier-radar-dot radar-dot-4" />
    <svg viewBox="0 0 300 300" fill="none">
      <g stroke="currentColor" opacity=".5">
        <circle cx="150" cy="150" r="146" strokeDasharray="2 6" />
        <circle cx="150" cy="150" r="119" /><circle cx="150" cy="150" r="83" /><circle cx="150" cy="150" r="48" />
        <path d="M150 2v296M2 150h296M45 45l210 210M45 255 255 45" strokeDasharray="3 6" />
      </g>
      <circle cx="150" cy="150" r="6" stroke="currentColor" /><circle cx="150" cy="150" r="2.5" fill="currentColor" />
    </svg>
  </div>;
}

function StrategyPlot({ step = 3 }: { step?: number }) {
  return <svg viewBox="0 0 500 230" className="atelier-strategy-plot" aria-hidden="true">
    <g stroke="currentColor" opacity=".18">
      <path d="M18 36h464M18 76h464M18 116h464M18 156h464M18 196h464M42 16v198M102 16v198M162 16v198M222 16v198M282 16v198M342 16v198M402 16v198M462 16v198" />
    </g>
    <path d="M20 181 45 166 66 176 88 141 108 155 131 146 152 161 177 126 199 134 222 100 249 120 274 105 291 123 316 87 342 98 369 67 390 85 415 58 442 66 480 35V215H20Z" fill="currentColor" opacity=".1" />
    <path d="M20 181 45 166 66 176 88 141 108 155 131 146 152 161 177 126 199 134 222 100 249 120 274 105 291 123 316 87 342 98 369 67 390 85 415 58 442 66 480 35" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    {step >= 1 && <g className="plot-entry"><path d="M222 100h260v25H222Z" fill="currentColor" opacity=".12" /><path d="M222 100h260" stroke="currentColor" strokeDasharray="4 4" /></g>}
    {step >= 2 && <g className="plot-risk"><path d="M222 157h260v23H222Z" fill="currentColor" opacity=".13" /><path d="M222 157h260" stroke="currentColor" strokeDasharray="4 4" /></g>}
    {step >= 3 && <g className="plot-target"><path d="M222 55h260" stroke="currentColor" strokeDasharray="4 4" /><circle cx="415" cy="58" r="5" fill="currentColor" /></g>}
  </svg>;
}

function MeetMia() {
  const [stage, setStage] = useState(0);
  const current = decisionStages[stage];
  return <section className="atelier-section atelier-container atelier-meet" id="philosophy">
    <div className="atelier-meet-art atelier-glass" data-stage={stage}>
      <div className="atelier-meet-orbit" aria-hidden="true">
        {decisionStages.map(({ icon, title }, i) => <span key={title} data-active={i === stage}><Icon name={icon} size={18} /></span>)}
      </div>
      <img src={miaImage} alt="" loading="lazy" width="1080" height="1080" />
    </div>
    <div className="atelier-meet-copy">
      <StoryTitle label="Meet MIA" title="A little character. A big intelligence.">Follow a market observation from its source to a recorded decision.</StoryTitle>
      <div className="atelier-steps" role="group" aria-label="Decision stages">
        {decisionStages.map(({ title, icon }, i) =>
          <button type="button" key={title} aria-pressed={i === stage} onClick={() => setStage(i)}><Icon name={icon} size={16} />{title}</button>)}
      </div>
      <p className="atelier-step-detail" aria-live="polite">{current.detail}</p>
    </div>
  </section>;
}

function Intelligence({ mode, setMode }: { mode: IntelligenceMode; setMode: (mode: IntelligenceMode) => void }) {
  const current = modes[mode];
  return <section className="atelier-section atelier-container" id="engine">
    <div className="atelier-section-top">
      <StoryTitle label="Two minds" title="Intelligence in two modes." />
      <ModePicker mode={mode} setMode={setMode} />
    </div>
    <div className="atelier-mode-surface atelier-glass" data-mode={mode}>
      <div className="atelier-mode-copy" aria-live="polite">
        <span className="atelier-icon-tile"><Icon name={current.icon} size={23} /></span>
        <h3>{current.promise}</h3>
        <p>{current.description}</p>
        <ul className="atelier-tags">{current.inputs.map((input) => <li key={input}>{input}</li>)}</ul>
      </div>
      <figure className="atelier-mode-visual">
        {mode === 'fast' ? <Radar /> : <StrategyPlot />}
        <figcaption>Illustrative {mode === 'fast' ? 'discovery radar' : 'strategy chart'}</figcaption>
      </figure>
    </div>
  </section>;
}

function IntelligenceNetwork() {
  const [active, setActive] = useState(0);
  return <section className="atelier-section atelier-container" id="architecture">
    <StoryTitle label="The intelligence network" title="One system, connected." />
    <div className="atelier-network-layout atelier-glass">
      <div className="atelier-network-map" role="group" aria-label="Intelligence engines">
        <div className="atelier-network-ring" aria-hidden="true"><MiaMark size={53} /></div>
        {engines.map(({ name, icon }, i) =>
          <button type="button" key={name} className={'atelier-network-node node-' + i} aria-pressed={active === i} onClick={() => setActive(i)}>
            <Icon name={icon} size={17} />{name}
          </button>)}
      </div>
      <div className="atelier-network-detail" aria-live="polite">
        <span className="atelier-icon-tile"><Icon name={engines[active].icon} size={23} /></span>
        <h3>{engines[active].name}</h3><p>{engines[active].description}</p>
      </div>
    </div>
  </section>;
}

function StrategyStory() {
  const [step, setStep] = useState(0);
  return <section className="atelier-section atelier-container atelier-split" id="strategy">
    <div>
      <StoryTitle label="Strategy reconstruction" title="See how a trade plan takes shape.">Step through a paper strategy example from observation to risk review.</StoryTitle>
      <div className="atelier-stage-list" role="group" aria-label="Strategy reconstruction stages">
        {strategyStages.map(({ title }, index) =>
          <button type="button" key={title} aria-pressed={index === step} onClick={() => setStep(index)}>
            <span className="atelier-stage-index">{index + 1}</span>{title}<Icon name="chevron" size={16} />
          </button>)}
      </div>
    </div>
    <figure className="atelier-strategy-surface atelier-glass">
      <figcaption>Illustrative strategy chart</figcaption>
      <StrategyPlot step={step} />
      <p aria-live="polite">{strategyStages[step].detail}</p>
    </figure>
  </section>;
}

function AutopilotStory() {
  return <section className="atelier-section atelier-container" id="autopilot">
    <div className="atelier-autopilot atelier-glass">
      <StoryTitle label="Autopilot" title="One place to supervise your workspace.">Review research, account readiness, and position protection in Central Command.</StoryTitle>
      <div className="atelier-autopilot-access">
        <div><span className="atelier-icon-tile"><Icon name="flask" size={20} /></span><div><strong>Paper</strong><p>Simulated allocation, orders, and fills.</p></div></div>
        <div><span className="atelier-icon-tile"><Icon name="lock" size={20} /></span><div><strong>Live locked</strong><p>Real-money execution requires verified readiness and owner authorization.</p></div></div>
        <Link className="atelier-button atelier-button-outline" to="/autopilot">Open Autopilot <Icon name="arrow-up-right" size={16} /></Link>
      </div>
    </div>
  </section>;
}

function JoeStory() {
  const [question, setQuestion] = useState(0);
  return <section className="atelier-section atelier-container atelier-split atelier-joe-section" id="joe">
    <div>
      <StoryTitle label="Trader Joe" title="Understand the decision.">Ask about market evidence, decisions, and portfolio risk.</StoryTitle>
      <img className="atelier-joe-art" src={joeImage} alt="Trader Joe, a warm ivory robot holding a holographic notebook" loading="lazy" width="800" height="800" />
    </div>
    <div className="atelier-joe-demo atelier-glass">
      <div className="atelier-joe-demo-hd"><div className="atelier-icon-tile"><Icon name="message" size={20} /></div><strong>Trader Joe</strong><span>Example conversation</span></div>
      <div className="atelier-joe-messages" aria-live="polite">
        <p className="atelier-joe-question">{questions[question].text}</p>
        <p className="atelier-joe-reply">{questions[question].reply}</p>
        <p className="atelier-source"><Icon name="layers" size={15} />{questions[question].evidence}</p>
      </div>
      <div className="atelier-joe-prompts" role="group" aria-label="Example questions">
        {questions.map(({ text }, index) =>
          <button type="button" key={text} aria-pressed={question === index} onClick={() => setQuestion(index)}>{text}</button>)}
      </div>
    </div>
  </section>;
}

function PortfolioStory() {
  return <section className="atelier-section atelier-container atelier-split" id="preview">
    <div>
      <StoryTitle label="Smart Portfolio" title="Know what you’re carrying.">See reconciled paper balances, asset exposure, fees, and position history in one workspace.</StoryTitle>
      <Link className="atelier-button atelier-button-outline" to="/smart-portfolio">Open Portfolio <Icon name="arrow-up-right" size={16} /></Link>
    </div>
    <div className="atelier-portfolio-example atelier-glass">
      <span className="atelier-example-label">Illustrative paper account</span>
      <div className="atelier-portfolio-values"><div><span>Equity</span><strong>$24,850.00</strong></div><div><span>Available cash</span><strong>$9,940.00</strong></div></div>
      <div className="atelier-allocation-bar" aria-hidden="true"><i /><i /><i /></div>
      <ul className="atelier-allocation-legend"><li>Cash 40%</li><li>BTC 36%</li><li>ETH 24%</li></ul>
    </div>
  </section>;
}

const safety: { title: string; description: string; icon: IconName }[] = [
  { title: 'Risk policy', description: 'Owner-approved thresholds govern paper entries and open exposure.', icon: 'shield' },
  { title: 'Position protection', description: 'See whether exits are being monitored and review protection incidents.', icon: 'compass' },
  { title: 'Owner authorization', description: 'Review readiness, permissions, and the audit trail in the workspace.', icon: 'lock' },
];

export function AtelierStory({ mode, setMode }: { mode: IntelligenceMode; setMode: (mode: IntelligenceMode) => void }) {
  return <>
    <MeetMia />
    <Intelligence mode={mode} setMode={setMode} />
    <IntelligenceNetwork />
    <StrategyStory />
    <AutopilotStory />
    <JoeStory />
    <PortfolioStory />
    <section className="atelier-section atelier-container" id="guardian">
      <StoryTitle label="Safety and transparency" title="Discipline comes first.">Trading involves risk. MIA makes its evidence and safeguards visible.</StoryTitle>
      <div className="atelier-safety-grid">
        {safety.map(({ title, description, icon }) => <article key={title} className="atelier-safety-card atelier-glass">
          <span className="atelier-icon-tile"><Icon name={icon} size={22} /></span>
          <h3>{title}</h3><p>{description}</p>
        </article>)}
      </div>
    </section>
    <section className="atelier-container atelier-end" id="roadmap">
      <MiaMark size={52} />
      <h2>Your intelligence workspace is ready.</h2>
      <Link className="atelier-button atelier-button-primary" to="/autopilot">Enter MIA <Icon name="arrow-up-right" size={18} /></Link>
    </section>
  </>;
}
