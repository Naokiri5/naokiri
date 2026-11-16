import { registerProvider } from './http.js';
import { config } from '../config.js';

/**
 * Integrations required by the spec that need credentials, paid licenses, or hosts not available
 * in this environment. They are registered so the Connections Hub shows their true state.
 * None of them return data until implemented and credentialed — nothing is faked.
 */
const P = (id: string, name: string, sourceClass: any, markets: string[], license: string, note: string) =>
  registerProvider({ id, name, sourceClass, markets, license, realtime: 'REALTIME', requiresCredentials: true, status: 'PENDING_CREDENTIALS', note });

P('equities', 'Equities market data (e.g. Alpaca / Polygon / IEX)', 'broker', ['stocks'], 'Requires exchange-licensed data subscription.', 'No key-free licensed equities feed. Configure a broker/data API key.');
P('commodities', 'Commodities/futures data (e.g. CME via vendor)', 'broker', ['commodities'], 'Requires CME/ICE market-data license via vendor.', 'Not configured.');
P('evm_rpc', 'EVM RPC + explorer (contract analysis, holders)', 'onchain', ['crypto-dex'], 'Provider ToS (Alchemy/Infura/Etherscan).', 'Needed for honeypot sell-simulation, holder maps, whale wallets.');
P('solana_rpc', 'Solana RPC (mint/freeze authority checks)', 'onchain', ['crypto-dex'], 'Provider ToS (Helius/QuickNode).', 'Needed for Part 2.2 Solana checks.');
P('x_api', 'X (Twitter) API', 'social', ['all'], 'X Developer Agreement; paid tier for read access.', 'OAuth 2.0 PKCE linking not configured.');
registerProvider({
  id: 'telegram', name: 'Telegram Bot API', sourceClass: 'messaging', markets: ['notifications'],
  license: 'Telegram Bot API Terms.', realtime: 'REALTIME', requiresCredentials: true,
  status: config.telegramBotToken ? 'IDLE' : 'PENDING_CREDENTIALS',
  note: config.telegramBotToken ? 'Bot token configured (server-side only).' : 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; host api.telegram.org must be allow-listed.',
});
registerProvider({
  id: 'anthropic', name: 'Anthropic Claude API (Trader Joe)', sourceClass: 'aggregator', markets: ['assistant'],
  license: 'Anthropic Commercial Terms.', realtime: 'REALTIME', requiresCredentials: true,
  status: config.anthropicApiKey ? 'IDLE' : 'PENDING_CREDENTIALS',
  note: config.anthropicApiKey ? 'API key configured.' : 'Set ANTHROPIC_API_KEY to enable conversational Trader Joe; deterministic command mode is used otherwise.',
});
P('live_venue', 'Live order execution (exchange trading API)', 'cex', ['crypto'], 'Exchange API terms.', 'LOCKED by release gate. Requires QA certification + explicit owner authorization + isolated signer.');
