/**
 * Paper/Testnet/Live parity contract (skill `mia-vike-parity`). ONE order lifecycle, two environments that share command,
 * state and reporting TYPES but never credentials, executions, balances or financial records.
 *
 *  - PaperExecutionAdapter: a thin wrapper around the existing paper OMS (exec/oms.ts). No logic is copied; Paper
 *    behaviour and its tests are unchanged.
 *  - TestnetPreflightAdapter: signed virtual-account and non-executing order-validation diagnostics only.
 *  - LockedLiveExecutionAdapter: refuses EVERY command. Live trading does not exist in this build (no venue adapter,
 *    no isolated signer; LIVE_EXECUTION_AVAILABLE = false and release gates G07/G08/G12-G14 never pass).
 *
 * A future Live adapter needs, before it may replace the locked one: typed account isolation in every query and
 * ledger row, durable reservations, venue client-order-id reconciliation, partial-fill states, verified protective
 * stops, trade-only credentials, Live release tests, per-account strategy enrollment and explicit owner approval.
 * A deposit only changes a balance; it never unlocks Live or raises risk limits.
 */
import type { DecisionReport } from '../decision/engine.js';
import { submitEntry, closePosition, VENUE } from './oms.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { LIVE_EXECUTION_AVAILABLE, getControl } from '../core/mode.js';
import { testnetConfiguration } from './venues/binanceTestnet.js';

export type TradingEnvironment = 'PAPER' | 'TESTNET' | 'LIVE';
export interface TradingAccountRef { ownerId: string; accountId: string; environment: TradingEnvironment; venueId: string }
export type EnvironmentAvailability = 'ACTIVE' | 'AVAILABLE' | 'LOCKED';
export interface ExecutionResult { ok: boolean; environment: TradingEnvironment; orderId?: string; positionId?: string; reason?: string }

export interface ExecutionAdapter {
  readonly account: TradingAccountRef;
  availability(): { state: EnvironmentAvailability; reasons: string[] };
  submitEntry(report: DecisionReport, actor: 'bot' | 'owner'): ExecutionResult;
  closePosition(actor: string, positionId: string): ExecutionResult;
}

export class LiveLockedError extends Error { readonly code = 'LIVE_LOCKED'; }

export const PAPER_ACCOUNT_REF: TradingAccountRef = Object.freeze({ ownerId: 'owner', accountId: PAPER_ACCOUNT, environment: 'PAPER', venueId: VENUE });
export const TESTNET_ACCOUNT_REF: TradingAccountRef = Object.freeze({ ownerId: 'owner', accountId: 'binance-spot-testnet', environment: 'TESTNET', venueId: 'binance-spot-testnet' });
export const LIVE_ACCOUNT_REF: TradingAccountRef = Object.freeze({ ownerId: 'owner', accountId: 'live-unconfigured', environment: 'LIVE', venueId: 'none' });

/** Wraps the canonical paper OMS. Every result is labelled PAPER so no caller can mistake a simulated fill. */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly account = PAPER_ACCOUNT_REF;
  availability() {
    const c = getControl();
    const active = (c.mode === 'PAPER' || c.mode === 'APPROVAL') && !c.emergency && !c.pausedNewOrders;
    return { state: (active ? 'ACTIVE' : 'AVAILABLE') as EnvironmentAvailability, reasons: active ? [] : [`mode ${c.mode}${c.emergency ? ', emergency stop' : ''}${c.pausedNewOrders ? ', new orders paused' : ''}`] };
  }
  submitEntry(report: DecisionReport, actor: 'bot' | 'owner'): ExecutionResult { return { environment: 'PAPER', ...submitEntry(report, actor) }; }
  closePosition(actor: string, positionId: string): ExecutionResult {
    const r = closePosition(actor, positionId); // throws OmsError on refusal, exactly as before
    return { ok: !!r, environment: 'PAPER', positionId };
  }
}

/**
 * TESTNET has an isolated signed preflight client, but no certified durable
 * order/fill/protection lifecycle yet. The normal execution adapter must
 * therefore refuse both submitEntry() and closePosition(). Validation via the
 * dedicated preflight route is NOT a trade.
 */
export class TestnetPreflightAdapter implements ExecutionAdapter {
  readonly account = TESTNET_ACCOUNT_REF;
  availability() {
    const status = testnetConfiguration();
    return { state: 'LOCKED' as EnvironmentAvailability, reasons: [
      status.configured ? 'signed testnet preflight is configured' : 'testnet API credentials not configured',
      'real testnet orders blocked until durable exchange order state, reconciliation and protective-stop verification are certified',
      'paper and live credentials, orders and balances remain separate',
    ] };
  }
  submitEntry(): ExecutionResult { throw new LiveLockedError('TESTNET_EXECUTION_LOCKED: /api/v3/order/test is validation only, no order sent'); }
  closePosition(): ExecutionResult { throw new LiveLockedError('TESTNET_EXECUTION_LOCKED: no owned testnet positions to close'); }
}

/** Live is LOCKED: every command is refused and nothing touches a venue, a signer or a balance. */
export class LockedLiveExecutionAdapter implements ExecutionAdapter {
  readonly account = LIVE_ACCOUNT_REF;
  availability() {
    return { state: 'LOCKED' as EnvironmentAvailability, reasons: [
      'NOT_CERTIFIED: no live venue adapter or isolated signer exists in this build',
      'release gates G07/G08/G12-G14 are not implemented',
      'requires explicit owner enrollment and a separately reviewed live build',
    ] };
  }
  submitEntry(): ExecutionResult { throw new LiveLockedError('Live execution is LOCKED (NOT_CERTIFIED): no order was sent'); }
  closePosition(): ExecutionResult { throw new LiveLockedError('Live execution is LOCKED (NOT_CERTIFIED): there are no live positions'); }
}

/** The only way to obtain an adapter. LIVE always yields the locked adapter while LIVE_EXECUTION_AVAILABLE is false. */
export function executionAdapter(environment: TradingEnvironment): ExecutionAdapter {
  if (environment === 'PAPER') return new PaperExecutionAdapter();
  if (environment === 'TESTNET') return new TestnetPreflightAdapter();
  if (environment === 'LIVE') { if (LIVE_EXECUTION_AVAILABLE) throw new Error('live build detected without a reviewed live adapter'); return new LockedLiveExecutionAdapter(); }
  throw new Error(`unknown trading environment ${String(environment)}`);
}

/** Read-only overview for the UI: the same layout for both environments, with Live shown truthfully as LOCKED. */
export function environmentsOverview() {
  return (['PAPER', 'TESTNET', 'LIVE'] as const).map((e) => { const a = executionAdapter(e); return { environment: e, account: a.account, ...a.availability() }; });
}
