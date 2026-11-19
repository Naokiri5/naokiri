import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, type Page } from '@playwright/test';

export const TEST_OWNER_PASSPHRASE = 'e2e owner passphrase';

export function readTestSetupCode() {
  // Read the runner's disposable offline database, the fixture equivalent of reading the server console.
  const db = new DatabaseSync(resolve(__dirname, '.data', 'mia.db'), { readOnly: true });
  try {
    const value = db.prepare("SELECT value FROM settings WHERE key = 'setup_code'").get()?.value;
    const code: unknown = typeof value === 'string' ? JSON.parse(value)?.code : undefined;
    if (typeof code !== 'string') throw new Error('The offline test server has no first-time setup code');
    return code;
  } finally {
    db.close();
  }
}

export async function signInTestOwner(page: Page) {
  const state = await (await page.request.get('/api/auth/state')).json();
  const password = TEST_OWNER_PASSPHRASE;
  const response = state.setup
    ? await page.request.post('/api/auth/login', { data: { password } })
    : await page.request.post('/api/auth/setup', { data: { password, setupCode: readTestSetupCode() } });
  expect(response.status()).toBe(200);
}
