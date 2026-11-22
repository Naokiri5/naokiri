import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { get } from '../src/db/db.js';
import { getControl, updateControl } from '../src/core/mode.js';
import { setSetting } from '../src/core/settings.js';

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

  it('does not block risk-reducing pause of an already-persisted legacy LIVE state', () => {
    setSetting('control', { ...getControl(), mode: 'BOUNDED_LIVE' });
    expect(updateControl('trader-joe', { pausedNewOrders: true })).toMatchObject({
      mode: 'BOUNDED_LIVE', pausedNewOrders: true,
    });
    expect(() => updateControl('owner', { mode: 'BOUNDED_LIVE' }, () => ({ ok: true }))).toThrow(/BOUNDED_LIVE blocked/);
  });
});
