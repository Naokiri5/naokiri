import { zonedClock } from '../core/time.js';
import { provider } from '../providers/http.js';

const LOCATIONS = [
  ['New York', 'America/New_York'], ['London', 'Europe/London'], ['Tokyo', 'Asia/Tokyo'],
  ['Hong Kong', 'Asia/Hong_Kong'], ['Singapore', 'Asia/Singapore'], ['Frankfurt', 'Europe/Berlin'],
  ['Sydney', 'Australia/Sydney'], ['Manila', 'Asia/Manila'],
] as const;

const UTC_SESSIONS = [
  { label: 'Asia-Pacific', startHourUtc: 0, endHourUtc: 8 },
  { label: 'Europe', startHourUtc: 8, endHourUtc: 16 },
  { label: 'Americas', startHourUtc: 16, endHourUtc: 24 },
] as const;

const COVERAGE = [
  { market: 'CEX crypto spot', sourceIds: ['binance'], coverage: 'Spot prices, candles, order books and paper research', schedule: '24/7 schedule. Halt and maintenance status unavailable.' },
  { market: 'DEX tokens and memecoins', sourceIds: ['dexscreener'], coverage: 'Pair discovery and aggregate snapshots. Chain-level token safety needs on-chain data.', schedule: 'Continuous by design. Pair availability depends on chain and pool conditions.' },
  { market: 'Tokenized equities', sourceIds: [], coverage: 'Dedicated listings and verified underlying mappings unavailable', schedule: 'Venue schedule unavailable' },
  { market: 'U.S. equities', sourceIds: ['equities'], coverage: 'Exchange prices and venue calendars unavailable', schedule: 'Venue calendar unavailable' },
  { market: 'Other equities', sourceIds: ['equities'], coverage: 'Exchange prices and venue calendars unavailable', schedule: 'Venue calendar unavailable' },
  { market: 'Forex', sourceIds: ['frankfurter'], coverage: 'ECB daily reference rates', schedule: 'Reference series only' },
  { market: 'Commodities', sourceIds: ['commodities'], coverage: 'Licensed commodity prices unavailable', schedule: 'Venue calendar unavailable' },
  { market: 'Derivatives', sourceIds: [], coverage: 'Contract prices, positioning and options feeds unavailable', schedule: 'Venue calendar unavailable' },
] as const;

export function marketCoverage(asOf: number, displayTimeZone: string) {
  const hour = new Date(asOf).getUTCHours();
  return {
    asOf,
    displayClock: zonedClock(asOf, displayTimeZone),
    clocks: LOCATIONS.map(([location, zone]) => ({ location, ...zonedClock(asOf, zone) })),
    // A research bucket, independent of exchange opening hours.
    utcAnalysisSession: UTC_SESSIONS.find(s => hour >= s.startHourUtc && hour < s.endHourUtc),
    markets: COVERAGE.map(({ market, coverage, schedule, sourceIds }) => ({
      market, coverage, schedule,
      sources: sourceIds.map(id => ({ id, name: provider(id)?.name ?? id, status: provider(id)?.status ?? 'UNAVAILABLE' })),
    })),
  };
}
