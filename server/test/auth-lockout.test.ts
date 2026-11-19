import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb } from './helpers.js';
import { buildApp } from '../src/index.js';
import { failureGate } from '../src/core/ratelimit.js';
import * as auth from '../src/api/auth.js';

/**
 * SEC-14 regression: strangers' failed guesses exhaust the server-wide budget, but they must not stop the owner from
 * (a) signing in at the machine itself or (b) running risk-REDUCING actions. Brute-force limits otherwise stay intact.
 */
const PW = 'correct-owner-passphrase';
const json = { 'content-type': 'application/json' };
describe('global lockout cannot block the owner (SEC-14)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  beforeEach(async () => {
    freshDb(); failureGate.reset(); auth.setupOwner(PW); app = await buildApp();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.1', headers: json, payload: { password: PW } });
    cookie = String(ok.headers['set-cookie']).split(';')[0];
    // 20 wrong guesses, each from a different address: the server-wide budget is now exhausted.
    for (let i = 0; i < 20; i++) await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: `198.51.100.${i}`, headers: json, payload: { password: 'wrong-guess-' + i } });
  });
  it('remote sign-in and risk-increasing step-up stay locked (brute-force protection unchanged)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.1', headers: json, payload: { password: PW } })).statusCode).toBe(429);
    const h = { cookie, 'x-mia-csrf': '1', ...json };
    expect((await app.inject({ method: 'POST', url: '/api/control', remoteAddress: '10.0.0.1', headers: h, payload: { mode: 'PAPER', password: PW } })).statusCode).toBe(429);
    // A forwarded request is not "local" even on a loopback socket.
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: { ...json, 'x-forwarded-for': '203.0.113.5' }, payload: { password: PW } })).statusCode).toBe(429);
  });
  it('the owner can still sign in directly at the machine', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: json, payload: { password: PW } });
    expect(r.statusCode).toBe(200);
  });
  it('risk-reducing actions (close all, revoke other sessions) still work with the passphrase', async () => {
    const h = { cookie, 'x-mia-csrf': '1', ...json };
    const close = await app.inject({ method: 'POST', url: '/api/emergency/close-all', remoteAddress: '10.0.0.1', headers: h, payload: { password: PW, confirm: 'CLOSE ALL' } });
    expect(close.statusCode).not.toBe(429); expect(close.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/security/sessions/revoke-others', remoteAddress: '10.0.0.1', headers: h, payload: { password: PW } })).statusCode).toBe(200);
  });
  it('per-client lockout still applies to risk-reducing step-up (no free guessing through it)', async () => {
    const h = { cookie, 'x-mia-csrf': '1', ...json };
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/emergency/close-all', remoteAddress: '10.0.0.9', headers: h, payload: { password: 'bad guess ' + i, confirm: 'CLOSE ALL' } });
    expect((await app.inject({ method: 'POST', url: '/api/emergency/close-all', remoteAddress: '10.0.0.9', headers: h, payload: { password: PW, confirm: 'CLOSE ALL' } })).statusCode).toBe(429);
  });
  it('behind a proxy, a stranger locking the shared IP cannot block the owner\'s close-all (MA-07)', async () => {
    failureGate.reset();
    const proxied = { ...json, 'x-forwarded-for': '203.0.113.50' }; // every client arrives from the proxy's loopback address
    for (let i = 0; i < 6; i++) await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: proxied, payload: { password: 'stranger ' + i } });
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: proxied, payload: { password: PW } })).statusCode).toBe(429); // the IP is locked
    const h = { cookie, 'x-mia-csrf': '1', ...proxied };
    expect((await app.inject({ method: 'POST', url: '/api/emergency/close-all', remoteAddress: '127.0.0.1', headers: h, payload: { password: PW, confirm: 'CLOSE ALL' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/security/sessions/revoke-others', remoteAddress: '127.0.0.1', headers: h, payload: { password: PW } })).statusCode).toBe(200);
  });
  it('behind a proxy, a stranger locking the shared IP cannot block the owner\'s passphrase change (I-01)', async () => {
    failureGate.reset();
    const proxied = { ...json, 'x-forwarded-for': '203.0.113.51' };
    for (let i = 0; i < 6; i++) await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.0.1', headers: proxied, payload: { password: 'stranger ' + i } });
    const h = { cookie, 'x-mia-csrf': '1', ...proxied };
    const r = await app.inject({ method: 'POST', url: '/api/settings/password', remoteAddress: '127.0.0.1', headers: h, payload: { current: PW, next: 'a-new-owner-passphrase' } });
    expect(r.statusCode).toBe(200); // was 429
  });
});
