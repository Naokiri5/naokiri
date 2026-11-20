import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ViewMode = 'simple' | 'analyst' | 'engineer';
const KEY = 'mia-presentation';
const valid = (value: string | null): value is ViewMode => value === 'simple' || value === 'analyst' || value === 'engineer';
const Context = createContext<{ mode: ViewMode; setMode: (mode: ViewMode) => void }>({ mode: 'simple', setMode: () => {} });

/** Presentation preference only: never stored as a trading mode or sent to the server. */
export function PresentationProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>(() => {
    try { const saved = localStorage.getItem(KEY); return valid(saved) ? saved : 'simple'; } catch { return 'simple'; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, mode); } catch { /* UI remains usable without storage. */ } }, [mode]);
  return <Context.Provider value={{ mode, setMode }}>{children}</Context.Provider>;
}
export const usePresentation = () => useContext(Context);
export function PresentationSelector() {
  const { mode, setMode } = usePresentation();
  return <label className="presentation-selector">View <select aria-label="Presentation mode" value={mode} onChange={e => { if (valid(e.target.value)) setMode(e.target.value); }}>
    <option value="simple">Simple</option><option value="analyst">Analyst</option><option value="engineer">Engineer</option>
  </select></label>;
}
