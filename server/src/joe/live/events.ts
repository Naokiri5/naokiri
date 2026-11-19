/**
 * Trader Joe Live (V4, milestone M1) — typed trade-lifecycle events.
 *
 * These events are a READ-ONLY projection of records MIA has already committed (decisions, orders, fills, ledger
 * entries, positions, protection incidents, audit log). Joe narrates them; he never creates, changes or authorizes
 * anything. Only kinds that the current PAPER OMS can really produce are emittable. Partial and unknown-order states
 * are RESERVED: the paper OMS fills all-or-nothing, so those kinds belong to a future, separately certified adapter.
 */
import { z } from 'zod';

export const JOE_EVENT_KINDS = [
  'DECISION_RECORDED', 'NO_TRADE', 'WAITING_FOR_CONFIRMATION', 'RISK_DENIED',
  'APPROVAL_PENDING', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'ORDER_EXPIRED',
  'PAPER_ENTRY_FILLED', 'PAPER_EXIT_FILLED', 'STOP_MONITORING_STARTED',
  'PROTECTION_ISSUE', 'PROTECTION_RECOVERED', 'POSITION_CLOSED', 'TRADE_REVIEW_RECORDED',
  'NEW_ORDERS_PAUSED', 'EMERGENCY_STOP', 'TRADING_RESUMED', 'CONTROLS_CHANGED',
] as const;
/** Not emittable in this build: the paper OMS has no partial fills or unknown order states. */
export const RESERVED_JOE_EVENT_KINDS = ['ORDER_PARTIAL', 'ORDER_UNKNOWN'] as const;

export const JOE_STATES = ['IDLE', 'SCANNING', 'THINKING', 'EXPLAINING', 'WAIT', 'APPROVAL', 'PAPER_FILLED', 'WATCHING',
  'RISK_DENIED', 'LOSS_REVIEW', 'DEGRADED', 'HALTED', 'RECOVERED'] as const;

const Scalar = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);

export const JoeTradeEvent = z.object({
  schemaVersion: z.literal(1),
  /** Stable id `<source facet>:<record id>`: the same committed record always yields the same id (dedupe key). */
  eventId: z.string().regex(/^[a-z.]+:[A-Za-z0-9_:\-]+$/).max(200),
  kind: z.enum(JOE_EVENT_KINDS),
  /** Always PAPER in this build. LIVE is not a usable mode. */
  mode: z.literal('PAPER'),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  occurredAt: z.number().int().nonnegative(),
  source: z.object({ service: z.string().max(60), table: z.string().max(60), recordId: z.string().max(120) }).strict(),
  links: z.object({
    decisionId: z.string().max(120).optional(), orderId: z.string().max(120).optional(),
    positionId: z.string().max(120).optional(), instrumentId: z.string().max(120).optional(),
  }).strict(),
  /** Facts copied from committed records. Money comes from ledger rows; nothing here is estimated by Joe. */
  fields: z.record(z.string().max(60), Scalar),
  presentation: z.object({
    templateId: z.string().max(60), templateVersion: z.string().max(20), joeState: z.enum(JOE_STATES),
    headline: z.string().max(200), text: z.string().max(600),
  }).strict(),
}).strict();
export type JoeTradeEvent = z.infer<typeof JoeTradeEvent>;
export type JoeEventKind = (typeof JOE_EVENT_KINDS)[number];
export type JoeState = (typeof JOE_STATES)[number];

/** Draft before narration: everything except the presentation block. */
export type JoeEventDraft = Omit<JoeTradeEvent, 'schemaVersion' | 'mode' | 'presentation'>;
