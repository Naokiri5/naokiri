import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { all, closeDb, J, run } from '../src/db/db.js';
import { paperExperience, paperExperienceOverview } from '../src/ditas/experience.js';
import { strategyPassports } from '../src/ditas/passports.js';
import { submitEntry } from '../src/exec/oms.js';
import type { DecisionReport } from '../src/decision/engine.js';

const strategyId = 'trend_pullback';
const instrumentId = 'crypto:binance:EXPERIENCEUSDT';
const now = () => Date.now();
function closePaperPosition(id: string, opts: { account?: string; version?: string | null; regime?: string; netR?: number; closedAt?: number; badRisk?: boolean } = {}) {
  const account = opts.account ?? 'paper-bot', version = opts.version === undefined ? '1.0.0' : opts.version;
  const decisionId = version === null ? null : 'decision-' + id;
  if (decisionId) run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
    decisionId, 'candidate-' + id, instrumentId, 'crypto', 'LONG', strategyId, 'PAPER_TRADE', now() - 120000,
    J({ strategy: { id: strategyId, version }, regime: opts.regime ?? 'TREND_UP', instrumentId, market: 'crypto' }));
  const closedAt = opts.closedAt ?? now() - 1000;
  run('INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,realized_pnl,fees,planned_risk,decision_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, account, instrumentId, 'crypto', 'LONG', strategyId, 0, 100, 95, 95, '{}', 'CLOSED', closedAt - 60000, closedAt,
    (opts.netR ?? -1) * 5, 0.2, opts.badRisk ? 0 : 5, decisionId);
}

describe('DITAS account-scoped actual-paper experience and no-trade review', () => {
  let originalMode: string | undefined;
  beforeEach(() => { originalMode = process.env.MIA_EXPERIENCE_NO_TRADE_MODE; delete process.env.MIA_EXPERIENCE_NO_TRADE_MODE; freshDb(false); });
  afterEach(() => { closeDb(); if (originalMode === undefined) delete process.env.MIA_EXPERIENCE_NO_TRADE_MODE; else process.env.MIA_EXPERIENCE_NO_TRADE_MODE = originalMode; });

  it('does not infer profitability from empty evidence', () => {
    const e = paperExperience(strategyId, '1.0.0', 'TREND_UP');
    expect(e).toMatchObject({ source: 'CANONICAL_PAPER_OMS', mode: 'SHADOW', signal: 'INSUFFICIENT_SAMPLE', health: { samples: 0, expectancyR: null } });
    expect(paperExperienceOverview().strategies).toHaveLength(3);
  });

  it('restricts observations to the paper account, strategy version, regime, cutoff and valid financial state', () => {
    closePaperPosition('valid', { netR: -1 });
    closePaperPosition('external', { account: 'live-account', netR: 999 });
    closePaperPosition('old', { version: '0.9.0', netR: 999 });
    closePaperPosition('unknown', { version: null, netR: 999 });
    closePaperPosition('other-regime', { regime: 'RANGE', netR: 999 });
    closePaperPosition('invalid-risk', { badRisk: true, netR: 999 });
    closePaperPosition('future', { netR: 999, closedAt: now() + 60000 });
    const e = paperExperience(strategyId, '1.0.0', 'TREND_UP');
    expect(e.health).toMatchObject({ samples: 1, expectancyR: -1 });
    expect(e.exclusions).toMatchObject({ otherVersion: 1, unknownVersion: 1, otherRegime: 1, invalidFinancials: 1 });
    expect(e.episodes.map(x => x.positionId)).toEqual(['valid']);
    expect(paperExperience(strategyId, '1.0.0', 'TREND_UP', now() - 120000).health.samples).toBe(0);
    expect(strategyPassports()[0].paperHealth.excludedOtherVersion).toBe(1);
    expect(strategyPassports()[0].paperHealth.samples).toBe(4); // valid, other-regime, invalid-risk excluded by passport, future included
  });

  it('defaults to SHADOW and only exposes a restrictive paper flag after 30 matching closed outcomes', () => {
    for (let i = 0; i < 30; i++) closePaperPosition('loss-' + i, { netR: -1 });
    const shadow = paperExperience(strategyId, '1.0.0', 'TREND_UP');
    expect(shadow).toMatchObject({ mode: 'SHADOW', signal: 'DEGRADED_REVIEW', health: { samples: 30, expectancyR: -1 } });
    process.env.MIA_EXPERIENCE_NO_TRADE_MODE = 'PAPER_ENFORCE';
    const gated = paperExperience(strategyId, '1.0.0', 'TREND_UP');
    expect(gated.mode).toBe('PAPER_ENFORCE');
    const report = { id: 'guarded', candidateId: 'guarded', instrumentId, asset: 'EXPERIENCEUSDT',
      strategy: { id: strategyId, version: '1.0.0' }, regime: 'TREND_UP',
      consensus: { expiresAt: new Date(now() + 60000).toISOString() } } as unknown as DecisionReport;
    const result = submitEntry(report, 'owner');
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toMatch(/PAPER_EXPERIENCE_DEGRADED/);
    expect(all('SELECT * FROM fills')).toHaveLength(0);
    expect(all('SELECT * FROM positions')).toHaveLength(30);
  });

  it('never treats stale versions, other regimes or single losses as a no-trade veto', () => {
    for (let i = 0; i < 30; i++) closePaperPosition('loss-' + i, { version: '0.9.0' });
    closePaperPosition('single-current', { netR: -5 });
    process.env.MIA_EXPERIENCE_NO_TRADE_MODE = 'PAPER_ENFORCE';
    expect(paperExperience(strategyId, '1.0.0', 'TREND_UP').signal).toBe('INSUFFICIENT_SAMPLE');
    expect(paperExperience(strategyId, '0.9.0', 'RANGE').signal).toBe('INSUFFICIENT_SAMPLE');
    expect(() => paperExperience(strategyId, '1.0.0', 'TREND_UP', NaN)).toThrow(/invalid/);
  });
});
