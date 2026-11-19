import { defineConfig } from 'vitest/config';
// MIA_SOLANA_RPC_URL is cleared so an owner's real setting never changes offline results; opt-in live tests keep it.
const solanaRpc = process.env.MIA_LIVE_TESTS === '1' ? (process.env.MIA_SOLANA_RPC_URL ?? '') : '';
export default defineConfig({ test: { env: { MIA_OFFLINE: '1', MIA_AUTH_MODE: 'passphrase', MIA_SOLANA_RPC_URL: solanaRpc }, testTimeout: 30_000, pool: 'forks' } });
