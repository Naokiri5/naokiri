/**
 * Binance Spot TESTNET boundary, Phase 1.
 *
 * Hard-coded host and a strict endpoint allow-list. No production host,
 * real orders, cancellations, withdrawals, signer export, or wallet access.
 * The only POST is /api/v3/order/test, which never reaches the matching engine.
 * This is a backend-only preflight tool, NOT a substitute for canonical OMS.
 *
 * Reference: https://developers.binance.com/en/docs/products/spot/testnet/rest-api
 */
import { createHmac } from 'node:crypto';

export const TESTNET_ORIGIN = 'https://testnet.binance.vision';
const RECV_WINDOW_MS = 5_000;
const TIMEOUT_MS = 4_000;
const CLOCK_SYNC_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const TEST_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,36}$/;

export class TestnetBoundaryError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {
    super(code);
    this.name = 'TestnetBoundaryError';
  }
}

export interface TestnetCredentials {
  readonly key: string;
  readonly secret: string;
}
export interface TestnetLimitOrder {
  readonly symbol: 'BTCUSDT' | 'ETHUSDT';
  readonly side: 'BUY' | 'SELL';
  readonly quantity: string;
  readonly price: string;
  readonly clientOrderId: string;
}
export interface TestnetAccount {
  environment: 'TESTNET';
  canTrade: boolean;
  accountType: string;
  assets: Array<{ asset: string; free: string; locked: string }>;
  note: 'VIRTUAL_FUNDS_ONLY';
}
export interface TestnetOrderStatus {
  environment: 'TESTNET';
  symbol: string;
  clientOrderId: string;
  venueOrderId: string;
  status: string;
  origQty: string;
  executedQty: string;
  side: string;
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;

export function testnetCredentialsConfigured(): boolean {
  return Boolean(process.env.BINANCE_TESTNET_API_KEY?.trim() &&
    process.env.BINANCE_TESTNET_API_SECRET?.trim());
}

/** Never return keys or secrets in this status object. */
export function testnetConfiguration() {
  return {
    environment: 'TESTNET' as const,
    venueId: 'binance-spot-testnet',
    configured: testnetCredentialsConfigured(),
    apiOrigin: TESTNET_ORIGIN,
    credentialsScope: 'TESTNET_ONLY',
    actualOrderPlacement: 'LOCKED' as const,
    productionExecution: 'LOCKED' as const,
    supported: ['SERVER_TIME', 'SIGNED_ACCOUNT', 'QUERY_ORDER', 'VALIDATE_ORDER_ONLY'] as const,
    note: 'No order is submitted to the matching engine; a dedicated durable OMS and protection certification are still required.',
  };
}

function serverCredentials(): TestnetCredentials {
  const key = process.env.BINANCE_TESTNET_API_KEY?.trim();
  const secret = process.env.BINANCE_TESTNET_API_SECRET?.trim();
  if (!key || !secret) throw new TestnetBoundaryError('TESTNET_CREDENTIALS_NOT_CONFIGURED');
  if (/[\r\n]/.test(key + secret)) throw new TestnetBoundaryError('TESTNET_CREDENTIAL_FORMAT_INVALID');
  return { key, secret };
}

function validSymbol(symbol: string): asserts symbol is TestnetLimitOrder['symbol'] {
  if (!TEST_SYMBOLS.has(symbol)) throw new TestnetBoundaryError('TESTNET_SYMBOL_NOT_ALLOWLISTED', 400);
}
function validDecimal(value: string, field: string) {
  if (typeof value !== 'string' || !DECIMAL.test(value) ||
    value.length > 24 || !(Number(value) > 0) || !Number.isFinite(Number(value))) {
    throw new TestnetBoundaryError('INVALID_' + field, 400);
  }
}
export function validateTestnetLimitOrder(order: Readonly<TestnetLimitOrder>): void {
  validSymbol(order.symbol);
  if (order.side !== 'BUY' && order.side !== 'SELL')
    throw new TestnetBoundaryError('TESTNET_SIDE_INVALID', 400);
  validDecimal(order.quantity, 'QUANTITY');
  validDecimal(order.price, 'PRICE');
  if (!CLIENT_ID.test(order.clientOrderId))
    throw new TestnetBoundaryError('TESTNET_CLIENT_ORDER_ID_INVALID', 400);
  const notional = Number(order.quantity) * Number(order.price);
  // Additional narrow safety constraint for diagnostic requests. The test endpoint
  // creates no order, but still avoid huge or nonsensical probes.
  if (!Number.isFinite(notional) || notional > 1_000)
    throw new TestnetBoundaryError('TESTNET_DIAGNOSTIC_NOTIONAL_LIMIT', 400);
}

/**
 * Requests are signed by a server-only module. An eventual production signer
 * must be an isolated process/service with independent review; this is NOT G07.
 */
export class BinanceSpotTestnet {
  private offsetMs = 0;
  private syncedAtMs: number | null = null;
  constructor(
    private readonly credentials: TestnetCredentials = serverCredentials(),
    private readonly transport: Transport = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {
    if (!credentials.key || !credentials.secret ||
      /[\r\n]/.test(credentials.key + credentials.secret))
      throw new TestnetBoundaryError('TESTNET_CREDENTIAL_FORMAT_INVALID');
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: '/api/v3/time' | '/api/v3/account' | '/api/v3/order' | '/api/v3/order/test',
    params: URLSearchParams = new URLSearchParams(),
    signed = false,
  ): Promise<T> {
    if (process.env.MIA_OFFLINE === '1') throw new TestnetBoundaryError('MIA_OFFLINE_BLOCKS_TESTNET');
    if (signed) {
      params.append('recvWindow', String(RECV_WINDOW_MS));
      params.append('timestamp', String(this.now() + this.offsetMs));
      const payload = params.toString();
      const signature = createHmac('sha256', this.credentials.secret).update(payload).digest('hex');
      params.append('signature', signature);
    }
    const q = params.toString();
    const url = TESTNET_ORIGIN + path + (q ? '?' + q : '');
    let response: Response;
    try {
      response = await this.transport(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json',
          'X-MBX-APIKEY': this.credentials.key, 'user-agent': 'MIA-TESTNET-PREFLIGHT' },
      });
    } catch {
      // Never expose credentials, query signatures, or transport internals.
      throw new TestnetBoundaryError('TESTNET_TRANSPORT_UNCERTAIN', 503);
    }
    if (response.status === 418 || response.status === 429)
      throw new TestnetBoundaryError('TESTNET_RATE_LIMIT_OR_BAN', 429);
    if (!response.ok)
      throw new TestnetBoundaryError(response.status >= 500 ?
        'TESTNET_VENUE_UNAVAILABLE_OR_UNKNOWN' : 'TESTNET_REQUEST_REJECTED', 502);
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new TestnetBoundaryError('TESTNET_RESPONSE_TOO_LARGE', 502);
    try { return JSON.parse(raw) as T; }
    catch { throw new TestnetBoundaryError('TESTNET_RESPONSE_INVALID', 502); }
  }

