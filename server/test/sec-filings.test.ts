import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { closeDb, openDb } from '../src/db/db.js';
import { buildApp } from '../src/index.js';
import { provider } from '../src/providers/http.js';
import { secCik, summarizeSubmissions } from '../src/providers/sec.js';

const cik = '0000000042';
const recent = {
  accessionNumber: ['0000000042-26-000001', '0000000042-26-000002', '0000000042-26-000003', '0000000042-26-000004'],
  form: ['10-K', '8-K', '10-K/A', '4'],
  filingDate: ['2026-03-30', '2026-04-03', '2026-04-07', '2026-04-01'],
  reportDate: ['2025-12-31', '2026-04-01', '2025-12-31', ''],
  acceptanceDateTime: ['2026-03-30T20:01:02.000Z', '2026-04-02T22:30:00.000Z', '2026-04-07T20:01:02.000Z', ''],
  items: ['', '2.02, 9.01', '', ''],
};
const fixture = { cik: '42', filings: { recent, files: [{ name: 'archived.json' }] } };

describe('SEC EDGAR filing metadata', () => {
  it('canonicalizes CIKs and refuses zero, URLs and overlong values', () => {
    expect(secCik.parse('42')).toBe(cik);
    for (const input of ['0', '00000000000', 'https://example.test', '-42', '%2f']) {
      expect(secCik.safeParse(input).success).toBe(false);
    }
  });

  it('preserves independent dates, amendments, 8-K item codes and links to the source', () => {
    const report = summarizeSubmissions(fixture, cik, '2026-04-10T00:00:00Z', 3);
    expect(report.coverage).toMatchObject({ historicArchiveParts: 1, matched: 3, excludedInvalid: 0 });
    expect(report.filings.map(f => f.form)).toEqual(['10-K/A', '8-K', '10-K']);
    expect(report.filings[0]).toMatchObject({
      amendment: true, baseForm: '10-K', filingDate: '2026-04-07', reportDate: '2025-12-31',
      acceptedAt: '2026-04-07T20:01:02.000Z',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/42/000000004226000003/0000000042-26-000003-index.htm',
    });
    expect(report.filings[1].items).toEqual(['2.02', '9.01']);
  });

  it('respects the UTC acceptance cutoff and waits until a later filing day passes in New York', () => {
    expect(summarizeSubmissions(fixture, cik, '2026-03-30T20:01:01Z', 5).filings).toHaveLength(0);
    expect(summarizeSubmissions(fixture, cik, '2026-03-30T20:01:02Z', 5).filings.map(f => f.form)).toEqual(['10-K']);
    expect(summarizeSubmissions(fixture, cik, '2026-04-04T03:59:59Z', 5).filings.map(f => f.form)).toEqual(['10-K']);
    expect(summarizeSubmissions(fixture, cik, '2026-04-04T04:00:00Z', 5).filings.map(f => f.form)).toEqual(['8-K', '10-K']);
  });

  it('rejects mismatched issuer and malformed column alignment while reporting rows with unknown timestamps', () => {
    const summarize = (raw: unknown) => summarizeSubmissions(raw, cik, '2026-04-10T00:00:00Z', 1);
    expect(() => summarize({ ...fixture, cik: '43' })).toThrow(/invalid submissions/);
    expect(() => summarize({ ...fixture, filings: { ...fixture.filings, recent: { ...recent, form: ['10-K'] } } })).toThrow(/invalid submissions/);
    const withMissingTime = { ...recent, acceptanceDateTime: ['', ...recent.acceptanceDateTime.slice(1)] };
    expect(summarize({ ...fixture, filings: { ...fixture.filings, recent: withMissingTime } })).toMatchObject({
      coverage: { matched: 2, excludedInvalid: 1 }, filings: [{ form: '10-K/A' }],
    });
  });
});

describe('filing research route', () => {
  const initial = { offline: config.offline, secUserAgent: config.secUserAgent };
  let app: Awaited<ReturnType<typeof buildApp>>;
  let headers: { cookie: string };

  beforeAll(async () => {
    openDb(':memory:');
    app = await buildApp();
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'test owner passphrase' } });
    expect(setup.statusCode).toBe(200);
    headers = { cookie: String(setup.headers['set-cookie']).split(';')[0] };
  });
  afterEach(() => {
    Object.assign(config, initial);
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    closeDb();
  });

  const get = (path: string) => app.inject({ url: `/api/research/filings/${path}`, headers });

  it('validates requests and never calls SEC without auth, while offline or without a contact User-Agent', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    expect((await app.inject('/api/research/filings/42')).statusCode).toBe(401);
    expect((await get('0')).statusCode).toBe(400);
    expect((await get('42?asOf=9999-01-01T00:00:00Z')).statusCode).toBe(400);
    expect((await get('42?limit=101')).statusCode).toBe(400);
    const offline = await get('42');
    expect(offline.statusCode).toBe(503);
    expect(offline.json()).toMatchObject({ status: 'UNAVAILABLE', error: expect.stringMatching(/offline/) });
    Object.assign(config, { offline: false, secUserAgent: 'Missing email' });
    const unavailable = await get('42');
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ source: 'sec_edgar', error: expect.stringMatching(/MIA_SEC_USER_AGENT/) });
    expect(outbound).not.toHaveBeenCalled();
  });

  it('requests the canonical SEC URL using the configured contact header', async () => {
    Object.assign(config, { offline: false, secUserAgent: 'Synthetic test contact@example.test' });
    const outbound = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(fixture));
    const r = await get('42?asOf=2026-04-04T04:00:00Z&limit=1');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ cik, coverage: { matched: 2 }, filings: [{ form: '8-K' }] });
    expect(outbound).toHaveBeenCalledExactlyOnceWith('https://data.sec.gov/submissions/CIK0000000042.json', expect.objectContaining({
      redirect: 'error',
      headers: expect.objectContaining({ 'user-agent': config.secUserAgent }),
    }));
  });

  it('returns a provider error for invalid upstream submissions', async () => {
    Object.assign(config, { offline: false, secUserAgent: 'Synthetic test contact@example.test' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...fixture, cik: '43' }));
    const response = await get('42');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ error: expect.stringMatching(/upstream.*sec_edgar/) });
    expect(provider('sec_edgar')?.status).toMatch(/DEGRADED|DOWN/);
  });
});
