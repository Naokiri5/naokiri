import { useState } from 'react';
import { api, fmt, uploadFile, useApi } from '../api';
import { Action, Badge, Card, Empty, ErrorLine, Modal, Page, Stat, Tabs } from '../ui';

/**
 * Quantitative Trading Intelligence Academy. Library, retrieval, concepts, conflicts and research experiments.
 * Everything shown is measured from stored records; knowledge is evidence and never authorizes a trade.
 */
const TABS = ['Overview', 'Library', 'Search & ask', 'Concepts', 'Conflicts', 'Research lab', 'Disciplines', 'Memory'];
const STATUS_TONE: Record<string, string> = { INDEXED: 'b-good', PARTIALLY_INDEXED: 'b-warn', NEEDS_REVIEW: 'b-warn', FAILED: 'b-bad', PROCESSING: 'b-info', INGESTION_PENDING: 'b-info', AWAITING_DOCUMENT: 'b-neutral' };
const VERDICT_TONE: Record<string, string> = { SUPPORTED: 'b-good', SUPPORTED_MOMENTUM: 'b-good', SUPPORTED_MEAN_REVERSION: 'b-good', INCONCLUSIVE: 'b-warn', INSUFFICIENT_EVIDENCE: 'b-warn', NOT_SUPPORTED: 'b-bad' };
const Status = ({ v }: { v: string }) => <Badge v={v.replace(/_/g, ' ')} tone={STATUS_TONE[v] ?? VERDICT_TONE[v] ?? 'b-neutral'} />;

export function Academy() {
  const [tab, setTab] = useState(TABS[0]);
  const stats = useApi('/api/academy/stats', { topics: ['knowledge'] });
  const s = stats.data;
  return <Page title="Quant Academy" sub="Your trading & quantitative-finance library, concept cards, source conflicts and reproducible research experiments."
    right={<button className="sm" onClick={stats.reload}>Refresh</button>}>
    <ErrorLine e={stats.error} />
    <div className="banner info">Knowledge is evidence, not authority. Passages, concepts and experiments never place or approve trades — the deterministic decision engine and risk gate stay in control. Paper trading only.</div>
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <Stat k="Documents indexed" v={s ? `${s.fullyIndexed + s.partiallyIndexed} / ${s.documents}` : '—'} s={s ? `${s.catalogWithDocument} of ${s.catalogued} catalogued titles have a document` : ''} />
      <Stat k="Passages" v={s?.chunks ?? '—'} s={s ? `${s.embeddedChunks} embedded · ${s.embeddingProvider}${s.semanticEmbeddings ? '' : ' (lexical)'}` : ''} />
      <Stat k="Concepts" v={s?.concepts ?? '—'} s={s ? `${s.conceptsWithSources} with sources · ${s.claims} claims` : ''} />
      <Stat k="Needs attention" v={s ? s.failed + s.needsReview : '—'} tone={s && s.failed ? 'down' : undefined} s={s ? `${s.failed} failed · ${s.needsReview} review · ${s.pending} pending` : ''} />
    </div>
    <Tabs tabs={TABS} value={tab} onChange={setTab} />
    {tab === 'Overview' && <Overview />}
    {tab === 'Library' && <Library onChange={stats.reload} />}
    {tab === 'Search & ask' && <SearchAsk />}
    {tab === 'Concepts' && <Concepts />}
    {tab === 'Conflicts' && <Conflicts />}
    {tab === 'Research lab' && <ResearchLab />}
    {tab === 'Disciplines' && <Disciplines />}
    {tab === 'Memory' && <Memory />}
  </Page>;
}

function Overview() {
  const cat = useApi<any[]>('/api/academy/catalog', { topics: ['knowledge'] });
  return <Card title="Reading catalog" right={<span className="hint">A title counts only when its document is indexed</span>} flush>
    <ErrorLine e={cat.error} />
    <div className="tablewrap"><table><thead><tr><th>#</th><th>Title</th><th>Authors</th><th>Discipline</th><th>Status</th><th>Passages</th></tr></thead><tbody>
      {(cat.data ?? []).map((c) => <tr key={c.id}><td className="mono">{c.priority ?? '—'}</td><td><b>{c.title}</b></td><td>{c.authors}</td><td>{c.discipline}</td><td><Status v={c.status} /></td><td className="mono">{c.chunks}</td></tr>)}
    </tbody></table></div>
    {cat.data && !cat.data.length && <Empty>Catalog is empty.</Empty>}
  </Card>;
}

