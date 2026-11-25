import type { ReactElement } from 'react';

/**
 * Original V5 campaign graphics: the retro signal terminal, Horizon signal tape, intelligence street sign and the
 * small MIA sticker vocabulary. Drawn for MIA AI (no reference artwork reused). All purely decorative pieces are
 * hidden from assistive technology; the street-sign plates are real, labeled links.
 */
const G = '#2B2430'; const PINK = '#F48BB8'; const PINK_D = '#E472A3'; const BLUE = '#8FD3F4'; const CREAM = '#FFF5F7'; const LAV = '#8E8196';

export function SignalTerminal({ className }: { className?: string }) {
  const grid = Array.from({ length: 7 }, (_, i) => 84 + i * 32);
  return <svg className={className} viewBox="0 0 440 540" aria-hidden="true" focusable="false">
    <ellipse cx="220" cy="522" rx="176" ry="13" fill={G} opacity=".12" />
    {/* lower terminal — MEMORY */}
    <rect x="34" y="292" width="372" height="222" rx="28" fill={PINK} stroke={G} strokeWidth="3" />
    <path d="M62 300h316" stroke={CREAM} strokeOpacity=".7" strokeWidth="6" strokeLinecap="round" />
    <rect x="58" y="318" width="262" height="174" rx="20" fill={G} />
    <rect x="68" y="328" width="242" height="154" rx="14" fill={BLUE} />
    {grid.map((x) => <path key={x} d={`M${x} 334v142`} stroke={G} strokeOpacity=".12" />)}
    {[360, 392, 424, 456].map((y) => <path key={y} d={`M74 ${y}h230`} stroke={G} strokeOpacity=".12" />)}
    <path className="v5-wave" d="M76 430c22 0 24-46 46-46s24 62 48 62 22-84 46-84 24 40 46 40 20-28 38-28" fill="none" stroke={G} strokeWidth="3.5" strokeLinecap="round" />
    <text x="82" y="352" fill={G} fontFamily="IBM Plex Mono, monospace" fontSize="13" fontWeight="600" letterSpacing="2">MEMORY</text>
    <rect x="216" y="338" width="84" height="20" rx="10" fill={CREAM} stroke={G} strokeWidth="1.5" />
    <text x="258" y="352" textAnchor="middle" fill={G} fontFamily="IBM Plex Mono, monospace" fontSize="9.5" fontWeight="600" letterSpacing="1">ILLUSTRATIVE</text>
    <circle cx="362" cy="350" r="18" fill={CREAM} stroke={G} strokeWidth="3" /><path d="M362 350l8-9" stroke={G} strokeWidth="3" strokeLinecap="round" />
    <circle cx="362" cy="404" r="12" fill={BLUE} stroke={G} strokeWidth="3" />
    <rect x="344" y="440" width="36" height="8" rx="4" fill={G} /><rect x="344" y="456" width="36" height="8" rx="4" fill={G} opacity=".6" />
    {/* upper terminal — PERCEPTION */}
    <rect x="80" y="30" width="300" height="246" rx="32" fill={PINK} stroke={G} strokeWidth="3" />
    <path d="M110 40h240" stroke={CREAM} strokeOpacity=".7" strokeWidth="6" strokeLinecap="round" />
    <rect x="104" y="58" width="208" height="180" rx="24" fill={G} />
    <rect x="114" y="68" width="188" height="160" rx="18" fill={BLUE} />
    <circle cx="208" cy="152" r="56" fill="none" stroke={G} strokeWidth="2.5" strokeDasharray="4 7" />
    <circle className="v5-aperture" cx="208" cy="152" r="36" fill={CREAM} stroke={G} strokeWidth="3" />
    <circle cx="208" cy="152" r="15" fill={PINK} stroke={G} strokeWidth="3" />
    <path d="M208 84v20M208 200v20M140 152h20M256 152h20" stroke={G} strokeWidth="2.5" strokeLinecap="round" />
    <text x="124" y="90" fill={G} fontFamily="IBM Plex Mono, monospace" fontSize="12" fontWeight="600" letterSpacing="2">PERCEPTION</text>
    <circle cx="346" cy="92" r="16" fill={CREAM} stroke={G} strokeWidth="3" /><path d="M346 92l-7-8" stroke={G} strokeWidth="3" strokeLinecap="round" />
    <circle cx="346" cy="140" r="10" fill={BLUE} stroke={G} strokeWidth="3" />
    <rect x="330" y="176" width="32" height="7" rx="3.5" fill={G} /><rect x="330" y="190" width="32" height="7" rx="3.5" fill={G} opacity=".6" />
    <path d="M150 276l-10 16h180l-10-16" fill={PINK_D} stroke={G} strokeWidth="3" strokeLinejoin="round" />
  </svg>;
}

