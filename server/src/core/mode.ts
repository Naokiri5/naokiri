import { getSetting, setSetting } from './settings.js';
import { audit } from './audit.js';
import { bus } from './bus.js';

/** Part 9 / 26.2 permission modes. Execution can be disabled without disabling monitoring. */
export type Mode = 'OBSERVE' | 'PAPER' | 'APPROVAL' | 'BOUNDED_LIVE';
export interface ControlState { mode: Mode; pausedNewOrders: boolean; emergency: boolean; disabledStrategies: string[]; updatedAt: number }
const DEFAULT: ControlState = { mode: 'OBSERVE', pausedNewOrders: false, emergency: false, disabledStrategies: [], updatedAt: 0 };

export const getControl = (): ControlState => ({ ...DEFAULT, ...getSetting<Partial<ControlState>>('control', {}) });
export function displayMode(c = getControl()) {
  if (c.emergency) return 'EMERGENCY';
  if (c.pausedNewOrders) return 'PAUSED';
  return ({ OBSERVE: 'READ-ONLY', PAPER: 'PAPER', APPROVAL: 'USER-APPROVAL (PAPER)', BOUNDED_LIVE: 'BOUNDED LIVE' } as const)[c.mode];
}
export function updateControl(actor: string, patch: Partial<ControlState>, gateCheck?: (m: Mode) => { ok: boolean; reason?: string }) {
  const cur = getControl();
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
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  setSetting('control', next);
  audit(actor, 'control.update', { from: cur, to: next });
  bus.publish('mode', { ...next, display: displayMode(next) });
  return next;
}
