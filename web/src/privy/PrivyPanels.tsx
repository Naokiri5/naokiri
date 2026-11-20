/**
 * Privy sign-in and account panels. Loaded lazily (React.lazy) only when the server reports Privy as enabled, so the
 * Privy SDK never ships in the main bundle and costs nothing when unused.
 *
 * Safety model (see server/src/security/privy.ts):
 *  - Privy proves identity; the MIA server verifies the token and opens a session ONLY for the linked owner.
 *  - Embedded wallets are never created automatically (`createOnLogin: 'off'`). If the server allows it
 *    (MIA_PRIVY_EMBEDDED_WALLETS=1), the owner can explicitly ask Privy to create one; Privy secures its key.
 *    Wallets are shown read-only. MIA never asks a wallet to sign or send a transaction, fund, export keys or
 *    delegate signing: those actions are LOCKED (paper trading only).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useCreateWallet, useLogin, usePrivy } from '@privy-io/react-auth';
import { api, ApiError, authInfo, stepUpBody, type AuthState } from '../api';
import { Action, Badge, Card, Empty, ErrorLine, PageErrorBoundary } from '../ui';
import { StepUp } from '../pages/Trading';
import { completePrivyLogout, privyLogoutPending, requestPrivySignIn, requirePrivyLogout, takePrivySignIn } from './browserSession';

export type PrivyClientConfig = AuthState['privy'];

function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return <PrivyProvider key={appId} appId={appId} config={{
    appearance: { theme: 'dark', accentColor: '#4f8cff', showWalletLoginFirst: false },
    // Never create embedded wallets automatically. Optional owner-initiated creation (MIA_PRIVY_EMBEDDED_WALLETS=1, server
    // step-up) is handled in AccountInner; MIA never holds, signs with, funds or exports any key.
    embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
  }}>{children}</PrivyProvider>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- login screen ---------------------------------------------------------------------------------------------------
type SignInError = { kind: 'auth' | 'network' | 'rate' | 'server'; msg: string };
function classify(e: unknown): SignInError {
  if (e instanceof ApiError) {
    if (e.status === 429) return { kind: 'rate', msg: 'Too many sign-in attempts. Wait a moment, then try again.' };
    if (e.status === 503) return { kind: 'server', msg: e.message };
    if (e.status >= 500) return { kind: 'server', msg: `The MIA server could not finish sign-in (HTTP ${e.status}). Try again.` };
    return { kind: 'auth', msg: e.message };
  }
  if (e instanceof TypeError) return { kind: 'network', msg: "Can't reach the MIA server. Check that it is running, then try again." };
  return { kind: 'auth', msg: errText(e) };
}

type LogoutStage = 'idle' | 'pending' | 'running' | 'confirming' | 'failed';

function SignInInner({ appId, onDone }: { appId: string; onDone: () => void }) {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const [err, setErr] = useState<SignInError | null>(null); const [busy, setBusy] = useState(false); const [slow, setSlow] = useState(false);
  const [logoutStage, setLogoutStage] = useState<LogoutStage>(() => privyLogoutPending(appId) ? 'pending' : 'idle');
  const exchanging = useRef(false);
  const loggingOut = useRef(false);
  const { login } = useLogin({
    onError: (code) => {
      if (!takePrivySignIn(appId)) return;
      if (code === 'exited_auth_flow' || code === 'oauth_user_denied') return;
      setErr({ kind: 'auth', msg: 'Privy could not complete sign-in. Try again.' });
    },
  });
  // Privy that never becomes ready usually means a wrong app id, an origin not allowed in the Privy dashboard, or a
  // blocked network/CSP. Say so instead of spinning forever.
  useEffect(() => { if (ready) { setSlow(false); return; } const t = setTimeout(() => setSlow(true), 15_000); return () => clearTimeout(t); }, [ready]);
  const signOut = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setLogoutStage('running'); setErr(null);
    try { await logout(); setLogoutStage('confirming'); }
    catch { setLogoutStage('failed'); }
    finally { loggingOut.current = false; }
  }, [logout]);
  // Keep the browser logout marker until both the SDK operation and the account state confirm sign-out.
  useEffect(() => {
    if (!ready || logoutStage === 'idle' || logoutStage === 'running') return;
    if (!authenticated) { completePrivyLogout(appId); setLogoutStage('idle'); }
    else if (logoutStage === 'pending') void signOut();
  }, [appId, authenticated, logoutStage, ready, signOut]);
  const exchange = useCallback(async () => {
    if (!ready || !authenticated || logoutStage !== 'idle' || exchanging.current || !takePrivySignIn(appId)) return;
    exchanging.current = true;
    setBusy(true); setErr(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Privy did not return a session token. Sign in with Privy again.');
      await api('/api/auth/privy/login', { body: { accessToken } }); // the server verifies it and sets the MIA session cookie
      onDone();
    } catch (e) { setErr(classify(e)); } finally { exchanging.current = false; setBusy(false); }
  }, [appId, authenticated, getAccessToken, logoutStage, onDone, ready]);
  useEffect(() => { void exchange(); }, [exchange]);
  const start = () => {
    if (logoutStage !== 'idle' || exchanging.current || !requestPrivySignIn(appId)) return;
    setErr(null);
    if (authenticated) { void exchange(); return; }
    try { login(); }
    catch {
      takePrivySignIn(appId);
      setErr({ kind: 'auth', msg: 'Privy could not open sign-in. Try again.' });
    }
  };
  const switchAccount = () => {
    if (exchanging.current) return;
    requirePrivyLogout(appId);
    setLogoutStage('pending');
  };
  return <div className="col" style={{ gap: 8 }}>
    <button type="button" className="primary login-btn" onClick={start} disabled={!ready || busy || logoutStage !== 'idle'}>{!ready ? 'Loading Privy…' : busy ? 'Signing in…' : 'Continue with Privy'}</button>
    {slow && !ready && <div className="hint warn" role="status">Privy is taking unusually long to load. Check the internet connection, that this address is an allowed origin in the Privy dashboard, and that MIA_PRIVY_APP_ID is correct. <button type="button" className="ghost sm" onClick={() => window.location.reload()}>Reload</button></div>}
    {err && <div className={`banner ${err.kind === 'auth' ? 'stale' : 'info'}`} role="alert" style={{ margin: 0, overflowWrap: 'anywhere' }}>{err.msg}</div>}
    {ready && logoutStage !== 'idle' && <div className="hint" role={logoutStage === 'failed' ? 'alert' : 'status'}>
      {logoutStage === 'failed' ? 'Privy sign-out failed. Retry before signing in.' : 'Signing out of Privy…'}
      {(logoutStage === 'failed' || logoutStage === 'confirming') && <button type="button" className="ghost sm" onClick={() => void signOut()}>Retry Privy sign-out</button>}
    </div>}
    {authenticated && logoutStage === 'idle' && <button type="button" className="ghost" onClick={switchAccount} disabled={busy}>Use a different Privy account</button>}
  </div>;
}
export function PrivySignIn({ config, onDone }: { config: PrivyClientConfig; onDone: () => void }) {
  if (!config.appId) return null;
  return <PageErrorBoundary label="Privy sign-in"><PrivyRoot appId={config.appId}><SignInInner appId={config.appId} onDone={onDone} /></PrivyRoot></PageErrorBoundary>;
}

// ---- Security Center ------------------------------------------------------------------------------------------------
type Account = { type: string; [k: string]: unknown };
function describe(a: Account): { kind: string; detail: string; wallet: boolean } {
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  const wallet = a.type === 'wallet' || a.type === 'smart_wallet';
  const addr = s('address');
  const short = addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
  if (wallet) return { kind: `${s('chainType') || 'wallet'} wallet${s('walletClientType') ? ` · ${s('walletClientType')}` : ''}`, detail: short, wallet };
  const kind = a.type.replace(/_oauth$/, '').replace(/_/g, ' ');
  return { kind, detail: addr || s('email') || s('username') || s('number') || s('phoneNumber') || s('name') || s('subject'), wallet };
}

function AccountInner({ config, onChange }: { config: PrivyClientConfig; onChange: () => void }) {
  const p = usePrivy();
  const { createWallet } = useCreateWallet();
  const [pw, setPw] = useState(''); const [err, setErr] = useState<string | null>(null);
  const accounts = ((p.user?.linkedAccounts ?? []) as unknown as Account[]);
  const hasEmbedded = accounts.some((a) => a.type === 'wallet' && a.walletClientType === 'privy');
  const add = (label: string, fn: () => void) => <button type="button" className="sm" key={label} onClick={() => { setErr(null); try { fn(); } catch (e) { setErr(errText(e)); } }}>{label}</button>;
  return <div className="col" style={{ gap: 10 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span>MIA sign-in with Privy:</span><Badge v={config.linked ? 'LINKED' : 'NOT LINKED'} tone={config.linked ? 'b-good' : 'b-neutral'} />
      <span>Wallet transactions:</span><Badge v="LOCKED" tone="b-bad" title="MIA is paper trading only. It never signs, sends, funds or exports a wallet." />
    </div>
    {!p.ready ? <Empty>Loading Privy…</Empty> : !p.authenticated
      ? <div className="row"><button type="button" className="primary" onClick={() => p.login()}>Connect a Privy account</button><span className="hint">Opens Privy's sign-in window (email, phone, Google, Apple, passkey, wallet and any other method enabled in your Privy dashboard).</span></div>
      : <>
        <div className="hint">Privy user <span className="mono">{p.user?.id}</span></div>
        <table><thead><tr><th>Sign-in method</th><th>Detail</th><th /></tr></thead><tbody>
          {accounts.map((a, i) => { const d = describe(a); return <tr key={`${a.type}-${i}`}><td>{d.kind}</td><td className="mono">{d.detail || '—'}</td><td>{d.wallet && <Badge v="VIEW ONLY" tone="b-info" title="Shown for identity only; MIA cannot use this wallet to sign or send." />}</td></tr>; })}
          {!accounts.length && <tr><td colSpan={3}><Empty>No linked methods.</Empty></td></tr>}
        </tbody></table>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="hint">Add a sign-in method:</span>
          {add('Email', p.linkEmail)}{add('Phone', p.linkPhone)}{add('Google', p.linkGoogle)}{add('Apple', p.linkApple)}{add('Passkey', p.linkPasskey)}{add('Wallet (identity only)', () => p.linkWallet())}
        </div>
        {config.embeddedWallets && !hasEmbedded && <div className="row" style={{ gap: 8 }}>
          <Action label="Create a Privy embedded wallet (Ethereum)" run={async () => {
            // Server-side step-up + audit first; nothing is created if it fails.
            await api('/api/security/privy/embedded-wallet-intent', { body: { ...stepUpBody(pw) } }); setPw('');
            await createWallet();
          }} />
          <span className="hint">Optional; needs step-up (field below). Privy secures the key; MIA only shows the address and can never sign, send or fund from it.</span>
        </div>}
        <div className="row" style={{ gap: 8 }}>
          <StepUp value={pw} onChange={setPw} />
          <Action className="primary" label={config.linked ? 'Re-link this Privy account to MIA' : 'Use this Privy account to sign in to MIA'} run={async () => {
            const accessToken = await p.getAccessToken(); if (!accessToken) throw new Error('Privy did not return a session token');
            await api('/api/security/privy/link', { body: { accessToken, ...stepUpBody(pw) } }); setPw(''); onChange();
          }} />
          {config.linked && authInfo.mode !== 'privy' && <Action className="danger" label="Unlink" run={async () => { await api('/api/security/privy/unlink', { body: { ...stepUpBody(pw) } }); setPw(''); onChange(); }} />}
          <button type="button" className="ghost" onClick={() => void p.logout()}>Disconnect Privy in this browser</button>
        </div>
      </>}
    <ErrorLine e={err} />
    <div className="banner info">Not available in MIA (LOCKED): signing or sending transactions, delegated signing, funding a wallet, exporting keys{config.embeddedWallets ? '' : ', creating embedded wallets (enable with MIA_PRIVY_EMBEDDED_WALLETS=1)'}. MIA is paper trading only. Linking a wallet only proves you own the address; it never moves funds.</div>
  </div>;
}
export function PrivyAccountCard({ config, onChange }: { config: PrivyClientConfig; onChange: () => void }) {
  if (!config.appId) return null;
  return <Card title="Privy account"><PageErrorBoundary label="The Privy panel"><PrivyRoot appId={config.appId}><AccountInner config={config} onChange={onChange} /></PrivyRoot></PageErrorBoundary></Card>;
}
