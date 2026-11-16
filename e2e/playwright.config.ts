import { defineConfig, devices } from '@playwright/test';
const port = process.env.MIA_E2E_PORT ?? '8799';
export default defineConfig({
  testDir: '.', timeout: 60_000, fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list'], ['json', { outputFile: '../data/qa/e2e-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  webServer: { command: 'node start-server.mjs', url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false, timeout: 120_000, cwd: __dirname },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
