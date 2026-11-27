/**
 * Trader Joe behavior model (MIA Atelier, section 6). Pure: maps real BrainOS signals to one animation state and a
 * caption that says, in plain words, which recorded fact triggered it.
 *
 * Rules:
 *  - Every non-idle state is driven by an observed signal: the /api/shell status, the paper session state, the chat
 *    request in flight, or a recent event from the /api/stream feed. Nothing is invented on a timer.
 *  - When the status is missing, malformed or the server is unreachable, Joe shows a calm warning. He never looks busy
 *    ("monitoring", "scanning") without a confirmed signal, so decoration cannot imply that MIA is trading, learning
 *    or connected to an exchange when it is not.
 *  - Joe is presentation only. This module has no access to orders, wallets, credentials or the risk policy.
 */
import { isShellDto, type ShellDto } from '../../status';

export type JoeState =
  | 'STANDBY' | 'LISTENING' | 'TYPING' | 'SCANNING' | 'RESEARCHING' | 'MONITORING'
  | 'RISK_ALERT' | 'DISCONNECTED' | 'POSITION_REVIEW' | 'SESSION_CLOSING' | 'SYSTEM_ERROR';

/** A stream event Joe reacts to, reduced to what the mapper needs (see server bus.publish payloads). */
export type JoeEvent =
  | { kind: 'scan'; at: number }
  | { kind: 'decision'; at: number; rejected: boolean; asset?: string }
  | { kind: 'protection'; at: number }
  | { kind: 'position-closed'; at: number };

export interface JoeSignals {
  /** Last /api/shell response (validated here) and whether the shell poll failed or is stale. */
  shell: unknown;
  shellUnavailable: boolean;
  streamConnected: boolean;
  /** Paper session state from /api/session/paper-spot, when known. */
  sessionState: string | null;
  chat: 'idle' | 'composing' | 'waiting';
  lastEvent: JoeEvent | null;
  now: number;
}

export interface JoeView { state: JoeState; caption: string }

/** How long a single stream event keeps Joe in its reaction before he returns to the session-level state. */
export const EVENT_WINDOW_MS = 12_000;

/** Map one stream message (topic + payload) to a Joe event, or null when it is not something Joe reacts to. */
export function joeEventFrom(topic: string, payload: unknown, at: number): JoeEvent | null {
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  if (topic === 'scan' && p) return { kind: 'scan', at };
  if (topic === 'decision' && p && typeof p.decision === 'string') {
    return { kind: 'decision', at, rejected: p.decision === 'REJECTED', asset: typeof p.asset === 'string' ? p.asset.slice(0, 24) : undefined };
  }
  if (topic === 'risk' && p?.status === 'OPEN') return { kind: 'protection', at };
  if (topic === 'position' && p?.closed === true) return { kind: 'position-closed', at };
  return null;
}

export function mapJoeState(s: JoeSignals): JoeView {
  const shell: ShellDto | null = !s.shellUnavailable && isShellDto(s.shell) ? s.shell : null;
  if (!shell) return { state: 'SYSTEM_ERROR', caption: 'MIA status is unavailable. Joe waits until the server reports in again.' };
  if (s.chat === 'waiting') return { state: 'TYPING', caption: 'Preparing an answer from recorded evidence.' };
  if (s.chat === 'composing') return { state: 'LISTENING', caption: 'Listening to your question.' };
  if (shell.control.emergency || s.sessionState === 'EMERGENCY_KILL_SWITCH') {
    return { state: 'RISK_ALERT', caption: 'Emergency stop is active. New orders are blocked; open positions stay monitored.' };
  }
  if (!s.streamConnected || shell.dataHealth.stale) {
    return { state: 'DISCONNECTED', caption: 'Market data is stale or the live feed is disconnected. New entries are blocked.' };
  }
  if (s.sessionState === 'CLOSING_DRAINING_ENTRIES') return { state: 'SESSION_CLOSING', caption: 'The paper session is closing: no new entries, open positions protected.' };

  const e = s.lastEvent && s.now - s.lastEvent.at >= 0 && s.now - s.lastEvent.at <= EVENT_WINDOW_MS ? s.lastEvent : null;
  if (e?.kind === 'protection') return { state: 'RISK_ALERT', caption: 'A position could not be verified as protected. Review it in the Risk Center.' };
  if (e?.kind === 'decision' && e.rejected) return { state: 'RISK_ALERT', caption: `A candidate${e.asset ? ` (${e.asset})` : ''} was rejected by the decision and risk gates.` };
  if (e?.kind === 'position-closed') return { state: 'POSITION_REVIEW', caption: 'A paper position closed. Reviewing the recorded outcome.' };
  if (e?.kind === 'decision') return { state: 'RESEARCHING', caption: `A decision record was written${e.asset ? ` for ${e.asset}` : ''}.` };
  if (e?.kind === 'scan') return { state: 'SCANNING', caption: 'A market scan just completed.' };

  if (s.sessionState === 'RUNNING') return { state: 'MONITORING', caption: 'A paper session is running within its authorized mandate.' };
  if (s.sessionState === 'ENTRY_SUSPENDED_RISK_HALT') return { state: 'RISK_ALERT', caption: 'Paper entries are suspended by a risk halt.' };
  return { state: 'STANDBY', caption: 'No paper session is running. Joe is on standby.' };
}
