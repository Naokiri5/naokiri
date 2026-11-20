import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../api';
import { Badge, Card, Page } from '../ui';

function Chat({ context, compact }: { context?: string; compact?: boolean }) {
  const { data, reload } = useApi('/api/joe'); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [local, setLocal] = useState<any[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const hist = [...(data?.history ?? []), ...local];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [hist.length]);
  // MIA-WEB-011: the failed-send error used to be wiped in the same tick and the typed text was already cleared, so a 429
  // or network error looked like nothing happened and the message was lost. The input is cleared only after success; on
  // failure the text comes back and the error stays visible until the next send.
  const send = async (text: string) => {
    if (!text.trim()) return; setBusy(true); setMsg(''); setLocal([{ role: 'user', content: text, id: 'u' }]);
    try {
      await api('/api/joe', { body: { message: context && context !== '/' ? `[viewing ${context}] ${text}` : text } });
      await reload(); setLocal([]);
    } catch (e: any) {
      setMsg(text); setLocal((l) => [...l, { role: 'assistant', content: `Not sent: ${e.message}. Your message is back in the box.`, id: 'e' }]);
    } finally { setBusy(false); }
  };
  return <div className="col" style={{ height: '100%', gap: 10 }}>
    <div className="chat" style={{ flex: 1, overflowY: 'auto', padding: compact ? 10 : 0, minHeight: 0 }}>
      {!hist.length && <div className="muted">Ask about markets, a symbol, your paper portfolio, or risk. Try “brief”, “analyze SOL”, “why was ETH rejected?”.</div>}
      {hist.map((m: any, i: number) => <div key={m.id ?? i} className={`msg ${m.role}`}>{m.content}</div>)}
      {busy && <div className="msg assistant muted">Trader Joe is checking live data…</div>}<div ref={end} />
    </div>
    <form className="row" style={{ padding: compact ? 10 : 0 }} onSubmit={(e) => { e.preventDefault(); send(msg); }}>
      <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message Trader Joe…" style={{ flex: 1 }} disabled={busy} aria-label="Message" maxLength={3500} />
      <button className="primary" disabled={busy || !msg.trim()}>Send</button>
    </form>
    {!compact && <div className="row">{['brief', 'opportunities', 'portfolio', 'risk', 'news', 'analyze BTC', 'pause'].map((c) => <button key={c} className="sm" onClick={() => send(c)} disabled={busy}>{c}</button>)}</div>}
  </div>;
}
export function JoePage() {
  const { data } = useApi('/api/joe');
  return <Page title="Trader Joe" sub="MIA's assistant. Reads live state through permission-safe tools; can analyze and pause new orders, but cannot trade, change limits or modes, or move funds." right={<Badge v={data?.llm ? `Claude · ${data.model}` : 'COMMAND MODE'} tone={data?.llm ? 'b-good' : 'b-neutral'} />}>
    <Card><div style={{ height: 'calc(100vh - 300px)', minHeight: 360 }}><Chat /></div></Card>
  </Page>;
}
export function JoeDrawer({ context, onClose }: { context: string; onClose: () => void }) {
  return <div className="drawer" role="dialog" aria-label="Trader Joe"><div className="row between" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}><b>☺ Trader Joe</b><span className="hint">context: {context}</span><button className="ghost sm" onClick={onClose} aria-label="Close">✕</button></div><div style={{ flex: 1, minHeight: 0 }}><Chat context={context} compact /></div></div>;
}
