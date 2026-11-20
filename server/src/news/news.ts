import { searchNews } from '../providers/googlenews.js';
import { all, run, J, P } from '../db/db.js';
import { sha256, escapeRegExp, safeHttpUrl } from '../core/util.js';
import { market } from '../market/store.js';
import { bus } from '../core/bus.js';
import { notify } from '../notify/notify.js';

/**
 * Part 6 / 30.9 news intelligence. Headlines are UNTRUSTED DATA: classified by a deterministic
 * lexicon, never executed or passed to an LLM as instructions. Impact labels are heuristic.
 */
export const NEWS_QUERIES = ['bitcoin', 'ethereum', 'crypto market', 'solana crypto', 'federal reserve interest rates', 'stock market today', 'dollar forex', 'crypto hack exploit', 'SEC crypto regulation', 'oil gold prices'];
const NEG = /\b(hack(ed)?|exploit(ed)?|drain(ed)?|lawsuit|sue[sd]?|delist(s|ed|ing)?|ban(s|ned)?|crash(es|ed)?|plunge[sd]?|outage|fraud|bankrupt(cy)?|insolven(t|cy)|liquidat(ed|ions?)|sell-?off|investigation|charged|halt(s|ed)?|rug ?pull|scam|tumble[sd]?|slump[sd]?)\b/i;
const POS = /\b(approv(al|ed|es)|inflows?|partnership|upgrade[sd]?|record high|all-time high|surge[sd]?|rall(y|ies|ied)|adoption|soar(s|ed)?|jump(s|ed)?|gain(s|ed)?|launch(es|ed)?|bullish)\b/i;
const MACRO = /\b(fed|fomc|federal reserve|powell|cpi|inflation|rate (hike|cut)|interest rates?|jobs report|nonfarm|payrolls|tariffs?|recession|gdp|treasury yields?|ecb|boj)\b/i;
const TIER1 = /\b(reuters|bloomberg|financial times|wall street journal|wsj|cnbc|associated press|ap news|the economist|coindesk|the block|barron'?s|marketwatch|forbes|axios|nikkei|yahoo finance|investing\.com|fxstreet|decrypt|cointelegraph)\b/i;

export interface NewsItem { id: string; ts: number; title: string; source: string; url: string; query: string; impact: 'HIGH' | 'MEDIUM' | 'LOW'; assets: string[]; credibility: 'ESTABLISHED_OUTLET' | 'UNVERIFIED'; sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'; macro: boolean }

export function classify(title: string, source: string) {
  const neg = NEG.test(title), pos = POS.test(title), macro = MACRO.test(title);
  const cred = TIER1.test(source) || TIER1.test(title) ? 'ESTABLISHED_OUTLET' as const : 'UNVERIFIED' as const;
  const sentiment = neg && !pos ? 'NEGATIVE' as const : pos && !neg ? 'POSITIVE' as const : 'NEUTRAL' as const;
  const impact = (macro && cred === 'ESTABLISHED_OUTLET') || (neg && cred === 'ESTABLISHED_OUTLET') ? 'HIGH' as const : neg || macro || pos ? 'MEDIUM' as const : 'LOW' as const;
  return { sentiment, impact, credibility: cred, macro };
}
export function matchAssets(title: string): string[] {
  const out = new Set<string>(); const T = ` ${title.toLowerCase()} `;
  for (const m of [...market.cg.values()].slice(0, 120)) {
    const name = m.name.toLowerCase();
    if (name.length >= 4 && T.includes(` ${name}`)) out.add(m.symbol);
    // MIA-SEC-004: provider symbols are untrusted text; escape before building a pattern ("USD+(" used to throw).
    else if (m.symbol.length >= 3 && new RegExp(`\\b${escapeRegExp(m.symbol)}\\b`).test(title)) out.add(m.symbol);
  }
  if (/\bbitcoin\b/i.test(title)) out.add('BTC'); if (/\bether(eum)?\b/i.test(title)) out.add('ETH');
  return [...out].slice(0, 8);
}

export async function refreshNews() {
  let added = 0;
  for (const q of NEWS_QUERIES) {
    let items; try { items = await searchNews(q); } catch { continue; }
    for (const it of items.slice(0, 25)) {
      const id = sha256(it.guid || it.link).slice(0, 24);
      const title = it.title.replace(/\s+-\s+[^-]+$/, '');
      const c = classify(title, it.source);
      const assets = matchAssets(title);
      const r = run('INSERT OR IGNORE INTO news(id,ts,fetched_at,title,source,url,query,impact,assets,credibility) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id, it.ts, Date.now(), title, it.source, safeHttpUrl(it.link), q, c.impact, J({ assets, sentiment: c.sentiment, macro: c.macro }), c.credibility);
      if (Number(r.changes) > 0) {
        added++;
        if (c.impact === 'HIGH' && Date.now() - it.ts < 3 * 3600_000) notify('WARNING', `Heads-up: ${title.slice(0, 120)}`, `${it.source} · ${c.macro ? 'macro event' : c.sentiment.toLowerCase()} · affected: ${assets.join(', ') || 'market-wide'}`, 'news');
      }
    }
  }
  if (added) bus.publish('news', { added });
  return added;
}
export function recentNews(limit = 100, sinceMs = 7 * 86400_000, nowTs = Date.now()): NewsItem[] {
  return all<any>('SELECT * FROM news WHERE ts > ? AND ts <= ? ORDER BY ts DESC LIMIT ?', nowTs - sinceMs, nowTs, limit).map((r) => {
    const m = P<any>(r.assets, {});
    return { id: r.id, ts: r.ts, title: r.title, source: r.source, url: r.url, query: r.query, impact: r.impact, assets: m.assets ?? [], credibility: r.credibility, sentiment: m.sentiment ?? 'NEUTRAL', macro: !!m.macro };
  });
}
export function newsContext(base: string, nowTs = Date.now()) {
  // Exclude future rows already persisted by older versions and use the same assessment time for the query and counts.
  const items = recentNews(400, 48 * 3600_000, nowTs);
  if (!items.length) return null;
  const rel = items.filter((i) => i.assets.includes(base) && nowTs - i.ts < 24 * 3600_000);
  return {
    relevant: rel.length, positive: rel.filter((i) => i.sentiment === 'POSITIVE').length, negative: rel.filter((i) => i.sentiment === 'NEGATIVE').length,
    highImpactMacro: items.filter((i) => i.macro && i.impact === 'HIGH' && nowTs - i.ts < 6 * 3600_000).length,
    headlines: rel.slice(0, 5).map((i) => `${i.title} — ${i.source}`),
  };
}
