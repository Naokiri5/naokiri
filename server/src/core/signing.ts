import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/** Canonical JSON (sorted keys) so signatures are stable. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
export function sign(payload: unknown, key: Buffer = config.evidenceKey) {
  return createHmac('sha256', key).update(canonical(payload)).digest('hex');
}
export function verify(payload: unknown, sig: string, key: Buffer = config.evidenceKey) {
  const exp = Buffer.from(sign(payload, key), 'hex');
  const got = Buffer.from(sig, 'hex');
  return exp.length === got.length && timingSafeEqual(exp, got);
}
