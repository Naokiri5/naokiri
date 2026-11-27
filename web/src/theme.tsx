import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

const MiaTheme = createContext<readonly [Theme, () => void]>(['light', () => {}]);

export function MiaThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // MIA Atelier: the soft-white workspace is the default; an explicit dark choice is remembered.
    try { return localStorage.getItem('mia-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('mia-theme', theme); } catch { /* Private browsing can block storage. */ }
  }, [theme]);

  return <MiaTheme.Provider value={[theme, () => setTheme((current) => current === 'dark' ? 'light' : 'dark')]}>{children}</MiaTheme.Provider>;
}

export const useMiaTheme = () => useContext(MiaTheme);