function Library({ onChange }: { onChange: () => void }) {
  const docs = useApi<any[]>('/api/academy/documents', { topics: ['knowledge'] });
  const cat = useApi<any[]>('/api/academy/catalog');
  const [file, setFile] = useState<File | null>(null); const [catalogId, setCatalogId] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const upload = async () => {
    if (!file) throw new Error('choose a file first');
    const r = await uploadFile(`/api/academy/documents${catalogId ? `?catalogId=${encodeURIComponent(catalogId)}` : ''}`, file);
    setMsg(r.duplicate ? `Already in the library (status ${r.status}).` : 'Uploaded — processing in the background.'); docs.reload(); onChange();
  };
  return <div className="col" style={{ gap: 14 }}>
    <Card title="Upload a document" right={<span className="hint">PDF · EPUB · DOCX · HTML · Markdown · TXT</span>}>
      <div className="row">
        <input type="file" aria-label="Document file" accept=".pdf,.epub,.docx,.html,.htm,.md,.markdown,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <select aria-label="Catalog entry" value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
          <option value="">Not linked to a catalog title</option>
          {(cat.data ?? []).filter((c) => !c.document_id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <Action label="Upload" run={upload} disabled={!file} />
      </div>
      {msg && <div className="hint" style={{ marginTop: 8 }}>{msg}</div>}
      <div className="hint" style={{ marginTop: 8 }}>Upload only material you are entitled to use. Files are stored unmodified; DRM-protected files are refused, never decrypted. Scanned PDFs without a text layer are reported as unreadable (OCR is not configured).</div>
    </Card>
    <Card title="Documents" flush>
      <ErrorLine e={docs.error} />
      <div className="tablewrap"><table><thead><tr><th>Document</th><th>Format</th><th>Status</th><th>Pages</th><th>Passages</th><th>Uploaded</th><th /></tr></thead><tbody>
        {(docs.data ?? []).map((d) => <tr key={d.id}>
          <td><b>{d.title ?? d.filename}</b><div className="hint">{d.authors ?? 'author unknown'}{d.error && <span className="down"> · {d.error}</span>}</div></td>
          <td>{d.format}</td><td><Status v={d.status} />{d.progress?.totalPages && d.status === 'PROCESSING' ? <div className="hint">page {d.progress.lastPage}/{d.progress.totalPages}</div> : null}</td>
          <td className="mono">{d.pages ?? '—'}{d.unreadable_pages?.length ? <span className="warn"> ({d.unreadable_pages.length} unreadable)</span> : null}</td>
          <td className="mono">{d.chunks}</td><td>{fmt.ago(d.uploaded_at)}</td>
          <td className="row"><button className="sm ghost" onClick={async () => setDetail(await api(`/api/academy/documents/${d.id}`))}>Details</button>
            <Action className="sm ghost" label="Re-process" confirm="Re-extract this document with the current extractor? The original file is kept." run={async () => { await api(`/api/academy/documents/${d.id}/reprocess`, { body: {} }); docs.reload(); }} /></td>
        </tr>)}
      </tbody></table></div>
      {docs.data && !docs.data.length && <Empty>No documents yet. Upload a book or paper above — the Academy never claims to have read anything it has not indexed.</Empty>}
    </Card>
    {detail && <Modal title={detail.title ?? detail.filename} onClose={() => setDetail(null)}>
      <div className="kv"><span>Status</span><span><Status v={detail.status} /></span><span>Authors</span><span>{detail.authors ?? '—'}</span><span>Edition</span><span>{detail.edition ?? '—'}</span><span>Published</span><span>{detail.published ?? '—'}</span><span>Evidence class</span><span>{detail.evidence_class}</span><span>Extractor</span><span className="mono">{detail.extractor_version ?? '—'}</span></div>
      <h4>Chapters</h4>{detail.chapters.length ? <ul>{detail.chapters.map((c: any, i: number) => <li key={i}>{c.chapter ?? '(no chapter)'} — {c.chunks} passages{c.page_start ? `, pp. ${c.page_start}–${c.page_end}` : ''}</li>)}</ul> : <Empty>No passages.</Empty>}
      <h4>Processing history</h4><ul>{detail.events.map((e: any, i: number) => <li key={i}><span className="mono">{fmt.time(e.ts)}</span> {e.event}</li>)}</ul>
    </Modal>}
  </div>;
}

function Passage({ p }: { p: any }) {
  return <div className="card" style={{ padding: 10 }}>
    <div className="row between"><b>{p.n ? `[${p.n}] ` : ''}{p.source}</b><span className="row"><Badge v={p.evidenceClass} tone="b-neutral" />{p.kind !== 'text' && <Badge v={p.kind} tone="b-info" />}</span></div>
    <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontSize: 13 }}>{p.excerpt}</div>
  </div>;
}

