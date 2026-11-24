import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { get } from '../src/db/db.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { getSetting, setSetting } from '../src/core/settings.js';

const auditCount = () => get<{ total: number }>('SELECT COUNT(*) AS total FROM audit_log')!.total;

describe('canonical mode authority: LIVE remains fail-closed', () => {
  beforeEach(() => freshDb());

  it('rejects direct owner-context LIVE activation with no optional gate callback', () => {
    const before = getControl();
    const auditsBefore = auditCount();
    expect(() => updateControl('owner', { mode: 'BOUNDED_LIVE' })).toThrow(/BOUNDED_LIVE blocked/);
    expect(getControl()).toEqual(before);
    expect(auditCount()).toBe(auditsBefore);
  });

  it('rejects direct LIVE activation even if the supplied callback incorrectly approves', () => {
    updateControl('owner', { mode: 'PAPER' });
    const before = getControl();
    const auditsBefore = auditCount();
    const permissive = () => ({ ok: true });
    expect(() => updateControl('owner', { mode: 'BOUNDED_LIVE' }, permissive)).toThrow(/BOUNDED_LIVE blocked/);
    expect(getControl()).toEqual(before);
    expect(auditCount()).toBe(auditsBefore);
  });

  it('retains existing PAPER mode changes and risk-reducing automated pause behavior', () => {
    expect(updateControl('owner', { mode: 'PAPER' }).mode).toBe('PAPER');
    expect(updateControl('trader-joe', { pausedNewOrders: true })).toMatchObject({
      mode: 'PAPER', pausedNewOrders: true,
    });
    expect(() => updateControl('trader-joe', { pausedNewOrders: false })).toThrow(/may not resume/);
  });

  it('treats legacy stored LIVE mode as observe and keeps risk-reducing controls available', () => {
    const legacy = { ...getControl(), mode: 'BOUNDED_LIVE', disabledStrategies: ['range_reversion'], updatedAt: 42 };
    setSetting('control', legacy);
    const auditsBefore = auditCount();
    expect(getControl()).toEqual({ ...legacy, mode: 'OBSERVE' });
    expect(getSetting('control', null)).toEqual(legacy);
    expect(auditCount()).toBe(auditsBefore);
    expect(updateControl('trader-joe', { pausedNewOrders: true })).toMatchObject({
      mode: 'OBSERVE', pausedNewOrders: true, disabledStrategies: ['range_reversion'],
    });
    expect(getSetting('control', null)).toMatchObject({ mode: 'OBSERVE', pausedNewOrders: true });
    const detail = get<{ detail: string }>("SELECT detail FROM audit_log WHERE action='control.update' ORDER BY id DESC LIMIT 1")!.detail;
    expect(JSON.parse(detail)).toMatchObject({ from: { mode: 'BOUNDED_LIVE' }, to: { mode: 'OBSERVE' } });
    expect(() => updateControl('owner', { mode: 'BOUNDED_LIVE' }, () => ({ ok: true }))).toThrow(/BOUNDED_LIVE blocked/);
  });
});
