import { Suspense, useEffect, useState } from 'react';
import { PrivySignIn, type PrivyClientConfig } from './privy/lazy';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, connectStream, disconnectStream, useApi, fmt } from './api';
import { ErrorLine, PageErrorBoundary } from './ui';
import { JoeDrawer } from './pages/Joe';
import * as P from './pages';
import { CommandPalette } from './palette';
import { StaleBanner, StatusRibbon } from './StatusRibbon';
import type { ShellDto } from './status';
import { PresentationProvider, PresentationSelector } from './presentation';
import { MiniCockpit } from './components/MiniCockpit';
import { ALL_PAGES } from './nav';
import { SideNav, GroupTabs, MobileNav } from './Navigation';


export default function App() {
  const [auth, setAuth] = useState<{ setup: boolean; authenticated: boolean; setupCodeRequired?: boolean; googleSignIn?: boolean } | null>(null);
  useEffect(() => { api('/api/auth/state').then(setAuth).catch(() => setAuth({ setup: true, authenticated: false })); const f = () => setAuth((a) => (a ? { ...a, authenticated: false } : a)); window.addEventListener('mia:unauthorized', f); return () => window.removeEventListener('mia:unauthorized', f); }, []);
  useEffect(() => { if (auth?.authenticated) connectStream(); else disconnectStream(); }, [auth?.authenticated]);
  if (!auth) return null;
  if (!auth.authenticated) return <Login setup={auth.setup} codeRequired={!!auth.setupCodeRequired} googleSignIn={!!auth.googleSignIn} onDone={() => setAuth({ ...auth, setup: true, authenticated: true })} />;
  return <PresentationProvider><Shell onLogout={() => setAuth({ ...auth, authenticated: false })} /></PresentationProvider>;
}

