import { describe, it, expect, afterEach } from 'vitest';
import { closeDb, openDb } from '../src/db/db.js';
import { config, listenPort, trustProxyHops } from '../src/config.js';
import { buildApp } from '../src/index.js';

/** Hosting (Railway + Cloudflare) configuration: port selection and proxy trust must be explicit and validated. */
describe('listen port', () => {
  it('defaults to 8787, accepts a platform PORT, and lets MIA_PORT win', () => {
    expect(listenPort({})).toBe(8787);
    expect(listenPort({ PORT: '3000' })).toBe(3000);
    expect(listenPort({ MIA_PORT: '9000', PORT: '3000' })).toBe(9000);
    expect(listenPort({ MIA_PORT: '', PORT: '4100' })).toBe(4100);
  });
  it('rejects malformed values instead of guessing', () => {
    expect(() => listenPort({ PORT: 'abc' })).toThrow(/PORT must be an integer/);
    expect(() => listenPort({ MIA_PORT: '70000' })).toThrow(/MIA_PORT/);
  });
});

describe('trusted proxy hops', () => {
  it('trusts no proxy unless configured, within a small bound', () => {
    expect(trustProxyHops({})).toBe(0);
    expect(trustProxyHops({ MIA_TRUST_PROXY: '2' })).toBe(2);
    expect(() => trustProxyHops({ MIA_TRUST_PROXY: 'true' })).toThrow(/MIA_TRUST_PROXY/);
    expect(() => trustProxyHops({ MIA_TRUST_PROXY: '9' })).toThrow(/MIA_TRUST_PROXY/);
  });

  const prev = config.trustProxyHops;
  afterEach(() => { (config as { trustProxyHops: number }).trustProxyHops = prev; });

  const clientIp = async (hops: number) => {
    (config as { trustProxyHops: number }).trustProxyHops = hops;
    closeDb(); openDb(':memory:');
    const app = await buildApp();
    app.get('/__test/ip', async (req) => ({ ip: req.ip }));
    try {
      // A client spoofs the left-most entry; Cloudflare then Railway append the real hops on the right.
      const r = await app.inject({ url: '/__test/ip', remoteAddress: '10.0.0.7', headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.9, 172.68.1.1' } });
      return (r.json() as { ip: string }).ip;
    } finally { await app.close(); }
  };

  it('ignores X-Forwarded-For by default', async () => {
    expect(await clientIp(0)).toBe('10.0.0.7');
  });
  it('takes the address the configured number of hops from the right, never the spoofed left-most value', async () => {
    expect(await clientIp(1)).toBe('172.68.1.1');
    expect(await clientIp(2)).toBe('203.0.113.9');
  });
});
