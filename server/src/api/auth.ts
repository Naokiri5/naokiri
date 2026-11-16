import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from '../db/db.js';
import { getSetting, setSetting } from '../core/settings.js';
import { sha256 } from '../core/util.js';
import { audit } from '../core/audit.js';

/** Single-owner local authentication. Passphrase hashed with scrypt; sessions stored as SHA-256 of token. */
const SESSION_MS = 12 * 3600_000;
const attempts = new Map<string, { n: number; until: number }>();
export const isSetup = () => !!getSetting<any>('owner', null);
export function setupOwner(pass: string) {
  if (isSetup()) throw new Error('owner already configured');
  if (pass.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = randomBytes(16).toString('hex'); const hash = scryptSync(pass, salt, 64).toString('hex');
  setSetting('owner', { salt, hash, createdAt: Date.now() }); audit('owner', 'auth.setup');
}
export function checkPassword(pass: string) {
  const o = getSetting<any>('owner', null); if (!o || typeof pass !== 'string') return false;
  const h = scryptSync(pass, o.salt, 64); return timingSafeEqual(h, Buffer.from(o.hash, 'hex'));
}
export function login(pass: string, ip: string) {
  const a = attempts.get(ip); if (a && a.until > Date.now()) throw new Error('too many attempts; wait a minute');
  if (!checkPassword(pass)) { const n = (a?.n ?? 0) + 1; attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 }); audit('anonymous', 'auth.login.failed', { ip }); throw new Error('invalid passphrase'); }
  attempts.delete(ip);
  const token = randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?,?,?)', sha256(token), Date.now(), Date.now() + SESSION_MS);
  audit('owner', 'auth.login', { ip }); return token;
}
export function validSession(token?: string) {
  if (!token) return false;
  const r = get<{ expires_at: number }>('SELECT expires_at FROM sessions WHERE token_hash=?', sha256(token));
  return !!r && r.expires_at > Date.now();
}
export function logout(token?: string) { if (token) run('DELETE FROM sessions WHERE token_hash=?', sha256(token)); }
export function changePassword(oldP: string, newP: string) {
  if (!checkPassword(oldP)) throw new Error('current passphrase incorrect');
  if (newP.length < 10) throw new Error('passphrase must be at least 10 characters');
  const salt = randomBytes(16).toString('hex'); setSetting('owner', { salt, hash: scryptSync(newP, salt, 64).toString('hex'), createdAt: Date.now() });
  run('DELETE FROM sessions'); audit('owner', 'auth.password.change');
}
