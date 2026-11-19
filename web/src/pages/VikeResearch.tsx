import { useLayoutEffect, useRef, useState } from 'react';
import { api, fmt, useApi } from '../api';
import { Badge, Card, Empty, ErrorLine, Freshness } from '../ui';

/**
 * Vike on-chain research (read-only). Data comes from the server's /api/research/vike routes; the API key never reaches
 * the browser. Everything shown here is RESEARCH_ONLY evidence: it cannot place, approve or size a trade.
 * Vike's response schemas are unpublished ({}), so rows are rendered defensively from whatever list the response holds.
 */
const CHAINS = ['ethereum', 'bsc', 'base', 'hyperevm'] as const;

/** Find the first array of objects in an untyped response (top level or one level down). */
function rowsOf(data: unknown): Record<string, unknown>[] {
  const isRows = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.every((x) => x && typeof x === 'object');
  if (isRows(data)) return data;
  if (data && typeof data === 'object') for (const v of Object.values(data)) if (isRows(v)) return v;
  return [];
}
const pick = (r: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (r[k] != null && typeof r[k] !== 'object') return r[k] as string | number; return undefined; };
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function ResearchTable({ rows, chain }: { rows: Record<string, unknown>[]; chain?: string }) {
  if (!rows.length) return <Empty>No rows in this response.</Empty>;
  return <div className="tablewrap"><table><thead><tr><th>Name</th><th>Chain</th><th className="num">Volume (USD)</th><th className="num">Net flow (USD)</th><th className="num">Holders</th></tr></thead>
    <tbody>{rows.slice(0, 50).map((r, i) => {
      const vol = num(pick(r, ['volume_usd', 'volume', 'volumeUsd'])); const inflow = num(pick(r, ['net_flow_usd', 'net_inflow_usd', 'net_flow', 'net_inflow']));
      const holders = num(pick(r, ['unique_holders', 'holders', 'holder_count']));
      return <tr key={String(pick(r, ['address', 'id', 'token_address']) ?? i)}>
        <td><b>{String(pick(r, ['symbol', 'name', 'title', 'question', 'address']) ?? '—')}</b> <span className="faint">{String(pick(r, ['name', 'type']) ?? '')}</span></td>
        <td>{String(pick(r, ['chain', 'network']) ?? chain ?? '—')}</td>
        <td className="num">{vol == null ? '—' : fmt.big(vol)}</td><td className="num">{inflow == null ? '—' : fmt.big(inflow)}</td><td className="num">{holders == null ? '—' : fmt.num(holders, 0)}</td></tr>;
    })}</tbody></table></div>;
}

export function VikeResearchPanel() {
  const status = useApi('/api/research/vike/status', { every: 60_000 });
  const [chain, setChain] = useState<typeof CHAINS[number]>('ethereum');
  const configured = !!status.data?.configured;
  const screener = useApi(configured ? `/api/research/vike/tokens?chain=${chain}&window=24h&limit=50` : null, { every: 120_000 });
  const [q, setQ] = useState(''); const [found, setFound] = useState<{ rows: Record<string, unknown>[]; at: number } | null>(null); const [searchErr, setSearchErr] = useState<string | null>(null);
  const currentSearch = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => currentSearch.current?.abort(), []);
  const search = async () => {
    currentSearch.current?.abort();
    const request = new AbortController();
    currentSearch.current = request;
    setFound(null);
    setSearchErr(null);
    try {
      const r = await api<{ data: unknown; fetchedAt: number }>(`/api/research/vike/search?q=${encodeURIComponent(q.trim())}&limit=20`, { signal: request.signal });
      if (!request.signal.aborted) setFound({ rows: rowsOf(r.data), at: r.fetchedAt });
    } catch (e) {
      if (!request.signal.aborted) setSearchErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (currentSearch.current === request) currentSearch.current = null;
    }
  };
  return <>
    <div className="banner info" style={{ marginBottom: 12 }}>Vike data is <b>research only</b>: it is never a trade signal and cannot place, approve or size an order. Names and symbols are untrusted external content and can collide.</div>
    <ErrorLine e={status.error} />
    {status.data && !configured && <Card title="Vike research" right={<Badge v="PENDING_CREDENTIALS" />}><Empty>Not configured. The owner sets <code>MIA_VIKE_API_KEY</code> in the <b>server</b> environment (never in the browser or git) and restarts MIA. Until then no Vike data is shown.</Empty></Card>}
    {configured && <>
      <Card flush title="On-chain token screener (24h)" right={<><Freshness at={screener.data?.fetchedAt} /><select value={chain} onChange={(e) => setChain(e.target.value as typeof CHAINS[number])} aria-label="Chain">{CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}</select></>}>
        <ErrorLine e={screener.error} />{screener.data ? <ResearchTable rows={rowsOf(screener.data.data)} chain={chain} /> : <Empty>Loading…</Empty>}
      </Card>
      <Card title="Search tokens, wallets and markets" right={found && <Freshness at={found.at} />}>
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) void search(); }} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={q} maxLength={256} onChange={(e) => setQ(e.target.value)} placeholder="e.g. PEPE or a contract address" aria-label="Vike search" style={{ flex: 1 }} />
          <button type="submit" disabled={!q.trim()}>Search</button>
        </form>
        <ErrorLine e={searchErr} />{found && <ResearchTable rows={found.rows} />}
      </Card>
    </>}
  </>;
}
