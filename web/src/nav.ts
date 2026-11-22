/**
 * Navigation metadata — the single source of truth for the sidebar, mobile bar, page tabs and command palette.
 * Presentation only: grouping pages differently never changes routes, permissions or trading authority.
 * Every existing URL stays valid; this file only decides where each page is listed.
 */
export interface NavPage { to: string; icon: string; label: string; desc: string; keywords?: string[] }
export interface NavGroup { id: string; label: string; icon: string; desc: string; pages: NavPage[]; /** extra path prefixes that belong to this group (detail routes) */ also?: string[] }

export const NAV_GROUPS: NavGroup[] = [
  { id: 'home', label: 'Home', icon: '⌂', desc: 'Account, risk and market overview', pages: [
    { to: '/app', icon: '◎', label: 'Overview', desc: 'Paper account, risk monitor, opportunities and activity', keywords: ['dashboard', 'home', 'summary', 'start'] },
  ] },
  { id: 'markets', label: 'Markets', icon: '▥', desc: 'Prices, charts, scanners and market news', also: ['/terminal/'], pages: [
    { to: '/terminal', icon: '▤', label: 'Market Terminal', desc: 'Candlestick chart, indicators and order book', keywords: ['chart', 'candles', 'price', 'order book', 'indicators'] },
    { to: '/scanner', icon: '⌖', label: 'AI Scanner', desc: 'Ranked candidates and why others were rejected', keywords: ['opportunities', 'signals', 'setups', 'rejections'] },
    { to: '/discover', icon: '✧', label: 'Asset Discovery', desc: 'Find and filter supported assets', keywords: ['coins', 'tokens', 'find', 'search assets'] },
    { to: '/bubbles', icon: '◍', label: 'Market Bubble Map', desc: 'Gainers, losers and market breadth', keywords: ['gainers', 'losers', 'breadth', 'movers', 'heatmap'] },
    { to: '/whales', icon: '◈', label: 'Whale & Launch Monitor', desc: 'Large exchange trades (not wallet identities)', keywords: ['whales', 'large trades', 'launches'] },
    { to: '/holders', icon: '⬡', label: 'Holder Map', desc: 'Holder clusters (needs an on-chain provider)', keywords: ['holders', 'on-chain', 'wallet clusters'] },
    { to: '/copy', icon: '⧉', label: 'Whale Intelligence', desc: 'FAST read-only wallet follow and DEEP institutional-footprint research', keywords: ['copy', 'whale', 'follow wallets', 'deep', 'memecoin', 'strategy dna'] },
    { to: '/news', icon: '☰', label: 'News & Events', desc: 'Classified headlines and macro events', keywords: ['headlines', 'macro', 'events', 'calendar events'] },
  ] },
  { id: 'autopilot', label: 'Autopilot', icon: '◉', desc: 'Paper bot, risk limits and strategies', pages: [
    { to: '/bot', icon: '⚙', label: 'Bot Account', desc: 'Paper capital, operating mode and automation state', keywords: ['bot', 'fund', 'deposit', 'allocate', 'paper money', 'mode', 'autopilot'] },
    { to: '/risk', icon: '⛨', label: 'Risk Center', desc: 'Risk policy, limits, incidents and emergency controls', keywords: ['risk', 'limits', 'policy', 'emergency', 'pause', 'stop', 'protection', 'incidents'] },
    { to: '/lab', icon: '⚗', label: 'Strategy Lab', desc: 'Backtests, out-of-sample validation and strategy status', keywords: ['strategies', 'backtest', 'validation', 'promote'] },
  ] },
  { id: 'portfolio', label: 'Portfolio', icon: '◔', desc: 'Positions, results, history and wallets', pages: [
    { to: '/portfolio', icon: '◔', label: 'Portfolio', desc: 'Open positions, exposure and paper balances', keywords: ['positions', 'holdings', 'profit', 'pnl', 'p&l', 'balance', 'equity', 'exposure'] },
    { to: '/history', icon: '≣', label: 'Trading History', desc: 'Paper orders and fills with CSV export', keywords: ['orders', 'fills', 'trades', 'export', 'csv'] },
    { to: '/journal', icon: '✎', label: 'Trade Journal', desc: 'Decisions, interventions and notes', keywords: ['journal', 'notes', 'log'] },
    { to: '/calendar', icon: '▦', label: 'Profit Calendar', desc: 'Daily paper results by month', keywords: ['profit', 'calendar', 'daily results', 'monthly'] },
    { to: '/wallet', icon: '⬗', label: 'Wallet & Withdrawals', desc: 'Address book; real withdrawals are locked', keywords: ['wallet', 'withdraw', 'addresses', 'fund (real wallet, locked)'] },
  ] },
  { id: 'intelligence', label: 'AI Intelligence', icon: '✦', desc: 'Workers, decisions, performance and research', also: ['/decision/'], pages: [
    { to: '/intelligence', icon: '✦', label: 'AI Intelligence', desc: 'The 100 market workers, evidence coverage and consensus (QCI)', keywords: ['ai bots', 'bots', 'workers', 'qci', 'consensus', 'evidence'] },
    { to: '/ditas', icon: '◫', label: 'DITAS Decision Intelligence', desc: 'Decision records, hypothetical twins, calibration, execution quality', keywords: ['ditas', 'decisions', 'calibration', 'twin', 'execution quality'] },
    { to: '/qhef', icon: '⚡', label: 'QHEF Performance', desc: 'Measured latency per processing stage', keywords: ['qhef', 'latency', 'speed', 'performance'] },
    { to: '/academy', icon: '❖', label: 'Quant Academy', desc: 'Your trading library, concepts and research experiments', keywords: ['academy', 'books', 'learn', 'research', 'library', 'concepts'] },
  ] },
  { id: 'settings', label: 'Settings & Security', icon: '⚙', desc: 'Connections, alerts, security and release gates', pages: [
    { to: '/connections', icon: '⇄', label: 'Connections Hub', desc: 'Data providers, credentials and health', keywords: ['api', 'keys', 'providers', 'feeds', 'data sources'] },
    { to: '/notifications', icon: '🔔', label: 'Notifications', desc: 'Alerts and delivery channels', keywords: ['alerts', 'telegram', 'notifications'] },
    { to: '/security', icon: '🛡', label: 'Security Center', desc: 'Sessions, passphrase and audit trail', keywords: ['security', 'sessions', 'password', 'passphrase', 'audit'] },
    { to: '/qa', icon: '✓', label: 'Release Gates', desc: 'Pre-flight checks; live execution stays locked', keywords: ['gates', 'preflight', 'qa', 'certification', 'live'] },
    { to: '/settings', icon: '⚙', label: 'Settings', desc: 'Preferences', keywords: ['settings', 'preferences', 'theme'] },
  ] },
];
/** Trader Joe is a universal launcher, plus a deep-linkable full page. */
export const JOE_PAGE: NavPage = { to: '/joe', icon: '☺', label: 'Trader Joe', desc: 'Assistant: explains markets, decisions and risk (no trading authority)', keywords: ['assistant', 'chat', 'help', 'ask', 'joe'] };

export const ALL_PAGES: NavPage[] = [...NAV_GROUPS.flatMap((g) => g.pages), JOE_PAGE];

const matches = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
/** The group that owns a path (detail routes such as /terminal/BTCUSDT or /decision/:id included); null for /joe and unknown paths. */
export function groupForPath(path: string): NavGroup | null {
  return NAV_GROUPS.find((g) => g.pages.some((p) => matches(path, p.to)) || g.also?.some((a) => path.startsWith(a))) ?? null;
}
export const pageForPath = (path: string) => ALL_PAGES.find((p) => matches(path, p.to)) ?? null;
