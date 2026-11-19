import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useApi, fmt } from '../api';
import { CockpitPrivacyToggle, useCockpitPrivacy } from '../privacy';
import { Badge, Empty } from '../ui';
import { CandleChart } from '../pages/Markets';
import { monitorState, sourceState, type CockpitSnapshot } from '../cockpit';

type PipHost = Window & { documentPictureInPicture?: { requestWindow: (options: { width: number; height: number }) => Promise<Window> } };
interface Props { snapshot: CockpitSnapshot | null; error: string | null; receivedAt: number | null }
interface InstrumentView { quality?: { status: string }; unavailable?: boolean; reason?: string; candles?: { t: number; o: number; h: number; l: number; c: number; forming?: boolean }[]; features?: unknown; ticker?: { receivedAt?: number }; instrument?: { symbol: string } }
interface Notice { id: string; severity: string; title: string; body?: string; ts: number }

/** One monitor controller: one content tree inline OR in a PiP portal, one existing SSE connection. */
export function MiniCockpit({ snapshot, error, receivedAt }: Props) {
  const { hidden, conceal } = useCockpitPrivacy();
  const [visible, setVisible] = useState(false), [child, setChild] = useState<Window | null>(null);
  const [opening, setOpening] = useState(false), [notice, setNotice] = useState('');
  const [symbol, setSymbol] = useState('BTCUSDT'), [now, setNow] = useState(Date.now());
  const pipRef = useRef<Window | null>(null), generation = useRef(0), alive = useRef(true);
  const nav = useNavigate();
  const instrument = useApi<InstrumentView>(visible ? `/api/instrument/${encodeURIComponent(symbol)}?interval=1h` : null, { topics: ['scan'], every: 30_000 });
  const alerts = useApi<Notice[]>(visible ? '/api/notifications' : null, { topics: ['notification'], every: 30_000 });
  const state = monitorState(snapshot, now, receivedAt, error);
  useEffect(() => { if (!visible) return; setNow(Date.now()); const clock = window.setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(clock); }, [visible]);
  // Advance the clock when a response arrives (CodeRabbit PR #18): otherwise a response newer than the last 5 s tick looks
  // future-dated and the monitor shows UNKNOWN until the next tick.
  useEffect(() => { if (visible) setNow(Date.now()); }, [visible, receivedAt, instrument.updatedAt]);
  useEffect(() => {
    alive.current = true;
    const close = () => { generation.current++; pipRef.current?.close(); pipRef.current = null; };
    window.addEventListener('pagehide', close);
    return () => { alive.current = false; close(); window.removeEventListener('pagehide', close); };
  }, []);
  useLayoutEffect(() => {
    if (!child) return;
    const sync = () => { child.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'dark'; };
    sync(); const observer = new MutationObserver(sync); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const restore = () => { if (pipRef.current === child) pipRef.current = null; if (alive.current) setChild(null); };
    child.addEventListener('pagehide', restore);
    return () => { observer.disconnect(); child.removeEventListener('pagehide', restore); };
  }, [child]);
  const closeMonitor = () => { generation.current++; pipRef.current?.close(); pipRef.current = null; setChild(null); setVisible(false); setOpening(false); };
  const float = async () => {
    if (opening) return;
    if (pipRef.current && !pipRef.current.closed) { pipRef.current.focus(); return; }
    setVisible(true); setNotice('');
    const api = (window as PipHost).documentPictureInPicture;
    if (!window.isSecureContext || !api) { setNotice('Floating windows are unsupported here. The read-only monitor is shown in this page.'); return; }
    const token = ++generation.current; setOpening(true);
    let target: Window | null = null;
    try {
      // Must stay in the direct user-click call stack; never request a child from a mount effect.
      target = await api.requestWindow({ width: 390, height: 560 });
      if (!alive.current || token !== generation.current) { target.close(); return; }
      if (target.closed) { setNotice('The floating window closed before it was ready. Using the in-page monitor.'); return; }
      target.document.title = 'MIA — read-only paper monitor';
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        if (node instanceof HTMLLinkElement && new URL(node.href, location.href).origin !== location.origin) continue;
        const clone = node.cloneNode(true) as HTMLElement;
        if (node instanceof HTMLLinkElement) (clone as HTMLLinkElement).href = node.href;
        target.document.head.appendChild(clone);
      }
      target.document.body.className = 'pip-monitor-body';
      pipRef.current = target; setChild(target);
    } catch {
      target?.close(); if (alive.current && token === generation.current) setNotice('The floating window could not open. The read-only monitor remains in this page.');
    } finally { if (alive.current && token === generation.current) setOpening(false); }
  };
  const notices = Array.isArray(alerts.data) ? alerts.data : null;
  const relevant = notices?.filter(a => a.severity === 'CRITICAL' || a.severity === 'WARNING');
  const critical = relevant ? [...relevant.filter(a => a.severity === 'CRITICAL'), ...relevant.filter(a => a.severity === 'WARNING')].slice(0, 3) : null;
  const chart = instrument.data;
  const chartState = sourceState(chart?.ticker?.receivedAt, now, 60_000);
  const contents = <section className="mini-cockpit" aria-label="Read-only paper monitor">
    <div className="row between"><h2>MIA monitor</h2><button type="button" onClick={closeMonitor} aria-label="Close monitor">✕</button></div>
    <CockpitPrivacyToggle />
    {hidden && <p className="hint">Cockpit amounts hidden. Public market prices remain visible. Other workspaces and exports may show account details.</p>}
    <div className="row"><Badge v="PAPER ACCOUNT" tone="b-warn" /><Badge v={state.mode} /><Badge v="READ ONLY" /></div>
    <p className={snapshot?.control?.emergency ? 'down' : 'warn'} role={snapshot?.control?.emergency ? 'alert' : 'status'}>{state.message}</p>
    <div className="kv"><span>Paper equity{state.lastKnown ? ' (last known)' : ''}</span><strong>{conceal(fmt.usd(snapshot?.account?.equity))}</strong>
      <span>Daily paper P&amp;L</span><span>{conceal(fmt.pct(snapshot?.account?.dailyPnlPct))}</span>
      <span>Market data</span><span>{state.market} · {fmt.time(snapshot?.dataHealth?.tickersAt)}</span>
      <span>Scanner</span><span>{state.scanner} · {fmt.time(snapshot?.dataHealth?.scanAt)}</span>
      <span>Account response received</span><span>{fmt.time(receivedAt)}</span></div>
    <label>Chart asset <select aria-label="Monitor asset" value={symbol} onChange={e => setSymbol(e.target.value)}>
      <option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option></select></label>
    <p className="hint">{symbol} · {chartState}{instrument.error ? ' · last known / request failed' : ''}</p>
    {instrument.error && <p role="alert" className="err">Chart unavailable: {conceal(instrument.error, 'details hidden')}</p>}
    {chart?.unavailable ? <Empty>{conceal(chart.reason ?? 'Instrument unavailable.', 'Instrument unavailable — details hidden.')}</Empty> : chart?.quality?.status !== 'FAIL' && chart?.instrument?.symbol === symbol && Array.isArray(chart.candles) && chart.candles.length ? <CandleChart candles={chart.candles} features={chart.features} /> : <Empty>{instrument.loading ? 'Loading observed candles…' : 'No observed chart data.'}</Empty>}
    <button type="button" onClick={() => { nav(`/terminal/${symbol}`); window.focus(); }}>Open full terminal</button>
    {critical?.map(a => <div key={a.id} className="alertbar bad" role="alert"><b>{conceal(a.title, `${a.severity} alert — details hidden`)}</b><div>{conceal(a.body)}</div><span className="hint">{fmt.time(a.ts)}</span></div>)}
    {!!relevant?.length && <p className="hint">Showing {critical?.length} of {relevant.length} critical/warning notices returned by the server. <button type="button" className="sm" onClick={() => { nav('/risk'); window.focus(); }}>Review protection incidents</button></p>}
    {alerts.error ? <p role="alert">Critical alerts unavailable — check the main dashboard.</p> : !notices ? <p className="hint">Checking alerts…</p> : !critical?.length && <p className="hint">No critical or warning notifications in the current response.</p>}
    <p className="hint">Simulated paper values are not withdrawable funds. This viewer cannot place orders or change risk limits. A floating window closes with its originating tab.</p>
    {notice && <p role="status" className="hint">{notice}</p>}
  </section>;
  return <>
    <button type="button" className="sm" onClick={float} disabled={opening}>{opening ? 'Opening monitor…' : 'Float monitor'}</button>
    {visible && (child ? createPortal(contents, child.document.body) : <aside className="mini-monitor-inline">{contents}</aside>)}
  </>;
}
