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
    </> : <Empty>Loading paper stress estimates…</Empty>}
  </Card>;
}