export function SignalTape({ className, words = ['SENSE', 'THINK', 'DEFEND', 'EXECUTE', 'LEARN'] }: { className?: string; words?: string[] }) {
  const run = [...words, ...words, ...words];
  return <div className={`v5-tape ${className ?? ''}`} aria-hidden="true"><div className="v5-tape-run">{run.map((w, i) => <span key={i}>{w}<i>✦</i></span>)}</div></div>;
}

const PLATES = [
  { href: '#fast', label: 'FAST', hint: 'Memecoin intelligence', tone: 'pink' },
  { href: '#deep', label: 'DEEP', hint: 'Futures intelligence', tone: 'blue' },
  { href: '#brainos', label: 'BrainOS', hint: 'Central intelligence', tone: 'cream' },
  { href: '#guardian', label: 'Guardian', hint: 'Risk gate', tone: 'lav' },
] as const;

export function StreetSign({ className }: { className?: string }) {
  return <nav className={`v5-sign ${className ?? ''}`} aria-label="Intelligence districts">
    <span className="v5-sign-post" aria-hidden="true" />
    <ul>{PLATES.map((p, i) => <li key={p.href} className={`v5-plate v5-plate-${p.tone}`} style={{ ['--tilt' as string]: `${i % 2 ? 3 : -4}deg` }}>
      <a href={p.href}><strong>{p.label}</strong><span>{p.hint}</span><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></a>
    </li>)}</ul>
  </nav>;
}

type StickerName = 'arc' | 'aperture' | 'loop' | 'fork' | 'gate' | 'wave';
export function Sticker({ name, className }: { name: StickerName; className?: string }) {
  const body: Record<StickerName, ReactElement> = {
    arc: <><circle cx="40" cy="40" r="34" fill={CREAM} /><path d="M20 54A26 26 0 0 1 58 22" fill="none" stroke={G} strokeWidth="5" strokeLinecap="round" /><circle cx="40" cy="44" r="6" fill={PINK} stroke={G} strokeWidth="2.5" /></>,
    aperture: <><circle cx="40" cy="40" r="34" fill={BLUE} /><path d="M14 40c8-12 16-17 26-17s18 5 26 17c-8 12-16 17-26 17S22 52 14 40Z" fill={CREAM} stroke={G} strokeWidth="3.5" /><circle cx="40" cy="40" r="8" fill={G} /></>,
    loop: <><circle cx="40" cy="40" r="34" fill={PINK} /><path d="M24 40a8 8 0 1 0 16 0 8 8 0 1 1 16 0 8 8 0 1 1-16 0 8 8 0 1 0-16 0Z" fill="none" stroke={G} strokeWidth="4" /></>,
    fork: <><circle cx="40" cy="40" r="34" fill={CREAM} /><path d="M40 60V44M40 44l-12-14M40 44l12-14" fill="none" stroke={G} strokeWidth="4.5" strokeLinecap="round" /><circle cx="28" cy="28" r="5" fill={PINK} stroke={G} strokeWidth="2.5" /><circle cx="52" cy="28" r="5" fill={BLUE} stroke={G} strokeWidth="2.5" /></>,
    gate: <><circle cx="40" cy="40" r="34" fill={G} /><path d="M24 58V30a16 16 0 0 1 32 0v28" fill="none" stroke={CREAM} strokeWidth="4.5" /><path d="M30 46h20" stroke={PINK} strokeWidth="4.5" strokeLinecap="round" /></>,
    wave: <><circle cx="40" cy="40" r="34" fill={BLUE} /><path d="M16 44c6 0 6-12 12-12s6 18 12 18 6-24 12-24 6 18 12 18" fill="none" stroke={G} strokeWidth="4" strokeLinecap="round" /></>,
  };
  return <svg className={`v5-sticker ${className ?? ''}`} viewBox="0 0 80 80" aria-hidden="true" focusable="false">
    <circle cx="40" cy="40" r="37" fill={CREAM} stroke={LAV} strokeWidth="1.5" />{body[name]}<circle cx="40" cy="40" r="34" fill="none" stroke={G} strokeWidth="3" />
  </svg>;
}
