import { useState, type ReactNode } from 'react';
import { fmt } from './api';

export function Card({ title, right, children, flush, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`card ${className ?? ''}`}>{(title || right) && <div className="hd"><h2>{title}</h2><div className="row">{right}</div></div>}<div className={`bd ${flush ? 'flush' : ''}`}>{children}</div></section>;
}
export function Stat({ k, v, s, tone }: { k: string; v: ReactNode; s?: ReactNode; tone?: 'up' | 'down' | 'warn' }) {
  return <div className="card stat"><div className="bd"><div className="k">{k}</div><div className={`v ${tone ?? ''}`}>{v}</div>{s && <div className="s">{s}</div>}</div></div>;
}
const TONES: Record<string, string> = {
  APPROVED_FOR_MONITORING: 'b-info', CAUTION: 'b-warn', HIGH_RISK: 'b-bad', REJECTED: 'b-bad', UNVERIFIED: 'b-neutral',
  OK: 'b-good', WARN: 'b-warn', FAIL: 'b-bad', PASS: 'b-good', PENDING: 'b-neutral', NOT_CERTIFIED: 'b-warn', NOT_IMPLEMENTED: 'b-neutral', SKIP: 'b-neutral',
  STRONG_CONSENSUS: 'b-good', MIXED_CONSENSUS: 'b-warn', NO_QUORUM: 'b-neutral', VETOED: 'b-bad', EXPIRED: 'b-neutral',
  SUPPORT: 'b-good', OPPOSE: 'b-bad', ABSTAIN: 'b-neutral', ALLOW: 'b-good', DENY: 'b-bad', NEEDS_REVIEW: 'b-warn',
  PAPER_TRADE: 'b-violet', APPROVED_FOR_USER_CONFIRMATION: 'b-warn', WAIT_FOR_CONFIRMATION: 'b-neutral', INSUFFICIENT_DATA: 'b-neutral', APPROVED_FOR_BOUNDED_EXECUTION: 'b-good',
  LIVE: 'b-good', DEGRADED: 'b-warn', DOWN: 'b-bad', PENDING_CREDENTIALS: 'b-neutral', DISABLED: 'b-neutral', IDLE: 'b-neutral',
  TREND_UP: 'b-good', TREND_DOWN: 'b-bad', RANGE: 'b-neutral', COMPRESSION: 'b-info', HIGH_VOLATILITY: 'b-warn', UNKNOWN: 'b-neutral',
  OPEN: 'b-info', CLOSED: 'b-neutral', FILLED: 'b-good', ACTIVE: 'b-info', CANCELLED: 'b-neutral', PENDING_APPROVAL: 'b-warn',
  INFO: 'b-info', WARNING: 'b-warn', CRITICAL: 'b-bad', HIGH: 'b-bad', MEDIUM: 'b-warn', LOW: 'b-neutral', POSITIVE: 'b-good', NEGATIVE: 'b-bad', NEUTRAL: 'b-neutral',
  BUY: 'b-good', SELL: 'b-bad', BLOCKED_BY_RELEASE_GATE: 'b-bad', CONFIRMED: 'b-good', PARTIALLY_COMPLETED: 'b-warn',
  RESEARCH: 'b-neutral', BACKTESTED: 'b-info', SUSPENDED: 'b-bad', RETIRED: 'b-neutral', LIVE_CANDIDATE: 'b-good',
  ESTABLISHED_OUTLET: 'b-info',
};
export function Badge({ v, tone, title }: { v: ReactNode; tone?: string; title?: string }) {
  const t = tone ?? (typeof v === 'string' ? TONES[v] : undefined) ?? 'b-neutral';
  return <span className={`badge ${t}`} title={title}>{typeof v === 'string' ? v.replace(/_/g, ' ') : v}</span>;
}
export const Chg = ({ v, dp = 2 }: { v: number | null | undefined; dp?: number }) => <span className={`mono ${v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : ''}`}>{fmt.pct(v, dp)}</span>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const ErrorLine = ({ e }: { e: string | null | undefined }) => (e ? <div className="err" role="alert">{e}</div> : null);
export function Page({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return <div><div className="row between" style={{ alignItems: 'flex-start' }}><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div><div className="row">{right}</div></div>{children}</div>;
}
export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t} role="tab" aria-selected={t === value} className={t === value ? 'on' : ''} onClick={() => onChange(t)}>{t}</button>)}</div>;
}
export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return <div className="modal-bg" onClick={onClose}><div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}><div className="card" style={{ border: 'none' }}><div className="hd"><h2>{title}</h2><button className="ghost" onClick={onClose} aria-label="Close">✕</button></div><div className="bd">{children}</div></div></div></div>;
}
/** Async action button with pending/error state. */
export function Action({ label, run, className, confirm, disabled, title }: { label: ReactNode; run: () => Promise<unknown>; className?: string; confirm?: string; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);
  return <span className="col" style={{ gap: 3, display: 'inline-flex' }}>
    <button className={className} disabled={busy || disabled} title={title} onClick={async () => { if (confirm && !window.confirm(confirm)) return; setBusy(true); setErr(null); setOk(false); try { await run(); setOk(true); setTimeout(() => setOk(false), 1800); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>{busy ? '…' : label}</button>
    {err && <span className="err" style={{ maxWidth: 360 }}>{err}</span>}{ok && <span className="ok">Done</span>}
  </span>;
}
/** Sortable table helper. */
export function useSort<T>(rows: T[], init: keyof T, desc = true) {
  const [k, setK] = useState<keyof T>(init); const [d, setD] = useState(desc);
  const sorted = [...rows].sort((a: any, b: any) => { const x = a[k], y = b[k]; const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return d ? -c : c; });
  const th = (key: keyof T, label: string, num?: boolean) => <th className={`sortable ${num ? 'num' : ''}`} onClick={() => (k === key ? setD(!d) : (setK(key), setD(true)))} aria-sort={k === key ? (d ? 'descending' : 'ascending') : 'none'}>{label}{k === key ? (d ? ' ↓' : ' ↑') : ''}</th>;
  return { sorted, th };
}
export function Sparkline({ values, height = 46, color }: { values: number[]; height?: number; color?: string }) {
  if (values.length < 2) return <div className="hint">not enough data</div>;
  const min = Math.min(...values), max = Math.max(...values), w = 300;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - ((v - min) / (max - min || 1)) * (height - 4) - 2}`).join(' ');
  const c = color ?? (values[values.length - 1] >= values[0] ? 'var(--up)' : 'var(--down)');
  return <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="trend line"><polyline points={pts} fill="none" stroke={c} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>;
}
export function Freshness({ at, label = 'as of' }: { at: number | string | null | undefined; label?: string }) {
  if (!at) return <span className="hint">no data yet</span>;
  const age = Date.now() - (typeof at === 'string' ? Date.parse(at) : at);
  return <span className={`hint ${age > 120_000 ? 'warn' : ''}`} title={fmt.time(at)}>{label} {fmt.ago(at)}</span>;
}
