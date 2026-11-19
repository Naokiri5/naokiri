import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const APP = 'offline-privy-app';
const OTHER_APP = 'other-offline-privy-app';
let session: typeof import('./browserSession');

beforeEach(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T00:00:00Z'));
  vi.resetModules();
  session = await import('./browserSession');
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Privy browser sign-in intent', () => {
  it('only resumes an explicit sign-in and consumes it once after a page reload', async () => {
    expect(session.takePrivySignIn(APP)).toBe(false);
    expect(session.requestPrivySignIn(APP)).toBe(true);
    vi.resetModules();
    const reloaded = await import('./browserSession');
    expect(reloaded.takePrivySignIn(OTHER_APP)).toBe(false);
    expect(reloaded.takePrivySignIn(APP)).toBe(true);
    expect(reloaded.takePrivySignIn(APP)).toBe(false);
  });

  it('drops expired sign-in intent', () => {
    expect(session.requestPrivySignIn(APP)).toBe(true);
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect(session.takePrivySignIn(APP)).toBe(false);
  });

  it('holds the logout marker across reloads and clears the previous sign-in attempt', async () => {
    expect(session.requestPrivySignIn(APP)).toBe(true);
    session.requirePrivyLogout(APP);
    vi.resetModules();
    const reloaded = await import('./browserSession');
    expect(reloaded.privyLogoutPending(APP)).toBe(true);
    expect(reloaded.requestPrivySignIn(APP)).toBe(false);
    expect(reloaded.takePrivySignIn(APP)).toBe(false);
    reloaded.completePrivyLogout(APP);
    expect(reloaded.takePrivySignIn(APP)).toBe(false);
    expect(reloaded.requestPrivySignIn(APP)).toBe(true);
    expect(reloaded.takePrivySignIn(APP)).toBe(true);
  });

  it('consumes the sign-in intent only once even if clearing browser storage fails', () => {
    expect(session.requestPrivySignIn(APP)).toBe(true);
    vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => { throw new Error('storage blocked'); });
    expect(session.takePrivySignIn(APP)).toBe(true);
    expect(session.takePrivySignIn(APP)).toBe(false);
  });
});
