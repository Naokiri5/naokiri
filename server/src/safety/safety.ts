import { market } from '../market/store.js';
import { bookImpact, bookAge, QUALITY_LIMITS } from '../market/quality.js';
import type { DexPair } from '../providers/dexscreener.js';

/** Part 2.5 asset safety classification. Incomplete checks can never yield a "safe" verdict. */
export type SafetyStatus = 'APPROVED_FOR_MONITORING' | 'CAUTION' | 'HIGH_RISK' | 'REJECTED' | 'UNVERIFIED';
export interface SafetyResult { status: SafetyStatus; reasons: string[]; checks: { name: string; result: 'PASS' | 'WARN' | 'FAIL' | 'NOT_AVAILABLE'; detail: string }[]; eligibleForAutomation: boolean }
export const SAFETY_LIMITS = { minQuoteVolume24h: 5_000_000, maxSpreadBps: 15, minDepth1pct: 150_000, pumpPct24h: 35, minTrades24h: 20_000 };

const rank: Record<SafetyStatus, number> = { APPROVED_FOR_MONITORING: 0, CAUTION: 1, UNVERIFIED: 2, HIGH_RISK: 3, REJECTED: 4 };
const worst = (a: SafetyStatus, b: SafetyStatus) => (rank[a] >= rank[b] ? a : b);

const finite = (...xs: unknown[]) => xs.every((x) => typeof x === 'number' && Number.isFinite(x));
export function assessCexAsset(instrumentId: string, nowTs = Date.now()): SafetyResult {
  const checks: SafetyResult['checks'] = []; const reasons: string[] = [];
  let status: SafetyStatus = 'APPROVED_FOR_MONITORING';
  const t = market.tickers.get(instrumentId); const d = market.deep.get(instrumentId);
  const add = (name: string, result: SafetyResult['checks'][0]['result'], detail: string, s?: SafetyStatus) => { checks.push({ name, result, detail }); if (s) { status = worst(status, s); reasons.push(`${name}: ${detail}`); } };
  if (!t) { add('market data', 'FAIL', 'no ticker', 'UNVERIFIED'); return { status, reasons, checks, eligibleForAutomation: false }; }
  // MIA-SAFE-001: a malformed field (NaN compares false) or an old snapshot must never read as PASS.
  const tAge = nowTs - Number(t.receivedAt);
  if (!finite(t.quoteVolume, t.trades, t.changePct) || !(tAge >= 0 && tAge <= QUALITY_LIMITS.maxQuoteAgeMs)) {
    add('market data', 'NOT_AVAILABLE', !finite(t.quoteVolume, t.trades, t.changePct) ? 'ticker fields are not valid numbers' : 'ticker is stale or future-dated', 'UNVERIFIED');
    return { status, reasons, checks, eligibleForAutomation: false };
  }
  t.quoteVolume >= SAFETY_LIMITS.minQuoteVolume24h ? add('24h volume', 'PASS', `$${fmt(t.quoteVolume)}`) : add('24h volume', 'FAIL', `$${fmt(t.quoteVolume)} < $${fmt(SAFETY_LIMITS.minQuoteVolume24h)}`, 'REJECTED');
  t.trades >= SAFETY_LIMITS.minTrades24h ? add('participation', 'PASS', `${t.trades} trades/24h`) : add('participation', 'WARN', `${t.trades} trades/24h`, 'CAUTION');
  const bAge = bookAge(d?.book ?? null, nowTs);
  const imp = bAge != null && bAge <= QUALITY_LIMITS.maxBookAgeMs ? bookImpact(d?.book ?? null, 'buy', 1000) : null;
  if (!imp) add('order book', 'NOT_AVAILABLE', bAge == null ? 'no depth snapshot' : 'depth snapshot is stale', 'UNVERIFIED');
  else {
    imp.spreadBps <= SAFETY_LIMITS.maxSpreadBps ? add('spread', 'PASS', `${imp.spreadBps.toFixed(1)} bps`) : add('spread', 'FAIL', `${imp.spreadBps.toFixed(1)} bps > ${SAFETY_LIMITS.maxSpreadBps}`, 'HIGH_RISK');
    imp.depth1pct >= SAFETY_LIMITS.minDepth1pct ? add('depth ±1%', 'PASS', `$${fmt(imp.depth1pct)}`) : add('depth ±1%', 'WARN', `$${fmt(imp.depth1pct)} < $${fmt(SAFETY_LIMITS.minDepth1pct)}`, 'CAUTION');
  }
  Math.abs(t.changePct) >= SAFETY_LIMITS.pumpPct24h ? add('pump/dump pattern', 'FAIL', `${t.changePct.toFixed(1)}% in 24h`, 'HIGH_RISK') : add('pump/dump pattern', 'PASS', `${t.changePct.toFixed(1)}% in 24h`);
  const cg = market.cg.get(t.base);
  if (!cg) add('market-cap reference', 'NOT_AVAILABLE', 'not in CoinGecko top-250 (or not yet loaded)', 'CAUTION');
  else {
    add('market-cap reference', 'PASS', `rank #${cg.rank}, mcap $${fmt(cg.marketCap)}`);
    const turnover = finite(cg.marketCap, cg.volume) && cg.marketCap > 0 ? cg.volume / cg.marketCap : NaN;
    if (!Number.isFinite(turnover)) add('wash-trading proxy (volume/mcap)', 'NOT_AVAILABLE', 'market cap or volume missing', 'CAUTION');
    else turnover > 1.5 ? add('wash-trading proxy (volume/mcap)', 'WARN', `${turnover.toFixed(2)}× daily turnover`, 'CAUTION') : add('wash-trading proxy (volume/mcap)', 'PASS', `${turnover.toFixed(2)}×`);
  }
  const eligible = status === 'APPROVED_FOR_MONITORING' || status === 'CAUTION';
  return { status, reasons, checks, eligibleForAutomation: eligible };
}

