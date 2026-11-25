import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { PrivyShell, WalletLogin, type PrivyPublicConfig } from './privy/WalletLogin';
import { requirePrivyLogout, completePrivyLogout } from './privy/browserSession';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, authInfo, connectStream, disconnectStream, useApi, fmt } from './api';
import { ErrorLine } from './ui';
import { JoeDrawer } from './pages/Joe';
import * as P from './pages';
import { CommandPalette } from './palette';
import { StaleBanner, StatusRibbon } from './StatusRibbon';
import type { ShellDto } from './status';
import { ALL_PAGES, pageForPath } from './nav';
import { GroupTabs, PrimaryNav } from './Navigation';
import { Icon, MiaWordmark } from './brand';
import { AccessScreen } from './AccessScreen';
import { useMiaTheme } from './theme';
import './cockpit.css';

type AuthReply = { mode: 'privy' | 'passphrase'; setup: boolean; authenticated: boolean; privy: PrivyPublicConfig; stepUp?: string };
export default function ProtectedApp() {
  const [auth, setAuth] = useState<AuthReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const raw = await api<Partial<AuthReply>>('/api/auth/state');
      if ((raw.mode !== 'privy' && raw.mode !== 'passphrase') ||
          typeof raw.authenticated !== 'boolean' || typeof raw.setup !== 'boolean')
        throw new Error('MIA server authentication configuration is incomplete');
      if (raw.mode === 'privy' && (!raw.privy || typeof raw.privy.enabled !== 'boolean'))
        throw new Error('Privy configuration is unavailable on this MIA server');
      authInfo.mode = raw.mode;
      setAuth(raw as AuthReply); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Authentication service unavailable'); setAuth(null); }
  }, []);
  useEffect(() => { void load(); const f = () => setAuth(a => a ? { ...a, authenticated: false } : a);
    window.addEventListener('mia:unauthorized', f); return () => window.removeEventListener('mia:unauthorized', f); }, [load]);
  useEffect(() => { if (auth?.authenticated) connectStream(); else disconnectStream(); }, [auth?.authenticated]);
  if (error) return <AccessScreen><section className="mia-wallet-card" role="alert">
    <h1>Unable to connect to MIA</h1><p>{error}</p>
    <button className="primary mia-wallet-button" onClick={() => void load()}>Try again</button>
  </section></AccessScreen>;
  if (!auth) return <AccessScreen><div className="mia-wallet-card" role="status">Connecting to MIA…</div></AccessScreen>;
  if (auth.mode === 'privy') {
    if (!auth.privy?.enabled || !auth.privy.appId) return <AccessScreen>
      <section className="mia-wallet-card" role="alert"><h1>Privy setup required</h1>
        <p>MIA wallet sign-in is not configured. The server administrator must set MIA_PRIVY_APP_ID and MIA_PRIVY_OWNER_ID.</p>
        </section></AccessScreen>;
    return <PrivyShell appId={auth.privy.appId}><PrivyOwnerApp auth={auth} load={load} /></PrivyShell>;
  }
  // Historical passphrase forms exist only in explicit OFFLINE recovery and test mode.
  if (!auth.authenticated) return <Login setup={auth.setup} onDone={() => void load()} />;
  return <Shell onLogout={() => void load()} />;
}
function PrivyOwnerApp({ auth, load }: { auth: AuthReply; load: () => Promise<void> }) {
  const { logout } = usePrivy();
  if (!auth.authenticated) return <WalletLogin appId={auth.privy.appId!} onDone={() => void load()} />;
  return <Shell onLogout={async () => {
    requirePrivyLogout(auth.privy.appId!);
    await logout(); completePrivyLogout(auth.privy.appId!);
    await load();
  }} />;
}

