import { z } from 'zod';
import { config } from '../config.js';
import { limiter } from '../core/ratelimit.js';
import { zonedDateFormatter } from '../core/time.js';
import { fetchProvider, ProviderError, registerProvider } from './http.js';

const ID = 'sec_edgar';
const API_BASE = 'https://data.sec.gov/submissions';
const ARCHIVE_BASE = 'https://www.sec.gov/Archives/edgar/data';
const FORMS = new Set(['10-K', '10-Q', '8-K', '20-F', '6-K']);
const MINUTE_LIMIT = limiter(30, 3);
const newYorkDay = zonedDateFormatter('America/New_York');
const dateOnly = z.iso.date();
const utcTimestamp = z.iso.datetime();
export const secCik = z.string().regex(/^\d{1,10}$/).refine(cik => /[1-9]/.test(cik), 'CIK must be positive')
  .transform(cik => cik.padStart(10, '0'));

function userAgentValid(value: string): boolean {
  // SEC requires a declared organization or application name followed by a contact email.
  return value.length <= 200 && /^[\x20-\x7E]+$/.test(value)
    && /^.+\s[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function secUnavailable() {
  if (config.offline) return 'SEC EDGAR is disabled in offline mode.';
  if (!userAgentValid(config.secUserAgent)) return 'Set MIA_SEC_USER_AGENT to an application or organization name followed by a contact email.';
  return null;
}

const blocked = secUnavailable();
registerProvider({
  id: ID, name: 'SEC EDGAR', sourceClass: 'regulator', markets: ['stocks'],
  license: 'Official SEC EDGAR submissions metadata. SEC Fair Access policy applies.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false,
  status: blocked ? 'DISABLED' : 'IDLE',
  note: blocked ?? 'Recent filings by SEC CIK. Metadata only. No exchange prices or trading access.',
});

const column = z.array(z.string().max(100)).max(20_000);
const recentSchema = z.object({
  accessionNumber: column,
  form: column,
  filingDate: column,
  reportDate: column,
  acceptanceDateTime: column,
  items: z.array(z.string().max(1024)).max(20_000),
}).refine(recent => Object.values(recent).every(values => values.length === recent.form.length), 'Unequal column lengths');

const submissionsSchema = z.object({
  cik: z.union([z.number().int().positive().max(9_999_999_999).transform(String), z.string()]).pipe(secCik),
  filings: z.object({
    recent: recentSchema,
    files: z.array(z.unknown()).max(10_000),
  }),
});

interface Filing {
  accessionNumber: string;
  form: string;
  baseForm: string;
  amendment: boolean;
  filingDate: string;
  reportDate: string | null;
  acceptedAt: string;
  items: string[];
  sourceUrl: string;
}

export function summarizeSubmissions(raw: unknown, cik: string, asOf: string, limit: number) {
  const parsed = submissionsSchema.safeParse(raw);
  if (!parsed.success || parsed.data.cik !== cik) throw new ProviderError(ID, 'invalid submissions metadata');
  const { recent, files } = parsed.data.filings;
  const cutoff = Date.parse(asOf);
  const cutoffDay = newYorkDay(cutoff);
  const filings: Filing[] = [];
  const seen = new Set<string>();
  let excludedInvalid = 0;
  for (const [index, form] of recent.form.entries()) {
    const amendment = form.endsWith('/A');
    const baseForm = amendment ? form.slice(0, -2) : form;
    if (!FORMS.has(baseForm)) continue;
    const accessionNumber = recent.accessionNumber[index];
    const filingDate = recent.filingDate[index];
    const reportDate = recent.reportDate[index];
    const acceptedAt = recent.acceptanceDateTime[index];
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) || !dateOnly.safeParse(filingDate).success
      || (reportDate && !dateOnly.safeParse(reportDate).success) || !utcTimestamp.safeParse(acceptedAt).success) {
      excludedInvalid++;
      continue;
    }
    const acceptedMillis = Date.parse(acceptedAt);
    if (acceptedMillis > cutoff || filingDate > cutoffDay || seen.has(accessionNumber)) continue;
    // Acceptance precedes dissemination for some after-hours filings. For a later filing date with
    // no precise publication timestamp, conservatively require that the filing day has passed.
    if (filingDate > newYorkDay(acceptedMillis) && filingDate === cutoffDay) continue;
    seen.add(accessionNumber);
    filings.push({
      accessionNumber, form, baseForm, amendment, filingDate, reportDate: reportDate || null, acceptedAt,
      items: recent.items[index].split(',').map(item => item.trim()).filter(item => /^\d\.\d{2}$/.test(item)),
      sourceUrl: `${ARCHIVE_BASE}/${Number(cik)}/${accessionNumber.replaceAll('-', '')}/${accessionNumber}-index.htm`,
    });
  }
  filings.sort((a, b) => Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt) || b.accessionNumber.localeCompare(a.accessionNumber));
  return {
    source: ID, cik, asOf, filings: filings.slice(0, limit),
    coverage: { scope: 'RECENT_SUBMISSIONS', historicArchiveParts: files.length, excludedInvalid, matched: filings.length },
    note: 'Research metadata from recent EDGAR submissions. Acceptance is an observed timestamp and an approximation of availability. Historical archive files and filing contents are outside this feed.',
  };
}

export async function secFilings(cik: string, asOf: string, limit: number) {
  MINUTE_LIMIT.take(ID, 'SEC EDGAR research');
  return fetchProvider(ID, `${API_BASE}/CIK${cik}.json`, {
    headers: { 'user-agent': config.secUserAgent },
    redirect: 'error',
    decode: raw => summarizeSubmissions(raw, cik, asOf, limit),
  });
}
