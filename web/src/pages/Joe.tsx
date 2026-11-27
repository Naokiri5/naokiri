import { useEffect, useRef, useState } from 'react';
import { api, fmt, useApi } from '../api';
import { Icon } from '../brand';
import { Card, ErrorLine, Page } from '../ui';
import joeImage from '../assets/trader-joe.webp';
import type { ShellState } from '../StatusRibbon';
import { TraderJoeStudio } from '../components/trader-joe/TraderJoeStudio';
import './Joe.css';

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

type ChatActivity = 'idle' | 'composing' | 'waiting';

function Chat({ context, compact = false, onActivity }: { context?: string; compact?: boolean; onActivity?: (activity: ChatActivity) => void }) {
  const { data, error, reload } = useApi<JoeState>('/api/joe');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const transcript = useRef<HTMLDivElement>(null);
  const history = data?.history ?? [];
  const empty = !!data && !history.length && !pending;
  const latest = history.at(-1)?.id;
  const contextPrefix = data?.llm && context ? '[viewing ' + context.slice(0, 160) + '] ' : '';
  const mode = data ? (data.llm ? 'Conversation mode' : 'Command mode') : error ? 'Unavailable' : 'Connecting…';

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [latest, pending]);
  const activity: ChatActivity = pending ? 'waiting' : message.trim() ? 'composing' : 'idle';
  useEffect(() => { onActivity?.(activity); }, [activity, onActivity]);

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
      {compact
        ? <><JoeAvatar thinking={!!pending} /><div><strong>Trader Joe</strong><div className="hint">{mode}</div></div></>
        : <><h2>Conversation</h2><span className="mia-chat-mode">{mode}</span></>}
      {context && <span className="hint mia-chat-context">{context}</span>}
    </div>
    <div className="chat mia-chat-transcript" role="log" aria-label="Trader Joe conversation" data-empty={empty} tabIndex={0} ref={transcript}>
      {empty && <div className="mia-chat-empty">
        <p>{data.llm ? 'Ask about a recorded decision or your paper account.' : 'Choose a suggested command or enter your own below.'}</p>
      </div>}
      {history.map((item) => <div key={item.id} className={'msg ' + item.role}>
        <span className="mia-chat-author">{item.role === 'assistant' ? 'Joe' : 'You'} <time title={fmt.time(item.ts)}>{new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
        {item.content}
      </div>)}
      {pending && <>
        <div className="msg user"><span className="mia-chat-author">You</span>{pending}</div>
        <div className="msg assistant muted" role="status">Waiting for Joe’s reply…</div>
      </>}
    </div>
    {!!tools.length && !pending && <details className="mia-chat-sources"><summary>Tools used in the latest reply</summary><ul>{tools.map((tool) => <li key={tool}>{tool.replaceAll('_', ' ')}</li>)}</ul></details>}
    <ErrorLine e={sendError ?? error} />
    {error && <button type="button" className="sm" onClick={() => void reload()}>Refresh conversation</button>}
    <div className="mia-chat-composer">
      <div className="mia-chat-prompts" role="group" aria-label="Suggested questions">
        {(compact ? prompts.slice(0, 2) : prompts).map(({ label, command }) => <button key={label} type="button" className="sm" onClick={() => void send(command)} disabled={!data || !!pending}>{label}</button>)}
      </div>
      <form className="mia-chat-form" onSubmit={(event) => { event.preventDefault(); void send(message); }}>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message Trader Joe…" disabled={!data || !!pending}
          maxLength={4000 - contextPrefix.length} aria-label="Message" />
        <button type="submit" className="primary" disabled={!data || !!pending || !message.trim()}>Send</button>
      </form>
    </div>
  </div>;
}

export function JoePage({ shell }: { shell: ShellState }) {
  const [activity, setActivity] = useState<ChatActivity>('idle');
  return <Page title="Trader Joe">
    <div className="mia-joe-layout mia-joe-workspace">
      <Card className="mia-joe-conversation"><Chat onActivity={setActivity} /></Card>
      <aside aria-label="Trader Joe workspace context">
        <TraderJoeStudio shell={shell} chat={activity} />
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