  async syncClock(): Promise<{ offsetMs: number; rttMs: number }> {
    const start = this.now();
    const res = await this.request<{ serverTime: number }>('GET', '/api/v3/time');
    const end = this.now();
    const rtt = end - start;
    if (!Number.isSafeInteger(res.serverTime) || res.serverTime <= 0 ||
      !Number.isFinite(rtt) || rtt < 0 || rtt > TIMEOUT_MS)
      throw new TestnetBoundaryError('TESTNET_CLOCK_UNTRUSTED', 503);
    const offset = Math.round(res.serverTime - (start + end) / 2);
    if (Math.abs(offset) > 30_000)
      throw new TestnetBoundaryError('TESTNET_CLOCK_SKEW_TOO_LARGE', 503);
    this.offsetMs = offset;
    this.syncedAtMs = end;
    return { offsetMs: offset, rttMs: rtt };
  }

  private async ensureClock(): Promise<void> {
    if (this.syncedAtMs === null || this.now() - this.syncedAtMs > CLOCK_SYNC_MS ||
      this.now() < this.syncedAtMs) await this.syncClock();
  }

  async account(): Promise<TestnetAccount> {
    await this.ensureClock();
    const raw = await this.request<{
      canTrade?: boolean; accountType?: string;
      balances?: Array<{ asset: string; free: string; locked: string }>;
    }>('GET', '/api/v3/account', new URLSearchParams(), true);
    if (typeof raw.canTrade !== 'boolean' || !Array.isArray(raw.balances))
      throw new TestnetBoundaryError('TESTNET_ACCOUNT_SCHEMA_INVALID', 502);
    return {
      environment: 'TESTNET', canTrade: raw.canTrade, accountType: String(raw.accountType ?? ''),
      assets: raw.balances.filter(b => /^[A-Z0-9]{1,20}$/.test(b.asset) &&
        DECIMAL.test(b.free) && DECIMAL.test(b.locked) &&
        (Number(b.free) > 0 || Number(b.locked) > 0)).slice(0, 200),
      note: 'VIRTUAL_FUNDS_ONLY',
    };
  }

  async orderStatus(symbol: string, clientOrderId: string): Promise<TestnetOrderStatus> {
    validSymbol(symbol);
    if (!CLIENT_ID.test(clientOrderId)) throw new TestnetBoundaryError('TESTNET_CLIENT_ORDER_ID_INVALID', 400);
    await this.ensureClock();
    const raw = await this.request<Record<string, unknown>>(
      'GET', '/api/v3/order',
      new URLSearchParams({ symbol, origClientOrderId: clientOrderId }), true);
    if (raw.symbol !== symbol || raw.clientOrderId !== clientOrderId ||
      typeof raw.status !== 'string' || typeof raw.executedQty !== 'string')
      throw new TestnetBoundaryError('TESTNET_ORDER_SCHEMA_INVALID', 502);
    return {
      environment: 'TESTNET', symbol, clientOrderId,
      venueOrderId: String(raw.orderId ?? ''), status: raw.status,
      origQty: String(raw.origQty ?? ''), executedQty: raw.executedQty,
      side: String(raw.side ?? ''),
    };
  }

  /**
   * This ONLY calls POST /api/v3/order/test. It validates authentication and
   * order fields at Binance but DOES NOT place an order or create a fill.
   * Do not pass test-order success as an OMS/strategy certification.
   */
  async validateOrderOnly(order: TestnetLimitOrder): Promise<{
    environment: 'TESTNET'; valid: true; placed: false; status: 'VALIDATED_ONLY';
  }> {
    validateTestnetLimitOrder(order);
    await this.ensureClock();
    const params = new URLSearchParams({
      symbol: order.symbol, side: order.side, type: 'LIMIT', timeInForce: 'GTC',
      quantity: order.quantity, price: order.price, newClientOrderId: order.clientOrderId,
    });
    await this.request<unknown>('POST', '/api/v3/order/test', params, true);
    return { environment: 'TESTNET', valid: true, placed: false, status: 'VALIDATED_ONLY' };
  }
}
