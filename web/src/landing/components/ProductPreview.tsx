/**
 * Public, read-only product demonstration. Every number is a deterministic local fixture labeled DEMO; nothing here
 * calls the API, reflects live markets or can place an order.
 */
export const PIPELINE = [
  { key: 'SENSE', title: 'Sense', body: 'The scanner reads public market data and checks feed health. Stale or missing data blocks new entries.' },
  { key: 'THINK', title: 'Think', body: '100 deterministic workers and 50 indicator specialists build evidence through QCI consensus. Evidence is not authorization.' },
  { key: 'DEFEND', title: 'Defend', body: 'The fail-closed risk gate checks data freshness, executable book depth, exposure and loss limits, and it can veto any candidate.' },
  { key: 'EXECUTE', title: 'Execute', body: 'Approved orders fill on paper against live order-book depth, never against a ticker fallback. Live venues stay locked.' },
  { key: 'LEARN', title: 'Learn', body: 'Decisions and outcomes are written to decision memory and Strategy Lab calibration. Nothing is promoted automatically.' },
] as const;

interface Candle { o: number; h: number; l: number; c: number }
function fixtureCandles(n = 36): Candle[] {
  let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const out: Candle[] = []; let prev = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i * 0.33) * 1.6 + 0.18;
    const c = prev + drift + (rnd() - 0.5) * 2.2;
    const h = Math.max(prev, c) + rnd() * 1.4; const l = Math.min(prev, c) - rnd() * 1.4;
    out.push({ o: prev, h, l, c }); prev = c;
  }
  return out;
}
const CANDLES = fixtureCandles();

function Chart() {
  const W = 520; const H = 220; const pad = 12;
  const hi = Math.max(...CANDLES.map((c) => c.h)); const lo = Math.min(...CANDLES.map((c) => c.l));
  const y = (v: number) => pad + ((hi - v) / (hi - lo)) * (H - pad * 2);
  const step = (W - pad * 2) / CANDLES.length;
  const ma = CANDLES.map((_, i) => { const w = CANDLES.slice(Math.max(0, i - 5), i + 1); return w.reduce((a, c) => a + c.c, 0) / w.length; });
  const maPath = ma.map((v, i) => `${i ? 'L' : 'M'}${(pad + step * i + step / 2).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return <svg className="v5-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {Array.from({ length: 5 }, (_, i) => <path key={i} d={`M0 ${pad + i * ((H - pad * 2) / 4)}H${W}`} stroke="#2B2430" strokeOpacity=".08" />)}
    <rect x={pad + step * 22} y={pad} width={step * 8} height={H - pad * 2} fill="#8FD3F4" opacity=".28" />
    {CANDLES.map((c, i) => {
      const x = pad + step * i + step / 2; const up = c.c >= c.o;
      return <g key={i}><path d={`M${x} ${y(c.h)}V${y(c.l)}`} stroke="#2B2430" strokeWidth="1.2" />
        <rect x={x - step * 0.32} y={y(Math.max(c.o, c.c))} width={step * 0.64} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))}
          fill={up ? '#FFFFFF' : '#2B2430'} stroke="#2B2430" strokeWidth="1.2" /></g>;
    })}
    <path className="v5-chart-line" d={maPath} fill="none" stroke="#E472A3" strokeWidth="2.5" pathLength={1} />
  </svg>;
}

const OUTCOME: Record<string, { ok: string; blocked?: string }> = {
  SENSE: { ok: 'Feeds healthy · book age 4 s · candidate found' },
  THINK: { ok: 'Evidence: 61 of 100 workers supportive · score is not a win rate' },
  DEFEND: { ok: 'Risk gate APPROVED · within exposure and loss limits', blocked: 'Risk gate REJECTED · order book 74 s old (limit 60 s)' },
  EXECUTE: { ok: 'Paper order filled against book depth · simulated funds', blocked: 'No trade · nothing sent · position unchanged' },
  LEARN: { ok: 'Decision and outcome recorded in decision memory', blocked: 'Rejection recorded with its reason for review' },
};

export function ProductPreview({ step, blocked }: { step: number; blocked: boolean }) {
  const current = PIPELINE[Math.max(0, Math.min(PIPELINE.length - 1, step))];
  const outcome = OUTCOME[current.key];
  const rejected = blocked && step >= 2;
  return <div className="v5-preview">
    <div className="v5-preview-back" aria-hidden="true" />
    <div className="v5-preview-screen" role="group" aria-label="Illustrative MIA terminal preview with demo data">
      <div className="v5-preview-bar"><span className="v5-preview-dots" aria-hidden="true"><i /><i /><i /></span><span>MIA / TERMINAL</span><span className="v5-chip v5-chip-cream">DEMO DATA · PAPER</span></div>
      <div className="v5-preview-body">
        <div className="v5-preview-head"><div><span className="v5-mono-label">Illustrative pair</span><strong>DEMO/USDT</strong></div><span className="v5-mono-label">1h · fixture</span></div>
        <Chart />
        <ol className="v5-preview-steps" aria-label="Decision pipeline">
          {PIPELINE.map((p, i) => {
            const state = i < step ? (blocked && i >= 2 ? 'blocked' : 'done') : i === step ? (rejected && i >= 2 ? 'blocked' : 'current') : 'todo';
            return <li key={p.key} data-state={state} aria-current={i === step ? 'step' : undefined}>{p.key}</li>;
          })}
        </ol>
        <div className={`v5-preview-outcome ${rejected ? 'is-blocked' : ''}`}>
          <span className="v5-mono-label">{current.key}</span>
          <p>{rejected && outcome.blocked ? outcome.blocked : outcome.ok}</p>
        </div>
      </div>
    </div>
  </div>;
}
