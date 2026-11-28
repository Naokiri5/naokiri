/**
 * Navigation metadata — the single source of truth for the sidebar, mobile bar, page tabs and command palette.
 * Presentation only: grouping pages differently never changes routes, permissions or trading authority.
 * Every existing URL stays valid; this file only decides where each page is listed.
 */
export interface NavPage { to: string; icon: string; label: string; desc: string; keywords?: string[] }
export interface NavGroup { id: string; label: string; icon: string; desc: string; pages: NavPage[]; /** extra path prefixes that belong to this group (detail routes) */ also?: string[] }

const LEGACY_NAV_GROUPS: NavGroup[] = [
  { id: 'home', label: 'Home', icon: '⌂', desc: 'Account, risk and market overview', pages: [
    { to: '/overview', icon: '◎', label: 'Overview', desc: 'Paper account, risk monitor, opportunities and activity', keywords: ['dashboard', 'home', 'summary', 'start'] },
  ] },
  { id: 'markets', label: 'Markets', icon: '▥', desc: 'Prices, charts, scanners and market news', also: ['/terminal/'], pages: [
    { to: '/terminal', icon: '▤', label: 'Market Terminal', desc: 'Candlestick chart, indicators and order book', keywords: ['chart', 'candles', 'price', 'order book', 'indicators'] },
    { to: '/scanner', icon: '⌖', label: 'AI Scanner', desc: 'Ranked candidates and why others were rejected', keywords: ['opportunities', 'signals', 'setups', 'rejections'] },
    { to: '/discover', icon: '✧', label: 'Asset Discovery', desc: 'Find and filter supported assets', keywords: ['coins', 'tokens', 'find', 'search assets'] },
    { to: '/bubbles', icon: '◍', label: 'Market Bubble Map', desc: 'Gainers, losers and market breadth', keywords: ['gainers', 'losers', 'breadth', 'movers', 'heatmap'] },
    { to: '/whales', icon: '◈', label: 'Whale & Launch Monitor', desc: 'Large exchange trades (not wallet identities)', keywords: ['whales', 'large trades', 'launches'] },
    { to: '/holders', icon: '⬡', label: 'Holder Map', desc: 'Holder clusters (needs an on-chain provider)', keywords: ['holders', 'on-chain', 'wallet clusters'] },
    { to: '/copy', icon: '⧉', label: 'Copy Trading', desc: 'Wallet copy rules (needs an on-chain provider)', keywords: ['copy', 'follow wallets'] },
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
/**
 * MIA 6.0 shell: four operator destinations, mapped onto existing functional pages.
 * Trading authority is unchanged. Existing deep links remain searchable and routable.
 * The full legacy catalogue remains data only (not a second sidebar or route registry).
 */
export const NAV_GROUPS: NavGroup[] = [
  { id: 'autopilot', label: 'Autopilot', icon: '◉',
    desc: 'Paper bot, market research, protection and operational status',
    pages: [{ to: '/autopilot', icon: '◉', label: 'Autopilot', desc: 'Existing paper bot and Central Command cockpit' }],
    also: ['/overview', '/bot', '/terminal', '/scanner', '/discover', '/bubbles', '/whales', '/holders', '/copy', '/news', '/intelligence'],
  },
  { id: 'smart-portfolio', label: 'Portfolio', icon: '◔',
    desc: 'Paper holdings, performance and historical records',
    pages: [{ to: '/smart-portfolio', icon: '◔', label: 'Portfolio', desc: 'Canonical paper ledger and position view' }],
    also: ['/portfolio', '/history', '/journal', '/calendar', '/wallet'],
  },
  { id: 'trader-joe', label: 'Trader Joe', icon: '☺',
    desc: 'Explanations, verifiable decisions and knowledge',
    pages: [{ to: '/trader-joe', icon: '☺', label: 'Trader Joe', desc: 'Existing permission-limited assistant' }],
    also: ['/joe', '/ditas', '/academy', '/decision'],
  },
  { id: 'settings', label: 'Settings', icon: '⚙',
    desc: 'Risk policies, strategies, connections, security and release gates',
    pages: [{ to: '/settings', icon: '⚙', label: 'Settings', desc: 'Account and operational preferences' }],
    also: ['/risk', '/lab', '/connections', '/notifications', '/security', '/qa', '/qhef'],
  },
];

/** Legacy Joe link remains indexed for bookmarks and command-palette search. */
export const JOE_PAGE: NavPage = { to: '/joe', icon: '☺', label: 'Trader Joe (legacy link)',
  desc: 'Permission-limited assistant; legacy route', keywords: ['assistant', 'chat', 'help', 'joe'] };

export const ALL_PAGES: NavPage[] = [
  ...NAV_GROUPS.flatMap((g) => g.pages),
  ...LEGACY_NAV_GROUPS.flatMap((g) => g.pages).filter((p) => !NAV_GROUPS.some((g) => g.pages.some((n) => n.to === p.to))),
  JOE_PAGE,
];

const matches = (path: string, to: string) => path === to || path.startsWith(`${to}/`);
const canonicalPath = (path: string) =>
  path === '/app' || path === '/app/' ? '/autopilot' :
    path.startsWith('/app/') ? path.slice(4) : path;

/** Map any known legacy deep link to its MIA 6.0 owning surface. */
export function groupForPath(path: string): NavGroup | null {
  const normalized = canonicalPath(path);
  return NAV_GROUPS.find((group) =>
    group.pages.some((page) => matches(normalized, page.to)) ||
    group.also?.some((prefix) => matches(normalized, prefix)),
  ) ?? null;
}

export const pageForPath = (path: string) =>
  ALL_PAGES.find((page) => matches(canonicalPath(path), page.to)) ?? null;
