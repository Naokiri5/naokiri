import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { sha256 } from '../core/util.js';
import { audit } from '../core/audit.js';
import { failureGate } from '../core/ratelimit.js';

export class AuthError extends Error { statusCode: number; constructor(msg: string, code = 401) { super(msg); this.statusCode = code; } }

/** Single-owner local authentication. Passphrase hashed with scrypt; sessions stored as SHA-256 of token. */
const SESSION_MS = 12 * 3600_000;
export const isSetup = () => !!getSetting<any>('owner', null);
export function setupOwner(pass: string) {
  if (isSetup()) throw new Error('owner already configured');
  if (pass.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = randomBytes(16).toString('hex'); const hash = scryptSync(pass, salt, 64).toString('hex');
  setSetting('owner', { salt, hash, createdAt: Date.now() }); audit('owner', 'auth.setup');
}
export function checkPassword(pass: string) {
  const o = getSetting<any>('owner', null); if (!o || typeof pass !== 'string' || pass.length > 1024) return false;
  const h = scryptSync(pass, o.salt, 64); return timingSafeEqual(h, Buffer.from(o.hash, 'hex'));
}
/**
 * The ONE place a passphrase is verified for login, step-up and passphrase change, so every path shares the
 * per-client and global brute-force limits (previously only login was limited and step-up could be guessed freely).
 */
export function verifyPassphrase(pass: unknown, client: string, purpose: string) {
  failureGate.check(client);
  if (typeof pass === 'string' && checkPassword(pass)) { failureGate.ok(client); return; }
  failureGate.fail(client);
  audit('anonymous', purpose === 'login' ? 'auth.login.failed' : 'auth.stepup.failed', { ip: client, purpose });
  throw new AuthError(purpose === 'login' ? 'invalid passphrase' : 'step-up authentication failed: passphrase required for this action', purpose === 'login' ? 401 : 403);
}
export function login(pass: string, ip: string) {
  verifyPassphrase(pass, ip, 'login');
  return createSession(ip, 'passphrase');
}
/** One established MIA cookie/session table, shared by password recovery and verified Privy owner. */
export function createSession(ip: string, method: 'passphrase' | 'privy') {
  run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
  const token = randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?,?,?)',
    sha256(token), Date.now(), Date.now() + SESSION_MS);
  audit('owner', 'auth.login', { ip, method });
  return token;
}
export function revokeAllSessions() { run('DELETE FROM sessions'); }

export function validSession(token?: string) {
  if (!token) return false;
  const r = get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token_hash=?', sha256(token));
  return !!r && r.expires_at > Date.now();
}
export function logout(token?: string) { if (token) run('DELETE FROM sessions WHERE token_hash=?', sha256(token)); }
export function changePassword(oldP: string, newP: string, client = 'local') {
  verifyPassphrase(oldP, client, 'password.change');
  if (newP.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = randomBytes(16).toString('hex'); setSetting('owner', { salt, hash: scryptSync(newP, salt, 64).toString('hex'), createdAt: Date.now() });
  run('DELETE FROM sessions'); audit('owner', 'auth.password.change');
}
