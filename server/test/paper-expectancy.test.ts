import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { all, closeDb, run } from '../src/db/db.js';
import { assessPaperExpectancyCohort, rollingPaperExpectancy, type ClosedPaperTrade } from '../src/portfolio/paperExpectancy.js';
import { PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { paperStats } from '../src/lab/lab.js';
import { freshDb } from './helpers.js';

const row = (i: number, pnl: number, extra: Partial<ClosedPaperTrade> = {}): ClosedPaperTrade => ({
  id: `paper-${i}`, market: 'crypto', strategy: 'trend_pullback',
  instrument: 'crypto:binance:BTCUSDT',
  realized_pnl: pnl, planned_risk: 10, closed_at: 1_800_000_000_000 + i, ...extra,
});

describe('MIA 5.0 canonical PAPER 30-trade expectancy (research only)', () => {
  it('requires 30 observed closed trades before reporting research thresholds', () => {
    const r = assessPaperExpectancyCohort(Array.from({ length: 29 }, (_, i) => row(i, 2)));
    expect(r).toMatchObject({ sleeve: 'spot', sampleTrades: 29, status: 'INSUFFICIENT_SAMPLE' });
  });

  it('computes realized USD/R expectancy and profit factor but grants no execution authority', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i, i === 29 ? -10 : 2));
    const r = assessPaperExpectancyCohort(rows);
    expect(r).toMatchObject({
      sampleTrades: 30, winningTrades: 29, status: 'THRESHOLDS_MET_RESEARCH_ONLY',
    });
    expect(r.rollingExpectancyUsd).toBeCloseTo(1.6);
    expect(r.rollingExpectancyR).toBeCloseTo(0.16);
    expect(r.profitFactor).toBeCloseTo(5.8);
  });

  it('does not interpret a zero-loss denominator as infinite proof of readiness', () => {
    const r = assessPaperExpectancyCohort(Array.from({ length: 30 }, (_, i) => row(i, 2)));
    expect(r.profitFactor).toBeNull();
    expect(r.status).toBe('THRESHOLDS_NOT_MET');
  });

  it('fails closed for invalid PnL or missing planned risk', () => {
    const r = assessPaperExpectancyCohort(Array.from({ length: 30 }, (_, i) =>
      row(i, 2, i === 3 ? { planned_risk: 0 } : {})));
    expect(r).toMatchObject({ status: 'INVALID_EVIDENCE', rollingExpectancyR: null });
    expect(assessPaperExpectancyCohort([row(1, Number.NaN)]).profitFactor).toBeNull();
  });

  it('never labels unknown markets or non-Binance positions as implemented spot trading', () => {
    expect(assessPaperExpectancyCohort([row(1, 2, { market: 'equity' })]).sleeve).toBeNull();
    expect(assessPaperExpectancyCohort([row(1, 2, { instrument: 'solana:dex:token' })]).sleeve).toBeNull();
  });

  describe('read-only canonical database integration', () => {
    beforeEach(() => freshDb());
    afterEach(() => closeDb());

    function insert(i: number, account = PAPER_ACCOUNT, strategy = 'trend_pullback') {
      run(`INSERT INTO positions
        (id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,
         targets,status,opened_at,closed_at,realized_pnl,planned_risk)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `record-${account}-${i}`, account, 'crypto:binance:BTCUSDT', 'crypto', 'LONG',
        strategy, 1, 100, 95, 95, '[]', 'CLOSED', 1000, 2000 + i, i === 0 ? -10 : 2, 10);
    }

    it('uses the latest 30 per strategy, scopes accounts, and never writes to any table', () => {
      for (let i = 0; i < 33; i++) insert(i);
      insert(40, 'another-account');
      insert(41, PAPER_ACCOUNT, 'other-strategy');
      const before = ['positions','ledger_entries'].map(t => all(`SELECT * FROM ${t}`));
      const report = rollingPaperExpectancy();
      expect(report).toMatchObject({ account: PAPER_ACCOUNT, mode: 'PAPER', authority: 'RESEARCH_ONLY' });
      expect(report.cohorts).toHaveLength(2);
      expect(report.cohorts.find(c => c.strategy === 'trend_pullback')).toMatchObject({
        sampleTrades: 30, winningTrades: 30, status: 'THRESHOLDS_NOT_MET',
      });
      expect(report.cohorts.find(c => c.strategy === 'other-strategy')?.sampleTrades).toBe(1);
      // The existing strategy health monitor must not be contaminated by another account.
      expect(paperStats('trend_pullback')?.trades).toBe(33);
      expect(['positions','ledger_entries'].map(t => all(`SELECT * FROM ${t}`))).toEqual(before);
      expect(rollingPaperExpectancy()).toEqual(report);
    });

    it('returns no fabricated cohorts when no paper positions have closed', () => {
      expect(rollingPaperExpectancy().cohorts).toEqual([]);
    });
  });
});
