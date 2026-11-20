import { useState } from 'react';
import { api } from '../api';
import { Action, Card, Empty } from '../ui';

interface FilingReport {
  cik: string;
  filings: Array<{
    accessionNumber: string;
    form: string;
    filingDate: string;
    reportDate: string | null;
    acceptedAt: string;
    items: string[];
    sourceUrl: string;
  }>;
  note: string;
}

export function SecFilings() {
  const [cik, setCik] = useState('');
  const [report, setReport] = useState<FilingReport | null>(null);
  const lookup = cik.trim();

  return <Card title="SEC EDGAR filings">
    <div className="row">
      <label className="row">Company CIK <input inputMode="numeric" value={cik} maxLength={10} onChange={e => setCik(e.target.value)} /></label>
      <Action label="Find filings" disabled={!/^\d{1,10}$/.test(lookup) || !/[1-9]/.test(lookup)} run={async () => {
        setReport(null);
        setReport(await api<FilingReport>(`/api/research/filings/${lookup}`));
      }} />
    </div>
    {report && <>
      <p className="muted">CIK {report.cik}. {report.note}</p>
      {report.filings.length ? <div className="tablewrap"><table>
        <thead><tr><th>Form</th><th>Accepted (UTC)</th><th>Filing date</th><th>Report period end</th><th>Reported items</th></tr></thead>
        <tbody>{report.filings.map(row => <tr key={row.accessionNumber}>
          <td><a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.form}</a></td>
          <td><time dateTime={row.acceptedAt}>{row.acceptedAt}</time></td>
          <td>{row.filingDate}</td><td>{row.reportDate ?? '—'}</td><td>{row.items.join(', ') || '—'}</td>
        </tr>)}</tbody>
      </table></div> : <Empty>No matching recent SEC filings.</Empty>}
    </>}
  </Card>;
}
