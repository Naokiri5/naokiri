import { zonedClock } from '../core/time.js';
import { provider } from '../providers/http.js';
import { LIVE_EXECUTION_AVAILABLE } from '../core/mode.js';

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

/**
 * MIA-ID-01 / MIA-ID-06: read-only mapping of the PDF's proposed five sleeves onto the
 * EXISTING market-coverage evidence. This is not a new instrument registry, risk
 * manager, trading mode, adapter, broker connection, or authorization mechanism.
 * These statuses describe the reviewed repository implementation, not provider uptime.
 */
export type ProposedSleeve = 'futures' | 'spot' | 'memecoin' | 'yield' | 'stocks_etf';
export type PaperSleeveCapability = 'PAPER_IMPLEMENTED' | 'DISCOVERY_ONLY' | 'UNAVAILABLE';
const FIVE_SLEEVE_COVERAGE = [
  { sleeve: 'futures', referenceMarket: 'Derivatives', paperCapability: 'UNAVAILABLE',
    limitation: 'No verified executable futures feed, contract metadata, leverage or derivatives execution adapter.' },
  { sleeve: 'spot', referenceMarket: 'CEX crypto spot', paperCapability: 'PAPER_IMPLEMENTED',
    limitation: 'Existing Binance spot PAPER path only; runtime price freshness, book depth and risk gate still determine readiness.' },
  { sleeve: 'memecoin', referenceMarket: 'DEX tokens and memecoins', paperCapability: 'DISCOVERY_ONLY',
    limitation: 'Pair discovery is not a tested token-safety, sellability, routing or PAPER execution capability.' },
  { sleeve: 'yield', referenceMarket: null, paperCapability: 'UNAVAILABLE',
    limitation: 'No certified vault integration, custody controls, yield ledger or transfer/recall execution capability.' },
  { sleeve: 'stocks_etf', referenceMarket: 'U.S. equities', paperCapability: 'UNAVAILABLE',
    limitation: 'Licensed equity/ETF execution quotes, verified exchange calendar and broker adapter are not available.' },
] as const satisfies readonly {
  sleeve: ProposedSleeve;
  referenceMarket: string | null;
  paperCapability: PaperSleeveCapability;
  limitation: string;
}[];

export function marketCoverage(asOf: number, displayTimeZone: string) {
  const hour = new Date(asOf).getUTCHours();
  const markets = COVERAGE.map(({ market, coverage, schedule, sourceIds }) => ({
    market, coverage, schedule,
    sources: sourceIds.map(id => {
      const source = provider(id);
      return { id, name: source?.name ?? id, status: source?.status ?? 'UNAVAILABLE' };
    }),
  }));
  return {
    asOf,
    displayClock: zonedClock(asOf, displayTimeZone),
    clocks: LOCATIONS.map(([location, zone]) => ({ location, ...zonedClock(asOf, zone) })),
    // A research bucket, independent of exchange opening hours.
    utcAnalysisSession: UTC_SESSIONS.find(s => hour >= s.startHourUtc && hour < s.endHourUtc),
    markets,
    // Shares the market coverage read model. Never infers authorization from provider 'LIVE' health.
    sleeves: FIVE_SLEEVE_COVERAGE.map(row => ({
      sleeve: row.sleeve,
      referenceMarket: row.referenceMarket,
      paperCapability: row.paperCapability,
      liveExecution: LIVE_EXECUTION_AVAILABLE ? 'NOT_CERTIFIED' as const : 'LOCKED' as const,
      limitation: row.limitation,
      sources: markets.find(m => m.market === row.referenceMarket)?.sources ?? [],
    })),
  };
}
