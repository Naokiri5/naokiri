import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Segment } from './status';

const KEY = 'mia-cockpit-privacy';
const Context = createContext({ hidden: false, setHidden: (_hidden: boolean) => {} });

/** A local display preference. Account data, formatting and trading permissions remain unchanged. */
export function CockpitPrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, String(hidden)); } catch { /* Works in memory when storage is unavailable. */ } }, [hidden]);
  return <Context.Provider value={{ hidden, setHidden }}>{children}</Context.Provider>;
}

export function useCockpitPrivacy() {
  const { hidden, setHidden } = useContext(Context);
  // Return replacement content, rather than mounting sensitive children under a blur or aria-hidden.
  const conceal = (value: ReactNode, replacement: ReactNode = 'Hidden') => hidden ? replacement : value;
  return { hidden, setHidden, conceal };
}

export function CockpitPrivacyToggle() {
  const { hidden, setHidden } = useCockpitPrivacy();
  return <button type="button" className="sm" aria-label="Hide cockpit amounts" aria-pressed={hidden}
    title="Masks Overview and monitor amounts only; other workspaces and exports may show account details."
    onClick={() => setHidden(!hidden)}>{hidden ? 'Reveal cockpit amounts' : 'Hide cockpit amounts'}</button>;
}

/** Preserve the authoritative safety tone/state, without leaking account figures through names or tooltips. */
export function privateCockpitSegment(segment: Segment): Segment {
  if (segment.id !== 'risk') return { ...segment, detail: `${segment.label} status shown. Detailed messages hidden in cockpit privacy mode.` };
  const states = ['EMERGENCY STOP', 'NO POLICY', 'BREAKER', 'MARKS MISSING', 'LOSS STREAK', 'STALE', 'UNKNOWN'];
  const value = states.find(state => segment.value === state || segment.value.startsWith(`${state} ·`)) ?? 'Hidden';
  return { ...segment, value, detail: 'Account figures hidden. Open the Risk Center to review safety and limits.' };
}
