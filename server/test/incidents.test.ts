import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { modeGate } from '../src/qa/gates.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, seedInstrument, setBook } from './helpers.js';
import { closeDb, openDb, get, run } from '../src/db/db.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT, openPositions } from '../src/portfolio/ledger.js';
import { submitEntry, monitorPositions, executeExit } from '../src/exec/oms.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { seedStrategies } from '../src/lab/lab.js';
import { listIncidents, acknowledgeIncident, reportUnprotected, REALERT_MS } from '../src/exec/incidents.js';
import type { DecisionReport } from '../src/decision/engine.js';

/** P0 execution safety: a position that cannot be exited becomes a persistent, de-duplicated, owner-acknowledged incident. */
function report(id: string, last: number): DecisionReport {
  const cid = `cand_${Math.random().toString(36).slice(2)}`;
  return { id: `dec_${cid}`, candidateId: cid, traceId: 'tr', asset: id.split(':')[2], instrumentId: id, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' }, regime: 'TREND_UP',
    entryRef: last, stopLoss: last * 0.97, takeProfit: [{ price: last * 1.045, fraction: 0.5, r: 1.5 }, { price: last * 1.09, fraction: 0.5, r: 3 }],
    consensus: { id: 'q', state: 'STRONG_CONSENSUS', support: 0.7, opposition: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    decision: 'PAPER_TRADE', opportunity: { score: 70, version: 'v', factors: [], missing: [] } as any } as DecisionReport;
}
const notifications = () => get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE severity='CRITICAL' AND title LIKE 'Protection unverified%'")!.n;
const stale = (id: string) => { market.deep.get(id)!.book!.ts = Date.now() - 10 * 60_000; market.tickers.get(id)!.receivedAt = Date.now() - 10 * 60_000; };
const riskFor = (id: string, last: number) => evaluateRisk({ instrumentId: id, strategyId: 'trend_pullback', side: 'buy', entryPrice: last, stopPrice: last * 0.97, idempotencyKey: `k${Math.random()}`, traceId: 't' });

describe('protection incidents', () => {
  let id = ''; let last = 0;
  beforeEach(() => {
    freshDb(); market.reset(); ({ inst: { id }, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any);
    acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    expect(submitEntry(report(id, last), 'bot').ok).toBe(true);
  });

  it('provider outage: keeps the position open, opens one incident, alerts once and blocks new entries on the instrument', () => {
    stale(id); monitorPositions(); monitorPositions(); monitorPositions(); // repeated detections (retries)
    expect(openPositions()).toHaveLength(1);
    const inc = listIncidents(); expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ status: 'OPEN', occurrences: 3 }); expect(inc[0].reason).toMatch(/stale|future-dated|missing/);
    expect(notifications()).toBe(1); // de-duplicated
    expect(riskFor(id, last).reasonCodes.join(' ')).toMatch(/PROTECTION_INCIDENT_OPEN/);
  });

  it('re-alerts only after the re-alert interval', () => {
    const pos = openPositions()[0]; const t0 = Date.now();
    reportUnprotected(pos, 'no book', t0); reportUnprotected(pos, 'no book', t0 + 1000);
    expect(notifications()).toBe(1);
    reportUnprotected(pos, 'no book', t0 + REALERT_MS + 1);
    expect(notifications()).toBe(2); expect(listIncidents()).toHaveLength(1);
  });

  it('a manual exit without a book is refused and recorded as the same incident (duplicate event)', () => {
    const pos = openPositions()[0]; stale(id);
    expect(executeExit(pos.id, pos.qty, 'MANUAL_CLOSE')).toBeNull(); monitorPositions();
    expect(listIncidents()).toHaveLength(1); expect(listIncidents()[0].occurrences).toBe(2);
  });

  it('delayed (future-dated) quote is treated as unusable', () => {
    const future = Date.now() + 10 * 60_000; market.tickers.get(id)!.receivedAt = future; market.tickers.get(id)!.providerTs = future;
    monitorPositions();
    expect(listIncidents()[0]?.status).toBe('OPEN');
  });

  it('recovery: fresh data moves it to RECOVERED, lifts the entry block, and the owner must acknowledge with a note', () => {
    stale(id); monitorPositions(); const inc = listIncidents()[0];
    expect(() => acknowledgeIncident('owner', inc.id, 'trying early')).toThrow(/still OPEN/);
    setBook(id, last); market.tickers.get(id)!.receivedAt = Date.now(); monitorPositions();
    expect(listIncidents()[0]).toMatchObject({ id: inc.id, status: 'RECOVERED' });
    expect(riskFor(id, last).reasonCodes.join(' ')).not.toMatch(/PROTECTION_INCIDENT_OPEN/);
    expect(() => acknowledgeIncident('bot', inc.id, 'x x x')).toThrow(/owner/);
    expect(() => acknowledgeIncident('owner', inc.id, '   ')).toThrow(/note/);
    expect(acknowledgeIncident('owner', inc.id, 'provider recovered; stop verified')).toMatchObject({ status: 'ACKNOWLEDGED', acknowledged_by: 'owner' });
    expect(listIncidents()).toHaveLength(0); expect(listIncidents(true)).toHaveLength(1);
    // a new outage after acknowledgement opens a new incident
    stale(id); monitorPositions(); expect(listIncidents()).toHaveLength(1); expect(listIncidents()[0].id).not.toBe(inc.id);
  });

  it('a fresh ticker alone does not recover the incident while the book is too thin to exit', () => {
    stale(id); monitorPositions(); expect(listIncidents()[0].status).toBe('OPEN');
    setBook(id, last); market.tickers.get(id)!.receivedAt = Date.now(); // data fresh again…
    market.deep.get(id)!.book!.bids = [[last * 0.999, 1e-6]]; // …but nowhere near enough depth for the position
    monitorPositions();
    expect(listIncidents()[0].status).toBe('OPEN'); expect(riskFor(id, last).reasonCodes.join(' ')).toMatch(/PROTECTION_INCIDENT_OPEN/);
  });
  it('acknowledgement is atomic with its audit record', () => {
    stale(id); monitorPositions(); setBook(id, last); market.tickers.get(id)!.receivedAt = Date.now(); monitorPositions();
    const inc = listIncidents()[0]; expect(inc.status).toBe('RECOVERED');
    acknowledgeIncident('owner', inc.id, 'verified after recovery');
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action='risk.incident.ack'")!.n).toBe(1);
  });
  it('a position closed some other way does not leave an OPEN incident behind', () => {
    stale(id); monitorPositions(); const pos = openPositions()[0];
    run("UPDATE positions SET status='CLOSED', closed_at=? WHERE id=?", Date.now(), pos.id);
    monitorPositions(); expect(listIncidents()[0].status).toBe('RECOVERED');
  });
});

describe('protection incidents survive a restart', () => {
  const folders: string[] = [];
  afterEach(() => { closeDb(); for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true }); });
  it('an OPEN incident is still OPEN and still blocks entries after closing and reopening the database', () => {
    const folder = mkdtempSync('/tmp/mia-incidents-'); folders.push(folder); const dbPath = join(folder, 'mia.sqlite');
    closeDb(); openDb(dbPath); market.reset();
    const { inst, last } = seedInstrument('ETHUSDT', { seed: 2 }) as any;
    seedStrategies(); run("UPDATE strategies SET status='PAPER'"); acceptPolicy('owner', DEFAULT_POLICY); updateControl('owner', { mode: 'PAPER' }, modeGate); ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    expect(submitEntry(report(inst.id, last), 'bot').ok).toBe(true);
    stale(inst.id); monitorPositions();
    closeDb(); openDb(dbPath); // restart
    expect(listIncidents()[0]).toMatchObject({ status: 'OPEN', instrument: inst.id });
    stale(inst.id); monitorPositions(); expect(notifications()).toBe(1); // no duplicate alert after restart
    expect(riskFor(inst.id, last).reasonCodes.join(' ')).toMatch(/PROTECTION_INCIDENT_OPEN/);
  });
});
