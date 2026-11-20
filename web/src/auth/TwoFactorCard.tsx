import { useState } from 'react';
import { api, authInfo, useApi } from '../api';
import { Action, Badge, Card, ErrorLine } from '../ui';

type Status = { enrolled: boolean; enrolledAt: number | null; pending: boolean; legacyPassphrase: boolean };
type Begin = { needsProof: 'otp' | 'console-code-or-passphrase' } | { secret: string; otpauth: string; expiresInSec: number };

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

/**
 * Owner authenticator app (TOTP) for step-up. Enrolling the first one needs independent proof (the server-console
 * code or the legacy passphrase); replacing one needs a current code. The server
 * enforces all of this; this card only walks through it.
 */
export function TwoFactorCard() {
  const st = useApi<Status>('/api/security/2fa');
  const [needs, setNeeds] = useState<'otp' | 'console-code-or-passphrase' | null>(null);
  const [consoleCode, setConsoleCode] = useState(''); const [password, setPassword] = useState(''); const [current, setCurrent] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null); const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const s = st.data;

  const begin = async () => {
    setErr(null);
    const body = needs === 'otp' ? { otp: current } : needs ? (consoleCode ? { consoleCode } : password ? { password } : {}) : {};
    const r = await api<Begin>('/api/security/2fa/begin', { body });
    setConsoleCode(''); setPassword(''); setCurrent('');
    if ('needsProof' in r) { setNeeds(r.needsProof); return; }
    setNeeds(null); setSetup({ secret: r.secret, otpauth: r.otpauth });
  };
  const confirm = async () => {
    await api('/api/security/2fa/confirm', { body: { otp: code } });
    authInfo.stepUp = 'totp'; setSetup(null); setCode(''); st.reload();
  };

  return <Card title="Two-factor step-up (authenticator app)" right={s && <Badge v={s.enrolled ? 'ENABLED' : 'NOT SET UP'} tone={s.enrolled ? 'b-good' : 'b-warn'} />}>
    <div className="col" style={{ gap: 10 }}>
      <div className="hint">Changing the trading mode or risk policy, promoting a strategy, resuming after an emergency, verifying a withdrawal address and lifting a withdrawal freeze each ask for a fresh 6-digit code from your authenticator app (Google Authenticator, 1Password, Authy, …). Signing in with Privy alone never allows these actions.</div>
      {s && !s.enrolled && s.legacyPassphrase && <div className="hint">Until you set this up, your old MIA passphrase still confirms these actions. Once it is set up, only the authenticator does.</div>}
      {s && !s.enrolled && !s.legacyPassphrase && <div className="banner stale" style={{ margin: 0 }}>Protected actions are blocked until an authenticator is set up.</div>}

      {!setup && <>
        {needs === 'console-code-or-passphrase' && <div className="col" style={{ gap: 6 }}>
          <div className="hint">To prove you control this MIA, enter the setup code just printed in the MIA server console (the terminal running MIA, or its service log){s?.legacyPassphrase ? ', or your old MIA passphrase' : ''}.</div>
          <input value={consoleCode} onChange={(e) => setConsoleCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" spellCheck={false} aria-label="Setup code from the server console" style={{ maxWidth: 220 }} />
          {s?.legacyPassphrase && <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="or old MIA passphrase" autoComplete="current-password" aria-label="Old MIA passphrase" style={{ maxWidth: 260 }} />}
        </div>}
        {needs === 'otp' && <input inputMode="numeric" value={current} onChange={(e) => setCurrent(digits(e.target.value))} placeholder="Current authenticator code" autoComplete="one-time-code" aria-label="Current authenticator code" style={{ maxWidth: 220 }} />}
        <div className="row"><Action className="primary" label={s?.enrolled ? 'Replace authenticator' : needs ? 'Continue' : 'Set up authenticator'} run={begin} /></div>
      </>}

      {setup && <div className="col" style={{ gap: 8 }}>
        <div>1. In your authenticator app, add an account with this setup key (or tap the link on your phone):</div>
        <div className="login-code mono" style={{ userSelect: 'all', overflowWrap: 'anywhere' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
        <a href={setup.otpauth}>Open in authenticator app</a>
        <div>2. Enter the 6-digit code it shows:</div>
        <div className="row" style={{ gap: 8 }}>
          <input inputMode="numeric" value={code} onChange={(e) => setCode(digits(e.target.value))} placeholder="123456" autoComplete="one-time-code" aria-label="Code from the new authenticator" style={{ width: 120 }} />
          <Action className="primary" label="Confirm" run={confirm} />
          <button type="button" className="ghost" onClick={() => setSetup(null)}>Cancel</button>
        </div>
        <div className="hint">Keep this key private. It is shown only now; if you lose the device, the administrator can reset it on the server with <span className="mono">npm run owner -- reset-2fa</span>.</div>
      </div>}
      <ErrorLine e={err ?? st.error} />
    </div>
  </Card>;
}
