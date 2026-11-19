import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authInfo, fmt, useApi, stepUpBody } from '../api';
import { Action, Badge, Card, Empty, ErrorLine, Page, Tabs } from '../ui';
import { StepUp } from './Trading';
import { TelegramConnection } from './TelegramConnection';
import { ackGroup } from '../CriticalStrip';

export function Wallet() {
  const { data, error, reload } = useApi('/api/wallet');
  const [form, setForm] = useState({ label: '', network: 'ethereum', address: '' }); const [check, setCheck] = useState<any>(null);
  const [wd, setWd] = useState({ network: 'ethereum', asset: 'ETH', amount: '', addressId: '' }); const [pw, setPw] = useState(''); const [preview, setPreview] = useState<any>(null);
  const net = data?.networks.find((n: any) => n.id === wd.network);
  return <Page title="Wallet & Withdrawals" sub={data?.custody}>
    <ErrorLine e={error} />
    <div className="banner stale">Withdrawals are BLOCKED BY RELEASE GATE: no isolated signing service exists in this build. The flow below validates and previews only, and records an audit entry. The trading bot and Trader Joe have no access to this workflow.</div>
    <div className="grid g2">
      <Card title="Verified address book"><div className="col">
        <div className="row"><input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={{ width: 120 }} />
          <select value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} aria-label="Network">{data?.networks.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
        <input placeholder="Destination address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mono" />
        <div className="row"><Action label="Validate" run={async () => setCheck(await api('/api/wallet/validate', { body: { network: form.network, address: form.address } }))} />
          <Action className="primary" label="Add (24h cooling-off)" run={async () => { const r = await api('/api/wallet/address', { body: form }); setCheck({ valid: true, warnings: r.warnings }); setForm({ ...form, address: '', label: '' }); reload(); }} /></div>
        {check && <div className={check.valid ? 'ok' : 'err'}>{check.valid ? `Valid${check.normalized ? `: ${check.normalized}` : ''}` : check.error}{check.warnings?.map((w: string) => <div key={w} className="hint warn">{w}</div>)}</div>}
        <table><tbody>{(data?.addresses ?? []).map((a: any) => <tr key={a.id}><td><b>{a.label}</b><div className="mono hint">{a.address}</div></td><td>{a.network}</td><td>{a.verified_at ? <Badge v="VERIFIED" tone="b-good" /> : <Action className="sm" label="Verify (step-up)" run={async () => { await api(`/api/wallet/address/${a.id}/verify`, { body: { ...stepUpBody(pw) } }); reload(); }} />}{a.cooldown_until > Date.now() && <div className="hint">cooling-off until {fmt.time(a.cooldown_until)}</div>}</td><td><Action className="sm ghost" label="Remove" confirm="Remove this address?" run={async () => { await api(`/api/wallet/address/${a.id}`, { method: 'DELETE' }); reload(); }} /></td></tr>)}</tbody></table>
        {!data?.addresses.length && <Empty>No saved addresses.</Empty>}
      </div></Card>
      <Card title="Withdrawal (guided preview, Part 24.2)"><div className="col">
        <div className="row"><select value={wd.network} onChange={(e) => setWd({ ...wd, network: e.target.value })} aria-label="Network">{data?.networks.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}</select>
          <select value={wd.asset} onChange={(e) => setWd({ ...wd, asset: e.target.value })} aria-label="Asset">{['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'BNB', 'POL', 'TRX', 'ARB', 'OP'].map((x) => <option key={x}>{x}</option>)}</select>
          <input type="number" placeholder="Amount" value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value })} style={{ width: 110 }} /></div>
        {net && !net.assets.includes(wd.asset) && <div className="err">⚠ {wd.asset} is not supported on {net.name}. Never infer a network from a ticker.</div>}
        <select value={wd.addressId} onChange={(e) => setWd({ ...wd, addressId: e.target.value })} aria-label="Destination"><option value="">Select verified destination…</option>{(data?.addresses ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.label} · {a.network} · {a.address.slice(0, 10)}…</option>)}</select>
        <div className="row"><StepUp value={pw} onChange={setPw} /><Action className="primary" label="Preview" run={async () => { setPreview(await api('/api/wallet/withdraw/preview', { body: { ...wd, amount: Number(wd.amount), ...stepUpBody(pw) } })); reload(); }} /></div>
        {preview && <div className="card"><div className="bd col"><div className="row"><Badge v={preview.status} /></div><div className="kv"><span>Network</span><span>{preview.preview.network}</span><span>Asset / amount</span><span>{preview.preview.amount} {preview.preview.asset}</span><span>Destination</span><span className="mono">{preview.preview.destination}</span><span>Fee / net</span><span>unavailable (no custody provider)</span></div><ul style={{ margin: 0, paddingLeft: 18 }}>{preview.reasons.map((r: string) => <li key={r} className="hint">{r}</li>)}</ul></div></div>}
        <div className="row">Emergency withdrawal freeze: <Badge v={data?.frozen ? 'FROZEN' : 'OFF'} tone={data?.frozen ? 'b-bad' : 'b-neutral'} /><Action className="sm" label={data?.frozen ? 'Lift (step-up)' : 'Freeze'} run={async () => { await api('/api/wallet/freeze', { body: { on: !data?.frozen, ...stepUpBody(pw) } }); reload(); }} /></div>
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
      <TelegramConnection />
      <Card title="Exchange / broker (read-only)"><p className="muted">Read-only API keys for balance sync and a licensed equities/commodities feed are not configured. Live trading keys are deliberately unsupported until release gates pass.</p></Card>
    </div>
  </Page>;
}