function SearchAsk() {
  const [q, setQ] = useState(''); const [mode, setMode] = useState('hybrid'); const [res, setRes] = useState<any>(null); const [ans, setAns] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const run = async (kind: 'search' | 'ask') => {
    setErr(null); setRes(null); setAns(null);
    try { if (kind === 'search') setRes(await api(`/api/academy/search?q=${encodeURIComponent(q)}&mode=${mode}`)); else setAns(await api('/api/academy/ask', { body: { question: q } })); }
    catch (e: any) { setErr(e.message); }
  };
  return <div className="col" style={{ gap: 14 }}>
    <Card title="Search the library">
      <form className="row" onSubmit={(e) => { e.preventDefault(); run('search'); }}>
        <input style={{ flex: 1, minWidth: 220 }} aria-label="Query" placeholder="e.g. volatility clustering, Kelly criterion, purged cross-validation" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Search mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="hybrid">Hybrid</option><option value="keyword">Keyword</option><option value="semantic">Vector</option></select>
        <button type="submit" disabled={!q.trim()}>Search</button>
        <button type="button" className="ghost" disabled={q.trim().length < 3} onClick={() => run('ask')}>What does the research say?</button>
      </form>
      <ErrorLine e={err} />
    </Card>
    {res && <Card title={`${res.hits.length} passages`} right={<span className="hint">vectors: {res.embedding.provider}{res.embedding.semantic ? '' : ' — lexical, not true semantic'}</span>}>
      <div className="col">{res.hits.map((h: any) => <Passage key={h.chunkId} p={h} />)}{!res.hits.length && <Empty>No indexed passage matches.</Empty>}</div>
    </Card>}
    {ans && <div className="col" style={{ gap: 14 }}>
      <div className="banner info">{ans.reasoning} {ans.notice}</div>
      {ans.answer && <Card title={`Answer (${ans.answer.provider})`} right={<Badge v={ans.answer.grounded ? 'CITATIONS VALIDATED' : 'NOT FULLY GROUNDED'} tone={ans.answer.grounded ? 'b-good' : 'b-warn'} />}><div style={{ whiteSpace: 'pre-wrap' }}>{ans.answer.text}</div></Card>}
      {ans.concepts.length > 0 && <Card title="Matching concepts"><div className="col">{ans.concepts.map((c: any) => <div key={c.id}><b>{c.name}</b> <Badge v={c.evidenceClass} tone="b-neutral" /> <span className="hint">{c.sourceStatus}</span><div>{c.explanation}</div>{c.formula && <div className="mono">{c.formula}</div>}</div>)}</div></Card>}
      {ans.disagreements.length > 0 && <Card title="Sources disagree"><ConflictList items={ans.disagreements} /></Card>}
      <Card title="Cited passages"><div className="col">{ans.passages.map((p: any) => <Passage key={p.chunkId} p={p} />)}{!ans.passages.length && <Empty>No passages.</Empty>}</div></Card>
    </div>}
  </div>;
}

