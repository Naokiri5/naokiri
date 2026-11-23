/**
 * MIA NEXUS versioned event envelope.
 *
 * Shape follows the owner's NEXUS Ω V3 spec (V3-04.3), CloudEvents-inspired naming. This file only DESCRIBES and
 * VALIDATES events; it creates no tables, changes no producer and has no authority. In particular an event is a
 * record ABOUT committed state: it never replaces the OMS, ledger, DITAS or audit log as the source of truth.
 */
import { z } from 'zod';
import { sha256 } from '../core/util.js';
import { topicSpec } from './catalog.js';

export const SOURCE_CLASSES = ['MARKET', 'PROVIDER', 'STRATEGY', 'QMC', 'QCI', 'RISK', 'OMS', 'LEDGER', 'DITAS', 'SYSTEM'] as const;
export const DATA_STATUSES = ['VERIFIED', 'DEGRADED', 'UNVERIFIED', 'MISSING'] as const;
export const ACCESS_CLASSES = ['PUBLIC_MARKET', 'OWNER_PRIVATE', 'SYSTEM_RESTRICTED'] as const;

const ISO = z.string().datetime({ offset: false }); // ISO-8601 UTC ('Z') only, normalised at the boundary
const ID = z.string().min(1).max(128).regex(/^[A-Za-z0-9:_.\-]+$/);
/** DITAS snapshot ids are content addresses (`snap_<sha256>`); the fabric references them, never copies market data. */
const SNAPSHOT_ID = z.string().regex(/^snap_[0-9a-f]{64}$/);

/** Keys that must never appear anywhere in an event payload (secrets stay out of the fabric; F13). */
const FORBIDDEN_KEY = /^(password|passphrase|otp|secret|apiKey|api_key|apiSecret|privateKey|private_key|mnemonic|seed|accessToken|refreshToken|token|authorization|cookie)$/i;

export const FabricEventV1 = z.object({
  schemaVersion: z.literal('fabric.event.v1'),
  eventId: ID,
  eventType: z.string().regex(/^[a-z]+(\.[a-z]+)+\.v\d+$/),
  source: ID,
  sourceClass: z.enum(SOURCE_CLASSES),
  assetId: ID.optional(),
  instrumentId: ID.optional(),
  traceId: ID,
  correlationId: ID.optional(),
  causationId: ID.optional(),
  occurredAt: ISO.nullable(),
  receivedAt: ISO,
  recordedAt: ISO,
  snapshotId: SNAPSHOT_ID.optional(),
  accountId: ID.optional(),
  environment: z.literal('PAPER').optional(),
  strategyVersion: z.string().min(1).max(40).optional(),
  policyVersion: z.number().int().positive().optional(),
  expiresAt: ISO.optional(),
  sourceSequence: z.string().max(64).optional(),
  producerVersion: z.string().min(1).max(40),
  dataStatus: z.enum(DATA_STATUSES),
  accessClass: z.enum(ACCESS_CLASSES),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  payload: z.record(z.string(), z.unknown()),
}).strict();
export type FabricEvent = z.infer<typeof FabricEventV1>;

/** Canonical JSON: object keys sorted recursively, so the same payload always hashes the same (cross-process, replay). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number in payload');
    if (v === undefined) throw new Error('undefined in payload');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
export const payloadHash = (payload: unknown) => sha256(canonicalJson(payload));

function forbiddenKeys(v: unknown, path = 'payload', out: string[] = [], depth = 0): string[] {
  if (depth > 32) { out.push(`${path} (too deep)`); return out; }
  if (Array.isArray(v)) v.forEach((x, i) => forbiddenKeys(x, `${path}[${i}]`, out, depth + 1));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_KEY.test(k)) out.push(`${path}.${k}`); forbiddenKeys(x, `${path}.${k}`, out, depth + 1); }
  return out;
}

export type ValidationResult = { ok: true; event: FabricEvent } | { ok: false; errors: string[] };
/**
 * Full validation: envelope schema, topic is catalogued and not RESERVED, producer is the topic's registered owner,
 * source class and access class match the catalog, payload hash matches, payload size within the topic's limit,
 * no secret-looking keys, and time is coherent (receivedAt ≤ recordedAt; occurredAt not after receivedAt + skew).
 * Anything unknown is rejected (V3-04 F04): never silently accepted.
 */
export function validateEvent(raw: unknown, opts: { maxClockSkewMs?: number } = {}): ValidationResult {
  const parsed = FabricEventV1.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'event'}: ${i.message}`) };
  const e = parsed.data; const errors: string[] = [];
  const secrets = forbiddenKeys(e.payload);
  if (secrets.length) return { ok: false, errors: [`payload contains secret-like keys: ${secrets.slice(0, 5).join(', ')}`] };
  let encoded: string;
  try { encoded = canonicalJson(e.payload); } catch { return { ok: false, errors: ['payload is not canonical JSON'] }; }
  const spec = topicSpec(e.eventType);
  if (!spec) errors.push(`unknown event type ${e.eventType}`);
  else {
    if (spec.status === 'RESERVED') errors.push(`${e.eventType} is reserved: no producer is implemented yet`);
    if (e.source !== spec.producer) errors.push(`${e.eventType} may only be produced by ${spec.producer}`);
    if (e.sourceClass !== spec.sourceClass) errors.push(`${e.eventType} must have sourceClass ${spec.sourceClass}`);
    if (e.accessClass !== spec.accessClass) errors.push(`${e.eventType} must have accessClass ${spec.accessClass}`);
    if (Buffer.byteLength(encoded) > spec.maxPayloadBytes) errors.push(`payload exceeds ${spec.maxPayloadBytes} bytes for ${e.eventType}`);
  }
  if (sha256(encoded) !== e.payloadHash) errors.push('payloadHash does not match the payload');
  const skew = opts.maxClockSkewMs ?? 5_000;
  if (Date.parse(e.receivedAt) > Date.parse(e.recordedAt)) errors.push('receivedAt is after recordedAt');
  if (e.occurredAt !== null && Date.parse(e.occurredAt) > Date.parse(e.receivedAt) + skew) errors.push('occurredAt is in the future relative to receivedAt');
  return errors.length ? { ok: false, errors } : { ok: true, event: e };
}

/** Builds a valid envelope (computes hash and times). Throws with every reason if the result would be invalid. */
export function buildEvent(input: Omit<FabricEvent, 'schemaVersion' | 'payloadHash' | 'recordedAt' | 'receivedAt'> & { receivedAt?: string; recordedAt?: string }, nowMs = Date.now()): FabricEvent {
  const now = new Date(nowMs).toISOString();
  const candidate = { schemaVersion: 'fabric.event.v1' as const, ...input, receivedAt: input.receivedAt ?? now, recordedAt: input.recordedAt ?? now, payloadHash: payloadHash(input.payload) };
  const r = validateEvent(candidate);
  if (!r.ok) throw new Error(`invalid fabric event: ${r.errors.join('; ')}`);
  return r.event;
}
