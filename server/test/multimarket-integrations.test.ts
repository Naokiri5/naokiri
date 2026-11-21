import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { marketIntegrations } from '../src/market/integrations.js';
import { brokerConnections, alpacaPaperAsset, oandaPracticePrice } from '../src/providers/regulatedBrokers.js';
import { heliusAsset, validSolanaMint } from '../src/providers/helius.js';
import { jupiterQuote } from '../src/providers/jupiter.js';
import { goPlusSolanaRisk } from '../src/providers/goplus.js';

const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const initiallyOffline = config.offline;
let outgoing: Array<{ method: string; url: string; init: RequestInit }> = [];
let responder: (url: URL, init: RequestInit) => Response;

beforeEach(() => {
  (config as { offline: boolean }).offline = false;
  vi.stubEnv('ALPACA_PAPER_KEY_ID', '');
  vi.stubEnv('ALPACA_PAPER_SECRET_KEY', '');
  vi.stubEnv('OANDA_PRACTICE_ACCOUNT_ID', '');
  vi.stubEnv('OANDA_PRACTICE_TOKEN', '');
  vi.stubEnv('HELIUS_API_KEY', '');
  vi.stubEnv('JUPITER_API_KEY', '');
  vi.stubEnv('GOPLUS_ACCESS_TOKEN', '');
  outgoing = [];
  responder = () => new Response('{}', { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const asString = String(url);
    const v = new URL(asString);
    expect(v.protocol).toBe('https:');
    outgoing.push({ method: init?.method ?? 'GET', url: asString, init: init ?? {} });
    return responder(v, init ?? {});
  }));
});
afterEach(() => {
  (config as { offline: boolean }).offline = initiallyOffline;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('MIA multi-market adapters — read-only by construction', () => {
  it('reports the existing Kraken adapter and labels CCXT as optional, not installed', () => {
    const a = marketIntegrations();
    expect(a.find(x => x.id === 'kraken')).toMatchObject({ execution: 'READ_ONLY', source: 'CANONICAL_PROVIDER' });
    expect(a.find(x => x.id === 'ccxt')).toMatchObject({ execution: 'NOT_INSTALLED', configuration: 'NOT_INSTALLED' });
    expect(a.every(x => x.canAuthorizeTrade === false)).toBe(true);
    expect(brokerConnections().alpacaPaper.configured).toBe(false);
    expect(brokerConnections().oandaPractice.configured).toBe(false);
  });

  it('Alpaca asset lookup refuses unconfigured keys and unallowlisted symbols before network', async () => {
    await expect(alpacaPaperAsset('AAPL')).rejects.toThrow('NOT_CONFIGURED');
    await expect(alpacaPaperAsset('AAPL/../../orders')).rejects.toThrow('INVALID_SYMBOL');
    expect(outgoing).toHaveLength(0);
  });
  it('Alpaca uses PAPER domain, returns eligibility not MIA authorization', async () => {
    vi.stubEnv('ALPACA_PAPER_KEY_ID', 'TEST_PAPER_KEY');
    vi.stubEnv('ALPACA_PAPER_SECRET_KEY', 'TEST_PAPER_SECRET');
    responder = (u, init) => {
      expect(u.host).toBe('paper-api.alpaca.markets');
      expect(u.pathname).toBe('/v2/assets/AAPL');
      expect(init.redirect).toBe('error');
      expect((init.headers as Record<string,string>)['APCA-API-KEY-ID']).toBe('TEST_PAPER_KEY');
      return new Response(JSON.stringify({
        symbol: 'AAPL', class: 'us_equity', exchange: 'NASDAQ',
        tradable: true, status: 'active', fractionable: true,
      }), { status: 200 });
    };
    const x = await alpacaPaperAsset('AAPL');
    expect(x).toMatchObject({
      environment: 'PAPER', assetClass: 'us_equity', brokerTradable: true,
      miaExecutionAuthorized: false,
    });
    expect(JSON.stringify(x)).not.toContain('TEST_PAPER');
    expect(outgoing.map(x => x.method)).toEqual(['GET']);
  });

  it('OANDA requests PRACTICE pricing only and verifies bid/ask and freshness', async () => {
    vi.stubEnv('OANDA_PRACTICE_ACCOUNT_ID', '101-012-12345678-001');
    vi.stubEnv('OANDA_PRACTICE_TOKEN', 'FAKE-PRACTICE-TOKEN');
    responder = (u, init) => {
      expect(u.host).toBe('api-fxpractice.oanda.com');
      expect(u.pathname).toContain('/pricing');
      expect(u.searchParams.get('instruments')).toBe('EUR_USD');
      expect((init.headers as Record<string,string>).Authorization).toBe('Bearer FAKE-PRACTICE-TOKEN');
      return new Response(JSON.stringify({
        prices: [{ instrument: 'EUR_USD', bids: [{ price: '1.12340' }],
          asks: [{ price: '1.12350' }], status: 'tradeable',
          time: new Date().toISOString() }],
      }), { status: 200 });
    };
    const x = await oandaPracticePrice('EUR_USD');
    expect(x).toMatchObject({
      environment: 'PRACTICE', bid: 1.1234, ask: 1.1235,
      venueTradeable: true, miaExecutionAuthorized: false,
    });
    expect(JSON.stringify(x)).not.toContain('FAKE-PRACTICE');
    expect(outgoing.map(x => x.method)).toEqual(['GET']);
  });
  it('OANDA refuses unsupported symbols and missing credentials without outgoing calls', async () => {
    await expect(oandaPracticePrice('EURUSD')).rejects.toThrow('INVALID_INSTRUMENT');
    await expect(oandaPracticePrice('EUR_USD')).rejects.toThrow('NOT_CONFIGURED');
    expect(outgoing).toHaveLength(0);
  });

  it('Helius issues ONLY a fixed-host getAsset RPC, no sendTransaction or wallet', async () => {
    vi.stubEnv('HELIUS_API_KEY', 'test_helius_secret');
    expect(validSolanaMint(SOL)).toBe(true);
    responder = (u, init) => {
      expect(u.host).toBe('mainnet.helius-rpc.com');
      expect(u.searchParams.get('api-key')).toBe('test_helius_secret');
      expect(init.method).toBe('POST');
      const body = JSON.parse(String(init.body));
      expect(body.method).toBe('getAsset');
      expect(body.params.id).toBe(SOL);
      return new Response(JSON.stringify({
        jsonrpc: '2.0', result: {
          content: { metadata: { name: 'Wrapped SOL', symbol: 'SOL' } },
          token_info: { decimals: 9 },
        },
      }), { status: 200 });
    };
    const x = await heliusAsset(SOL);
    expect(x).toMatchObject({ environment: 'READ_ONLY', symbol: 'SOL',
      decimals: 9, automationEligible: false, safetyStatus: 'UNASSESSED' });
    expect(JSON.stringify(x)).not.toContain('test_helius_secret');
    expect(outgoing).toHaveLength(1);
  });
  it('Helius rejects bad mints and unconfigured keys before any RPC call', async () => {
    await expect(heliusAsset('../wallet')).rejects.toThrow('INVALID_SOLANA_MINT');
    await expect(heliusAsset(SOL)).rejects.toThrow('NOT_CONFIGURED');
    expect(outgoing).toHaveLength(0);
  });

  it('Jupiter uses Swap V2 /order without taker and never signs/sends swaps', async () => {
    responder = (u) => {
      expect(u.origin).toBe('https://api.jup.ag');
      expect(u.pathname).toBe('/swap/v2/order');
      expect(u.searchParams.has('taker')).toBe(false);
      expect(u.searchParams.get('inputMint')).toBe(SOL);
      return new Response(JSON.stringify({ router: 'metis',
        inAmount: '100000000', outAmount: '15222000',
        transaction: null, feeBps: 0 }), { status: 200 });
    };
    const q = await jupiterQuote(SOL, USDC, '100000000');
    expect(q).toMatchObject({ executable: false, safetyVerified: false,
      transaction: null, outAmount: '15222000' });
    expect(outgoing.map(x => x.method)).toEqual(['GET']);
  });
  it('Jupiter fails closed if upstream unexpectedly returns a transaction', async () => {
    responder = () => new Response(JSON.stringify({
      inAmount: '100000000', outAmount: '15000000',
      transaction: 'UNEXPECTED_SIGNABLE_TX',
    }), { status: 200 });
    await expect(jupiterQuote(SOL, USDC, '100000000')).rejects.toThrow('UNSAFE_OR_INVALID_QUOTE');
    await expect(jupiterQuote(SOL, SOL, '100000000')).rejects.toThrow('INVALID_QUOTE_INPUT');
    expect(outgoing).toHaveLength(1);
  });

  it('GoPlus records caution flags but cannot grant token automation', async () => {
    responder = (u) => {
      expect(u.origin).toBe('https://api.gopluslabs.io');
      expect(u.pathname).toBe('/api/v1/solana/token_security');
      expect(u.searchParams.get('contract_addresses')).toBe(SOL);
      return new Response(JSON.stringify({
        code: 1, result: { [SOL.toLowerCase()]: { is_mintable: '1',
          is_locked: '0', some_other_field: '0' } },
      }), { status: 200 });
    };
    const x = await goPlusSolanaRisk(SOL);
    expect(x).toMatchObject({ source: 'goplus', status: 'RISK_FLAGS',
      automationEligible: false, notProofOfSafety: true });
    expect(x.flags).toContain('GOPLUS_IS_MINTABLE');
    expect(x.flags).toContain('GOPLUS_LIQUIDITY_NOT_VERIFIED_LOCKED');
  });
  it('GoPlus treats missing/partial result as UNKNOWN, never safe', async () => {
    responder = () => new Response(JSON.stringify({ code: 2, result: {} }), { status: 200 });
    const x = await goPlusSolanaRisk(SOL);
    expect(x).toMatchObject({ status: 'UNKNOWN', automationEligible: false });
  });

  it('none of the added providers import live execution, OMS or wallet modules', () => {
    const filenames = [
      'regulatedBrokers.ts', 'helius.ts', 'jupiter.ts', 'goplus.ts',
    ];
    for (const file of filenames) {
      const text = readFileSync(new URL('../src/providers/' + file, import.meta.url), 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map(m => m[1]);
      expect(imports.filter(s => /\/(exec|wallet|risk)\/|binanceLive|\/oms/.test(s))).toEqual([]);
      expect(text).not.toContain('/api/v3/order');
      expect(text).not.toMatch(/fetchProvider\([^\n]*execute/);
    }
  });
});