function Concepts() {
  const list = useApi<any[]>('/api/academy/concepts', { topics: ['knowledge'] });
  const [open, setOpen] = useState<any>(null);
  return <Card title="Concept cards" flush>
    <ErrorLine e={list.error} />
    <div className="tablewrap"><table><thead><tr><th>Concept</th><th>Discipline</th><th>Evidence class</th><th>Sources</th><th>Claims</th><th>Experiments</th></tr></thead><tbody>
      {(list.data ?? []).map((c) => <tr key={c.id} style={{ cursor: 'pointer' }} onClick={async () => setOpen(await api(`/api/academy/concepts/${c.id}`))}>
        <td><b>{c.name}</b><div className="hint">{c.explanation?.slice(0, 110)}</div></td><td>{c.discipline}</td><td><Badge v={c.evidence_class} tone="b-neutral" /></td>
        <td className="mono">{c.sources}</td><td className="mono">{c.claims}</td><td className="mono">{c.experiments}</td></tr>)}
    </tbody></table></div>
    {open && <Modal title={open.name} onClose={() => setOpen(null)}>
      <div className="row"><Badge v={open.evidenceClass} tone="b-neutral" /><Badge v={open.origin} tone="b-violet" /><span className="hint">{open.sourceStatus}</span></div>
      <p>{open.card.explanation}</p>{open.card.formula && <pre className="mono">{open.card.formula}</pre>}
      <div className="kv"><span>Assumptions</span><span>{open.card.assumptions.join('; ')}</span><span>Works when</span><span>{open.card.appliesWhen.join('; ')}</span><span>Fails when</span><span>{open.card.failsWhen.join('; ')}</span><span>Risks</span><span>{open.card.risks.join('; ')}</span><span>MIA components</span><span>{open.card.miaComponents.join(', ')}</span><span>Related</span><span>{open.card.related.join(', ')}</span></div>
      <h4>Sources</h4>{open.sources.length ? <div className="col">{open.sources.slice(0, 6).map((s: any) => <div key={s.chunkId}><Badge v={s.relation} tone="b-info" /> <b>{s.source}</b><div className="hint">{s.excerpt?.slice(0, 300)}</div></div>)}</div> : <Empty>No supporting source yet.</Empty>}
      <h4>Experiments</h4>{open.experiments.length ? <ul>{open.experiments.map((e: any) => <li key={e.id}><Status v={e.verdict} /> {e.kind} · {fmt.time(e.created_at)}</li>)}</ul> : <Empty>Not tested yet — run it in the Research lab.</Empty>}
    </Modal>}
  </Card>;
}

function ConflictList({ items }: { items: any[] }) {
  return <div className="col" style={{ gap: 12 }}>{items.map((c, i) => <div key={i} className="card" style={{ padding: 10 }}>
    <div className="row between"><b>{c.concept}: {c.proposition}</b>{c.autoCandidatesOnly && <Badge v="AUTO-DETECTED — VERIFY" tone="b-warn" />}</div>
    <div className="grid g2" style={{ marginTop: 6 }}>
      <div><div className="up">Supports</div>{c.supporting.map((s: any) => <div key={s.id} className="hint">“{s.quote}” — {s.source}</div>)}</div>
      <div><div className="down">Contradicts</div>{c.contradicting.map((s: any) => <div key={s.id} className="hint">“{s.quote}” — {s.source}</div>)}</div>
    </div>
    <ul className="hint">{c.resolution.map((r: string, j: number) => <li key={j}>{r}</li>)}</ul>
  </div>)}</div>;
}
function Conflicts() {
  const c = useApi<any[]>('/api/academy/conflicts', { topics: ['knowledge'] });
  return <Card title="Source disagreements" right={<span className="hint">Kept side by side — never merged into one answer</span>}>
    <ErrorLine e={c.error} />{c.data && (c.data.length ? <ConflictList items={c.data} /> : <Empty>No disagreements between indexed sources yet.</Empty>)}
  </Card>;
}