function Login({ setup, codeRequired, googleSignIn, onDone }: { setup: boolean; codeRequired: boolean; googleSignIn: boolean; onDone: () => void }) {
  const [p, setP] = useState(''); const [p2, setP2] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState<string | null>(() => new URLSearchParams(window.location.search).get('google') === 'failed'
    ? 'Google sign-in could not be completed. Try again or use your owner passphrase.' : null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    setErr(null);
    try {
      const { url } = await api<{ url: string }>('/api/auth/google/start', { body: {} });
      window.location.assign(url);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Google sign-in could not be started');
      setGoogleBusy(false);
    }
  };
  const [privy, setPrivy] = useState<PrivyClientConfig | null>(null);
  useEffect(() => { if (setup) api<PrivyClientConfig>('/api/auth/privy/config').then(setPrivy).catch(() => setPrivy(null)); }, [setup]);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(null); if (!setup && p !== p2) return setErr('passphrases do not match'); try { await api(setup ? '/api/auth/login' : '/api/auth/setup', { body: setup || !codeRequired ? { password: p } : { password: p, setupCode: code } }); onDone(); } catch (x: any) { setErr(x.message); } };
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 16 }}>
    <form onSubmit={submit} className="card" style={{ width: 'min(400px, 100%)' }}>
      <div className="hd"><div className="row"><div className="logo">M</div><h2>MIA 4.1 {setup ? 'Sign in' : 'Owner setup'}</h2></div></div>
      <div className="bd col">
        {setup && googleSignIn && <button type="button" disabled={googleBusy} onClick={signInWithGoogle}>Continue with Google</button>}
        {!setup && <div className="hint">Create the owner passphrase (≥10 characters). It protects mode changes, risk limits and withdrawals. MIA never asks for seed phrases or private keys.</div>}
        <label className="col" style={{ gap: 4 }}>Passphrase<input type="password" autoFocus value={p} onChange={(e) => setP(e.target.value)} autoComplete={setup ? 'current-password' : 'new-password'} /></label>
        {!setup && <label className="col" style={{ gap: 4 }}>Confirm<input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></label>}
        {!setup && codeRequired && <label className="col" style={{ gap: 4 }}>Setup code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
          <span className="hint">Enter the one-time code printed in the MIA server console (the terminal running <code>npm start</code>, or the service log).</span></label>}
        <ErrorLine e={err} /><button className="primary" type="submit">{setup ? 'Sign in' : 'Create owner'}</button>
        {setup && privy?.enabled && privy.linked && <>
          <div className="hint" style={{ textAlign: 'center' }}>or</div>
          <PageErrorBoundary fallback={<ErrorLine e="Privy sign-in could not load. Use your passphrase to sign in." />}>
            <Suspense fallback={<div className="hint">Loading Privy…</div>}>
              <PrivySignIn config={privy} onDone={onDone} />
            </Suspense>
          </PageErrorBoundary>
        </>}
      </div>
    </form>
  </div>;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  // Sign out only after the server confirms the session is gone. A failed request used to show the sign-in screen while
  // the HttpOnly session cookie stayed valid, so a reload silently signed the user back in (MIA-WEB-001).
  const [signOutErr, setSignOutErr] = useState<string | null>(null);
  const signOut = async () => { setSignOutErr(null); try { await api('/api/auth/logout', { body: {} }); onLogout(); } catch (e: any) { setSignOutErr(e?.message ?? 'network error'); } };
  const shell = useApi<ShellDto>('/api/shell', { topics: ['mode', 'bot', 'notification', 'position', 'health'], every: 15_000 });
  const [palette, setPalette] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const [collapsed, setCollapsed] = useState(false); const [mobOpen, setMobOpen] = useState(false); const [joe, setJoe] = useState(false);
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('mia-theme') ?? 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('mia-theme', theme); } catch { /* */ } }, [theme]);
  const loc = useLocation(); useEffect(() => setMobOpen(false), [loc.pathname]);
  useEffect(() => { if (!mobOpen) return; const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobOpen(false); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [mobOpen]);
  const s = shell.data; const nav = useNavigate();
  return <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
    <aside className={`side ${mobOpen ? 'open' : ''}`} aria-label="Primary">
      <div className="brand"><div className="logo">M</div><div className="bname"><div style={{ fontWeight: 600 }}>MIA 4.1</div><div className="hint">paper · read-only data</div></div></div>
      <SideNav collapsed={collapsed && !mobOpen} />
      <div style={{ marginTop: 'auto', padding: 10 }}><button className="ghost sm desk-only" onClick={() => setCollapsed(!collapsed)} aria-pressed={collapsed} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>{collapsed ? '»' : '« collapse'}</button></div>
    </aside>
    <header className="top">
      <button className="ghost sm mob-only" onClick={() => setMobOpen(!mobOpen)} aria-label="Menu">☰</button>
      <StatusRibbon shell={shell} />
      <Search />
      <PresentationSelector />
      <MiniCockpit snapshot={shell.data} error={shell.error} receivedAt={shell.updatedAt} />
      <button className="pill" onClick={() => nav('/notifications')} aria-label="Notifications">🔔 {s?.unread ?? 0}</button>
      <button className="ghost sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">{theme === 'dark' ? '☀' : '☾'}</button>
      <button className="ghost sm" onClick={signOut}>Sign out</button>
    </header>
    <main>
      <StaleBanner shell={shell} />
      {signOutErr && <div className="banner stale" role="alert">Sign-out failed ({signOutErr}). You are still signed in on the server — try again before leaving this device.</div>}
      {s?.control?.emergency === true && <div className="banner stale">⛔ EMERGENCY STOP active — new orders blocked. Existing positions are still monitored. Resolve in the Risk Center.</div>}
      {s?.dataHealth?.stale === true && <div className="banner stale">⚠ Market data is stale or disconnected (last update {fmt.ago(s.dataHealth?.tickersAt)}). New entries are blocked by the data-quality gate.</div>}
      {s && s.mode !== 'OBSERVE' && <div className="banner paper">PAPER TRADING — all balances, orders and PnL are simulated against live order books. No real funds are used.</div>}
      {s && !s.policyAccepted && loc.pathname !== '/risk' && <div className="banner info">Risk policy not yet accepted — paper execution stays disabled until you review it in the <a href="/risk" onClick={(e) => { e.preventDefault(); nav('/risk'); }}>Risk Center</a>.</div>}
      <ErrorLine e={shell.error} />
      <GroupTabs />
      <PageErrorBoundary key={loc.pathname}><Routes>
        <Route path="/" element={<P.Overview />} />
        <Route path="/ditas" element={<P.Ditas />} />
        <Route path="/academy" element={<P.Academy />} />
        <Route path="/terminal" element={<P.Terminal />} /><Route path="/terminal/:symbol" element={<P.Terminal />} />
        <Route path="/scanner" element={<P.Scanner />} /><Route path="/intelligence" element={<P.Intelligence />} />
        <Route path="/joe" element={<P.JoePage />} /><Route path="/bubbles" element={<P.Bubbles />} /><Route path="/whales" element={<P.Whales />} />
        <Route path="/holders" element={<P.Holders />} /><Route path="/news" element={<P.News />} /><Route path="/bot" element={<P.Bot />} />
        <Route path="/risk" element={<P.Risk />} /><Route path="/portfolio" element={<P.Portfolio />} /><Route path="/journal" element={<P.Journal />} />
        <Route path="/calendar" element={<P.Calendar />} /><Route path="/lab" element={<P.Lab />} /><Route path="/wallet" element={<P.Wallet />} />
        <Route path="/connections" element={<P.Connections />} /><Route path="/notifications" element={<P.Notifications />} /><Route path="/qa" element={<P.QA />} />
        <Route path="/settings" element={<P.Settings />} />
        <Route path="/discover" element={<P.Discover />} /><Route path="/qhef" element={<P.Qhef />} /><Route path="/security" element={<P.SecurityCenter />} />
        <Route path="/copy" element={<P.CopyTrading />} /><Route path="/history" element={<P.History />} /><Route path="/decision/:id" element={<P.DecisionPage />} />
        <Route path="*" element={<div className="empty">Not found</div>} />
      </Routes></PageErrorBoundary>
    </main>
    <MobileNav moreOpen={mobOpen} onMore={() => setMobOpen(!mobOpen)} />
    {palette && <CommandPalette pages={ALL_PAGES} onClose={() => setPalette(false)} extra={[
      { id: 'act:pause', label: 'Pause new orders', hint: 'risk-reducing', group: 'Action', run: async () => { await api('/api/emergency/pause', { body: {} }); shell.reload(); } },
      { id: 'act:protect', label: 'Verify position protection', hint: 'Risk Center', group: 'Action', run: async () => { await api('/api/emergency/protect', { body: {} }); nav('/risk'); } },
      { id: 'act:news', label: 'Refresh news now', group: 'Action', run: async () => { await api('/api/news/refresh', { body: {} }); nav('/news'); } },
      { id: 'act:joe', label: 'Ask Trader Joe', group: 'Action', run: () => setJoe(true) },
      { id: 'act:theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, group: 'Action', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    ]} />}
    {loc.pathname !== '/joe' && (joe ? <JoeDrawer context={loc.pathname} onClose={() => setJoe(false)} /> : <button className="fab" onClick={() => setJoe(true)}>☺ Ask Trader Joe</button>)}
  </div>;
}

function Search() {
  const [q, setQ] = useState(''); const [res, setRes] = useState<any[]>([]); const nav = useNavigate();
  // MIA-WEB-016: a response for an older query must not overwrite (or refill) the results of the current one.
  useEffect(() => { if (q.length < 2) return setRes([]); let live = true; const t = setTimeout(() => api(`/api/markets/search?q=${encodeURIComponent(q)}`).then((r) => { if (live) setRes(r); }).catch(() => {}), 200); return () => { live = false; clearTimeout(t); }; }, [q]);
  const go = (sym: string) => { setQ(''); setRes([]); nav(`/terminal/${sym}`); };
  return <div className="search"><input id="gsearch" placeholder="Search asset… (Ctrl/⌘K for commands)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && res[0]) go(res[0].symbol); if (e.key === 'Escape') setQ(''); }} aria-label="Search assets" />
    {res.length > 0 && <div className="results">{res.map((r) => <div key={r.id} onClick={() => go(r.symbol)}><b>{r.base}</b> <span className="muted">{r.symbol} · Binance spot</span></div>)}</div>}</div>;
}