/** DEX aggregate observations support research and screening. Critical safety checks require verified on-chain evidence. */
export function assessDexPair(p: DexPair, nowTs = Date.now()): SafetyResult & { eligibleForAutomation: false } {
  const checks: SafetyResult['checks'] = []; const reasons: string[] = [];
  let status: SafetyStatus = 'CAUTION';
  const add = (name: string, result: SafetyResult['checks'][0]['result'], detail: string, s?: SafetyStatus) => { checks.push({ name, result, detail }); if (s) { status = worst(status, s); reasons.push(`${name}: ${detail}`); } };
  add('contract permissions / sell simulation', 'NOT_AVAILABLE', 'EVM/Solana RPC provider not configured — honeypot checks incomplete', 'UNVERIFIED');
  if (!Number.isFinite(p.liquidityUsd)) add('pool liquidity', 'FAIL', 'liquidity not reported', 'REJECTED'); // MIA-SAFE-002
  else if (p.liquidityUsd < 10_000) add('pool liquidity', 'FAIL', `$${fmt(p.liquidityUsd)}`, 'REJECTED');
  else if (p.liquidityUsd < 100_000) add('pool liquidity', 'WARN', `$${fmt(p.liquidityUsd)}`, 'HIGH_RISK');
  else add('pool liquidity', 'PASS', `$${fmt(p.liquidityUsd)} in reported aggregate liquidity`);
  if (p.buys24h > 30 && p.sells24h === 0) add('sell activity', 'FAIL', `${p.buys24h} buys, 0 sells — possible honeypot`, 'REJECTED');
  else if (p.sells24h > 0 && p.buys24h / p.sells24h > 5) add('buy/sell imbalance', 'WARN', `${p.buys24h}/${p.sells24h}`, 'HIGH_RISK');
  else add('sell activity', 'PASS', `${p.buys24h} buys / ${p.sells24h} sells`);
  // Milliseconds only: a seconds value (< 1e12) would read as ~50 years old and skip the new-pair warning.
  const created = typeof p.pairCreatedAt === 'number' && Number.isFinite(p.pairCreatedAt) && p.pairCreatedAt >= 1e12 && p.pairCreatedAt <= nowTs ? p.pairCreatedAt : null;
  const ageH = created ? (nowTs - created) / 3600_000 : null;
  if (ageH == null) add('pair age', 'NOT_AVAILABLE', 'unknown or invalid creation time', 'UNVERIFIED');
  else if (ageH < 24) add('pair age', 'WARN', `${ageH.toFixed(1)}h old`, 'HIGH_RISK'); else add('pair age', 'PASS', `${(ageH / 24).toFixed(1)}d`);
  if (p.liquidityUsd > 0 && p.fdv / p.liquidityUsd > 200) add('FDV/liquidity', 'WARN', `${(p.fdv / p.liquidityUsd).toFixed(0)}×`, 'HIGH_RISK');
  if (p.volume24h > 0 && p.liquidityUsd > 0 && p.volume24h / p.liquidityUsd > 50) add('volume/liquidity (wash proxy)', 'WARN', `${(p.volume24h / p.liquidityUsd).toFixed(0)}×`, 'HIGH_RISK');
  if (Math.abs(p.change24h) > 300) add('pump/dump pattern', 'WARN', `${p.change24h.toFixed(0)}% 24h`, 'HIGH_RISK');
  if (!p.hasWebsite && !p.hasSocials) add('project metadata', 'WARN', 'no website or socials', 'CAUTION');
  add('executable sell-side depth', 'NOT_AVAILABLE',
    'DEX Screener reports aggregate USD liquidity. Verified route data is required to evaluate exit reserves and price impact at the intended size.', 'UNVERIFIED');
  add('intended sell proceeds', 'NOT_AVAILABLE',
    'Historical sell counts describe past activity. A verified full-size sell simulation is required to estimate proceeds and transfer taxes.', 'UNVERIFIED');
  add('LP control and lock', 'NOT_AVAILABLE', 'Pool withdrawal permissions and liquidity lock claims require on-chain verification.', 'UNVERIFIED');
  add('holder concentration', 'NOT_AVAILABLE', 'Ownership concentrations and related holder wallets require verified on-chain evidence.', 'UNVERIFIED');
  return { status, reasons, checks, eligibleForAutomation: false };
}
const fmt = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : x.toFixed(0));
