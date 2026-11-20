import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb } from './helpers.js';
import { J, run } from '../src/db/db.js';
import { parseRss } from '../src/providers/googlenews.js';
import { newsContext, recentNews } from '../src/news/news.js';

const NOW = 1_800_000_000_000;
const rss = (date?: string) => `<rss><channel><item><title>Synthetic timestamp fixture</title><link>https://example.invalid/news</link>${date === undefined ? '' : `<pubDate>${date}</pubDate>`}<source>Fixture outlet</source></item></channel></rss>`;

describe('news evidence timestamp integrity (B-07)', () => {
  beforeEach(() => freshDb());

  it.each([undefined, '', 'not a publication date', new Date(NOW + 60_000).toUTCString()])('omits missing, invalid or future publication time: %s', date => {
    expect(parseRss(rss(date), NOW)).toEqual([]);
  });

  it('keeps the reported publication time, including the epoch, without substituting receipt time', () => {
    const published = NOW - 60_000;
    expect(parseRss(rss(new Date(published).toUTCString()), NOW)[0].ts).toBe(published);
    expect(parseRss(rss(new Date(0).toUTCString()), NOW)[0].ts).toBe(0);
    expect(parseRss(rss(new Date(NOW).toUTCString()), NOW)[0].ts).toBe(NOW);
  });

  it('excludes already-stored future rows from recent news and worker evidence at the supplied assessment time', () => {
    const insert = (id: string, ts: number, sentiment: string) => run(
      'INSERT INTO news(id,ts,fetched_at,title,source,url,query,impact,assets,credibility) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, ts, NOW, id, 'Synthetic fixture', 'https://example.invalid/news', 'test', 'HIGH',
      J({ assets: ['BTC'], sentiment, macro: true }), 'UNVERIFIED',
    );
    insert('past', NOW - 60_000, 'POSITIVE');
    insert('current', NOW, 'POSITIVE');
    insert('future', NOW + 60_000, 'NEGATIVE');
    insert('old', NOW - 8 * 86400_000, 'NEGATIVE');
    expect(recentNews(100, 7 * 86400_000, NOW).map(item => item.id)).toEqual(['current', 'past']);
    expect(newsContext('BTC', NOW)).toMatchObject({ relevant: 2, positive: 2, negative: 0, highImpactMacro: 2 });
    expect(newsContext('BTC', NOW - 8 * 86400_000)).toMatchObject({ relevant: 1, negative: 1 });
  });
});
