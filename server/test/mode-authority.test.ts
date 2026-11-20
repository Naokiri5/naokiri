import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { updateControl, getControl } from '../src/core/mode.js';

/**
 * SAFE-01 (owner-approved 2026-11-18, ticket #1): privileged mode transitions fail closed inside core/mode.ts itself,
 * including internal callers that bypass the HTTP route. Risk-reducing changes stay available without a gate.
 */
describe('mode authority fails closed (SAFE-01)', () => {
  beforeEach(() => { freshDb(); });

  it('a mode change without a release-gate check is refused and the mode is unchanged', () => {
    expect(() => updateControl('owner', { mode: 'PAPER' })).toThrow(/release-gate authorization/);
    expect(getControl().mode).toBe('OBSERVE');
  });

  it('BOUNDED_LIVE is refused in this build even when the gate callback says ok', () => {
    expect(() => updateControl('owner', { mode: 'BOUNDED_LIVE' }, () => ({ ok: true }))).toThrow(/BOUNDED_LIVE is locked/);
    expect(() => updateControl('owner', { mode: 'BOUNDED_LIVE' })).toThrow();
    expect(getControl().mode).toBe('OBSERVE');
  });

  it('a gate that refuses still blocks, and a gate that allows still works for paper modes', () => {
    expect(() => updateControl('owner', { mode: 'PAPER' }, () => ({ ok: false, reason: 'no policy' }))).toThrow(/no policy/);
    expect(updateControl('owner', { mode: 'PAPER' }, () => ({ ok: true })).mode).toBe('PAPER');
  });

  it('non-owners still cannot change mode, even with a permissive gate', () => {
    expect(() => updateControl('telegram:x', { mode: 'PAPER' }, () => ({ ok: true }))).toThrow(/only the authenticated owner/);
  });

  it('risk-reducing changes need no gate (pause, emergency, disabling a strategy)', () => {
    expect(updateControl('telegram:x', { pausedNewOrders: true }).pausedNewOrders).toBe(true);
    expect(updateControl('joe', { emergency: true }).emergency).toBe(true);
    expect(updateControl('owner', { disabledStrategies: ['trend_pullback'] }).disabledStrategies).toEqual(['trend_pullback']);
  });

  it('a patch that repeats the current mode is not a transition and needs no gate', () => {
    expect(updateControl('owner', { mode: 'OBSERVE', pausedNewOrders: true }).mode).toBe('OBSERVE');
  });
});
