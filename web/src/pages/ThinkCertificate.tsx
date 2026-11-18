import { fmt, useApi } from '../api';
import { Badge, Card, Empty, ErrorLine } from '../ui';

/**
 * THINK Reason-to-Trade Certificate: a read-only explanation of one stored decision (server: decision/certificate.ts).
 * It cannot approve or place anything. Scenario values are hypothetical; the win probability stays "no valid forecast"
 * until a calibrated out-of-sample cohort exists.
 */
const REASON_TEXT: Record<string, string> = {
  STALE_OR_MISSING_MARKET_DATA: 'Market data was stale or missing', INSUFFICIENT_DATA: 'Not enough data to decide',
  ASSET_NOT_ELIGIBLE: 'Asset failed the safety/eligibility check', INSUFFICIENT_LIQUIDITY: 'Not enough executable liquidity',
  QCI_VETO: 'A worker vetoed the idea', QCI_NO_QUORUM: 'Too little independent evidence (no quorum)', QCI_MIXED_EVIDENCE: 'Evidence was mixed',
  CONSENSUS_EXPIRED: 'Consensus expired before use', REQUIRED_DOMAIN_MISSING: 'A required evidence area had no data',
  BELOW_OPPORTUNITY_THRESHOLD: 'Opportunity score below the policy minimum', OBSERVE_MODE: 'MIA is in observe mode',
  RISK_DENIED: 'Independent risk gate denied it', NEEDS_OWNER_REVIEW: 'Risk gate asked for owner review', COSTS_TOO_HIGH: 'Fees and slippage too high for the risk',
  NEGATIVE_OUT_OF_SAMPLE_EXPECTANCY: 'Strategy lost money out of sample', NO_POSITIVE_EDGE_LOWER_BOUND: 'No edge after uncertainty',
};

export function ThinkCertificateView({ decisionId }: { decisionId: string }) {
  const { data: c, error } = useApi<any>(`/api/decisions/${decisionId}/certificate`);
  if (error) return <ErrorLine e={error} />;
  if (!c) return <Empty>Loading certificate…</Empty>;
  const sc = c.scenarios;
  return <div className="col" style={{ gap: 14 }}>
    <div className="banner info" style={{ marginBottom: 0 }}>{c.disclaimer} This certificate cannot approve or place a trade: the independent risk gate decides and only the paper OMS executes.</div>
    <div className="grid g2">
      <Card title="Verdict" right={<Badge v={c.verdict.finalDecision} />}>
        {c.verdict.tradeTaken ? <span>MIA proposed a paper trade.</span> : c.verdict.noTradeReasons.length
          ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.verdict.noTradeReasons.map((r: string) => <li key={r}><b>{REASON_TEXT[r] ?? r}</b> <span className="faint mono">{r}</span></li>)}</ul>
          : <span className="muted">No trade (monitoring only).</span>}
        {c.verdict.riskReasonCodes.length > 0 && <div className="hint" style={{ marginTop: 8 }}>Risk gate: {c.verdict.riskReasonCodes.join('; ')}</div>}
      </Card>
      <Card title="Calibration status">
        <div className="kv">
          <span>Opportunity score</span><span className="mono">{c.calibration.opportunityScore.value} <span className="faint">heuristic, not a probability</span></span>
          <span>Consensus</span><span><Badge v={c.calibration.consensus} /></span>
          <span>Win probability</span><span><Badge v="NO VALID FORECAST" tone="b-neutral" title={c.calibration.expectancy.reason} /></span>
          <span>Expected value</span><span className="muted">{c.calibration.expectancy.status === 'ESTIMATED' ? `${c.calibration.expectancy.expectedR}R (${c.calibration.expectancy.expectedRLower}…${c.calibration.expectancy.expectedRUpper})` : 'not estimated without a calibrated cohort'}</span>
        </div>
      </Card>
    </div>
    <Card flush title="Hypothetical outcomes (not predictions)" right={<span className="faint">fees {fmt.num(sc.costAssumptions.feeRatePerSide * 1e4, 1)} bps/side · spread {fmt.num(sc.costAssumptions.spreadBps, 1)} bps · slippage {fmt.num(sc.costAssumptions.slippageBps, 1)} bps</span>}>
      {!sc.valid ? <Empty>{sc.invalidReason}</Empty> : <div className="tablewrap"><table><thead><tr><th>Scenario</th><th className="num">Exit</th><th className="num">Net per unit</th><th className="num">Net R</th><th className="num">Net USD</th></tr></thead>
        <tbody>{sc.scenarios.map((s: any) => <tr key={s.id}><td>{s.description}</td><td className="num mono">{fmt.px(s.exitPrice)}</td><td className="num mono">{fmt.num(s.netPerUnit, 4)}</td><td className="num mono">{fmt.num(s.netR, 2)}R</td><td className="num mono">{s.netUsd == null ? '—' : fmt.usd(s.netUsd)}</td></tr>)}</tbody></table>
        <div className="hint" style={{ padding: '8px 12px' }}>Break-even exit {fmt.px(sc.breakEvenExit)}{sc.maxPlannedLossUsd != null && <> · planned max loss {fmt.usd(sc.maxPlannedLossUsd)} · worst stress {fmt.usd(sc.worstStressUsd)}</>}. {sc.caveats.join(' ')}</div></div>}
    </Card>
    <div className="grid g2">
      <Card title="Bull case">{c.bullCase.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.bullCase.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : <span className="muted">none recorded</span>}</Card>
      <Card title="Bear case and vetoes">{c.bearCase.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{c.bearCase.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : <span className="muted">none recorded</span>}</Card>
    </div>
    <div className="grid g2">
      <Card title="Evidence coverage">
        {c.coverage.workers ? <div className="kv"><span>Workers</span><span className="mono">{c.coverage.workers.responding}/{c.coverage.workers.eligible} responded · {c.coverage.workers.abstaining} abstained · {c.coverage.workers.failed} failed · {c.coverage.workers.quarantined} quarantined</span>
          <span>Independent groups</span><span className="mono">{c.coverage.dependencyGroups}</span>
          <span>Required areas missing</span><span>{c.coverage.requiredDomainsMissing.length ? c.coverage.requiredDomainsMissing.map((d: string) => <Badge key={d} v={d} tone="b-warn" />) : <span className="muted">none</span>}</span></div>
          : <span className="muted">Consensus record not found: coverage could not be verified.</span>}
      </Card>
      <Card title="Uncertainty and provenance">
        <ul style={{ margin: 0, paddingLeft: 18 }}>{c.uncertainty.map((x: string, i: number) => <li key={i} className="muted">{x}</li>)}</ul>
        <div className="hint mono" style={{ marginTop: 8, wordBreak: 'break-all' }}>{c.version} · report sha256 {c.provenance.reportSha256.slice(0, 16)}… · consensus {c.provenance.consensusSha256 ? `${c.provenance.consensusSha256.slice(0, 16)}…` : 'missing'} · as of {fmt.time(c.asOf)}</div>
      </Card>
    </div>
  </div>;
}
