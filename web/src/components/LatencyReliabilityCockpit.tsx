import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Card, ErrorLine, Meter, Stat } from '../ui';

type Stage = {
  stage: string;
  lane: string;
  description: string;
  metric: 'p95' | 'p99';
  budgetMs: number | null;
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  status: 'WITHIN_BUDGET' | 'OVER_BUDGET' | 'NO_DATA';
};
type Book = {
  symbol: string;
  syncState: 'REST_SNAPSHOT_UNVERIFIED';
  lastUpdateId: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spreadBps: number | null;
  ageMs: number | null;
};
type LatencySnapshot = {
  schemaVersion: 1;
  timestampEpochMs: number;
  slaOverallPass: boolean | null;
  stages: Stage[];
  eventLoop: {
    eldP50Ms: number;
    eldP95Ms: number;
    eldP99Ms: number;
    eldMaxMs: number;
    eluActiveRatio: number | null;
    overloaded: boolean;
    samplingMs: number;
  };
  books: Book[];
  transport: {
    mode: 'REST_POLLING';
    websocketConnected: null;
    usedWeight1m: number | null;
    rateLimitCooldownUntilEpochMs: number | null;
    weightHardLimit1m: number;
    weightSoftWatermark1m: number;
  };
  limitations: string[];
};
const fmtMs = (ms: number | null | undefined) => ms == null || !Number.isFinite(ms) ? '—' : `${ms.toFixed(1)} ms`;
const fmtVal = (n: number | null) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 5 });
const tone = (status: Stage['status']) =>
  status === 'WITHIN_BUDGET' ? 'b-good' : status === 'OVER_BUDGET' ? 'b-bad' : 'b-neutral';

/**
 * QHEF-owned MIA latency cockpit. One measured data source; no parallel latency monitor,
 * order book, authentication system, or new trading authority.
 */
