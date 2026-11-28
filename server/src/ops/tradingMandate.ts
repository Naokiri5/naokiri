import { get } from '../db/db.js';
import { STRATEGIES } from '../lab/strategies.js';
import { market } from '../market/store.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { currentPolicy } from '../risk/policy.js';

/**
 * The owner's durable trading mandate (BrainOS master spec §6).
 *
 * A mandate only ever NARROWS what the canonical risk gate and paper OMS already allow. It never sizes a
 * position, never authorizes an entry by itself and never unlocks LIVE. It binds one session to:
 *  - exactly one market scope (FAST → Solana memecoins, DEEP → futures, SPOT_PAPER → Binance spot);
 *  - an authorized capital ceiling covering open cost basis plus net losses (fees included) realized under the
 *    mandate, enforced against the actual fill inside the OMS write transaction;
 *  - the risk policy and strategy set the owner reviewed when authorizing;
 *  - an expiry, after which new entries fail closed and the session drains.
 */
export const MARKET_SCOPES = ['BINANCE_SPOT', 'SOLANA_MEMECOIN', 'FUTURES'] as const;
export type MarketScope = (typeof MARKET_SCOPES)[number];
export type EntryScope = MarketScope | 'UNSUPPORTED';
export type SessionLane = 'SPOT_PAPER' | 'FAST' | 'DEEP';

/** Each session lane is bound to exactly one market scope. */
export const LANE_SCOPE: Readonly<Record<SessionLane, MarketScope>> = {
  SPOT_PAPER: 'BINANCE_SPOT', FAST: 'SOLANA_MEMECOIN', DEEP: 'FUTURES',
};

export const MANDATE_LIMITS = { minDurationHours: 1, maxDurationHours: 720 } as const;

export interface MandateRequest { capitalCeiling: number; durationHours: number }

export interface TradingMandate {
  market_scope: MarketScope;
  capital_ceiling: number;
  risk_policy_version: number;
  authorized_by: string;
  authorized_at: number;
  expires_at: number;
  strategy_config_version: string;
}
/** Mandate columns as persisted on `brainos_sessions`. All are null on sessions created before migration 7. */
export type MandateColumns = { [K in keyof TradingMandate]: TradingMandate[K] | null };
export const NO_MANDATE: MandateColumns = {
  market_scope: null, capital_ceiling: null, risk_policy_version: null, authorized_by: null,
  authorized_at: null, expires_at: null, strategy_config_version: null,
};

/** Rejected owner input. The API maps `statusCode` to an HTTP 400 without exposing internals. */
export class MandateError extends Error {
  readonly statusCode = 400;
}

/** The deployed strategy set, e.g. `donchian_breakout@1.0.0,trend_pullback@1.0.0`. */
export function strategyConfigVersion() {
  return STRATEGIES.map((strategy) => `${strategy.id}@${strategy.version}`).sort().join(',');
}

/** Classifies an entry's market from the decision report and the canonical instrument registry. */
export function classifyEntryScope(entry: { instrumentId: string; market: string; venue: string }): EntryScope {
  const instrument = market.instruments.get(entry.instrumentId);
  if (entry.market === 'crypto' && entry.venue === 'binance' && instrument?.market === 'crypto' &&
      instrument.venue === 'binance' && entry.instrumentId === `crypto:binance:${instrument.symbol}`) return 'BINANCE_SPOT';
  if (entry.market === 'crypto-dex' && (entry.venue === 'solana' || entry.instrumentId.startsWith('solana:'))) return 'SOLANA_MEMECOIN';
  if (/futures|perpetual|perp/i.test(entry.market) || /usdm|futures|perp/i.test(entry.venue)) return 'FUTURES';
  return 'UNSUPPORTED';
}

/** Validates the owner's request against the current paper funds and the accepted risk policy. */
export function buildMandate(
  lane: SessionLane, request: MandateRequest, context: { at: number; availableCash: number; authorizedBy: string },
): TradingMandate {
  const { capitalCeiling, durationHours } = request;
  const { at, availableCash, authorizedBy } = context;
  const policy = currentPolicy();
  if (!policy) throw new MandateError('MANDATE_RISK_POLICY_REQUIRED: accept a risk policy before authorizing a session');
  if (!Number.isFinite(capitalCeiling) || capitalCeiling <= 0)
    throw new MandateError('MANDATE_CAPITAL_INVALID: authorized capital must be a positive amount');
  if (!Number.isFinite(availableCash) || capitalCeiling > availableCash + 1e-9)
    throw new MandateError('MANDATE_CAPITAL_EXCEEDS_FUNDS: authorized capital cannot exceed available paper cash');
  if (!Number.isInteger(durationHours) || durationHours < MANDATE_LIMITS.minDurationHours ||
      durationHours > MANDATE_LIMITS.maxDurationHours)
    throw new MandateError(`MANDATE_DURATION_INVALID: choose ${MANDATE_LIMITS.minDurationHours}–${MANDATE_LIMITS.maxDurationHours} hours`);
  if (!Number.isSafeInteger(at) || at <= 0) throw new MandateError('MANDATE_CLOCK_INVALID');
  return {
    market_scope: LANE_SCOPE[lane],
    capital_ceiling: capitalCeiling,
    risk_policy_version: policy.version,
    authorized_by: authorizedBy,
    authorized_at: at,
    expires_at: at + durationHours * 3_600_000,
    strategy_config_version: strategyConfigVersion(),
  };
}

