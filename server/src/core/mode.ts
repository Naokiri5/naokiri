import { getSetting, setSetting } from './settings.js';
import { audit } from './audit.js';
import { bus } from './bus.js';

/** Part 9 / 26.2 permission modes. Execution can be disabled without disabling monitoring. */
export type Mode = 'OBSERVE' | 'PAPER' | 'APPROVAL' | 'BOUNDED_LIVE';
export interface ControlState { mode: Mode; pausedNewOrders: boolean; emergency: boolean; disabledStrategies: string[]; updatedAt: number }
const DEFAULT: ControlState = { mode: 'OBSERVE', pausedNewOrders: false, emergency: false, disabledStrategies: [], updatedAt: 0 };

function isAvailableMode(mode: unknown): mode is Exclude<Mode, 'BOUNDED_LIVE'> {
  return mode === 'OBSERVE' || mode === 'PAPER' || mode === 'APPROVAL';
}

const storedControl = (): ControlState => ({ ...DEFAULT, ...getSetting<Partial<ControlState>>('control', {}) });
function effectiveControl(control: ControlState): ControlState {
  return isAvailableMode(control.mode) ? control : { ...control, mode: 'OBSERVE' };
}

// One persisted authority, two views: safe effective state for UI/monitoring,
// and explicit denial provenance for financial decisions. Read atomically once.
export function controlAuthority() {
  const stored = storedControl();
  return { control: effectiveControl(stored), unavailableMode: !isAvailableMode(stored.mode) };
}
export const getControl = (): ControlState => controlAuthority().control;
export function displayMode(c = getControl()) {
  if (c.emergency) return 'EMERGENCY';
  if (c.pausedNewOrders) return 'PAUSED';
  return ({ OBSERVE: 'READ-ONLY', PAPER: 'PAPER', APPROVAL: 'USER-APPROVAL (PAPER)', BOUNDED_LIVE: 'BOUNDED LIVE' } as const)[c.mode];
}
export function updateControl(actor: string, patch: Partial<ControlState>, gateCheck?: (m: Mode) => { ok: boolean; reason?: string }) {
  // LIVE is not implemented or certified. Enforce this at the canonical mode authority,
  // not only at HTTP routes: an internal owner-context caller may omit gateCheck or
  // supply a permissive callback. Future LIVE support requires a server-owned,
  // non-optional certification/authorization check here before this lock is removed.
  if (patch.mode === 'BOUNDED_LIVE') {
    throw new Error('BOUNDED_LIVE blocked: no certified live venue, signer or core authorization is available');
  }
  if (patch.mode !== undefined && !isAvailableMode(patch.mode)) throw new Error('invalid execution mode');
  const stored = storedControl();
  const cur = effectiveControl(stored);
  if (patch.mode && patch.mode !== cur.mode) {
    if (actor !== 'owner') throw new Error('only the authenticated owner may change execution mode');
    const g = gateCheck?.(patch.mode) ?? { ok: true };
    if (!g.ok) throw new Error(g.reason ?? 'mode blocked by release gate');
  }
  // Non-owner actors (Trader Joe, automated supervisors) may only REDUCE risk.
  if (actor !== 'owner') {
    if (patch.pausedNewOrders === false || patch.emergency === false) throw new Error(`${actor} may not resume trading; owner action required`);
    if (patch.disabledStrategies && cur.disabledStrategies.some((id) => !patch.disabledStrategies!.includes(id))) throw new Error(`${actor} may not re-enable strategies`);
  }
  const next = { ...cur, ...patch, mode: patch.mode ?? cur.mode, updatedAt: Date.now() };
  setSetting('control', next);
  audit(actor, 'control.update', { from: stored, to: next });
  bus.publish('mode', { ...next, display: displayMode(next) });
  return next;
}
