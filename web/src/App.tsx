import { useEffect, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import Landing from './Landing';

/**
 * The public landing page ships without the protected terminal: the Privy SDK, dashboard pages and charts load only
 * when a visitor reaches /app (or any deep link). A plain dynamic import is used instead of React.lazy/Suspense so the
 * hand-off involves no timer-based reveal (pages are tested under paused browser clocks).
 */
let shellModule: Promise<{ default: ComponentType }> | null = null;
export const loadAppShell = () => (shellModule ??= import('./AppShell'));

export default function App() {
  const { pathname } = useLocation();
  const isLanding = pathname === '/';
  const [Shell, setShell] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isLanding || Shell) return;
    let live = true;
    loadAppShell().then((m) => { if (live) setShell(() => m.default); })
      .catch(() => { shellModule = null; if (live) setFailed(true); });
    return () => { live = false; };
  }, [isLanding, Shell]);

  if (isLanding) return <Landing />;
  if (failed) return <main className="mia-wallet-login"><section className="mia-wallet-card" role="alert">
    <h1>Unable to load MIA</h1><p>The terminal could not be downloaded. Check your connection, then reload.</p>
    <button className="primary mia-wallet-button" onClick={() => window.location.reload()}>Reload</button>
  </section></main>;
  if (!Shell) return <div className="mia-wallet-login" role="status">Connecting to MIA…</div>;
  return <Shell />;
}
