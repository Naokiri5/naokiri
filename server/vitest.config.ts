import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { MIA_OFFLINE: '1' }, testTimeout: 30_000, pool: 'forks' } });
