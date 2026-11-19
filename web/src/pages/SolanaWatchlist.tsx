import { fmt } from '../api';
import { Badge, Card, Empty, Freshness } from '../ui';

/** Shape of `discover().solanaHunter` (server/src/market/discover.ts `solanaWatchlist`). Read-only: no field can authorize a trade. */
export interface SolanaHunterView {
  /** Null until the DEX Screener cache has loaded once. */
  asOf: number | null; stale: boolean; executionReady: false; note: string;
  /** True when the ranker could not process the current sample; older servers omit it. */
  rankerFailed?: boolean;
  /** Solana pools left out because they are not quoted in SOL, USDC or USDT (their liquidity figure is not trusted). */
  skippedUntrustedQuote?: number;
  /** Omega PR-06: read-only on-chain mint checks. Absent on older servers. Never contains the RPC address. */
  mintChecks?: { configured: boolean; lastRunAt: number | null; lastError: string | null; checked: number };
  /** Omega 06a: opt-in Telegram alerts (Settings → Notifications). Absent on older servers. */
  alerts?: { enabled: boolean; lastRunAt: number | null; lastError: string | null };
  /** Omega PR-07: read-only Pump.fun launch/graduation feed from Solana. Absent on older servers. */
  pumpfun?: PumpFeedView;
  candidates: Array<{
    mint: string; symbol: string; pairAddress: string; dex: string; ageMinutes: number | null; liquidityUsd: number;
    volume1hUsd: number; observedBuys1h: number; observedSells1h: number; momentum1hPct: number; rankScore: number;
    status: 'WATCH' | 'REJECT' | 'INSUFFICIENT_DATA'; blockers: string[]; notes: string[]; tradingEligible: false;
    mintCheck?: MintCheckView;
  }>;
}
export interface PumpFeedView {
  enabled: boolean; connected: boolean; lastEventAt: number | null; reconnects: number; lastError: string | null; launchesSeen: number; graduationsSeen: number;
  launches: Array<{ signature: string; mint: string; creator: string; name: string; symbol: string; createdAt: number | null }>;
  graduations: Array<{ signature: string; mint: string; pool: string; graduatedAt: number | null }>;
}
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** Omega PR-07: what Pump.fun is launching and graduating right now, read from Solana. Display only: no actions. */
function PumpFunPanel({ feed }: { feed: PumpFeedView }) {
  if (!feed.enabled) return <div className="hint" style={{ padding: '8px 12px 0' }}>
    Pump.fun live feed: off. To turn it on, set MIA_PUMPFUN_FEED=1 on the server (it uses the Solana endpoint in MIA_SOLANA_RPC_URL).
  </div>;
  return <div style={{ padding: '8px 12px' }} aria-label="Pump.fun live feed">
    <div className="row between"><b>Pump.fun live (read-only, from Solana)</b>
      <span className="hint">{feed.connected ? 'connected' : 'disconnected'} · last event {feed.lastEventAt ? fmt.ago(feed.lastEventAt) : 'none yet'}{feed.lastError ? ` · ${feed.lastError}` : ''}</span></div>
    <div className="hint">New tokens sit on a bonding curve and are extremely risky; names are chosen by their creators. Graduated means the curve filled and liquidity moved to a PumpSwap pool. Not a trade signal.</div>
    <div className="grid g2" style={{ marginTop: 8 }}>
      <div className="tablewrap"><table><thead><tr><th>Latest launches</th><th>Mint</th><th>Creator</th><th className="num">When</th></tr></thead><tbody>
        {feed.launches.map((l) => <tr key={`${l.signature}:${l.mint}`}><td><b>{l.symbol}</b> <span className="faint">{l.name}</span></td>
          <td className="mono faint" style={{ fontSize: 11, wordBreak: 'break-all', userSelect: 'all' }}>{l.mint}</td>
          <td className="mono faint" title={l.creator}>{short(l.creator)}</td><td className="num">{l.createdAt ? fmt.ago(l.createdAt) : '—'}</td></tr>)}
      </tbody></table>{!feed.launches.length && <Empty>No launches seen since the server started.</Empty>}</div>
      <div className="tablewrap"><table><thead><tr><th>Latest graduations</th><th>PumpSwap pool</th><th className="num">When</th></tr></thead><tbody>
        {feed.graduations.map((g) => <tr key={`${g.signature}:${g.mint}`}><td className="mono faint" style={{ fontSize: 11, wordBreak: 'break-all', userSelect: 'all' }}>{g.mint}</td>
          <td className="mono faint" title={g.pool}>{short(g.pool)}</td><td className="num">{g.graduatedAt ? fmt.ago(g.graduatedAt) : '—'}</td></tr>)}
      </tbody></table>{!feed.graduations.length && <Empty>No graduations seen since the server started.</Empty>}</div>
    </div>
  </div>;
}

export interface MintCheckView {
  status: 'PASS_MINT_CHECKS_ONLY' | 'BLOCK' | 'UNKNOWN' | 'NOT_CHECKED';
  reasons: string[]; tokenProgram: string; slot: number | null; checkedAt: number | null;
}

/** One badge per row: what the on-chain mint check found. A pass is only "authorities revoked", never "safe". */
function MintCheckBadge({ c }: { c: MintCheckView | undefined }) {
  if (!c || c.status === 'NOT_CHECKED') return <Badge v="not checked" tone="b-neutral" title={c?.reasons.includes('STALE_CHECK') ? 'The last check is too old to count.' : undefined} />;
  const at = c.slot == null ? '' : ` at slot ${c.slot}`;
  if (c.status === 'BLOCK') return <Badge v="blocked" tone="b-bad" title={`${c.reasons.join(', ')}${at}`} />;
  if (c.status === 'UNKNOWN') return <Badge v="inconclusive" tone="b-warn" title={`${c.reasons.join(', ')}${at}`} />;
  return <Badge v="authorities revoked" tone="b-good" title={`Mint and freeze authority are revoked${at}. Mint-level checks only: not a safety verdict.`} />;
}

