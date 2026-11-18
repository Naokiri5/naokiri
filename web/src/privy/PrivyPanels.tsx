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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PrivyProvider, useCreateWallet, usePrivy } from '@privy-io/react-auth';
import { api } from '../api';
import { Action, Badge, Card, Empty, ErrorLine, PageErrorBoundary } from '../ui';
import { StepUp } from '../pages/Trading';

export interface PrivyClientConfig { enabled: boolean; appId: string | null; linked: boolean; embeddedWallets: boolean; walletActions: 'LOCKED' }

function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return <PrivyProvider appId={appId} config={{
    appearance: { theme: 'dark', accentColor: '#4f8cff', showWalletLoginFirst: false },
    // Never create custodial/embedded wallets: MIA must not hold or control any key that can move funds.
    embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
  }}>{children}</PrivyProvider>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- login screen ---------------------------------------------------------------------------------------------------
function SignInInner({ onDone }: { onDone: () => void }) {
  const { ready, authenticated, login, logout, getAccessToken, user } = usePrivy();
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const wanted = useRef(false);
  const exchange = async () => {
    setBusy(true); setErr(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Privy did not return a session token');
      await api('/api/auth/privy/login', { body: { accessToken } }); onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); wanted.current = false; }
  };
  useEffect(() => { if (ready && authenticated && wanted.current) void exchange(); }, [ready, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => { wanted.current = true; if (authenticated) void exchange(); else login(); };
  return <div className="col" style={{ gap: 8 }}>
    <button type="button" onClick={start} disabled={!ready || busy}>{!ready ? 'Loading Privy…' : busy ? 'Signing in…' : 'Sign in with Privy'}</button>
    {authenticated && <button type="button" className="ghost" onClick={() => void logout()}>Use a different Privy account{user?.email?.address ? ` (now: ${user.email.address})` : ''}</button>}
    <ErrorLine e={err} />
  </div>;
}
export function PrivySignIn({ config, onDone }: { config: PrivyClientConfig; onDone: () => void }) {
  if (!config.appId) return null;
  // A Privy failure (bad app id, blocked network) must never take down the passphrase sign-in around it.
  return <PageErrorBoundary label="Privy sign-in"><PrivyRoot appId={config.appId}><SignInInner onDone={onDone} /></PrivyRoot></PageErrorBoundary>;
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
          <Action label="Create a Privy embedded wallet (Ethereum)" run={async () => { await createWallet(); }} />
          <span className="hint">Optional. Privy secures the key; MIA only shows the address and can never sign, send or fund from it.</span>
        </div>}
        <div className="row" style={{ gap: 8 }}>
          <StepUp value={pw} onChange={setPw} />
          <Action className="primary" label={config.linked ? 'Re-link this Privy account to MIA' : 'Use this Privy account to sign in to MIA'} run={async () => {
            const accessToken = await p.getAccessToken(); if (!accessToken) throw new Error('Privy did not return a session token');
            await api('/api/security/privy/link', { body: { accessToken, password: pw } }); setPw(''); onChange();
          }} />
          {config.linked && <Action className="danger" label="Unlink" run={async () => { await api('/api/security/privy/unlink', { body: { password: pw } }); setPw(''); onChange(); }} />}
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