function ResearchLab() {
  const exps = useApi<any[]>('/api/academy/experiments');
  const paper = useApi('/api/academy/paper-experiment', { every: 60_000 });
  const [form, setForm] = useState({ kind: 'volatility_clustering', symbol: 'BTCUSDT', interval: '1h', strategyId: 'trend_pullback', bars: 3000 });
  const [open, setOpen] = useState<any>(null);
  const run = async () => {
    const conceptId = form.kind === 'volatility_clustering' ? 'con_volatility_clustering' : form.kind === 'return_autocorrelation' ? 'con_mean_reversion' : 'con_walk_forward_validation';
    const r = await api('/api/academy/experiments', { body: { ...form, conceptId, strategyId: form.kind === 'strategy_walkforward' ? form.strategyId : undefined } });
    setOpen(r); exps.reload();
  };
  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  return <div className="col" style={{ gap: 14 }}>
    <Card title="Run an experiment" right={<span className="hint">Binance public candles · seeded · stored immutably</span>}>
      <div className="row">
        <select aria-label="Experiment" value={form.kind} onChange={(e) => set('kind', e.target.value)}><option value="volatility_clustering">Volatility clustering</option><option value="return_autocorrelation">Return autocorrelation (mean reversion / momentum)</option><option value="strategy_walkforward">Strategy walk-forward (purged + embargo)</option></select>
        <input aria-label="Symbol" value={form.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} style={{ width: 120 }} />
        <select aria-label="Interval" value={form.interval} onChange={(e) => set('interval', e.target.value)}><option>15m</option><option>1h</option><option>4h</option></select>
        {form.kind === 'strategy_walkforward' && <select aria-label="Strategy" value={form.strategyId} onChange={(e) => set('strategyId', e.target.value)}><option value="trend_pullback">trend_pullback (1h)</option><option value="donchian_breakout">donchian_breakout</option><option value="range_reversion">range_reversion</option></select>}
        <input aria-label="Bars" type="number" min={500} max={8000} value={form.bars} onChange={(e) => set('bars', Number(e.target.value))} style={{ width: 100 }} />
        <Action label="Run" run={run} />
      </div>
      <div className="hint" style={{ marginTop: 8 }}>Results are historical evidence only. A supported result does not promote a strategy; promotion still requires the Strategy Lab gate, the risk engine and paper trading.</div>
    </Card>
    <Card title="Experiments" flush><ErrorLine e={exps.error} />
      <div className="tablewrap"><table><thead><tr><th>When</th><th>Experiment</th><th>Dataset</th><th>Verdict</th></tr></thead><tbody>
        {(exps.data ?? []).map((e) => <tr key={e.id} style={{ cursor: 'pointer' }} onClick={async () => setOpen(await api(`/api/academy/experiments/${e.id}`))}><td>{fmt.time(e.created_at)}</td><td><b>{e.kind}</b><div className="hint">{e.hypothesis}</div></td><td className="mono">{e.dataset.symbol} {e.dataset.interval} · {e.dataset.bars} bars</td><td><Status v={e.verdict} /></td></tr>)}
      </tbody></table></div>
      {exps.data && !exps.data.length && <Empty>No experiments yet.</Empty>}
    </Card>
    <Card title="90-day paper experiment"><div className="kv"><span>Status</span><span>{paper.data ? <Status v={paper.data.status} /> : '—'}</span><span>Days elapsed</span><span>{paper.data?.daysElapsed ?? '—'} / 90</span><span>Closed paper trades</span><span>{paper.data?.closedTrades ?? '—'}</span><span>Expectancy (R)</span><span>{fmt.num(paper.data?.expectancyR)}</span></div><div className="hint">{paper.data?.note}</div></Card>
    {open && <Modal title={`${open.kind} · ${open.dataset.symbol} ${open.dataset.interval}`} onClose={() => setOpen(null)}>
      <div className="row"><Status v={open.verdict} /><Badge v={`integrity ${open.integrity}`} tone={open.integrity === 'VERIFIED' ? 'b-good' : 'b-bad'} /></div>
      <p><b>Hypothesis:</b> {open.hypothesis}</p>
      <h4>Limitations</h4><ul>{open.limitations.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
      <h4>Reproduce</h4><pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(open.reproduce, null, 2)}</pre>
      <h4>Results</h4><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(open.results, null, 2)}</pre>
    </Modal>}
  </div>;
}

function Disciplines() {
  const d = useApi<any[]>('/api/academy/disciplines');
  return <div className="grid g2">{(d.data ?? []).map((x) => <Card key={x.id} title={x.name}>
    <div className="kv"><span>Covers</span><span>{x.categories.join(', ')}</span><span>MIA components</span><span>{x.miaComponents.join(', ')}</span><span>Exercises</span><span>{x.exercises.join('; ')}</span><span>Hypotheses</span><span>{x.hypotheses.join('; ')}</span><span>Evaluation</span><span>{x.evaluation.join('; ')}</span></div>
  </Card>)}<ErrorLine e={d.error} /></div>;
}

function Memory() {
  const m = useApi('/api/academy/memory');
  return <Card title="Memory architecture" right={<span className="hint">{m.data?.authority}</span>} flush><ErrorLine e={m.error} />
    <div className="tablewrap"><table><thead><tr><th>Category</th><th>Holds</th><th>Stores (records)</th><th>Freshness</th></tr></thead><tbody>
      {(m.data?.categories ?? []).map((c: any) => <tr key={c.id}><td><b>{c.id}. {c.name}</b></td><td>{c.holds}</td><td className="mono">{Object.entries(c.records).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td><td className="hint">{c.freshness}</td></tr>)}
    </tbody></table></div>
  </Card>;
}
