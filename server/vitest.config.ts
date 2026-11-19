import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { MIA_OFFLINE: '1', MIA_AUTH_MODE: 'passphrase' }, testTimeout: 30_000, pool: 'forks' } });