/** Why the table is empty, in plain words; never claims "no pairs" when the server did not say so. */
function emptyText(view: SolanaHunterView | undefined, loaded: boolean) {
  if (!loaded) return 'Loading…';
  if (!view) return 'This server does not report a Solana watchlist.';
  if (view.rankerFailed) return 'No candidates: the ranker could not process this DEX Screener sample.';
  if (view.stale) return 'Waiting for fresh DEX Screener data…';
  return 'No Solana pairs in the current DEX Screener sample.';
}

/**
 * Omega PR-01: read-only Solana watchlist from the existing DEX Screener cache. It never offers a buy action: MIA has
 * no Solana signer, and on-chain mint, holder, custody and sell-route checks are not verified yet. The full mint
 * address is shown (selectable) because tickers can be spoofed; the address is the token's identity.
 */
export function SolanaWatchlist({ view, loaded }: { view: SolanaHunterView | undefined; loaded: boolean }) {
  const rows = view?.candidates ?? [];
  return <Card flush title={`Solana watchlist · ${rows.length} candidate${rows.length === 1 ? '' : 's'}`} right={<Freshness at={view?.asOf ?? null} />}>
    <div className="banner info" style={{ margin: 12 }} role="note">
      <b>Watchlist only. Not a trade signal.</b> MIA cannot buy these tokens: no Solana signer exists and every row is
      marked not trading-eligible. {view?.mintChecks?.configured
        ? <>Mint and freeze authority are read on-chain (read-only); holder distribution, pool custody and an executable sell route are <b>not verified</b>.</>
        : <>Mint authority, holder distribution, pool custody and an executable sell route are <b>not verified</b> yet.</>}
      {' '}The score only orders the list; it is <b>not</b> a probability of profit. Tickers can be faked: compare the mint address.
    </div>
    {view?.mintChecks?.configured && view.mintChecks.lastError && <div className="banner stale" style={{ margin: '0 12px 12px' }} role="status">
      The last on-chain mint check failed ({view.mintChecks.lastError}). Rows without a current check show "not checked".
    </div>}
    {view?.stale && <div className="banner stale" style={{ margin: '0 12px 12px' }} role="status">
      DEX Screener data is stale, missing or future-dated, so no candidates are shown.
    </div>}
    {view?.rankerFailed && <div className="banner stale" style={{ margin: '0 12px 12px' }} role="status">
      The Solana ranker could not process the current DEX Screener sample, so no candidates are shown. Other Discover lists are unaffected.
    </div>}
    <div className="tablewrap"><table><thead><tr>
      <th>Token · mint</th><th>DEX</th><th className="num">Age</th><th className="num">Liquidity</th><th className="num">Vol 1h</th>
      <th className="num">Buys / sells 1h</th><th className="num">1h</th><th className="num" title="Orders the watchlist only; not a probability">Watch order</th><th>Status</th><th>Mint check</th><th>Why</th>
    </tr></thead><tbody>
      {rows.map((r) => <tr key={r.mint}>
        <td><b>{r.symbol}</b><div className="faint mono" style={{ fontSize: 11, wordBreak: 'break-all', userSelect: 'all' }}>{r.mint}</div></td>
        <td>{r.dex}</td>
        <td className="num">{r.ageMinutes == null ? 'unknown' : `${fmt.num(r.ageMinutes, 0)} min`}</td>
        <td className="num">{fmt.big(r.liquidityUsd)}</td>
        <td className="num">{fmt.big(r.volume1hUsd)}</td>
        <td className="num">{fmt.num(r.observedBuys1h, 0)} / {fmt.num(r.observedSells1h, 0)}</td>
        <td className="num">{fmt.pct(r.momentum1hPct, 1)}</td>
        <td className="num">{fmt.num(r.rankScore, 0)}</td>
        <td><Badge v={r.status} /></td>
        <td><MintCheckBadge c={r.mintCheck} /></td>
        {/* notes[0] is the ranker's fixed "not verified" disclaimer, already in the banner; later notes are row-specific. */}
        <td className="hint">{[...r.blockers, ...r.notes.slice(1)].join(', ') || 'checks above not yet verified'}</td>
      </tr>)}
    </tbody></table>
    {!rows.length && <Empty>{emptyText(view, loaded)}</Empty>}</div>
    {!!view?.skippedUntrustedQuote && <div className="hint" style={{ padding: '8px 12px 0' }}>
      {view.skippedUntrustedQuote} Solana pool{view.skippedUntrustedQuote === 1 ? '' : 's'} left out: priced against a token other than SOL, USDC or USDT, so the liquidity figure cannot be trusted.
    </div>}
    {view?.pumpfun && <PumpFunPanel feed={view.pumpfun} />}
    {view?.alerts && <div className="hint" style={{ padding: '8px 12px 0' }}>
      Telegram alerts: {view.alerts.enabled ? 'on' : 'off'} (Settings → Notifications){view.alerts.lastError ? ` · last run failed: ${view.alerts.lastError}` : ''}
    </div>}
    {view?.note && <div className="hint" style={{ padding: '8px 12px' }}>{view.note}</div>}
  </Card>;
}
