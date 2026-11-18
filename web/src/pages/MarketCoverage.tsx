import { useApi } from '../api';
import { Badge, Card, Empty, ErrorLine } from '../ui';

interface Clock {
  local: string;
  timeZone: string;
  offset: string;
}

interface Coverage {
  asOf: number;
  displayClock: Clock;
  clocks: Array<Clock & { location: string }>;
  utcAnalysisSession: { label: string; startHourUtc: number; endHourUtc: number };
  markets: Array<{
    market: string;
    coverage: string;
    schedule: string;
    sources: Array<{ id: string; name: string; status: string }>;
  }>;
}

const hour = (value: number) => String(value).padStart(2, '0') + ':00';

export function MarketCoverage() {
  const { data, error } = useApi<Coverage>('/api/markets/coverage', { every: 30_000 });
  return <>
    <ErrorLine e={error} />
    {data ? <div className="col" style={{ gap: 14 }}>
      <Card title="Market data coverage" flush>
        <div className="tablewrap"><table>
          <thead><tr><th>Market</th><th>Data coverage</th><th>Schedule</th><th>Provider status</th></tr></thead>
          <tbody>{data.markets.map(row => <tr key={row.market}>
            <td>{row.market}</td><td>{row.coverage}</td><td>{row.schedule}</td>
            <td>{row.sources.length ? row.sources.map(source => <div key={source.id}>{source.name} <Badge v={source.status} /></div>) : 'Unavailable'}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Market clocks">
        <div className="row">
          <b>{data.displayClock.local} {data.displayClock.timeZone}</b>
          <span className="hint">Observed at {new Date(data.asOf).toISOString()}</span>
        </div>
        <p className="muted">Crypto research session {data.utcAnalysisSession.label}, {hour(data.utcAnalysisSession.startHourUtc)}–{hour(data.utcAnalysisSession.endHourUtc)} UTC</p>
        <div className="tablewrap"><table><thead><tr><th>Location</th><th>Local time</th><th>UTC offset</th></tr></thead>
          <tbody>{data.clocks.map(c => <tr key={c.timeZone}><td>{c.location}</td><td>{c.local}</td><td>{c.offset}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </div> : <Empty>Loading market coverage…</Empty>}
  </>;
}
