import { describe, expect, it } from 'vitest';
import { assessExitProtection, type ExitEvidence } from '../src/risk/exitProtection.js';

const base = (): ExitEvidence => ({
  positionId: 'paper-position-1', lane: 'FAST_MEMECOIN',
  observedAtMs: 1_000, nowMs: 1_000, positionQty: 10,
  executableQty: 10, quoteAgeMs: 0, maxQuoteAgeMs: 1_000,
  sellable: true, verifiedLiquidityWithdrawal: false,
  verifiedInsiderDistribution: false, executableImpactBps: 20,
  maxExecutableImpactBps: 100,
});

describe('FAST/DEEP advisory exit protection (no order authority)', () => {
  it('holds with verified FAST inputs and never authorizes an order', () => {
    expect(assessExitProtection(base())).toMatchObject({ action: 'HOLD', orderAuthorized: false });
  });
  it('escalates verified rug evidence to an executable-exit recommendation', () => {
    expect(assessExitProtection({ ...base(), verifiedLiquidityWithdrawal: true }))
      .toMatchObject({ action: 'EXIT_IF_EXECUTABLE', severity: 'CRITICAL', orderAuthorized: false });
  });
  it('fails closed on unknown sellability or missing sell route', () => {
    expect(assessExitProtection({ ...base(), sellable: null }).action).toBe('PROTECTION_UNVERIFIED');
    expect(assessExitProtection({ ...base(), executableQty: 0 }).action).toBe('PROTECTION_UNVERIFIED');
  });
  it('never claims full execution when depth is partial', () => {
    expect(assessExitProtection({ ...base(), executableQty: 2 })).toMatchObject({ action: 'REDUCE', executableQty: 2 });
  });
  it('refuses stale or future-dated evidence', () => {
    expect(assessExitProtection({ ...base(), quoteAgeMs: 1_001 }).action).toBe('PROTECTION_UNVERIFIED');
    expect(assessExitProtection({ ...base(), observedAtMs: 2_000 }).action).toBe('PROTECTION_UNVERIFIED');
  });
  it('DEEP warns before buffer exhaustion and escalates at the boundary', () => {
    const deep: ExitEvidence = { ...base(), lane: 'DEEP_LEVERAGED', side: 'LONG',
      markPrice: 100, liquidationPrice: 94, stressMovePct: 3, reservePct: 2,
      marginDataFresh: true, accountMarginSafe: true };
    expect(assessExitProtection(deep).action).toBe('REDUCE');
    expect(assessExitProtection({ ...deep, liquidationPrice: 95 }).action).toBe('EXIT_IF_EXECUTABLE');
  });
  it('DEEP accounts for short positions and account margin health', () => {
    const deep: ExitEvidence = { ...base(), lane: 'DEEP_LEVERAGED', side: 'SHORT',
      markPrice: 100, liquidationPrice: 104, stressMovePct: 2, reservePct: 1,
      marginDataFresh: true, accountMarginSafe: true };
    expect(assessExitProtection(deep).action).toBe('REDUCE');
    expect(assessExitProtection({ ...deep, accountMarginSafe: false }).action).toBe('EXIT_IF_EXECUTABLE');
  });
  it('DEEP fails closed without venue margin evidence', () => {
    expect(assessExitProtection({ ...base(), lane: 'DEEP_LEVERAGED' }).action).toBe('PROTECTION_UNVERIFIED');
  });
});