interface NotificationGroup { source: string; title: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; count: number; unread: number; firstTs: number; lastTs: number; lastBody: string; ackThroughId: string; href: string | null; sticky: boolean }
const HIDE_INFO_KEY = 'mia-hide-info';
/**
 * Severity notification center. Repeats are grouped by source + title + severity on the server; unread CRITICAL groups
 * are pinned until explicitly acknowledged. "Hide INFO" is a local view preference and only ever removes INFO groups.
 */
export function Notifications() {
  const [hideInfo, setHideInfo] = useState(() => { try { return localStorage.getItem(HIDE_INFO_KEY) === '1'; } catch { return false; } });
  const [tab, setTab] = useState('By severity');
  const center = useApi<{ groups: NotificationGroup[]; hasMore: boolean }>('/api/notifications/center?hideInfo=' + (hideInfo ? '1' : '0'), { topics: ['notification'], every: 30_000 });
  const raw = useApi(tab === 'Raw history' ? '/api/notifications' : null, { topics: ['notification'] });
  const toggleInfo = (on: boolean) => { setHideInfo(on); try { localStorage.setItem(HIDE_INFO_KEY, on ? '1' : '0'); } catch { /* */ } };
  const groups = center.data?.groups ?? [];
  const sections = [
    { title: 'Needs acknowledgement', rows: groups.filter((g) => g.sticky) },
    { title: 'Critical · acknowledged', rows: groups.filter((g) => !g.sticky && g.severity === 'CRITICAL') },
    { title: 'Warning', rows: groups.filter((g) => g.severity === 'WARNING') },
    { title: 'Info', rows: groups.filter((g) => g.severity === 'INFO') },
  ];
  // Completions (acknowledge, mark read) must refresh the CURRENT filter path, not the one captured when the click started.
  const reload = () => { latest.current.center(); latest.current.raw(); };
  const latest = useRef({ center: center.reload, raw: raw.reload }); latest.current = { center: center.reload, raw: raw.reload };
  return <Page title="Notifications" sub="Repeats are grouped by source, title and severity. Unread CRITICAL stays pinned until you acknowledge it; acknowledging never resolves an incident or resumes trading."
    right={<><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={hideInfo} onChange={(e) => toggleInfo(e.target.checked)} />Hide INFO</label>
      <Action label="Mark non-critical read" run={async () => { await api('/api/notifications/read', { body: {} }); reload(); }} /></>}>
    <ErrorLine e={center.error} />
    {center.error && <div className="alertbar warn" role="status">Critical status unknown: the notification center could not be refreshed.{center.data ? ' The list below is the last successful load and may be stale.' : ''}</div>}
    {hideInfo && <div className="hint" style={{ marginBottom: 10 }}>INFO is hidden. CRITICAL and WARNING are never hidden.</div>}
    <Tabs tabs={['By severity', 'Raw history']} value={tab} onChange={setTab} />
    {tab === 'By severity' && <>
      {sections.filter((x) => x.rows.length).map((x) => <Card key={x.title} title={x.title + ' (' + x.rows.length + ')'} flush>
        <ul className="feed">{x.rows.map((g) => <NotificationGroupRow key={g.source + '|' + g.title + '|' + g.severity} g={g} onDone={reload} />)}</ul></Card>)}
      {center.data && !groups.length && <Empty>No notifications in the last 14 days.</Empty>}
      {center.data?.hasMore && <div className="hint">Older non-critical groups are not shown (the newest 100 are). Unread CRITICAL groups are always shown.</div>}
    </>}
    {tab === 'Raw history' && <Card flush><ErrorLine e={raw.error} /><div className="tablewrap" style={{ maxHeight: 700 }}><table><tbody>{(raw.data ?? []).map((n: any) => { const d = JSON.parse(n.delivery); return <tr key={n.id} style={{ opacity: n.read ? 0.65 : 1 }}><td className="faint" style={{ whiteSpace: 'nowrap' }}>{fmt.time(n.ts)}</td><td><Badge v={n.severity} /></td><td><b>{n.title}</b><div className="muted">{n.body}</div></td><td className="hint">{n.source}</td><td className="hint">app: {d.inApp}<br />telegram: {d.telegram}</td><td>{!n.read && n.severity !== 'CRITICAL' && <Action className="sm ghost" label="read" run={async () => { await api('/api/notifications/read', { body: { id: n.id } }); reload(); }} />}</td></tr>; })}</tbody></table>{raw.data && !raw.data.length && <Empty>No notifications.</Empty>}</div></Card>}
  </Page>;
}
function NotificationGroupRow({ g, onDone }: { g: NotificationGroup; onDone: () => void }) {
  return <li style={{ opacity: g.unread ? 1 : 0.7 }}>
    <Badge v={g.severity} />
    <div className="what"><b>{g.title}</b> <span className="hint">×{g.count}{g.unread ? ' · ' + g.unread + ' unread' : ''} · last {fmt.ago(g.lastTs)}{g.count > 1 ? ' · first ' + fmt.ago(g.firstTs) : ''} · {g.source}</span>
      <div className="hint">{g.lastBody}</div>{g.href && <Link to={g.href}>Root cause →</Link>}</div>
    {g.unread > 0 && <Action className="sm" label={g.severity === 'CRITICAL' ? 'Acknowledge' : 'Mark read'} run={async () => { await ackGroup(g); onDone(); }} />}
  </li>;
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

function GoogleSignInSettings() {
  const endpoint = '/api/settings/google';
  const { data, error } = useApi<{ configured: boolean; linked: boolean }>(endpoint);
  const [password, setPassword] = useState('');
  const failed = new URLSearchParams(window.location.search).get('google') === 'failed';
  return <Card title="Google sign-in">
    <div className="col">
      <ErrorLine e={error ?? (failed && !data?.linked ? 'Google linking could not be completed. Please try again.' : null)} />
      {data && <p className="muted">{data.linked
        ? 'A Google account is linked. Your owner passphrase is available for sign-in and sensitive actions.'
        : data.configured ? 'Link your Google account to sign in to this MIA owner account.'
        : 'Google sign-in requires server configuration.'}</p>}
      {data && (data.configured || data.linked) && <>
        <label className="col">Owner passphrase for Google
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        {data.linked
          ? <Action label="Unlink Google" disabled={!password} confirm="Disconnect Google and sign out other sessions?" run={async () => {
            try {
              await api(`${endpoint}/unlink`, { body: { password } });
              window.location.replace('/settings');
            } finally { setPassword(''); }
          }} />
          : <Action label="Link Google" disabled={!password} run={async () => {
            try {
              const { url } = await api<{ url: string }>(`${endpoint}/link`, { body: { password } });
              window.location.assign(url);
            } finally { setPassword(''); }
          }} />}
      </>}
    </div>
  </Card>;
}

export function Settings() {
  const { data, error, reload } = useApi('/api/settings');
  const [pw, setPw] = useState({ current: '', next: '' }); const [tz, setTz] = useState<string | null>(null); const [prefs, setPrefs] = useState<any>(null);
  const p = prefs ?? data?.notifyPrefs;
  return <Page title="Settings" sub="Security, notifications, display and assistant configuration. Risk limits live in the Risk Center; execution mode in Bot Account.">
    <ErrorLine e={error} />
    <div className="grid g2">
      <Card title="Security"><div className="col">{authInfo.mode === 'privy' ? <div className="hint">You sign in with Privy, so there is no MIA passphrase to change. Manage sign-in methods and the authenticator app in <Link to="/security">Security Center</Link>.</div> : <><input type="password" placeholder="Current passphrase" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /><input type="password" placeholder="New passphrase (≥10 chars)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
        <Action className="primary" label="Change passphrase (signs out all sessions)" run={async () => { await api('/api/settings/password', { body: pw }); window.location.reload(); }} /></>}
        <div className="hint">MIA never requests seed phrases or private keys. Secrets (API keys, bot tokens) are configured server-side via environment variables and never reach the browser.</div></div></Card>
      <Card title="Notifications"><div className="col">{p && <>
        <label className="row">Telegram minimum severity <select value={p.telegramMinSeverity} onChange={(e) => setPrefs({ ...p, telegramMinSeverity: e.target.value })}><option>INFO</option><option>WARNING</option><option>CRITICAL</option></select></label>
        <label className="row">Quiet hours (UTC, critical always delivered) <input type="number" min={0} max={23} style={{ width: 60 }} value={p.quietHoursUtc?.[0] ?? ''} onChange={(e) => setPrefs({ ...p, quietHoursUtc: e.target.value === '' ? null : [Number(e.target.value), p.quietHoursUtc?.[1] ?? 7] })} />–<input type="number" min={0} max={23} style={{ width: 60 }} value={p.quietHoursUtc?.[1] ?? ''} onChange={(e) => setPrefs({ ...p, quietHoursUtc: [p.quietHoursUtc?.[0] ?? 22, Number(e.target.value)] })} /></label>
        <label className="row"><input type="checkbox" checked={!!p.solanaWatchlistTelegram} onChange={(e) => setPrefs({ ...p, solanaWatchlistTelegram: e.target.checked })} />
          Send Solana watchlist alerts to Telegram</label>
        <div className="hint">Only tokens rated WATCH whose on-chain mint check passed; at most 5 per hour, once per token per day. Read-only: the
          message has the mint address and checks, never a buy button or a trading-bot link. Not a trade signal.</div>
        <div className="row"><Action className="primary" label="Save" run={async () => { await api('/api/settings/notify', { body: p }); reload(); }} /><Action label="Send test notification" run={() => api('/api/notifications/test', { body: {} })} /></div>
        <div className="hint">Telegram: {data?.telegram.configured ? 'configured' : 'not configured (set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID on the server)'}</div></>}</div></Card>
      <GoogleSignInSettings />
      <Card title="Display timezone">
        <div className="row">
          <input aria-label="IANA timezone" placeholder="Asia/Manila" value={tz ?? data?.calendarTimeZone ?? ''} onChange={e => setTz(e.target.value)} />
          <Action label="Use device timezone" run={async () => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone)} />
          <Action label="Save timezone" disabled={!tz?.trim()} run={async () => { await api('/api/calendar/tz', { body: { timeZone: tz } }); setTz(null); reload(); }} />
        </div>
        <div className="hint">Used by market clocks and the profit calendar. Enter an IANA name such as America/New_York or UTC.</div>
        {data && !data.calendarTimeZone && <div className="hint">Current profit calendar offset {data.calendarTzOffsetMin} minutes from UTC.</div>}
      </Card>
      <Card title="Trader Joe"><div className="kv"><span>Mode</span><span>{data?.joe.llm ? `Claude API (${data.joe.model})` : 'Command mode — set ANTHROPIC_API_KEY on the server for conversational answers'}</span><span>Tools</span><span className="hint">{data?.joe.tools.join(', ')}</span><span>Authority</span><span className="hint">read, analyze, and risk-reducing pause only</span></div></Card>
    </div>
  </Page>;
}
