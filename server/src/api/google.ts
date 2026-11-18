import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { sha256 } from '../core/util.js';

export const GOOGLE_CALLBACK = '/api/auth/google/callback';
const FLOW_COOKIE = '__Host-mia_google';
const FLOW_SECONDS = 300;
const cookieFlags = 'Path=/; HttpOnly; Secure; SameSite=Lax';
export const clearGoogleFlow = `${FLOW_COOKIE}=; ${cookieFlags}; Max-Age=0`;

export function googleConfig() {
  const { MIA_GOOGLE_CLIENT_ID: clientId, MIA_GOOGLE_CLIENT_SECRET: secret, MIA_GOOGLE_REDIRECT_URI: redirect } = process.env;
  if (!config.secureCookie || !clientId || !secret || !redirect) return null;
  try {
    const url = new URL(redirect);
    if (url.protocol !== 'https:' || url.pathname !== GOOGLE_CALLBACK || url.search || url.hash || url.username || url.password) return null;
    return { clientId, secret, redirect };
  } catch { return null; }
}
type GoogleConfig = NonNullable<ReturnType<typeof googleConfig>>;

const Flow = z.object({
  state: z.string().length(43),
  verifier: z.string().length(43),
  expires: z.number(),
  sessionHash: z.string().length(64).nullable(),
});
const sign = (value: string, cfg: GoogleConfig) => createHmac('sha256', cfg.secret).update(value).digest();

export function startGoogleFlow(cfg: GoogleConfig, ownerToken?: string) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const flow = { state, verifier, expires: Date.now() + FLOW_SECONDS * 1000, sessionHash: ownerToken ? sha256(ownerToken) : null };
  const encoded = Buffer.from(JSON.stringify(flow)).toString('base64url');
  const cookie = `${FLOW_COOKIE}=${encoded}.${sign(encoded, cfg).toString('base64url')}; ${cookieFlags}; Max-Age=${FLOW_SECONDS}`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirect, response_type: 'code', scope: 'openid', state,
    code_challenge: Buffer.from(sha256(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return { cookie, url: url.href };
}

export function readGoogleFlow(cfg: GoogleConfig, cookies: string, state: string) {
  const value = cookies.split(/;\s*/).find(cookie => cookie.startsWith(`${FLOW_COOKIE}=`))?.slice(FLOW_COOKIE.length + 1);
  if (!value || value.length > 1024) return null;
  const [encoded, signature, extra] = value.split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  const actual = Buffer.from(signature, 'base64url');
  const expected = sign(encoded, cfg);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const flow = Flow.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    return flow.expires > Date.now() && flow.state === state ? flow : null;
  } catch { return null; }
}

/** Resolve the subject through Google's HTTPS UserInfo endpoint using only the access token received from its code exchange. */
export async function googleSubject(cfg: GoogleConfig, code: string, verifier: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, code,
      code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: cfg.redirect }),
  });
  if (!response.ok) throw new Error('Google rejected the authorization code');
  const token = z.object({ access_token: z.string().min(1).max(8192) }).parse(await response.json());
  const profile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(8_000),
  });
  if (!profile.ok) throw new Error('Google UserInfo request failed');
  return z.object({ sub: z.string().min(1).max(255) }).parse(await profile.json()).sub;
}
