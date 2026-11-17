import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import { Badge, Card, Empty, ErrorLine } from '../ui';
import { ago } from '../status';
import { groupReasons, liveEvidence, type Evidence, type Reason, type ReasonGroup } from '../attention';

interface NoTradeRow {
  instrumentId: string; symbol: string; decisionId: string; strategy: string; decision: string; score: number | null; createdAt: number;
  ageMs: number | null; expiresAt: number | null; evidence: Evidence; supersededBy: string | null;
  risk: { decision: string; policyVersion: number | null; checkedAt: string } | null; reasons: Reason[]; missing: string[];
  history: { decisionId: string; decision: string; createdAt: number; supersededBy: string; reasons: Reason[] }[];
}
interface NoTradeBoardDto {
  asOf: number; ttlMs: number; windowMs: number; globalLabel: string; rows: NoTradeRow[];
  global: { code: string; group: ReasonGroup; text: string; href: string }[]; omittedTrades: { instrumentId: string; decisionId: string; decision: string }[];
}
type Live = ReturnType<typeof liveEvidence>;
const EVIDENCE_TONE: Record<Evidence, string> = { RECENT: 'b-info', STALE: 'b-neutral', UNKNOWN: 'b-warn' };
const GROUP_TONE: Record<ReasonGroup, string> = { data: 'b-warn', safety: 'b-bad', consensus: 'b-neutral', risk: 'b-bad', mode: 'b-violet' };

/**
 * "Why MIA is not trading": each instrument's latest recorded non-trade decision with the reasons stored in its report,
 * plus known global blockers. Read-only; it never recommends a trade. Ages tick locally on the monotonic clock, so a row
 * turns STALE at the 2 h TTL between polls.
 */
export function NoTradeBoard() {
  const { data, error, requestedAt } = useApi<NoTradeBoardDto>('/api/no-trade', { topics: ['decision', 'mode', 'risk', 'scan', 'bot'], every: 30_000 });
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => { const t = window.setInterval(() => setNow(performance.now()), 1000); return () => clearInterval(t); }, []);
  const rows = (data?.rows ?? []).map((r) => ({ r, live: liveEvidence(r, requestedAt, now, data!.ttlMs) }));
  const current = rows.filter((x) => x.live.evidence !== 'STALE'); const stale = rows.filter((x) => x.live.evidence === 'STALE');
  const omitted = data?.omittedTrades.length ?? 0;
  return <div className="col" style={{ gap: 14 }}>
    <ErrorLine e={error} />
    {error && data && <div className="alertbar warn" role="status">Board refresh failed: showing the last loaded evidence, which may be out of date.</div>}
    <Card title={<>Global blockers · <span className="muted">{data?.globalLabel ?? 'known blockers, not execution clearance'}</span></>} flush>
      {data && !data.global.length && <div className="hint" style={{ padding: '10px 14px' }}>No known global blockers. This is not execution clearance: the risk gate still evaluates every order.</div>}
      <ul className="feed">{(data?.global ?? []).map((g) => <li key={g.code}><Badge v={g.code} tone={GROUP_TONE[g.group]} /><div className="what nt-text">{g.text} <Link to={g.href}>Open →</Link></div></li>)}</ul>
      {!data && !error && <Empty>Loading…</Empty>}
    </Card>
    {current.length > 0 && <div className="grid g2 nt-current">{current.map(({ r, live }) => <NoTradeCard key={r.instrumentId} r={r} live={live} ttlMs={data!.ttlMs} />)}</div>}
    {data && !rows.length && <Empty>No recorded non-trade decisions in the last 24 hours, so there is nothing to explain.{omitted ? ' ' + omitted + ' instrument(s) left out because their latest decision was a trade.' : ''}</Empty>}
    {stale.length > 0 && <details className="nt-stale"><summary>{stale.length} stale decision(s), older than {ago(data!.ttlMs)}: evidence may no longer hold</summary>
      <div className="grid g2" style={{ marginTop: 10 }}>{stale.map(({ r, live }) => <NoTradeCard key={r.instrumentId} r={r} live={live} ttlMs={data!.ttlMs} />)}</div></details>}
    {rows.length > 0 && omitted > 0 && <div className="hint">{omitted} instrument(s) left out because their latest decision was a trade.</div>}
  </div>;
}

function NoTradeCard({ r, live, ttlMs }: { r: NoTradeRow; live: Live; ttlMs: number }) {
  const when = live.ageMs == null ? 'decided at an unknown or invalid time' : 'decided ' + ago(live.ageMs) + ' ago';
  const expiry = live.evidence === 'RECENT' && live.ageMs != null ? ' · evidence expires in ' + ago(ttlMs - live.ageMs) : '';
  return <Card className="nt-card" title={<span className="row" style={{ gap: 6 }}><b>{r.symbol}</b><Badge v={r.decision} /><Badge v={live.evidence} tone={EVIDENCE_TONE[live.evidence]} /></span>}
    right={<Link to={'/decision/' + r.decisionId}>Decision record →</Link>}>
    <div className="col" style={{ gap: 8 }}>
      <div className="hint">{r.strategy} · {when}{expiry}{r.risk ? ' · risk ' + r.risk.decision + ', policy v' + (r.risk.policyVersion ?? '—') + ', checked ' + r.risk.checkedAt : ''}</div>
      {groupReasons(r.reasons).map((g) => <div key={g.id} className="nt-group"><div className="sec-title" style={{ margin: 0 }}>{g.label}</div>
        {g.reasons.map((x, i) => <div key={i} className="nt-text"><Badge v={x.code} tone={GROUP_TONE[x.group]} /> <span className="mono">{x.text}</span></div>)}</div>)}
      {r.missing.length > 0 && <div className="hint nt-text">Missing inputs: {r.missing.join('; ')}</div>}
      {r.history.length > 0 && <div className="hint nt-text">Earlier: {r.history.map((h, i) => <span key={h.decisionId}>{i ? ' · ' : ''}<Link to={'/decision/' + h.decisionId}>{h.decision.replace(/_/g, ' ')}</Link> {fmt.ago(h.createdAt)}, superseded by <Link to={'/decision/' + h.supersededBy}>a newer decision</Link></span>)}</div>}
    </div>
  </Card>;
}
