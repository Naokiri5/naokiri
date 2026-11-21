import type { CexActivityReport } from '../../../server/src/market/cexActivityTypes';
import { fmt } from '../api';
import { Card } from '../ui';

const explain = (value: string | null) => value?.toLowerCase().replaceAll('_', ' ');
const percent = (ratio: number | null) => ratio === null ? '—' : fmt.num(ratio * 100, 1) + '%';

export function CexActivity({ report }: { report?: CexActivityReport }) {
  if (!report) return null;
  const { volume, book, depthExhaustion } = report;
  return <Card title="Sense · Spot volume and liquidity">
    <div className="col" style={{ gap: 12 }}>
      <div className="tablewrap"><table>
        <caption>{report.source === 'binance' ? 'Binance closed-candle observations' : 'Spot observations'}</caption>
        <thead><tr><th>Window</th><th>Base volume</th><th>vs. prior median</th><th>vs. prior window</th><th>Taker buy − sell</th><th>Closed at</th></tr></thead>
        <tbody>{volume.map(row => <tr key={row.window}>
          <th scope="row">{row.window}</th>
          {row.status === 'AVAILABLE' ? <>
            <td>{fmt.num(row.baseVolume)} {report.baseAsset}</td>
            <td>{row.relativeToMedian === null ? 'Unavailable' : `${fmt.num(row.relativeToMedian)}× (${row.baselineWindows} windows)`}</td>
            <td>{fmt.pct(row.changeVsPreviousPct)}</td>
            <td>{row.aggressiveFlow ? <>{fmt.num(row.aggressiveFlow.deltaBase)} {report.baseAsset}<div className="hint">{row.aggressiveFlow.tradeCount ?? '—'} trades</div></> : 'Unavailable'}</td>
            <td>{fmt.time(row.closedAt)}</td>
          </> : <td colSpan={5}>Unavailable · {explain(row.reason)}</td>}
        </tr>)}</tbody>
      </table></div>
      {book.status === 'AVAILABLE' ? <>
        <div className="kv">
          <span>Spread</span><span>{fmt.num(book.spreadBps)} bps</span>
          <span>Book age</span><span>{fmt.num((book.quoteAgeMs ?? NaN) / 1000, 1)}s</span>
          <span>Bid / ask depth within 1%</span><span>{fmt.num(book.bidDepth1pctQuote)} / {fmt.num(book.askDepth1pctQuote)} {report.quoteAsset} · {percent(book.bidShare1pct)} bids</span>
          <span>Visible sell capacity within 1%</span><span>{fmt.num(book.exit.conservativeBaseCapacity, 4)} {report.baseAsset}</span>
        </div>
        <div className="tablewrap"><table>
          <caption>Estimated impact using the observed book</caption>
          <thead><tr><th>Side</th><th>Size ({report.quoteAsset})</th><th>Impact</th></tr></thead>
          <tbody>{book.impactCurve.map(row => <tr key={`${row.side}:${row.requestedQuote}`}>
            <td>{row.side}</td><td>{fmt.num(row.requestedQuote, 0)}</td>
            <td>{row.filledFully ? `${fmt.num(row.impactBps, 2)} bps` : 'Insufficient visible depth'}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="hint">Estimates use one book snapshot. Prices and visible size may change before an order reaches the venue.</div>
      </> : <div className="hint">Order-book estimates unavailable · {explain(book.reason)}</div>}
      {depthExhaustion?.status === 'MEASURED' ? <div className="col">
        <b>L2 exhaustion research</b>
        <div>{depthExhaustion.pressure === 'BID_DEPTH_AND_BUYING' ? 'Bid depth and taker buying aligned' :
          depthExhaustion.pressure === 'ASK_DEPTH_AND_SELLING' ? 'Ask depth and taker selling aligned' : 'Depth and taker flow did not meet the alignment threshold'}</div>
        <div className="kv">
          <span>Bid / ask depth within {depthExhaustion.bandBps} bps</span><span>{fmt.num(depthExhaustion.bidDepthQuote)} / {fmt.num(depthExhaustion.askDepthQuote)} {report.quoteAsset}</span>
          <span>3-second taker buy − sell</span><span>{fmt.num(depthExhaustion.takerDeltaQuote)} {report.quoteAsset} · {depthExhaustion.tradeCount} aggregate trades</span>
        </div>
        <div className="hint">The research threshold is {depthExhaustion.depthRatioThreshold}× opposing depth with taker flow in the same direction. {depthExhaustion.bookSource === 'BINANCE_SPOT_REST' ? 'REST' : 'Stream'} book update {depthExhaustion.bookUpdateId} at {fmt.time(depthExhaustion.bookAt)}. Flow window ended at {fmt.time(depthExhaustion.flowEndExclusive)}.</div>
      </div> : depthExhaustion && <div className="hint">L2 exhaustion research unavailable · {explain(depthExhaustion.reason)}</div>}
    </div>
  </Card>;
}
