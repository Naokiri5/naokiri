import { XMLParser } from 'fast-xml-parser';
import { fetchProvider, registerProvider, setRateLimit } from './http.js';
registerProvider({
  id: 'googlenews', name: 'Google News RSS', sourceClass: 'news', markets: ['all'],
  license: 'RESTRICTED: feed terms permit personal, non-commercial feed-reader use only. Replace with a licensed news API before commercial use.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('googlenews', 10);
const parser = new XMLParser({ ignoreAttributes: false });
export interface RssItem { title: string; link: string; source: string; ts: number; guid: string }
export async function searchNews(q: string): Promise<RssItem[]> {
  const xml = await fetchProvider('googlenews', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { as: 'text' });
  return parseRss(xml);
}
export function parseRss(xml: string, nowTs = Date.now()): RssItem[] {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? [];
  const text = (value: unknown) => value && typeof value === 'object' && '#text' in value
    ? String(value['#text'] ?? '') : String(value ?? '');
  const out: RssItem[] = [];
  if (!Number.isFinite(nowTs) || nowTs < 0) return out;
  for (const raw of Array.isArray(items) ? items : [items]) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const ts = typeof it.pubDate === 'string' ? Date.parse(it.pubDate) : NaN;
    // Publication time is evidence, not receipt time. An undated or future story cannot count as recent news.
    if (!Number.isFinite(ts) || ts < 0 || ts > nowTs) continue;
    out.push({ title: text(it.title).slice(0, 400), link: text(it.link), source: text(it.source), ts,
      guid: text(it.guid ?? it.link) });
  }
  return out;
}
