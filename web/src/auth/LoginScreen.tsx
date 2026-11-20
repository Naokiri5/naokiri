import { Suspense } from 'react';
import type { AuthState } from '../api';
import { PrivySignIn } from '../privy/lazy';
import { PageErrorBoundary } from '../ui';

function Brand() {
  return <div className="login-brand">
    <div className="logo login-logo" aria-hidden="true">M</div>
    <div><h1>Welcome to MIA</h1><div className="muted">Your AI Trading Command Center</div></div>
  </div>;
}

function Notes() {
  return <ul className="login-notes">
    <li>Privy confirms who you are with the sign-in methods enabled for this MIA (for example email, Google or a passkey).</li>
    <li>MIA checks that proof on its own server and opens the dashboard only for the configured owner.</li>
    <li>MIA never asks for seed phrases or private keys. Paper trading only: real-money trading stays locked.</li>
  </ul>;
}

/** Shown when the server has no Privy app id: an administrator task, not something a visitor can fix. */
function NotConfigured() {
  return <div className="col" style={{ gap: 8 }} role="status">
    <div className="banner stale" style={{ margin: 0 }}>Sign-in isn't configured on this MIA server yet.</div>
    <div className="hint">Administrator: create an app in the Privy dashboard, then on the server set</div>
    <pre className="login-code">MIA_PRIVY_APP_ID=&lt;your 25-character Privy app id&gt;{'\n'}MIA_PRIVY_OWNER_ID=did:privy:&lt;the owner's Privy user id&gt;</pre>
    <div className="hint">and restart MIA. Step-by-step guide: <span className="mono">docs/operations/PRIVY_SIGN_IN.md</span>.</div>
  </div>;
}

/** The only sign-in screen in Privy mode. No passphrase fields. */
export function PrivyLoginScreen({ auth, onDone }: { auth: AuthState; onDone: () => void }) {
  return <div className="login-wrap"><main className="login-card" aria-labelledby="login-title">
    <Brand />
    {!auth.privy.enabled ? <NotConfigured /> : <div className="col" style={{ gap: 10 }}>
      {!auth.privy.ownerConfigured && <div className="hint" role="note">No owner is set up on this server yet. After you sign in, MIA shows your Privy user id so the administrator can make you the owner.</div>}
      <PageErrorBoundary label="Privy sign-in">
        <Suspense fallback={<button type="button" className="primary login-btn" disabled>Loading Privy…</button>}>
          <PrivySignIn config={auth.privy} onDone={onDone} />
        </Suspense>
      </PageErrorBoundary>
    </div>}
    <Notes />
  </main></div>;
}

/** The server could not be asked who is signed in. Never treated as "signed out" and never opens the dashboard. */
export function ServerProblem({ network, detail, onRetry }: { network: boolean; detail: string; onRetry: () => void }) {
  return <div className="login-wrap"><main className="login-card" role="alert">
    <Brand />
    <div className="banner stale" style={{ margin: 0 }}>{network ? "Can't reach the MIA server." : 'The MIA server answered with an error.'}</div>
    <div className="hint">{network
      ? 'Check that MIA is running (npm start; the server listens on port 8787 by default, and npm run dev serves this page on 5173 with a proxy to it). Your session, if any, is unchanged.'
      : `Details: ${detail}. Your session, if any, is unchanged.`}</div>
    <button type="button" className="primary login-btn" onClick={onRetry}>Try again</button>
  </main></div>;
}
