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
/**
 * Live execution does not exist in this build (no venue adapter, no isolated signer; release gates G07/G12 are
 * NOT_IMPLEMENTED). BOUNDED_LIVE is therefore refused here, in the trusted core, whatever a caller's gate says.
 * Changing this needs a separately reviewed live build and explicit owner authorization.
 */
export const LIVE_EXECUTION_AVAILABLE = false;

/**
 * SAFE-01 (ticket #1): a mode TRANSITION fails closed. It needs the owner AND an explicit release-gate check that
 * returns ok; a missing gate is a refusal, never an approval. Risk-reducing patches (pause, emergency, disabling
 * strategies) need no gate and remain available to every actor.
 * Callers with a surrounding database transaction can defer the event until after commit.
 */
export function updateControl(
  actor: string,
  patch: Partial<ControlState>,
  gateCheck?: (m: Mode) => { ok: boolean; reason?: string },
  deferPublish?: (publish: () => void) => void,
) {
  const cur = getControl();
  if (patch.mode && patch.mode !== cur.mode) {
    if (actor !== 'owner') throw new Error('only the authenticated owner may change execution mode');
    if (patch.mode === 'BOUNDED_LIVE' && !LIVE_EXECUTION_AVAILABLE) throw new Error('BOUNDED_LIVE is locked in this build: no live venue adapter or isolated signer exists');
    if (!gateCheck) throw new Error('mode change requires release-gate authorization');
    const g = gateCheck(patch.mode);
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
  const publish = () => bus.publish('mode', { ...next, display: displayMode(next) });
  if (deferPublish) deferPublish(publish);
  else publish();
  return next;
}