function Login({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [p, setP] = useState(''); const [p2, setP2] = useState(''); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setErr(null);
    if (!setup && p !== p2) { setErr('Passphrases do not match.'); return; }
    setBusy(true);
    try {
      await api(setup ? '/api/auth/login' : '/api/auth/setup', { body: { password: p } });
      onDone();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };
  return <AccessScreen><form onSubmit={submit} className="mia-wallet-card">
    <div className="mia-wallet-eyebrow">Paper workspace</div>
    <h1>{setup ? 'Sign in' : 'Owner setup'}</h1>
    <p>{setup ? 'Enter your owner passphrase to open the workspace.' : 'Create an owner passphrase of at least 10 characters.'}</p>
    <div className="col mia-access-fields">
      <label className="col">Passphrase<input type="password" autoFocus value={p} onChange={(e) => setP(e.target.value)} autoComplete={setup ? 'current-password' : 'new-password'} /></label>
      {!setup && <label className="col">Confirm passphrase<input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></label>}
      <ErrorLine e={err} />
      <button className="primary mia-wallet-button" type="submit" disabled={busy}>{busy ? 'Connecting…' : setup ? 'Sign in' : 'Create owner'}</button>
    </div>
  </form></AccessScreen>;
}

function Shell({ onLogout }: { onLogout: () => void | Promise<void> }) {
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const shell = useApi<ShellDto>('/api/shell', { topics: ['mode', 'bot', 'notification', 'position', 'health'], every: 15_000 });
  const [palette, setPalette] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const [joe, setJoe] = useState(false);
  const [theme, toggleTheme] = useMiaTheme();
  const loc = useLocation();
  const s = shell.data; const nav = useNavigate();
  // /app is the protected entry, while original deep links stay valid for backwards compatibility.
  const routeLocation = loc.pathname === '/app' || loc.pathname.startsWith('/app/')
    ? { ...loc, pathname: loc.pathname.slice(4) || '/' }
    : loc;
  const cockpit = routeLocation.pathname === '/' || routeLocation.pathname === '/autopilot';
  return <div className="shell mia-operator-shell">
    <a className="mia-skip-link" href="#mia-main-content">Skip to main content</a>
    <header className="top">
      <div className="mia-top-row">
        <div className="mia-header-brand">
          <Link className="brand" to="/app" aria-label="MIA Autopilot"><MiaWordmark /></Link>
          <span className="mia-header-page">{pageForPath(loc.pathname)?.label}</span>
        </div>
        <PrimaryNav />
        <div className="mia-top-actions">
          <button className="ghost mia-top-icon" onClick={() => setPalette(true)} aria-label="Open command palette"><Icon name="compass" size={17} /></button>
          <button className="pill mia-top-icon" onClick={() => nav('/notifications')} aria-label="Notifications"><Icon name="bell" size={16} />{s?.unread ? <span>{s.unread}</span> : null}</button>
          <button className="ghost mia-top-icon" onClick={toggleTheme} aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
          <button className="ghost mia-sign-out" onClick={async () => { setSignOutError(null); try { await api('/api/auth/logout', { body: {} }); await onLogout(); } catch (e) { setSignOutError(e instanceof Error ? e.message : 'Sign out failed'); } }}>Sign out</button>
        </div>
      </div>
      <div className="mia-top-status"><StatusRibbon shell={shell} /><Search /></div>
    </header>
    <main id="mia-main-content" tabIndex={-1}>
      <StaleBanner shell={shell} />
      {signOutError && <div className="banner stale" role="alert">Sign-out was not fully completed: {signOutError}</div>}
      {s?.control.emergency && <div className="banner stale">⛔ EMERGENCY STOP active — new orders blocked. Existing positions are still monitored. Resolve in the Risk Center.</div>}
      {s && s.dataHealth.stale && <div className="banner stale">⚠ Market data is stale or disconnected (last update {fmt.ago(s.dataHealth.tickersAt)}). New entries are blocked by the data-quality gate.</div>}
      {s && s.mode !== 'OBSERVE' && <div className="banner paper">PAPER TRADING — all balances, orders and PnL are simulated against live order books. No real funds are used.</div>}
      {s && !s.policyAccepted && loc.pathname !== '/risk' && <div className="banner info">Risk policy not yet accepted — paper execution stays disabled until you review it in the <a href="/risk" onClick={(e) => { e.preventDefault(); nav('/risk'); }}>Risk Center</a>.</div>}
      <ErrorLine e={shell.error} />
      {!cockpit && <GroupTabs />}
      <Routes location={routeLocation}>
        <Route path="/" element={<P.Bot shell={shell} />} />
        <Route path="/overview" element={<P.Overview />} />
        <Route path="/ditas" element={<P.Ditas />} />
        <Route path="/academy" element={<P.Academy />} />
        <Route path="/terminal" element={<P.Terminal />} /><Route path="/terminal/:symbol" element={<P.Terminal />} />
        <Route path="/scanner" element={<P.Scanner />} /><Route path="/intelligence" element={<P.Intelligence />} />
        <Route path="/autopilot" element={<P.Bot shell={shell} />} />
        <Route path="/trader-joe" element={<P.JoePage />} />
        <Route path="/smart-portfolio" element={<P.Portfolio />} />
        <Route path="/joe" element={<P.JoePage />} /><Route path="/bubbles" element={<P.Bubbles />} /><Route path="/whales" element={<P.Whales />} />
        <Route path="/holders" element={<P.Holders />} /><Route path="/news" element={<P.News />} /><Route path="/bot" element={<P.Bot shell={shell} legacy />} />
        <Route path="/risk" element={<P.Risk />} /><Route path="/portfolio" element={<P.Portfolio />} /><Route path="/journal" element={<P.Journal />} />
        <Route path="/calendar" element={<P.Calendar />} /><Route path="/lab" element={<P.Lab />} /><Route path="/wallet" element={<P.Wallet />} />
        <Route path="/connections" element={<P.Connections />} /><Route path="/notifications" element={<P.Notifications />} /><Route path="/qa" element={<P.QA />} />
        <Route path="/settings" element={<P.Settings />} />
        <Route path="/discover" element={<P.Discover />} /><Route path="/qhef" element={<P.Qhef />} /><Route path="/security" element={<P.SecurityCenter />} />
        <Route path="/copy" element={<P.CopyTrading />} /><Route path="/history" element={<P.History />} /><Route path="/decision/:id" element={<P.DecisionPage />} />
        <Route path="*" element={<div className="empty">Not found</div>} />
      </Routes>
    </main>
    {palette && <CommandPalette pages={ALL_PAGES} onClose={() => setPalette(false)} extra={[
      { id: 'act:pause', label: 'Pause new orders', hint: 'risk-reducing', group: 'Action', run: async () => { await api('/api/emergency/pause', { body: {} }); shell.reload(); } },
      { id: 'act:protect', label: 'Verify position protection', hint: 'Risk Center', group: 'Action', run: async () => { await api('/api/emergency/protect', { body: {} }); nav('/risk'); } },
      { id: 'act:news', label: 'Refresh news now', group: 'Action', run: async () => { await api('/api/news/refresh', { body: {} }); nav('/news'); } },
      { id: 'act:joe', label: 'Ask Trader Joe', group: 'Action', run: () => setJoe(true) },
      { id: 'act:theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, group: 'Action', run: toggleTheme },
    ]} />}
    {(joe || !['/joe', '/trader-joe'].includes(routeLocation.pathname)) &&
      (joe ? <JoeDrawer context={loc.pathname} onClose={() => setJoe(false)} /> : <button className="fab" onClick={() => setJoe(true)}><Icon name="message" size={17} />Ask Trader Joe</button>)}
  </div>;
}

function Search() {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([]); const nav = useNavigate();
  useEffect(() => { if (q.length < 2) return setRes([]); const t = setTimeout(() => api(`/api/markets/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => {}), 200); return () => clearTimeout(t); }, [q]);
  const go = (sym: string) => { setQ(''); setRes([]); nav(`/terminal/${sym}`); };
  return <div className="search"><input id="gsearch" placeholder="Search asset… (Ctrl/⌘K for commands)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && res[0]) go(res[0].symbol); if (e.key === 'Escape') setQ(''); }} aria-label="Search assets" />
    {res.length > 0 && <div className="results">{res.map((r) => <div key={r.id} onClick={() => go(r.symbol)}><b>{r.base}</b> <span className="muted">{r.symbol} · Binance spot</span></div>)}</div>}</div>;
}
