/**
 * QCI support discount (owner-approved, 26 Nov 2026): a worker version whose SUPPORT votes are measured as
 * significantly worse than the base win rate (workers/reliability.ts) has those votes scored as ABSTAIN.
 *
 * Invariants:
 *  - only SUPPORT is discounted; OPPOSE votes, vetoes and the challenge panel always see the original packets;
 *  - signed packets are never changed: the coordinator scores a copy and records which votes it discounted;
 *  - a discount binds to the exact worker version it was measured on; a new version starts undiscounted;
 *  - a missing or malformed stored list means no discount (it can only lower support, never raise it).
 */
import { getSetting } from '../core/settings.js';
import type { EvidencePacket } from './schemas.js';

export const SUPPORT_DISCOUNT_KEY = 'qci.discountedSupport';

export interface SupportDiscount { workerId: string; workerVersion: string; supports: number; winRateUpper: number; baseWinRateLower: number }
export interface StoredSupportDiscounts { computedAt: number; workers: SupportDiscount[] }

const isDiscount = (v: unknown): v is SupportDiscount => !!v && typeof v === 'object'
  && typeof (v as SupportDiscount).workerId === 'string' && typeof (v as SupportDiscount).workerVersion === 'string'
  && Number.isSafeInteger((v as SupportDiscount).supports)
  && Number.isFinite((v as SupportDiscount).winRateUpper) && Number.isFinite((v as SupportDiscount).baseWinRateLower);

export function storedSupportDiscounts(): StoredSupportDiscounts | null {
  let raw: unknown;
  try { raw = getSetting<unknown>(SUPPORT_DISCOUNT_KEY, null); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const { computedAt, workers } = raw as StoredSupportDiscounts;
  return Number.isSafeInteger(computedAt) && Array.isArray(workers) && workers.every(isDiscount) ? { computedAt, workers } : null;
}

/** The packets QCI scores: discounted SUPPORT votes become ABSTAIN copies. The input array and packets are untouched. */
export function discountSupport(packets: readonly EvidencePacket[], stored: StoredSupportDiscounts | null) {
  const keys = new Set((stored?.workers ?? []).map((w) => `${w.workerId}@${w.workerVersion}`));
  const discounted: { worker_id: string; worker_version: string }[] = [];
  const scored = packets.map((p) => {
    if (p.stance !== 'SUPPORT' || !keys.has(`${p.worker_id}@${p.worker_version}`)) return p;
    discounted.push({ worker_id: p.worker_id, worker_version: p.worker_version });
    return { ...p, stance: 'ABSTAIN' as const };
  });
  return { scored, discounted };
}