function completeMandate(columns: MandateColumns): TradingMandate | null {
  const { market_scope: scope, capital_ceiling: ceiling, risk_policy_version: policy, authorized_by: by,
    authorized_at: authorizedAt, expires_at: expiresAt, strategy_config_version: strategies } = columns;
  if (!scope || !(MARKET_SCOPES as readonly string[]).includes(scope)) return null;
  if (ceiling === null || !Number.isFinite(ceiling) || ceiling <= 0) return null;
  if (policy === null || !Number.isSafeInteger(policy) || !by || !strategies) return null;
  if (authorizedAt === null || expiresAt === null || !Number.isSafeInteger(authorizedAt) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= authorizedAt) return null;
  return columns as TradingMandate;
}

/** Read-only view of a session's mandate; null when absent or malformed. */
export const sessionMandate = (columns: MandateColumns) => completeMandate(columns);

/**
 * Entry-time mandate verdict. `entry` is omitted for status checks that do not concern a specific order.
 * Returns a stable denial code or null. Missing, malformed, expired or outdated mandates fail closed.
 */
export function mandateEntryDenial(
  session: MandateColumns & { environment: string; mind: string; started_at: number | null },
  at: number,
  entry?: { scope: EntryScope; strategy: { id: string; version: string } | undefined },
): string | null {
  if (session.environment !== 'PAPER') return 'SESSION_ENVIRONMENT_NOT_PAPER';
  const mandate = completeMandate(session);
  if (!mandate) return 'SESSION_MANDATE_MISSING';
  // A mandate authorizes only the session it was granted with; any reopen (by any code version) sets a new start.
  if (session.started_at !== mandate.authorized_at) return 'SESSION_MANDATE_NOT_BOUND';
  const laneScope = (LANE_SCOPE as Record<string, MarketScope | undefined>)[session.mind];
  if (!laneScope || mandate.market_scope !== laneScope) return 'SESSION_MANDATE_SCOPE_INVALID';
  if (!Number.isFinite(at) || at < mandate.authorized_at) return 'SESSION_MANDATE_CLOCK_INVALID';
  if (at >= mandate.expires_at) return 'SESSION_MANDATE_EXPIRED';
  if (currentPolicy()?.version !== mandate.risk_policy_version) return 'SESSION_RISK_POLICY_CHANGED';
  if (mandate.strategy_config_version !== strategyConfigVersion()) return 'SESSION_STRATEGY_CONFIG_CHANGED';
  if (!entry) return null;
  if (entry.scope !== mandate.market_scope) return `MARKET_OUTSIDE_SESSION_MANDATE: ${entry.scope} entry in a ${mandate.market_scope} session`;
  if (!entry.strategy || !mandate.strategy_config_version.split(',').includes(`${entry.strategy.id}@${entry.strategy.version}`))
    return 'SESSION_STRATEGY_OUTSIDE_MANDATE';
  return null;
}

/** Cost basis still open in the paper account. Conservative: it includes positions opened before the session. */
export function openPaperExposure(): number {
  return get<{ exposure: number | null }>(
    `SELECT SUM(qty * entry_price) exposure FROM positions WHERE account=? AND status='OPEN'`, PAPER_ACCOUNT,
  )?.exposure ?? 0;
}

/** Net realized result, fees included, of every position opened since `since` (open or closed). */
export function realizedNetSince(since: number): number {
  return get<{ net: number | null }>(
    'SELECT SUM(realized_pnl) net FROM positions WHERE account=? AND opened_at>=?', PAPER_ACCOUNT, since,
  )?.net ?? 0;
}

/**
 * Capital the mandate has consumed: all open cost basis plus net losses realized by positions opened under it.
 * Gains offset losses, so a profitable session can redeploy them; losses can never exceed the ceiling.
 */
export function mandateCapitalInUse(mandate: TradingMandate) {
  const openExposure = openPaperExposure();
  const realizedLoss = Math.max(0, -realizedNetSince(mandate.authorized_at));
  return { openExposure, realizedLoss, capitalInUse: openExposure + realizedLoss };
}

/**
 * Capital ceiling check for an entry whose actual cost (fill notional + fees) is known. Call it inside the OMS
 * write transaction so concurrent entries cannot jointly exceed the authorized capital.
 */
export function mandateCapitalDenial(columns: MandateColumns, entryCost: number): string | null {
  const mandate = completeMandate(columns);
  if (!mandate) return 'SESSION_MANDATE_MISSING';
  const { openExposure, realizedLoss, capitalInUse } = mandateCapitalInUse(mandate);
  if (!Number.isFinite(capitalInUse) || openExposure < 0 || !Number.isFinite(entryCost) || entryCost <= 0)
    return 'MANDATE_CAPITAL_UNVERIFIABLE';
  if (capitalInUse + entryCost > mandate.capital_ceiling + 1e-9) {
    return `MANDATE_CAPITAL_CEILING: open ${openExposure.toFixed(2)} + realized loss ${realizedLoss.toFixed(2)} + entry ${entryCost.toFixed(2)} exceeds authorized ${mandate.capital_ceiling.toFixed(2)}`;
  }
  return null;
}
