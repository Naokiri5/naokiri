/**
 * MIA 5.0 multi-market capabilities.
 *
 * This is the only summary of integration availability. Never treat provider
 * API access as trading authority; every future venue must still pass the
 * canonical QCI, risk gate, account isolation, firewall and release policy.
 */
import { provider } from '../providers/http.js';
import { brokerConnections } from '../providers/regulatedBrokers.js';
import { heliusConfigured } from '../providers/helius.js';

export type ProviderExecution = 'READ_ONLY' | 'NOT_INSTALLED';
export interface MarketIntegration {
  id: string;
  markets: readonly string[];
  purpose: string;
  configuration: 'CONFIGURED' | 'MISSING_CREDENTIALS' | 'KEYLESS' | 'NOT_INSTALLED';
  existingProviderStatus: string;
  execution: ProviderExecution;
  canAuthorizeTrade: false;
  source: 'CANONICAL_PROVIDER' | 'CCXT_OPTIONAL';
}
export function marketIntegrations(): MarketIntegration[] {
  const broker = brokerConnections();
  const cfg = (on: boolean) => on ? 'CONFIGURED' as const : 'MISSING_CREDENTIALS' as const;
  const normal = (id: string, markets: readonly string[], purpose: string,
    configuration: MarketIntegration['configuration']): MarketIntegration => ({
    id, markets, purpose, configuration,
    existingProviderStatus: provider(id)?.status ?? 'NOT_REGISTERED',
    execution: 'READ_ONLY', canAuthorizeTrade: false, source: 'CANONICAL_PROVIDER',
  });
  return [
    normal('kraken', ['crypto'], 'Existing direct Kraken REST reference-price feed',
      'KEYLESS'),
    normal('alpaca-paper', ['stocks', 'etf'], 'Alpaca PAPER account asset eligibility; no orders',
      cfg(broker.alpacaPaper.configured)),
    normal('oanda-practice', ['forex'], 'OANDA PRACTICE account pricing; no orders',
      cfg(broker.oandaPractice.configured)),
    normal('helius', ['solana'], 'Solana DAS asset metadata; no signing',
      cfg(heliusConfigured())),
    normal('jupiter-quote', ['solana'], 'Swap V2 indicative route quote; no transaction',
      process.env.JUPITER_API_KEY?.trim() ? 'CONFIGURED' : 'KEYLESS'),
    normal('goplus', ['solana'], 'Beta token-risk evidence; never a safe verdict',
      process.env.GOPLUS_ACCESS_TOKEN?.trim() ? 'CONFIGURED' : 'KEYLESS'),
    {
      id: 'ccxt', markets: ['crypto'],
      purpose: 'Optional future unified exchange SDK. Existing Kraken direct adapter retained; no duplicate CCXT runtime installed.',
      configuration: 'NOT_INSTALLED', existingProviderStatus: 'NOT_INSTALLED',
      execution: 'NOT_INSTALLED', canAuthorizeTrade: false, source: 'CCXT_OPTIONAL',
    },
  ];
}
