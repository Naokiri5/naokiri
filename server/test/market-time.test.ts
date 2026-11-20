import { afterEach, describe, expect, it } from 'vitest';
import { timeZoneName } from '../src/core/time.js';
import { closeDb, openDb, run } from '../src/db/db.js';
import { marketCoverage } from '../src/market/coverage.js';
import { calendar, calendarTimeZone, setCalendarTimeZone } from '../src/portfolio/calendar.js';
import { PAPER_ACCOUNT } from '../src/portfolio/ledger.js';

const at = (time: string) => Date.parse(time);

describe('IANA market clocks', () => {
  it('follows different daylight saving transitions in New York and London', () => {
    const sample = at('2026-03-15T12:00:00Z');
    const report = marketCoverage(sample, 'Asia/Manila');
    expect(report.asOf).toBe(sample);
    expect(report.displayClock.local).toBe('2026-03-15 20:00:00');
    expect(report.clocks.find(clock => clock.location === 'New York')).toMatchObject({ local: '2026-03-15 08:00:00', offset: 'GMT-04:00' });
    expect(report.clocks.find(clock => clock.location === 'London')).toMatchObject({ local: '2026-03-15 12:00:00', offset: 'GMT+00:00' });
    expect(report.utcAnalysisSession?.label).toBe('Europe');
    expect(marketCoverage(at('2026-03-15T16:00:00Z'), 'UTC').utcAnalysisSession?.label).toBe('Americas');
  });

  it('validates named zones and keeps offsets on the legacy calendar path', () => {
    expect(timeZoneName('America/New_York')).toBe('America/New_York');
    expect(timeZoneName('Asia/Manila')).toBe('Asia/Manila');
    expect(timeZoneName('Mars/Colony')).toBeNull();
    expect(timeZoneName('+08:00')).toBeNull();
  });
});

describe('profit calendar timezone', () => {
  afterEach(closeDb);

  it('uses the zone offset at each close, including both month boundaries', () => {
    openDb(':memory:');
    const fixtureTimes = [
      '2026-03-01T04:30:00Z', // February in New York
      '2026-03-01T05:30:00Z',
      '2026-03-20T04:30:00Z', // New York is on daylight saving time
      '2026-04-01T03:30:00Z',
      '2026-04-01T04:30:00Z', // April in New York
    ];
    fixtureTimes.forEach((time, i) => run(
      `INSERT INTO positions (id, account, instrument, market, direction, strategy, qty, entry_price, stop_price,
        initial_stop, targets, status, opened_at, closed_at, realized_pnl, fees, planned_risk)
       VALUES (?, ?, 'crypto:binance:BTCUSDT', 'crypto', 'LONG', 'fixture', 1, 100, 90, 90,
        '[]', 'CLOSED', 0, ?, 1, 0.2, 10)`,
      `fixture-${i}`, PAPER_ACCOUNT, at(time),
    ));

    setCalendarTimeZone({ timeZone: 'America/New_York' });
    const march = calendar('2026-03');
    expect(march.days.map(day => day.date)).toEqual(['2026-03-01', '2026-03-20', '2026-03-31']);
    expect(march.summary).toMatchObject({ trades: 3, net: 3 });
    expect(calendar('2026-02').summary.trades).toBe(1);
    expect(calendar('2026-04').summary.trades).toBe(1);

    setCalendarTimeZone({ offsetMin: -300 });
    expect(calendarTimeZone()).toBeNull();
    expect(calendar('2026-03').days.map(day => day.date)).toEqual(['2026-03-01', '2026-03-19', '2026-03-31']);
  });
});
