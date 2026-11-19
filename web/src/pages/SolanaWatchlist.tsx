import { fmt } from '../api';
import { Badge, Card, Empty, Freshness } from '../ui';

/** Shape of `discover().solanaHunter` (server/src/market/discover.ts). Read-only: no field can authorize a trade. */
export interface SolanaHunterView {
  asOf: number | null; stale: boolean; executionReady: false; note: string;
  candidates: Array<{
    mint: string; symbol: string; pairAddress: string; dex: string; ageMinutes: number | null; liquidityUsd: number;
    volume1hUsd: number; observedBuys1h: number; observedSells1h: number; momentum1hPct: number; rankScore: number;
    status: 'WATCH' | 'REJECT' | 'INSUFFICIENT_DATA'; blockers: string[]; notes: string[]; tradingEligible: false;
  }>;
}

const shortMint = (m: string) => (m.length > 12 ? `${m.slice(0, 5)}…${m.slice(-4)}` : m);

/**
 * Omega PR-01: read-only Solana watchlist from the existing DEX Screener cache. It never offers a buy action: MIA has
 * no Solana signer, and on-chain mint, holder, custody and sell-route checks are not verified yet.
 */
export function SolanaWatchlist({ view }: { view: SolanaHunterView | undefined }) {
  const rows = view?.candidates ?? [];
  return <Card flush title={`Solana watchlist · ${rows.length} candidate${rows.length === 1 ? '' : 's'}`} right={<Freshness at={view?.asOf ?? null} />}>
    <div className="banner info" style={{ margin: 12 }} role="note">
      <b>Watchlist only. Not a trade signal.</b> MIA cannot buy these tokens: no Solana signer exists and every row is
      marked not trading-eligible. Mint authority, holder distribution, pool custody and an executable sell route are
      <b> not verified</b> yet. The score only orders the list; it is <b>not</b> a probability of profit.
    </div>
    {view?.stale && <div className="banner stale" style={{ margin: "0 12px 12px" }} role="status">
      DEX Screener data is stale, missing or future-dated, so no candidates are shown.
    </div>}
    <div className="tablewrap"><table><thead><tr>
      <th>Token</th><th>DEX</th><th className="num">Age</th><th className="num">Liquidity</th><th className="num">Vol 1h</th>
      <th className="num">Buys / sells 1h</th><th className="num">1h</th><th className="num" title="Orders the watchlist only; not a probability">Watch order</th><th>Status</th><th>Why</th>
    </tr></thead><tbody>
      {rows.map((r) => <tr key={r.mint}>
        <td><b>{r.symbol}</b> <span className="faint mono" title={r.mint}>{shortMint(r.mint)}</span></td>
        <td>{r.dex}</td>
        <td className="num">{r.ageMinutes == null ? 'unknown' : `${fmt.num(r.ageMinutes, 0)} min`}</td>
        <td className="num">{fmt.big(r.liquidityUsd)}</td>
        <td className="num">{fmt.big(r.volume1hUsd)}</td>
        <td className="num">{r.observedBuys1h} / {r.observedSells1h}</td>
        <td className="num">{fmt.pct(r.momentum1hPct, 1)}</td>
        <td className="num">{fmt.num(r.rankScore, 0)}</td>
        <td><Badge v={r.status} /></td>
        <td className="hint">{r.blockers.length ? r.blockers.join(', ') : 'checks above not yet verified'}</td>
      </tr>)}
    </tbody></table>
    {!rows.length && <Empty>{view?.stale ? 'Waiting for fresh DEX Screener data…' : 'No Solana pairs in the current DEX Screener sample.'}</Empty>}</div>
    <div className="hint" style={{ padding: '8px 12px' }}>{view?.note}</div>
  </Card>;
}
