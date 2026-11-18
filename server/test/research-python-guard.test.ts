import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * CI guard for the isolated Python research labs (research/python). Runs in the required server test job, without
 * Python: it fails if a lab is ever configured to trade, carries credentials, or imports live-trading machinery.
 */
const repo = (p: string) => new URL(`../../${p}`, import.meta.url);
const read = (p: string) => readFileSync(repo(p), 'utf8');

describe('Freqtrade research config stays a keyless dry-run lab', () => {
  const cfg = JSON.parse(read('research/python/freqtrade/user_data/config.json'));
  it('dry-run only, no keys, no remote control surfaces', () => {
    expect(cfg.dry_run).toBe(true);
    expect(cfg.initial_state).toBe('stopped');
    expect(cfg.force_entry_enable).toBe(false);
    expect(cfg.exchange.key).toBe(''); expect(cfg.exchange.secret).toBe('');
    expect(cfg.exchange.password ?? '').toBe(''); expect(cfg.exchange.uid ?? '').toBe('');
    expect(cfg.exchange.ccxt_config).toEqual({}); expect(cfg.exchange.ccxt_async_config).toEqual({});
    expect(cfg.api_server).toBeUndefined();
    expect(cfg.telegram.enabled).toBe(false); expect(cfg.telegram.token).toBe('');
    expect(cfg.trading_mode).toBe('spot');
  });
});

describe('Python research labs cannot reach live trading', () => {
  it('dependencies are pinned to exact versions', () => {
    for (const f of ['research/python/nautilus/requirements.txt', 'research/python/freqtrade/requirements.txt']) {
      const lines = read(f).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l, f).toMatch(/^[A-Za-z0-9_.-]+==\d[\w.]*$/);
    }
  });
  it('lab code imports no live node, exchange adapter, wallet or HTTP client', () => {
    const src = ['research/python/nautilus/smoke_backtest.py', 'research/python/freqtrade/user_data/strategies/MiaResearchEmaCross.py', 'research/python/freqtrade/make_synthetic_data.py'].map(read).join('\n');
    expect(src).not.toMatch(/nautilus_trader\.(live|adapters)|TradingNode|LiveExecClient/);
    expect(src).not.toMatch(/^\s*(import|from)\s+(ccxt|requests|aiohttp|web3|eth_account|httpx)\b/m);
    expect(src).not.toMatch(/api[_-]?key|secret|private[_-]?key|mnemonic/i);
  });
  it('environments and data are git-ignored', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('research/python/*/.venv/');
    expect(gi).toContain('research/python/freqtrade/user_data/*');
  });
});
