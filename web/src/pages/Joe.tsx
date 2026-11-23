import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt, useApi } from '../api';
import { Icon } from '../brand';
import { Badge, Card, ErrorLine, Page } from '../ui';
import joeImage from '../assets/trader-joe.webp';

type Message = { id: number; ts: number; role: 'user' | 'assistant'; content: string };
type JoeState = { history: Message[]; llm: boolean; model: string };
type JoeReply = { reply: string; mode: 'LLM' | 'COMMAND'; toolsUsed: string[] };

const prompts = [
  { label: 'FAST paper readiness', command: 'session FAST PAPER' },
  { label: 'DEEP paper readiness', command: 'session DEEP PAPER' },
  { label: 'Market briefing', command: 'brief' },
  { label: 'Paper portfolio', command: 'portfolio' },
];

function JoeAvatar({ thinking = false }: { thinking?: boolean }) {
  return <span className="mia-joe-avatar" data-thinking={thinking} aria-hidden="true"><img src={joeImage} alt="" width="800" height="800" /></span>;
}

function Chat({ context, compact = false }: { context?: string; compact?: boolean }) {
  const { data, error, reload } = useApi<JoeState>('/api/joe');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const transcript = useRef<HTMLDivElement>(null);
  const history = data?.history ?? [];
  const latest = history.at(-1)?.id;
  const contextPrefix = data?.llm && context ? '[viewing ' + context.slice(0, 160) + '] ' : '';
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [latest, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending || !data) return;
    setPending(question);
    setSendError(null);
    try {
      const response = await api<JoeReply>('/api/joe', { body: { message: contextPrefix + question } });
      setMessage('');
      setTools([...new Set(response.toolsUsed)]);
      await reload();
    } catch (cause) {
      setMessage(question);
      setSendError(cause instanceof Error ? cause.message : 'Message could not be sent.');
    } finally {
      setPending(null);
    }
  }

  return <div className={'mia-chat' + (compact ? ' mia-chat-compact' : '')}>
    <div className="mia-chat-header">
      <JoeAvatar thinking={!!pending} />
      <div><strong>Trader Joe</strong><div className="hint">{data ? data.llm ? 'Conversation mode' : 'Command mode' : 'Connecting…'}</div></div>
      {context && <span className="hint mia-chat-context">{context}</span>}
    </div>
    <div className="chat mia-chat-transcript" role="log" aria-label="Trader Joe conversation" ref={transcript}>
      {!history.length && !pending && <div className="mia-chat-empty">
        <Icon name="message" size={25} /><strong>What would you like to understand?</strong>
        <p>Check session readiness, review a decision, or ask about your paper account.</p>
      </div>}
      {history.map((item) => <div key={item.id} className={'msg ' + item.role}>
        <span className="mia-chat-author">{item.role === 'assistant' ? 'Joe' : 'You'} <time title={fmt.time(item.ts)}>{new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
        {item.content}
      </div>)}
      {pending && <><div className="msg user">{pending}</div><div className="msg assistant muted" role="status">Joe is checking the available evidence…</div></>}
    </div>
    {!!tools.length && !pending && <details className="mia-chat-sources"><summary>Tools used in the latest reply</summary><ul>{tools.map((tool) => <li key={tool}>{tool.replaceAll('_', ' ')}</li>)}</ul></details>}
    <ErrorLine e={sendError ?? error} />
    {error && <button type="button" className="sm" onClick={() => void reload()}>Refresh conversation</button>}
    <div className="mia-chat-prompts" role="group" aria-label="Suggested questions">
      {(compact ? prompts.slice(0, 2) : prompts).map(({ label, command }) => <button key={label} type="button" className="sm" onClick={() => void send(command)} disabled={!data || !!pending}>{label}</button>)}
    </div>
    <form className="mia-chat-form" onSubmit={(event) => { event.preventDefault(); void send(message); }}>
      <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message Trader Joe…" disabled={!data || !!pending}
        maxLength={4000 - contextPrefix.length} aria-label="Message" />
      <button type="submit" className="primary" disabled={!data || !!pending || !message.trim()}>Send <Icon name="arrow" size={15} /></button>
    </form>
  </div>;
}

export function JoePage() {
  return <Page title="Trader Joe" sub="Ask about the evidence behind decisions, market conditions, and paper-account risk.">
    <div className="mia-joe-layout">
      <Card className="mia-joe-conversation"><Chat /></Card>
      <aside className="card mia-joe-profile" aria-label="Trader Joe workspace context">
        <img src={joeImage} alt="Trader Joe with an amber visor and a holographic notebook" width="800" height="800" />
        <div>
          <Badge v="Evidence assistant" tone="b-warn" />
          <h2>Review the source</h2>
          <Link to="/autopilot">Session readiness <Icon name="arrow-up-right" size={14} /></Link>
          <Link to="/ditas">Decision records <Icon name="arrow-up-right" size={14} /></Link>
          <Link to="/risk">Risk Center <Icon name="arrow-up-right" size={14} /></Link>
        </div>
      </aside>
    </div>
  </Page>;
}

export function JoeDrawer({ context, onClose }: { context: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    close.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  return <div className="drawer mia-joe-drawer" role="dialog" aria-label="Trader Joe" onKeyDown={(event) => {
    if (event.key === 'Escape') onClose();
  }}>
    <button ref={close} type="button" className="ghost mia-top-icon mia-drawer-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
    <Chat context={context} compact />
  </div>;
}
