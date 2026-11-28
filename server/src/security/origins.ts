import type { IncomingHttpHeaders } from 'node:http';

function parseOrigin(value: string): URL | null {
  // An Origin is a serialized scheme and authority, without a path, userinfo or a list of origins.
  if (!/^https?:\/\/[^\s,/?#@\\%*]+$/i.test(value)) return null;
  return URL.parse(value);
}

export function readPublicOrigin(value: string | undefined): string | undefined {
  const setting = value?.trim();
  if (!setting) return undefined;
  const origin = parseOrigin(setting.replace(/\/$/, ''));
  const local = origin && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (!origin || (origin.protocol !== 'https:' && !local)) {
    throw new Error('MIA_PUBLIC_ORIGIN must be an HTTPS origin or an HTTP origin on loopback, without a path');
  }
  return origin.origin;
}

/** Apply browser-origin restrictions alongside the independent session and CSRF checks. */
export function allowsApiOrigin(headers: IncomingHttpHeaders, scheme: 'http' | 'https', publicOrigin?: string): boolean {
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  const raw = headers.origin;
  if (raw === undefined) return true; // Health probes and non-browser clients can omit both browser headers.
  const origin = typeof raw === 'string' ? parseOrigin(raw)?.origin : undefined;
  if (origin === undefined) return false;
  // Ignore Forwarded and X-Forwarded-* values. A proxy that rewrites Host can use the explicit public origin.
  const expected = publicOrigin ?? (headers.host ? parseOrigin(`${scheme}://${headers.host}`)?.origin : undefined);
  return origin === expected;
}
