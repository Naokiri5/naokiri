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
export function parseRss(xml: string): RssItem[] {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? [];
  return (Array.isArray(items) ? items : [items]).map((it: any) => ({
    title: String(it.title ?? '').slice(0, 400),
    link: String(it.link ?? ''),
    source: typeof it.source === 'object' ? String(it.source['#text'] ?? '') : String(it.source ?? ''),
    ts: Date.parse(it.pubDate ?? '') || Date.now(),
    guid: typeof it.guid === 'object' ? String(it.guid['#text']) : String(it.guid ?? it.link),
  }));
}
