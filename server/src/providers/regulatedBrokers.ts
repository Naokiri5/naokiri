/**
 * Regulated broker discovery: ALPACA PAPER and OANDA PRACTICE only.
 *
 * Deliberately uses MIA's existing provider health, rate limiting and
 * telemetry. No live/production endpoint, no order submission, no ledger
 * mutation and no trading authorization. Broker availability depends on
 * account region, eligibility, licensing and the provider's API permissions.
 */
import { fetchProvider, registerProvider, setRateLimit, ProviderError } from './http.js';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const OANDA_PRACTICE = 'https://api-fxpractice.oanda.com';
const ALPACA_SYMBOL = /^[A-Z][A-Z0-9.]{0,9}$/;
const OANDA_ACCOUNT = /^[A-Za-z0-9-]{4,64}$/;
const OANDA_PAIRS = new Set(['EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_USD', 'USD_CAD']);

registerProvider({
  id: 'alpaca-paper', name: 'Alpaca Paper (asset eligibility only)',
  sourceClass: 'broker', markets: ['stocks', 'etf'],
  license: 'Alpaca API — account eligibility, market data terms and geographic restrictions apply.',
  realtime: 'DELAYED', requiresCredentials: true,
  status: 'PENDING_CREDENTIALS',
  note: 'Isolated PAPER broker metadata; NOT a trading or consolidated market data feed.',
});
setRateLimit('alpaca-paper', 30);

registerProvider({
  id: 'oanda-practice', name: 'OANDA Practice (account pricing)',
  sourceClass: 'broker', markets: ['forex'],
  license: 'OANDA v20 practice API subject to jurisdiction and API agreement.',
  realtime: 'NEAR_REALTIME', requiresCredentials: true,
  status: 'PENDING_CREDENTIALS',
  note: 'Account-specific demo pricing; NOT exchange execution and NOT available in every jurisdiction.',
});
setRateLimit('oanda-practice', 25);

export function brokerConnections() {
  return {
    alpacaPaper: { configured: Boolean(
      process.env.ALPACA_PAPER_KEY_ID?.trim() && process.env.ALPACA_PAPER_SECRET_KEY?.trim()),
      environment: 'PAPER' as const, execution: 'DISABLED' as const,
    },
    oandaPractice: { configured: Boolean(
      process.env.OANDA_PRACTICE_ACCOUNT_ID?.trim() && process.env.OANDA_PRACTICE_TOKEN?.trim()),
      environment: 'PRACTICE' as const, execution: 'DISABLED' as const,
    },
  };
}
function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value || /[\r\n]/.test(value)) throw new ProviderError('broker', name + '_NOT_CONFIGURED');
  return value;
}
function finitePositive(n: number) { return Number.isFinite(n) && n > 0; }

export interface EquityAsset {
  environment: 'PAPER';
  provider: 'alpaca-paper';
  symbol: string;
  assetClass: string;
  exchange: string;
  active: boolean;
  brokerTradable: boolean;
  fractionable: boolean;
  /** A broker 'tradable' field is NOT approval from MIA's risk gate. */
  miaExecutionAuthorized: false;
}
export async function alpacaPaperAsset(symbol: string): Promise<EquityAsset> {
  if (!ALPACA_SYMBOL.test(symbol)) throw new ProviderError('alpaca-paper', 'INVALID_SYMBOL');
  const key = requiredEnv('ALPACA_PAPER_KEY_ID');
  const secret = requiredEnv('ALPACA_PAPER_SECRET_KEY');
  const res = await fetchProvider('alpaca-paper', ALPACA_PAPER + '/v2/assets/' + symbol, {
    redirectMode: 'error',
    headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
  }) as Record<string, unknown>;
  if (res.symbol !== symbol || typeof res.tradable !== 'boolean')
    throw new ProviderError('alpaca-paper', 'INVALID_ASSET_RESPONSE');
  return {
    environment: 'PAPER', provider: 'alpaca-paper', symbol,
    assetClass: String(res.class ?? ''), exchange: String(res.exchange ?? ''),
    active: res.status === 'active', brokerTradable: res.tradable,
    fractionable: res.fractionable === true, miaExecutionAuthorized: false,
  };
}

export interface ForexPracticeQuote {
  environment: 'PRACTICE';
  provider: 'oanda-practice';
  instrument: string;
  bid: number;
  ask: number;
  observedAt: number;
  venueTradeable: boolean;
  miaExecutionAuthorized: false;
}
export async function oandaPracticePrice(instrument: string): Promise<ForexPracticeQuote> {
  if (!OANDA_PAIRS.has(instrument)) throw new ProviderError('oanda-practice', 'INVALID_INSTRUMENT');
  const account = requiredEnv('OANDA_PRACTICE_ACCOUNT_ID');
  if (!OANDA_ACCOUNT.test(account)) throw new ProviderError('oanda-practice', 'INVALID_ACCOUNT_ID');
  const token = requiredEnv('OANDA_PRACTICE_TOKEN');
  const data = await fetchProvider('oanda-practice',
    OANDA_PRACTICE + '/v3/accounts/' + encodeURIComponent(account) +
      '/pricing?instruments=' + encodeURIComponent(instrument), {
      redirectMode: 'error', headers: { Authorization: 'Bearer ' + token },
    }) as { prices?: Array<{ instrument?: string; time?: string; status?: string;
      bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }> };
  const p = data.prices?.find(x => x.instrument === instrument);
  const bid = Number(p?.bids?.[0]?.price), ask = Number(p?.asks?.[0]?.price);
  const ts = Date.parse(p?.time ?? '');
  if (!p || !finitePositive(bid) || !finitePositive(ask) || bid > ask ||
    !Number.isFinite(ts) || ts > Date.now() + 10_000 || Date.now() - ts > 120_000)
    throw new ProviderError('oanda-practice', 'INVALID_OR_STALE_QUOTE');
  return {
    environment: 'PRACTICE', provider: 'oanda-practice', instrument,
    bid, ask, observedAt: ts, venueTradeable: p.status === 'tradeable',
    miaExecutionAuthorized: false,
  };
}
