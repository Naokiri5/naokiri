import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { api, ApiError } from '../api';
import { requestPrivySignIn, takePrivySignIn, requirePrivyLogout, completePrivyLogout, privyLogoutPending } from './browserSession';

export type PrivyPublicConfig = {
  enabled: boolean; appId: string | null; linked: boolean; ownerConfigured: boolean;
  embeddedWallets: boolean; walletActions: 'LOCKED';
};

/** ONE SDK provider for sign-in, dashboard wallet display and sign-out. */
export function PrivyShell({ appId, children }: { appId: string; children: ReactNode }) {
  return <PrivyProvider appId={appId} config={{
    loginMethods: ['wallet'],
    appearance: { theme: 'dark', accentColor: '#4f8cff', showWalletLoginFirst: true },
    embeddedWallets: {
      ethereum: { createOnLogin: 'off' },
      solana: { createOnLogin: 'off' },
    },
  }}>{children}</PrivyProvider>;
}

function friendly(e: unknown) {
  if (e instanceof ApiError) return e.status === 503
    ? 'Privy verification is unavailable. Retry when the service recovers.'
    : e.message;
  return e instanceof Error ? e.message : 'Wallet verification failed';
}

export function WalletLogin({ appId, onDone }: { appId: string; onDone: () => void }) {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loggingOut, setLoggingOut] = useState(() => privyLogoutPending(appId));
  const exchanging = useRef(false);
  const { login } = useLogin({
    onError: (code) => {
      takePrivySignIn(appId);
      if (code !== 'exited_auth_flow' && code !== 'oauth_user_denied')
        setError('Privy could not verify this wallet. Please try again.');
    },
  });

  useEffect(() => {
    if (ready) { setSlow(false); return; }
    const t = window.setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    if (!ready || !authenticated || loggingOut || exchanging.current || !takePrivySignIn(appId)) return;
    exchanging.current = true;
    setBusy(true); setError(null);
    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new Error('Privy did not return an authenticated access token.');
        await api('/api/auth/privy/login', { body: { accessToken } });
        onDone(); // server session is authoritative
      } catch (e) { setError(friendly(e)); }
      finally { exchanging.current = false; setBusy(false); }
    })();
  }, [ready, authenticated, getAccessToken, appId, loggingOut, onDone]);

  useEffect(() => {
    if (!loggingOut || !ready) return;
    if (!authenticated) { completePrivyLogout(appId); setLoggingOut(false); return; }
    void logout().catch(() => setError('Privy sign-out failed; retry before switching accounts.'));
  }, [loggingOut, ready, authenticated, logout, appId]);

  const start = () => {
    if (!ready || busy || loggingOut || !requestPrivySignIn(appId)) return;
    setError(null);
    if (!authenticated) {
      try { login(); }
      catch (e) { takePrivySignIn(appId); setError(friendly(e)); }
    } else {
      // A new sign-in intent causes the authenticated effect to exchange once.
      setBusy(true);
      window.setTimeout(() => setBusy(false), 0);
    }
  };
  return <main className="mia-wallet-login"><section className="mia-wallet-card" aria-labelledby="mia-wallet-heading">
    <div className="mia-wallet-mark" aria-hidden="true">M</div>
    <div className="mia-wallet-eyebrow">MIA · SECURE ACCESS</div>
    <h1 id="mia-wallet-heading">Connect your wallet</h1>
    <p>Sign in to the MIA command center using your Privy-connected wallet. No passphrase or seed phrase required.</p>
    <button className="primary mia-wallet-button" disabled={!ready || busy || loggingOut} onClick={start}>
      {!ready ? 'Loading Privy…' : busy ? 'Verifying with MIA…' : 'Connect wallet with Privy'}
    </button>
    {authenticated && !loggingOut &&
      <button className="ghost mia-wallet-button" onClick={() => { requirePrivyLogout(appId); setLoggingOut(true); }}>Use another wallet</button>}
    {loggingOut && <div className="hint" role="status">Disconnecting your previous Privy session…</div>}
    {slow && !ready && <div className="hint" role="status">Privy is not responding. Verify the App ID, allowed domain, installed wallet and internet access.</div>}
    {error && <div className="banner stale" role="alert">{error}</div>}
    <div className="mia-wallet-security"><span>Verified wallet login</span><span>Owner access protected</span><span>LIVE trading locked</span></div>
    <p className="hint">Wallets are for identity only. MIA will not sign transactions, transfer funds or export keys.</p>
  </section></main>;
}

export function ConnectedWallets() {
  const { authenticated, user } = usePrivy();
  const accounts = (user?.linkedAccounts ?? []) as Array<{ type: string; address?: string; chainType?: string }>;
  const wallets = accounts.filter(a => (a.type === 'wallet' || a.type === 'smart_wallet') && a.address);
  return <section className="card"><div className="hd"><h2>Privy connected wallet</h2></div><div className="bd">
    {!authenticated ? <p className="hint">No Privy wallet session in this browser.</p>
      : wallets.length === 0 ? <p className="hint">No linked wallet address available in this Privy session.</p>
      : <div className="col">{wallets.map(w => <div className="row" key={(w.chainType ?? '') + w.address}>
          <strong>{w.chainType ?? 'Wallet'}</strong><span className="mono">{w.address!.slice(0, 8)}…{w.address!.slice(-6)}</span>
          <span className="hint">READ ONLY</span></div>)}</div>}
    <p className="hint">Wallet connection is not trading authorization. Signing, funding and withdrawals remain locked.</p>
  </div></section>;
}
