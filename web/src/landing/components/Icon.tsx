/** One functional icon family for the landing page (1.75 px stroke, 24 px grid). Decorative stickers live elsewhere. */
export type IconName = 'arrow' | 'arrowDown' | 'menu' | 'close' | 'check' | 'cross' | 'lock' | 'shield' | 'play' | 'stop' | 'spark';

const PATHS: Record<IconName, string> = {
  arrow: 'M5 12h14M13 6l6 6-6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7',
  cross: 'M7 7l10 10M17 7 7 17',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6zM12 14.5v2.5',
  shield: 'M12 3 4.5 6v5.5c0 4.4 3.1 7.7 7.5 9.5 4.4-1.8 7.5-5.1 7.5-9.5V6L12 3Z',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  stop: 'M7 7h10v10H7z',
  spark: 'M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3',
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>;
}
