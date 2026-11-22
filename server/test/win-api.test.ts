import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';

describe('WIN HTTP integration (owner auth + CSRF, no execution)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = '';
  beforeAll(async () => {
    closeDb(); openDb(':memory:');
    app = await buildApp();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup',
      payload: { password: 'win repository secure passphrase' } });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie']).split(';')[0];
  });
  afterAll(async () => { await app.close(); closeDb(); });

  it('requires owner login for the copy and deep workspaces', async () => {
    expect((await app.inject({ url: '/api/copy' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/whales/deep' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/copy/follow',
      payload: { walletAddress: '1'.repeat(32) } })).statusCode).toBe(401);
  });

  it('keeps existing /api/copy compatibility and the explicit trade lock', async () => {
    const r = await app.inject({ url: '/api/copy', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const data = r.json();
    expect(data.status).toBe('BLOCKED');
    expect(Array.isArray(data.trackedWallets)).toBe(true);
    expect(data.win.status).toBe('NOT_CONFIGURED');
    expect(data.win.liveExecution).toBe('LOCKED_G01_G14');
  });

  it('read-only follow requires CSRF and never enables paper or live orders', async () => {
    const wallet = '1'.repeat(32);
    expect((await app.inject({ method: 'POST', url: '/api/copy/follow', headers: { cookie },
      payload: { walletAddress: wallet } })).statusCode).toBe(403);
    const created = await app.inject({ method: 'POST', url: '/api/copy/follow',
      headers: { cookie, 'x-mia-csrf': '1' }, payload: { walletAddress: wallet } });
    expect(created.statusCode).toBe(200);
    const data = created.json();
    expect(data.status).toBe('READ_ONLY_WATCHLIST');
    expect(data.followedWallet.walletAddress).toBe(wallet);
    expect(data.followedWallet.executionMode).toBe('READ_ONLY');
    expect(data.automaticExecution).toBe('BLOCKED');
    expect(data.demoExecution).toBe('NOT_WIRED');
    const status = (await app.inject({ url: '/api/copy', headers: { cookie } })).json();
    expect(status.status).toBe('BLOCKED');
    expect(status.win.followedWallet.active).toBe(true);
    const invalid = await app.inject({ method: 'POST', url: '/api/copy/follow',
      headers: { cookie, 'x-mia-csrf': '1' },
      payload: { walletAddress: wallet, executionMode: 'LIVE' } });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject({ url: '/api/copy/observations', headers: { cookie } })).json().events).toEqual([]);
  });

  it('profile requires authentication and never turns research PnL into execution authority', async () => {
    expect((await app.inject({ url: '/api/copy/profile' })).statusCode).toBe(401);
    const r = await app.inject({ url: '/api/copy/profile', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.status).toBe('RESEARCH_ONLY');
    expect(p.executable).toBe(false);
    expect(p.profile.automaticCopyEligible).toBe(false);
    expect(p.profile.coverageRatio).toBeNull();
    expect(p.profile.grossClosedPnlUsd).toBeNull();
    expect(p.profile.reasonCodes).toContain('NO_INDEPENDENT_HISTORY_COVERAGE');
  });

  it('learning memory is authenticated, source-backed and cannot auto-trade', async () => {
    expect((await app.inject({ url: '/api/copy/learning' })).statusCode).toBe(401);
    const res = await app.inject({ url: '/api/copy/learning', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      version: 'WIN-L01', status: 'AWAITING_VERIFIED_LEARNING_INPUTS',
      totalReconstructedClosedLots: 0, studiedRecentClosedLots: 0,
      entryTimeDnaSnapshots: 0, delayedCostedFollowerOutcomes: 0,
      sampledWindowIsCompleteHistory: false, automaticModelPromotion: false,
      canTrade: false, canDisableRisk: false, liveExecution: 'LOCKED',
    });
  });

  it('DEEP returns only inferred anonymous research from existing large-print source', async () => {
    const r = await app.inject({ url: '/api/whales/deep', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('RESEARCH_ONLY');
    expect(r.json().attribution).toBe('INFERRED_ENTITY');
    expect(r.json().executable).toBe(false);
  });

  it('unfollow requires CSRF and preserves lock', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/copy/follow',
      headers: { cookie } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'DELETE', url: '/api/copy/follow',
      headers: { cookie, 'x-mia-csrf': '1' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('NOT_CONFIGURED');
    expect(r.json().liveExecution).toBe('LOCKED_G01_G14');
  });
});
