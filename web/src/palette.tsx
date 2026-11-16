import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';

/**
 * Command palette (Ctrl/⌘+K): jump to any workspace, run a few risk-reducing actions, or open an asset.
 * Risk-increasing actions (mode changes, limits, funding) are deliberately NOT available here — they need step-up auth.
 */
export interface PaletteItem { id: string; label: string; hint?: string; group: string; run: () => void | Promise<void> }
export function CommandPalette({ pages, onClose, extra }: { pages: [string, string, string][]; onClose: () => void; extra: PaletteItem[] }) {
  const [q, setQ] = useState(''); const [sel, setSel] = useState(0); const [assets, setAssets] = useState<PaletteItem[]>([]); const [msg, setMsg] = useState<string | null>(null);
  const nav = useNavigate(); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setAssets([]); return; }
    const t = setTimeout(() => api<any[]>(`/api/markets/search?q=${encodeURIComponent(q.trim())}`).then((r) => setAssets(r.slice(0, 6).map((a) => ({ id: `asset:${a.id}`, label: `${a.base}`, hint: `${a.symbol} · open terminal`, group: 'Assets', run: () => nav(`/terminal/${a.symbol}`) })))).catch(() => setAssets([])), 150);
    return () => clearTimeout(t);
  }, [q, nav]);
  const items = useMemo(() => {
    const ql = q.toLowerCase().trim();
    const base: PaletteItem[] = [...pages.map(([to, , l]) => ({ id: `page:${to}`, label: l, hint: to, group: 'Go to', run: () => nav(to) })), ...extra];
    const m = ql ? base.filter((i) => i.label.toLowerCase().includes(ql) || i.hint?.toLowerCase().includes(ql)) : base;
    return [...m, ...assets];
  }, [q, pages, extra, assets, nav]);
  useEffect(() => setSel(0), [q]);
  const exec = async (i: PaletteItem) => { try { await i.run(); onClose(); } catch (e: any) { setMsg(e.message); } };
  return <div className="modal-bg" onClick={onClose}><div className="modal" style={{ width: 'min(640px,100%)' }} role="dialog" aria-modal aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
    <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
      <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a page, action, or asset…" style={{ width: '100%' }} aria-label="Command"
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } else if (e.key === 'Enter' && items[sel]) exec(items[sel]); else if (e.key === 'Escape') onClose(); }} />
    </div>
    {msg && <div className="err" style={{ padding: '6px 12px' }}>{msg}</div>}
    <div style={{ maxHeight: 420, overflowY: 'auto' }} role="listbox">
      {items.map((i, n) => <div key={i.id} role="option" aria-selected={n === sel} onMouseEnter={() => setSel(n)} onClick={() => exec(i)}
        style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 10, background: n === sel ? 'var(--panel2)' : undefined }}>
        <span><span className="faint" style={{ fontSize: 11, marginRight: 8 }}>{i.group}</span>{i.label}</span><span className="hint">{i.hint}</span></div>)}
      {!items.length && <div className="empty">No matches</div>}
    </div>
    <div className="hint" style={{ padding: '6px 12px', borderTop: '1px solid var(--line)' }}>↑↓ to move · Enter to run · Esc to close · risk-increasing actions are not available here</div>
  </div></div>;
}
