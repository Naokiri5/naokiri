/**
 * Trader Joe Live — deterministic narrator (M1). Fixed, versioned sentence templates over verified fields only.
 * No LLM is involved, so delivery of a financial event never waits for one and the text cannot invent facts.
 * Rules: every money line says SIMULATED PAPER; a fill is described only from a committed fill row; a stop is
 * "monitored", never "guaranteed"; a loss is not celebrated or blamed; missing values are shown as unknown.
 */
import type { JoeEventDraft, JoeEventKind, JoeState, JoeTradeEvent } from './events.js';

export const TEMPLATE_VERSION = 'joe-live-templates@1';

/** Provider-supplied symbols are untrusted text: only plain tickers are repeated, anything else is masked. */
export function safeSymbol(instrumentId: unknown) {
  const sym = typeof instrumentId === 'string' ? instrumentId.split(':').pop() ?? '' : '';
  return /^[A-Z0-9]{2,20}$/.test(sym) ? sym : 'an unrecognised instrument';
}
const usd = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}` : 'unknown');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toPrecision(8))) : 'unknown');
const str = (v: unknown, fallback = 'not recorded') => (typeof v === 'string' && v.trim() ? v.slice(0, 200) : fallback);

type Line = { joeState: JoeState; headline: string; text: string };
const TEMPLATES: Record<JoeEventKind, (f: JoeEventDraft['fields'], sym: string) => Line> = {
  DECISION_RECORDED: (f, s) => ({ joeState: 'EXPLAINING', headline: `Decision recorded for ${s}`, text: `MIA recorded a ${str(f.decision)} decision for ${s} (research/paper). This is an evidence review, not a promise of profit.` }),
  NO_TRADE: (f, s) => ({ joeState: 'EXPLAINING', headline: `No trade on ${s}`, text: `MIA did not trade ${s}: ${str(f.decision)}. Declining a weak or unverified setup is a normal outcome.` }),
  WAITING_FOR_CONFIRMATION: (_f, s) => ({ joeState: 'WAIT', headline: `Waiting on ${s}`, text: `Evidence for ${s} is incomplete or mixed, so MIA is waiting. No order was created.` }),
  RISK_DENIED: (f, s) => ({ joeState: 'RISK_DENIED', headline: `Risk gate blocked ${s}`, text: `The independent risk gate denied a paper entry on ${s}${f.reasons ? ` (${str(f.reasons)})` : ''}. No order was submitted. Joe cannot override this.` }),
  APPROVAL_PENDING: (f, s) => ({ joeState: 'APPROVAL', headline: `Paper entry waiting for your approval`, text: `A PAPER entry for ${num(f.qty)} ${s} is waiting for your approval. No order has been filled.` }),
  ORDER_REJECTED: (f, s) => ({ joeState: 'RISK_DENIED', headline: `Paper entry rejected for ${s}`, text: `The paper entry for ${s} was rejected: ${str(f.reason)}. Nothing was filled.` }),
  ORDER_CANCELLED: (f, s) => ({ joeState: 'EXPLAINING', headline: `Paper order cancelled for ${s}`, text: `The paper order for ${s} was cancelled${f.reason ? `: ${str(f.reason)}` : ''}. Nothing was filled.` }),
  ORDER_EXPIRED: (_f, s) => ({ joeState: 'EXPLAINING', headline: `Approval window expired for ${s}`, text: `The consensus behind the ${s} entry expired before approval, so the paper order lapsed. Nothing was filled.` }),
  PAPER_ENTRY_FILLED: (f, s) => ({ joeState: 'PAPER_FILLED', headline: `SIMULATED PAPER fill: bought ${s}`, text: `SIMULATED PAPER fill recorded: ${num(f.qty)} ${s} at ${usd(f.price)}, fee ${usd(f.fee)} (ledger cash ${usd(f.ledgerCash)}). Not a real exchange execution.` }),
  PAPER_EXIT_FILLED: (f, s) => ({ joeState: 'EXPLAINING', headline: `SIMULATED PAPER exit: sold ${s}`, text: `SIMULATED PAPER exit (${str(f.reason, 'exit')}): ${num(f.qty)} ${s} at ${usd(f.price)}, fee ${usd(f.fee)} (ledger cash ${usd(f.ledgerCash)}).` }),
  STOP_MONITORING_STARTED: (f, s) => ({
    joeState: f.stopStatus === 'ACTIVE' ? 'WATCHING' : 'EXPLAINING', headline: `Stop monitoring started for ${s}`,
    text: `MIA started monitoring a paper stop at ${usd(f.stopPrice)} for ${s}. ${f.stopStatus === 'ACTIVE' ? `It is still active, now at ${usd(f.currentStopPrice)}` : `This stop is no longer active (${str(f.stopStatus, 'status unknown')})`}. A stop is not guaranteed to fill at its exact price.`,
  }),
  PROTECTION_ISSUE: (f, s) => ({ joeState: 'DEGRADED', headline: `Protection problem on ${s}`, text: `Protection for the ${s} paper position could not be verified: ${str(f.reason)}. MIA keeps checking and you have been notified.` }),
  PROTECTION_RECOVERED: (_f, s) => ({ joeState: 'RECOVERED', headline: `Protection verified again for ${s}`, text: `MIA verified protection for ${s} again. The incident stays in the record for review.` }),
  POSITION_CLOSED: (f, s) => ({
    joeState: typeof f.netPnl === 'number' && f.netPnl < 0 ? 'LOSS_REVIEW' : 'EXPLAINING',
    headline: `SIMULATED PAPER position closed: ${s}`,
    text: `The ${s} paper position closed (${str(f.exitReason, 'exit')}). Net result after fees from the ledger: ${usd(f.netPnl)}${f.reconciled === false ? ' — ledger and position records disagree, review needed' : ''}. Past results do not predict future ones.`,
  }),
  TRADE_REVIEW_RECORDED: (f, s) => ({ joeState: typeof f.r === 'number' && f.r < 0 ? 'LOSS_REVIEW' : 'EXPLAINING', headline: `Trade review saved for ${s}`, text: `MIA saved a post-trade review for ${s} (${num(f.r)}R). A single outcome does not change strategy rules.` }),
  NEW_ORDERS_PAUSED: (f) => ({ joeState: 'HALTED', headline: 'New paper orders paused', text: `New risk-increasing paper orders are paused (by ${str(f.actor)}). Existing positions stay monitored. Only the owner can resume.` }),
  EMERGENCY_STOP: (f) => ({ joeState: 'HALTED', headline: 'Emergency stop active', text: `An emergency stop is active (by ${str(f.actor)}). New entries are blocked.` }),
  CONTROLS_CHANGED: (f) => ({ joeState: f.paused || f.emergency ? 'HALTED' : 'RECOVERED', headline: 'Execution controls changed', text: `Execution controls changed (by ${str(f.actor)}): new orders paused = ${f.paused ? 'yes' : 'no'}, emergency stop = ${f.emergency ? 'yes' : 'no'}.` }),
  TRADING_RESUMED: (f) => ({ joeState: 'RECOVERED', headline: 'Owner resumed paper trading', text: `The owner (${str(f.actor)}) lifted the pause. The risk gate still checks every new entry.` }),
};

export function narrate(d: JoeEventDraft): JoeTradeEvent {
  const line = TEMPLATES[d.kind](d.fields, safeSymbol(d.links.instrumentId));
  return { schemaVersion: 1, mode: 'PAPER', ...d, presentation: { templateId: d.kind.toLowerCase(), templateVersion: TEMPLATE_VERSION, ...line } };
}
