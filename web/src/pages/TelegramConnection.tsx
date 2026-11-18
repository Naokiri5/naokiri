import { useState } from 'react';
import { api, fmt, useApi } from '../api';
import { Action, Badge, Card, ErrorLine } from '../ui';

const endpoint = '/api/integrations/telegram';

interface TelegramStatus {
  webhookEnabled: boolean;
  botTokenConfigured: boolean;
  link: { linked: boolean; pendingCode: boolean; pendingExpiresAt: number | null };
}

interface PairingCode {
  code: string;
  expiresAt: number;
}

export function TelegramConnection() {
  const { data, error, reload } = useApi<TelegramStatus>(`${endpoint}/status`, { every: 4_000 });
  const [password, setPassword] = useState('');
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const ready = !!data?.webhookEnabled && data.botTokenConfigured;
  const linked = !!data?.link.linked;
  const pending = !!data?.link.pendingCode;
  const showCode = !error && ready && !linked && pending && pairing && pairing.expiresAt > Date.now()
    && pairing.expiresAt === data?.link.pendingExpiresAt;

  return <Card title="Telegram">
    <div className="col">
      <ErrorLine e={error} />
      {!data && !error && <p role="status">Checking Telegram connection…</p>}
      {data && <>
        <div role="status"><Badge v={linked ? 'LINKED' : ready ? pending ? 'AWAITING PAIRING' : 'UNLINKED' : 'SETUP REQUIRED'} /></div>
        {!ready && <p className="muted">Set <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_WEBHOOK_SECRET</code> on the server and register the bot webhook at <code>/api/integrations/telegram/webhook</code>.</p>}
        {ready && <p className="muted">Use your private bot chat to check paper trading status or pause new paper entries.</p>}
        {linked ? <div className="row">
          <Action label="Unlink Telegram" confirm="Disconnect the linked Telegram chat?" disabled={!!error} run={async () => {
            await api(`${endpoint}/unlink`, { body: {} });
            setPairing(null);
            await reload();
          }} />
        </div> : pending ? <>
          {showCode && <p role="status">Send <code>/link {pairing.code}</code> to your bot in a private chat by {fmt.time(pairing.expiresAt)}.</p>}
          {pending && !showCode && <p className="muted">A pairing code is already active. Cancel it to generate a new one.</p>}
          <div className="row">
            <Action label="Cancel pairing code" disabled={!!error} run={async () => {
              await api(`${endpoint}/link/cancel`, { body: {} });
              setPairing(null);
              await reload();
            }} />
          </div>
        </> : ready && <>
          <label className="col">Owner passphrase
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <div className="row">
            <Action className="primary" label="Generate pairing code" disabled={!password || !!error} run={async () => {
              try {
                setPairing(await api<PairingCode>(`${endpoint}/link/start`, { body: { password } }));
                await reload();
              } finally {
                setPassword('');
              }
            }} />
          </div>
        </>}
      </>}
    </div>
  </Card>;
}
