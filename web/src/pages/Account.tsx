import { useState } from 'react';
import { api, authInfo, fmt, useApi } from '../api';
import { ConnectedWallets } from '../privy/WalletLogin';
import { Action, Badge, Card, Empty, ErrorLine, Page, Tabs } from '../ui';
import { StepUp } from './Trading';

export function Wallet() {
  const { data, error, reload } = useApi('/api/wallet');
  const [form, setForm] = useState({ label: '', network: 'ethereum', address: '' }); const [check, setCheck] = useState<any>(null);
  const [wd, setWd] = useState({ network: 'ethereum', asset: 'ETH', amount: '', addressId: '' }); const [pw, setPw] = useState(''); const [preview, setPreview] = useState<any>(null);
  const net = data?.networks.find((n: any) => n.id === wd.network);
  return <Page title="Wallet & Withdrawals" sub={data?.custody}>
    <ErrorLine e={error} />
    {authInfo.mode === 'privy' && <><ConnectedWallets /><div style={{height:14}} /></>}
    <div className="banner stale">Withdrawals are BLOCKED BY RELEASE GATE: no isolated signing service exists in this build. The flow below validates and previews only, and records an audit entry. The trading bot and Trader Joe have no access to this workflow.</div>
    <div className="grid g2">
      <Card title="Verified address book"><div className="col">
        <div className="row"><input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={{ width: 120 }} />
          <select value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} aria-label="Network">{data?.networks.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
        <input placeholder="Destination address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mono" />
        <div className="row"><Action label="Validate" run={async () => setCheck(await api('/api/wallet/validate', { body: { network: form.network, address: form.address } }))} />
          <Action className="primary" label="Add (24h cooling-off)" run={async () => { const r = await api('/api/wallet/address', { body: form }); setCheck({ valid: true, warnings: r.warnings }); setForm({ ...form, address: '', label: '' }); reload(); }} /></div>
        {check && <div className={check.valid ? 'ok' : 'err'}>{check.valid ? `Valid${check.normalized ? `: ${check.normalized}` : ''}` : check.error}{check.warnings?.map((w: string) => <div key={w} className="hint warn">{w}</div>)}</div>}
        <table><tbody>{(data?.addresses ?? []).map((a: any) => <tr key={a.id}><td><b>{a.label}</b><div className="mono hint">{a.address}</div></td><td>{a.network}</td><td>{a.verified_at ? <Badge v="VERIFIED" tone="b-good" /> : <Action className="sm" label="Verify (step-up)" run={async () => { await api(`/api/wallet/address/${a.id}/verify`, { body: { password: pw } }); reload(); }} />}{a.cooldown_until > Date.now() && <div className="hint">cooling-off until {fmt.time(a.cooldown_until)}</div>}</td><td><Action className="sm ghost" label="Remove" confirm="Remove this address?" run={async () => { await api(`/api/wallet/address/${a.id}`, { method: 'DELETE' }); reload(); }} /></td></tr>)}</tbody></table>
        {!data?.addresses.length && <Empty>No saved addresses.</Empty>}
      </div></Card>
      <Card title="Withdrawal (guided preview, Part 24.2)"><div className="col">
        <div className="row"><select value={wd.network} onChange={(e) => setWd({ ...wd, network: e.target.value })} aria-label="Network">{data?.networks.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
          <select value={wd.asset} onChange={(e) => setWd({ ...wd, asset: e.target.value })} aria-label="Asset">{['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'BNB', 'POL', 'TRX', 'ARB', 'OP'].map((x) => <option key={x}>{x}</option>)}</select>
          <input type="number" placeholder="Amount" value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value })} style={{ width: 110 }} /></div>
        {net && !net.assets.includes(wd.asset) && <div className="err">⚠ {wd.asset} is not supported on {net.name}. Never infer a network from a ticker.</div>}
        <select value={wd.addressId} onChange={(e) => setWd({ ...wd, addressId: e.target.value })} aria-label="Destination"><option value="">Select verified destination…</option>{(data?.addresses ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.label} · {a.network} · {a.address.slice(0, 10)}…</option>)}</select>
        <div className="row"><StepUp value={pw} onChange={setPw} /><Action className="primary" label="Preview" run={async () => { setPreview(await api('/api/wallet/withdraw/preview', { body: { ...wd, amount: Number(wd.amount), password: pw } })); reload(); }} /></div>
        {preview && <div className="card"><div className="bd col"><div className="row"><Badge v={preview.status} /></div><div className="kv"><span>Network</span><span>{preview.preview.network}</span><span>Asset / amount</span><span>{preview.preview.amount} {preview.preview.asset}</span><span>Destination</span><span className="mono">{preview.preview.destination}</span><span>Fee / net</span><span>unavailable (no custody provider)</span></div><ul style={{ margin: 0, paddingLeft: 18 }}>{preview.reasons.map((r: string) => <li key={r} className="hint">{r}</li>)}</ul></div></div>}
        <div className="row">Emergency withdrawal freeze: <Badge v={data?.frozen ? 'FROZEN' : 'OFF'} tone={data?.frozen ? 'b-bad' : 'b-neutral'} /><Action className="sm" label={data?.frozen ? 'Lift (step-up)' : 'Freeze'} run={async () => { await api('/api/wallet/freeze', { body: { on: !data?.frozen, password: pw } }); reload(); }} /></div>
      </div></Card>
    </div>
    <div style={{ height: 14 }} />
    <div className="grid g2">
      <Card title="Network registry" flush><table><thead><tr><th>Network</th><th>Family</th><th>Assets</th><th>Status</th></tr></thead><tbody>{data?.networks.map((n: any) => <tr key={n.id}><td><b>{n.name}</b>{n.chainId && <span className="faint"> #{n.chainId}</span>}</td><td>{n.family}</td><td>{n.assets.join(', ')}</td><td><Badge v={n.status} tone="b-neutral" /></td></tr>)}</tbody></table></Card>
      <Card title="Withdrawal history" flush><table><tbody>{(data?.withdrawals ?? []).map((w: any) => <tr key={w.id}><td className="faint">{fmt.time(w.created_at)}</td><td>{w.amount} {w.asset} · {w.network}</td><td><Badge v={w.status} /></td></tr>)}</tbody></table>{!data?.withdrawals.length && <Empty>No withdrawal requests.</Empty>}</Card>
    </div>
  </Page>;
}

export function Connections() {
  const { data, error } = useApi('/api/connections', { topics: ['health'], every: 15_000 });
  return <Page title="Connections Hub" sub="Every integration with its real status, license terms and latency. Nothing marked PENDING returns data — it is not simulated.">
    <ErrorLine e={error} />
    <Card flush><div className="tablewrap"><table><thead><tr><th>Provider</th><th>Class</th><th>Markets</th><th>Freshness</th><th>Status</th><th className="num">Latency</th><th className="num">OK / err</th><th>License / notes</th></tr></thead>
      <tbody>{(data?.providers ?? []).map((p: any) => <tr key={p.id}><td><b>{p.name}</b><div className="faint mono" style={{ fontSize: 11 }}>{p.id}</div></td><td>{p.sourceClass}</td><td>{p.markets.join(', ')}</td><td>{p.realtime.replace('_', ' ').toLowerCase()}</td><td><Badge v={p.status} />{p.lastOkAt && <div className="hint">ok {fmt.ago(p.lastOkAt)}</div>}{p.lastError && <div className="hint warn" title={p.lastError}>{p.lastError.slice(0, 40)}</div>}</td><td className="num">{p.lastLatencyMs ?? '—'}ms</td><td className="num">{p.okCount}/{p.errorCount}</td><td className="hint" style={{ maxWidth: 380 }}>{p.license}{p.note && <div>{p.note}</div>}</td></tr>)}</tbody></table></div></Card>
    <div style={{ height: 14 }} />
    <Card title="Hot-path latency (Part 29.5 / 33.18)" flush><table><thead><tr><th>Stage</th><th className="num">Samples</th><th className="num">p50 ms</th><th className="num">p95 ms</th><th className="num">p99 ms</th><th className="num">max</th></tr></thead><tbody>{(data?.latency ?? []).map((l: any) => <tr key={l.stage}><td className="mono">{l.stage}</td><td className="num">{l.samples}</td><td className="num">{l.p50}</td><td className="num">{l.p95}</td><td className="num">{l.p99}</td><td className="num">{l.max}</td></tr>)}</tbody></table>{!data?.latency.length && <Empty>No samples yet.</Empty>}</Card>
    <div style={{ height: 14 }} />
    <div className="grid g3">
      <Card title="X (Twitter)"><Badge v="PENDING_CREDENTIALS" /><p className="muted">OAuth 2.0 PKCE linking requires an X developer app (paid read tier). Social posts would be untrusted data feeding the news/social worker only.</p></Card>
      <Card title="Telegram"><p className="muted">Notifications: set <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> server-side (never in the browser). Launch-source monitoring requires approved channel configuration.</p></Card>
      <Card title="Exchange / broker (read-only)"><p className="muted">Read-only API keys for balance sync and a licensed equities/commodities feed are not configured. Live trading keys are deliberately unsupported until release gates pass.</p></Card>
    </div>
  </Page>;
}

export function Notifications() {
  const { data, error, reload } = useApi('/api/notifications', { topics: ['notification'] }); const [sev, setSev] = useState('');
  const items = (data ?? []).filter((n: any) => !sev || n.severity === sev);
  return <Page title="Notifications" sub="In-app history with delivery state per channel." right={<><select value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Severity"><option value="">All</option><option>CRITICAL</option><option>WARNING</option><option>INFO</option></select><Action label="Mark all read" run={async () => { await api('/api/notifications/read', { body: {} }); reload(); }} /></>}>
    <ErrorLine e={error} />
    <Card flush><div className="tablewrap" style={{ maxHeight: 700 }}><table><tbody>{items.map((n: any) => { const d = JSON.parse(n.delivery); return <tr key={n.id} style={{ opacity: n.read ? 0.65 : 1 }}><td className="faint" style={{ whiteSpace: 'nowrap' }}>{fmt.time(n.ts)}</td><td><Badge v={n.severity} /></td><td><b>{n.title}</b><div className="muted">{n.body}</div></td><td className="hint">{n.source}</td><td className="hint">app: {d.inApp}<br />telegram: {d.telegram}</td><td>{!n.read && <button className="sm ghost" onClick={async () => { await api('/api/notifications/read', { body: { id: n.id } }); reload(); }}>read</button>}</td></tr>; })}</tbody></table>{!items.length && <Empty>No notifications.</Empty>}</div></Card>
  </Page>;
}

export function QA() {
  const { data, error } = useApi('/api/qa'); const audit = useApi('/api/audit'); const [tab, setTab] = useState('Release gates');
  return <Page title="Release Gates" sub="Part 12.7 — no real funds until every gate passes with evidence and the owner explicitly authorizes. A profitable paper result alone is never sufficient.">
    <ErrorLine e={error} />
    <div className={`banner ${data?.liveAllowed ? 'info' : 'stale'}`}>{data?.summary}</div>
    <Tabs tabs={['Release gates', 'Audit log']} value={tab} onChange={setTab} />
    {tab === 'Release gates' && <Card flush><table><tbody>{(data?.gates ?? []).map((g: any) => <tr key={g.id}><td className="mono faint">{g.id}</td><td><b>{g.name}</b><div className="hint">{g.evidence}</div></td><td><Badge v={g.status} /></td></tr>)}</tbody></table></Card>}
    {tab === 'Audit log' && <Card flush title={<span>Hash-chained audit log <Badge v={data?.audit.ok ? 'PASS' : 'FAIL'} /> <span className="hint">{data?.audit.entries} entries</span></span>}><div className="tablewrap" style={{ maxHeight: 650 }}><table><tbody>{(audit.data ?? []).map((a: any) => <tr key={a.id}><td className="faint">{fmt.time(a.ts)}</td><td>{a.actor}</td><td className="mono">{a.action}</td><td className="hint" style={{ maxWidth: 520, wordBreak: 'break-all' }}>{a.detail?.slice(0, 240)}</td></tr>)}</tbody></table></div></Card>}
  </Page>;
}

export function Settings() {
  const { data, error, reload } = useApi('/api/settings');
  const [pw, setPw] = useState({ current: '', next: '' }); const [tz, setTz] = useState<number | null>(null); const [prefs, setPrefs] = useState<any>(null);
  const p = prefs ?? data?.notifyPrefs;
  return <Page title="Settings" sub="Security, notifications, display and assistant configuration. Risk limits live in the Risk Center; execution mode in Bot Account.">
    <ErrorLine e={error} />
    <div className="grid g2">
      <Card title="Security"><div className="col">
        {authInfo.mode === 'passphrase' ? <>
          <input type="password" placeholder="Current passphrase" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
          <input type="password" placeholder="New passphrase (≥10 chars)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <Action className="primary" label="Change passphrase (signs out all sessions)" run={async () => { await api('/api/settings/password', { body: pw }); window.location.reload(); }} />
        </> : <TwoFactorSetup />}
        <div className="hint">MIA never requests seed phrases or private keys. Secrets and recovery credentials stay on the server. Wallet login does not authorize LIVE trading.</div></div></Card>
      <Card title="Notifications"><div className="col">{p && <>
        <label className="row">Telegram minimum severity <select value={p.telegramMinSeverity} onChange={(e) => setPrefs({ ...p, telegramMinSeverity: e.target.value })}><option>INFO</option><option>WARNING</option><option>CRITICAL</option></select></label>
        <label className="row">Quiet hours (UTC, critical always delivered) <input type="number" min={0} max={23} style={{ width: 60 }} value={p.quietHoursUtc?.[0] ?? ''} onChange={(e) => setPrefs({ ...p, quietHoursUtc: e.target.value === '' ? null : [Number(e.target.value), p.quietHoursUtc?.[1] ?? 7] })} />–<input type="number" min={0} max={23} style={{ width: 60 }} value={p.quietHoursUtc?.[1] ?? ''} onChange={(e) => setPrefs({ ...p, quietHoursUtc: [p.quietHoursUtc?.[0] ?? 22, Number(e.target.value)] })} /></label>
        <div className="row"><Action className="primary" label="Save" run={async () => { await api('/api/settings/notify', { body: p }); reload(); }} /><Action label="Send test notification" run={() => api('/api/notifications/test', { body: {} })} /></div>
        <div className="hint">Telegram: {data?.telegram.configured ? 'configured' : 'not configured (set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID on the server)'}</div></>}</div></Card>
      <Card title="Profit calendar timezone"><div className="row"><select value={tz ?? data?.calendarTzOffsetMin ?? 0} onChange={(e) => setTz(Number(e.target.value))} aria-label="Timezone offset">{Array.from({ length: 27 }, (_, i) => (i - 12) * 60).map((m) => <option key={m} value={m}>UTC{m >= 0 ? '+' : ''}{m / 60}</option>)}</select><Action label="Save" run={async () => { await api('/api/calendar/tz', { body: { offsetMin: tz ?? 0 } }); reload(); }} /></div><div className="hint">Defines the day boundary for daily PnL attribution.</div></Card>
      <Card title="Trader Joe"><div className="kv"><span>Mode</span><span>{data?.joe.llm ? `Claude API (${data.joe.model})` : 'Command mode — set ANTHROPIC_API_KEY on the server for conversational answers'}</span><span>Tools</span><span className="hint">{data?.joe.tools.join(', ')}</span><span>Authority</span><span className="hint">read, analyze, and risk-reducing pause only</span></div></Card>
    </div>
  </Page>;
}

/** Verified owner 2FA enrollment; initial enrollment needs the server-console setup code. */
function TwoFactorSetup() {
  const status = useApi<{ enrolled: boolean; pending: boolean }>('/api/security/2fa');
  const [consoleCode, setConsoleCode] = useState('');
  const [otp, setOtp] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return <div className="col">
    <b>Authenticator step-up</b>
    <div className="hint">{status.data?.enrolled ? 'Enabled: high-risk actions require a fresh six-digit authenticator code.' : 'Not enrolled: high-risk actions remain blocked until setup.'}</div>
    <input placeholder={status.data?.enrolled ? 'Existing authenticator code' : 'One-time server-console code'}
      value={status.data?.enrolled ? otp : consoleCode}
      onChange={e => status.data?.enrolled ? setOtp(e.target.value) : setConsoleCode(e.target.value)} />
    <Action label={status.data?.enrolled ? 'Replace authenticator (requires current code)' : 'Begin authenticator setup'}
      run={async () => {
        const response = await api<{ secret?: string; otpauth?: string; needsProof?: string }>('/api/security/2fa/begin',
          { body: status.data?.enrolled ? { otp } : { consoleCode: consoleCode || undefined } });
        if (response.needsProof) { setNote('Obtain the setup code from the MIA server console, then retry.'); return; }
        setSecret(response.secret ?? null); setUri(response.otpauth ?? null);
        setNote('Add the secret to an authenticator app; then confirm using a fresh six-digit code.');
      }} />
    {secret && <div className="hint">Authenticator setup secret (do not share): <code>{secret}</code></div>}
    {uri && <div className="hint">Setup URI: <code style={{overflowWrap:'anywhere'}}>{uri}</code></div>}
    {secret && <>
      <input inputMode="numeric" autoComplete="one-time-code" placeholder="Six-digit authenticator code" value={otp} onChange={e=>setOtp(e.target.value)} />
      <Action className="primary" label="Confirm authenticator" run={async () => {
        await api('/api/security/2fa/confirm', { body: { otp } });
        setSecret(null); setUri(null); setOtp(''); setConsoleCode('');
        setNote('Authenticator enrolled.'); status.reload();
      }} />
    </>}
    {note && <div className="hint" role="status">{note}</div>}
  </div>;
}
