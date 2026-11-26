import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { STRATEGIES } from '../src/lab/strategies.js';
import { checkStrategyHealth, verifiedLossEvidence, VERIFIED_LOSS_RULE, setStrategyStatus } from '../src/lab/lab.js';
import { linkClosedTrades } from '../src/ditas/tradeOutcomes.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { all, get, run, J } from '../src/db/db.js';

const strategy = STRATEGIES[0];
const status = () => get<{ status: string; note: string }>('SELECT status, note FROM strategies WHERE id=?', strategy.id)!;

/**
 * Closed paper trades whose orders, fills and ledger rows agree, linked by the real linker so each outcome record is
 * ledger-verified and hashed. Planned risk is 10, so a trade with `netR` realizes netR * 10.
 */
function settledTrades(netRs: number[], version = strategy.version) {
  const t0 = Date.now() - 1_000_000;
  netRs.forEach((r, i) => {
    const pnl = r * 10, opened = t0 + i * 1000, closed = opened + 500;
    const pos = `pos_${version}_${i}`, dec = `dec_${version}_${i}`, entry = `ord_e_${version}_${i}`, exit = `ord_x_${version}_${i}`;
    run('INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,created_at,report) VALUES (?,?,?,?,?,?,?,?,?)',
      dec, `cand_${i}`, 'crypto:binance:ETHUSDT', 'crypto', 'LONG', strategy.id, 'PAPER_TRADE', opened, J({ id: dec, strategy: { id: strategy.id, version }, traceId: `trace_${i}` }));
    run(`INSERT INTO positions(id,account,instrument,market,direction,strategy,qty,entry_price,stop_price,initial_stop,targets,status,opened_at,closed_at,
      exit_price,realized_pnl,fees,decision_id,exit_reason,planned_risk) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      pos, PAPER_ACCOUNT, 'crypto:binance:ETHUSDT', 'crypto', 'LONG', strategy.id, 0, 100, 90, 90, '{}', 'CLOSED', opened, closed, 100 + pnl, pnl, 0, dec, 'TEST', 10);
    for (const [id, side, purpose, price, at] of [[entry, 'BUY', 'ENTRY', 100, opened], [exit, 'SELL', 'EXIT_TEST', 100 + pnl, closed]] as const) {
      run(`INSERT INTO orders(id,client_order_id,account,venue,instrument,side,type,qty,status,purpose,position_id,decision_id,filled_qty,avg_price,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, `c_${id}`, PAPER_ACCOUNT, 'binance-paper', 'crypto:binance:ETHUSDT', side, 'MARKET', 1, 'FILLED', purpose, pos, purpose === 'ENTRY' ? dec : null, 1, price, at, at);
      run('INSERT INTO fills(id,order_id,qty,price,fee,liquidity,ts) VALUES (?,?,?,?,?,?,?)', `fil_${id}`, id, 1, price, 0, 'TAKER', at);
      ledger(PAPER_ACCOUNT, side === 'BUY' ? 'BUY' : 'SELL', side === 'BUY' ? -100 : 100 + pnl, id, 'test', at);
    }
  });
  expect(linkClosedTrades(Date.now())).toMatchObject({ linked: netRs.length, verified: netRs.length });
}

describe('automatic suspension on ledger-verified losses', () => {
  beforeEach(() => freshDb());
  // Small, consistent losses: mean -0.15R, well above the -0.3R heuristic, so only the verified rule can fire.
  const consistentLoss = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? -0.05 : -0.25));

  it('suspends a PAPER strategy once its verified trades show a significant net loss, with the evidence in the note', () => {
    settledTrades(consistentLoss(VERIFIED_LOSS_RULE.minTrades));
    const e = verifiedLossEvidence(strategy.id)!;
    expect(e.trades).toBe(30);
    expect(e.meanNetR).toBeCloseTo(-0.15, 9);
    expect(e.upperNetR).toBeLessThan(0);
    expect(checkStrategyHealth()).toEqual([strategy.id]);
    expect(status()).toMatchObject({ status: 'SUSPENDED', note: expect.stringMatching(/verified net loss -0\.15R .* over 30 ledger-verified trades/) });
    expect(checkStrategyHealth()).toEqual([]); // once
  });

  it('does not act below the minimum sample', () => {
    settledTrades(consistentLoss(VERIFIED_LOSS_RULE.minTrades - 1));
    expect(verifiedLossEvidence(strategy.id)).toBeNull();
    expect(checkStrategyHealth()).toEqual([]);
    expect(status().status).toBe('PAPER');
  });

  it('does not act on a negative mean that is not statistically significant', () => {
    settledTrades(Array.from({ length: 40 }, (_, i) => (i % 2 ? 1.0 : -1.3))); // mean -0.15R, wide interval
    expect(verifiedLossEvidence(strategy.id)).toBeNull();
    expect(checkStrategyHealth()).toEqual([]);
  });

  it('never counts an altered record as evidence', () => {
    settledTrades(consistentLoss(30));
    run('DROP TRIGGER ditas_trade_outcomes_no_update');
    run("UPDATE ditas_trade_outcomes SET net_r=net_r-1 WHERE position_id=(SELECT position_id FROM ditas_trade_outcomes LIMIT 1)");
    expect(verifiedLossEvidence(strategy.id)).toBeNull(); // 29 intact records remain, below the minimum sample
    expect(checkStrategyHealth()).toEqual([]);
  });

  it('only counts the current strategy version', () => {
    settledTrades(consistentLoss(30), '0.0.1');
    expect(verifiedLossEvidence(strategy.id)).toBeNull();
    expect(checkStrategyHealth()).toEqual([]);
  });

  it('never touches a strategy that is not in PAPER, and re-enabling stays an owner action', () => {
    settledTrades(consistentLoss(30));
    run("UPDATE strategies SET status='RESEARCH' WHERE id=?", strategy.id);
    expect(checkStrategyHealth()).toEqual([]);
    expect(status().status).toBe('RESEARCH');
    expect(() => setStrategyStatus('strategy-health-monitor', strategy.id, 'PAPER')).toThrow(/only the owner/);
    expect(all("SELECT id FROM audit_log WHERE action='strategy.status'")).toHaveLength(0);
  });
});
