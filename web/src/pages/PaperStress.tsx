import { fmt, useApi } from '../api';
import { Badge, Card, Empty, ErrorLine, Freshness } from '../ui';

interface StressReport {
  asOf: number;
  baselineEquity: number | null;
  scenarios: Array<{
    id: string;
    label: string;
    status: 'MODELED' | 'PARTIAL' | 'UNAVAILABLE' | 'NO_EXPOSURE';
    assumption: string;
    loss: number | null;
    equityLossPct: number | null;
    reason: string | null;
    unpricedValue?: number | null;
    largestHolding?: { instrument: string; baselineEquityPct: number; stressedEquityPct: number } | null;
  }>;
  note: string;
  tailRisk?: { status: 'ESTIMATED' | 'UNAVAILABLE' | 'NO_EXPOSURE'; horizon: '4H'; confidence: number;
    observations: number; varLoss: number | null; expectedShortfallLoss: number | null;
    worstObservedLoss: number | null; maxObservedLossPctEquity: number | null;
    correlatedPeers?: { minimumCorrelation: number; observations: number; holdings: Array<{
      instrument: string; weightedPeerValue: number; strongestPeer: { instrument: string; correlation: number } | null;
    }> } | null;
    effectiveHoldings: number | null; reason: string | null; note: string; authority: 'RESEARCH_ONLY' };
}

export function PaperStress() {
  const { data, error } = useApi<StressReport>('/api/risk/stress', { topics: ['position'], every: 20_000 });
  return <Card title="Paper portfolio stress" right={<Freshness at={data?.asOf} />}>
    <ErrorLine e={error} />
    {data ? <>
      <p className="muted">Baseline equity {data.baselineEquity === null ? 'unavailable' : fmt.num(data.baselineEquity) + ' USDT'}. {data.note}</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Scenario and assumptions</th><th>Coverage</th><th className="num">Loss</th><th className="num">Equity loss</th></tr></thead>
        <tbody>{data.scenarios.map(s => <tr key={s.id}>
          <td><b>{s.label}</b><div className="hint">{s.assumption}</div>
            {s.largestHolding && <div className="hint">{s.largestHolding.instrument.split(':').at(-1)} share of equity {fmt.num(s.largestHolding.baselineEquityPct)}% → {fmt.num(s.largestHolding.stressedEquityPct)}%</div>}
          </td>
          <td><Badge v={s.status.replaceAll('_', ' ')} />
            {s.reason && <div className="hint">{s.reason}</div>}
            {s.unpricedValue != null && s.unpricedValue > 0 && <div className="hint">{fmt.num(s.unpricedValue)} USDT unpriced</div>}
          </td>
          <td className="num">{s.loss === null ? '—' : fmt.num(s.loss)}</td>
          <td className="num">{s.equityLossPct === null ? '—' : fmt.num(s.equityLossPct) + '%'}</td>
        </tr>)}</tbody>
      </table></div>
      {data.tailRisk && <section aria-label="Historical 4-hour tail-risk research">
        <h3>Historical downside research (4 hours)</h3>
        <p className="muted">Research only — not a loss limit, trade authorization, or daily forecast. {data.tailRisk.note}</p>
        <p><Badge v={data.tailRisk.status.replaceAll('_', ' ')} />{' '}
          {data.tailRisk.status === 'ESTIMATED'
            ? `${Math.round(data.tailRisk.confidence * 100)}% empirical quantile from ${data.tailRisk.observations} aligned closed 4h returns`
            : `No numeric estimate: ${data.tailRisk.reason ?? data.tailRisk.status}`}</p>
        {data.tailRisk.status === 'ESTIMATED' && <div className="tablewrap"><table>
          <thead><tr><th>Historical metric</th><th className="num">USDT</th></tr></thead>
          <tbody>
            <tr><td>Historical value-at-risk (4h)</td><td className="num">{data.tailRisk.varLoss == null ? '—' : fmt.num(data.tailRisk.varLoss)}</td></tr>
            <tr><td>Expected shortfall (4h tail mean)</td><td className="num">{data.tailRisk.expectedShortfallLoss == null ? '—' : fmt.num(data.tailRisk.expectedShortfallLoss)}</td></tr>
            <tr><td>Worst observed 4h loss</td><td className="num">{data.tailRisk.worstObservedLoss == null ? '—' : fmt.num(data.tailRisk.worstObservedLoss)}</td></tr>
          </tbody>
        </table></div>}
      </section>}
      {data.tailRisk && 'correlatedPeers' in data.tailRisk && <section aria-label="Correlated paper holdings">
        <h3>Correlated paper holdings</h3>
        {data.tailRisk.correlatedPeers ? <>
          <p className="hint">Each row weights the marked value of other long holdings by their positive correlation above {data.tailRisk.correlatedPeers.minimumCorrelation}. The estimate uses {data.tailRisk.correlatedPeers.observations} aligned 4-hour log returns. Rows can include the same peer.</p>
          <div className="tablewrap"><table><thead><tr><th>Holding</th><th className="num">Weighted peer value (USDT)</th><th>Strongest qualifying peer</th></tr></thead>
            <tbody>{data.tailRisk.correlatedPeers.holdings.map(row => <tr key={row.instrument}>
              <td>{row.instrument}</td><td className="num">{fmt.num(row.weightedPeerValue)}</td>
              <td>{row.strongestPeer ? `${row.strongestPeer.instrument} (${fmt.num(row.strongestPeer.correlation, 2)})` : 'None'}</td>
            </tr>)}</tbody></table></div>
        </> : <p className="hint">{data.tailRisk.status === 'NO_EXPOSURE' ? 'No open paper holdings.' : 'Unknown. This estimate requires two marked holdings with sufficiently long, variable and aligned return histories.'}</p>}
      </section>}
    </> : <Empty>Loading paper stress estimates…</Empty>}
  </Card>;
}