export function LatencyReliabilityCockpit() {
  const [intervalMs, setIntervalMs] = useState(1000);
  const [refreshId, setRefreshId] = useState(0);
  const [snapshot, setSnapshot] = useState<LatencySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const poll = () => {
      controller?.abort(); // single-flight: a slow response can never overwrite a newer one
      const current = new AbortController();
      controller = current;
      void api<LatencySnapshot>('/api/telemetry/latency', { signal: current.signal })
        .then((data) => { if (active && !current.signal.aborted) { setSnapshot(data); setError(null); } })
        .catch((cause: unknown) => {
          if (active && !current.signal.aborted)
            setError(cause instanceof Error ? cause.message : 'Telemetry request failed');
        });
    };
    poll();
    const timer = intervalMs > 0 ? window.setInterval(poll, intervalMs) : null;
    return () => { active = false; controller?.abort(); if (timer !== null) window.clearInterval(timer); };
  }, [intervalMs, refreshId]);

  const reset = async () => {
    setResetting(true); setResetError(null);
    try {
      // Existing same-origin owner session and x-mia-csrf; never store tokens in browser storage.
      await api<{ reset: true }>('/api/telemetry/latency/reset', { method: 'POST', body: {} });
      setSnapshot(null);
      setRefreshId((n) => n + 1);
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const loop = snapshot?.eventLoop;
  const label = !snapshot || snapshot.slaOverallPass === null ? 'NO DATA'
    : snapshot?.slaOverallPass && !error ? 'OBSERVED SLA PASS' : 'OBSERVED SLA DEGRADED';
  return <section aria-label="Latency and Reliability Cockpit">
    <Card title="Latency & Reliability Cockpit" right={<>
      <label className="row" style={{ gap: 6 }}>Polling
        <select aria-label="Latency polling interval" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))}>
          <option value={500}>500 ms</option><option value={1000}>1 s</option><option value={2500}>2.5 s</option><option value={0}>Paused</option>
        </select>
      </label>
      <button className="sm" disabled={resetting} onClick={() => void reset()} aria-label="Reset latency telemetry">{resetting ? 'Resetting…' : 'Reset histograms'}</button>
    </>}>
      <div className="col">
        <div className="row between">
          <Badge v={label} tone={!snapshot || snapshot.slaOverallPass == null ? 'b-neutral' : snapshot.slaOverallPass && !error ? 'b-good' : 'b-bad'} />
          <span className="hint">{intervalMs === 0 ? 'Updates paused' : `Polling every ${intervalMs} ms`} · {snapshot ? `sampled ${new Date(snapshot.timestampEpochMs).toLocaleTimeString()}` : 'awaiting sample'}</span>
        </div>
        <ErrorLine e={error} /><ErrorLine e={resetError} />
        <div className="grid g3">
          <Stat k="Event-loop delay p99" v={loop ? fmtMs(loop.eldP99Ms) : '—'} s={loop ? `p50 ${fmtMs(loop.eldP50Ms)} · p95 ${fmtMs(loop.eldP95Ms)}` : 'Awaiting a sample'} tone={loop?.overloaded ? 'warn' : undefined} />
          <Stat k="Event-loop utilization" v={loop?.eluActiveRatio == null ? '—' : `${(loop.eluActiveRatio * 100).toFixed(1)}%`} s="Delta since the previous QHEF observation (not CPU usage)" tone={loop?.overloaded ? 'warn' : undefined} />
          <Stat k="Market depth transport" v={snapshot?.transport.mode ?? '—'} s="Independent REST snapshots; not a synchronized WebSocket order book" />
        </div>
        {loop && <div className="grid g2">
          <Meter label="ELD p99 engineering threshold" value={loop.eldP99Ms} limit={25} unit=" ms" dp={1} />
          {loop.eluActiveRatio != null && <Meter label="ELU threshold" value={loop.eluActiveRatio * 100} limit={85} unit="%" dp={1} />}
        </div>}
        <div className="tablewrap">
          <table><thead><tr><th>Measured stage</th><th>Lane</th><th className="num">Samples</th><th className="num">p50</th><th className="num">p95</th><th className="num">p99</th><th>Budget</th><th>Status</th></tr></thead>
          <tbody>{(snapshot?.stages ?? []).map((s) => <tr key={s.stage} title={s.description}>
            <td className="mono">{s.stage}</td><td>{s.lane}</td><td className="num">{s.count}</td><td className="num">{fmtMs(s.p50Ms)}</td>
            <td className="num">{fmtMs(s.p95Ms)}</td><td className="num">{fmtMs(s.p99Ms)}</td>
            <td>{s.metric} ≤ {s.budgetMs == null ? '—' : fmtMs(s.budgetMs)}</td>
            <td><Badge v={s.status} tone={tone(s.status)} /></td>
          </tr>)}</tbody></table>
          {!snapshot && <div className="hint" role="status">Loading measured QHEF stages…</div>}
        </div>
        <div className="hint">The table reports existing measured stages. Proposed microsecond FAST/exit stages are not represented as passing until correctly instrumented.</div>
      </div>
    </Card>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card title="Order-book observation (REST only)" flush>
        <div className="tablewrap" style={{ maxHeight: 300 }}><table><thead><tr><th>Symbol</th><th>Sync verification</th><th className="num">Age</th><th className="num">Bid</th><th className="num">Ask</th><th className="num">Spread (bps)</th></tr></thead><tbody>
          {(snapshot?.books ?? []).map((b) => <tr key={b.symbol}><td className="mono">{b.symbol}</td><td><Badge v="UNVERIFIED REST" tone="b-warn" /></td><td className="num">{fmtMs(b.ageMs)}</td><td className="num">{fmtVal(b.bestBid)}</td><td className="num">{fmtVal(b.bestAsk)}</td><td className="num">{fmtVal(b.spreadBps)}</td></tr>)}
        </tbody></table>{snapshot && snapshot.books.length === 0 && <div className="hint">No tracked depth snapshots yet.</div>}</div>
      </Card>
      <Card title="Venue rate-limit evidence">
        <div className="col">
          <div className="hint">X-MBX-USED-WEIGHT-1M / 429 / 418: not collected by the current REST adapter. Displaying zero usage or a cooldown timer would be misleading.</div>
          <div className="kv"><span>Hard documented cap</span><span>{snapshot?.transport.weightHardLimit1m ?? 6000}/min (configuration reference)</span>
          <span>Soft engineering watermark</span><span>{snapshot?.transport.weightSoftWatermark1m ?? 4800}/min (configuration reference)</span>
          <span>Actual used weight</span><span>Not instrumented</span>
          <span>Retry-after cooldown</span><span>Not instrumented</span></div>
        </div>
      </Card>
    </div>
    {snapshot && <div className="hint" style={{ marginTop: 8 }}>Observability only · Not a release gate · Does not authorize real-money trading.</div>}
  </section>;
}
