import { describe, expect, it, vi } from 'vitest';
import { monitorExitProtection, type ExitMonitorSource } from '../src/exec/exitMonitor.js';
import type { ExitEvidence } from '../src/risk/exitProtection.js';

const evidence = (): ExitEvidence => ({
  positionId: 'p1', lane: 'FAST_MEMECOIN', nowMs: 1000, observedAtMs: 1000,
  positionQty: 10, executableQty: 10, quoteAgeMs: 0, maxQuoteAgeMs: 1000,
  sellable: true, verifiedLiquidityWithdrawal: true, verifiedInsiderDistribution: false,
  executableImpactBps: 10, maxExecutableImpactBps: 100,
});
describe('shared PAPER/LIVE exit monitoring contract', () => {
  for (const environment of ['PAPER', 'LIVE'] as const) {
    it(`${environment}: evaluates risk without submitting orders`, async () => {
      const record = vi.fn();
      const degraded = vi.fn();
      const source: ExitMonitorSource = { environment, snapshot: async () => [evidence()] };
      const result = await monitorExitProtection(source, { record, degraded });
      expect(result).toEqual({ environment, assessed: 1, critical: 1, degraded: false });
      expect(record).toHaveBeenCalledWith(environment, expect.objectContaining({
        action: 'EXIT_IF_EXECUTABLE', orderAuthorized: false,
      }));
      expect(degraded).not.toHaveBeenCalled();
    });
  }
  it('fails visibly on unavailable live evidence', async () => {
    const degraded = vi.fn();
    const result = await monitorExitProtection({
      environment: 'LIVE', snapshot: async () => { throw new Error('venue offline'); },
    }, { record: vi.fn(), degraded });
    expect(result).toMatchObject({ assessed: 0, degraded: true });
    expect(degraded).toHaveBeenCalledOnce();
  });
  it('does not confuse unverified protection with safe HOLD', async () => {
    const record = vi.fn();
    const result = await monitorExitProtection({
      environment: 'PAPER', snapshot: async () => [{ ...evidence(), sellable: null }],
    }, { record, degraded: vi.fn() });
    expect(result.degraded).toBe(true);
    expect(record).toHaveBeenCalledWith('PAPER', expect.objectContaining({
      action: 'PROTECTION_UNVERIFIED', orderAuthorized: false,
    }));
  });
});
