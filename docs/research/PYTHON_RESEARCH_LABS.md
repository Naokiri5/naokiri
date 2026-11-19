# Python research labs: NautilusTrader and Freqtrade

Status: **set up and smoke-tested on 2026-11-18**:
- `nautilus_trader==1.231.0`: an offline backtest gave 184 simulated fills on 2,000 synthetic bars.
- `freqtrade==2026.10`: the strategy check passed, and a dry-run backtest made 109 trades on 120 days of synthetic candles.

These are **isolated research environments**, not trading bots and not part of MIA's runtime. Each tool has its own Python virtual environment under `research/python/<tool>/.venv`, which git ignores, so neither shares packages with MIA or with the other. MIA's decision engine, risk gate and paper OMS stay the only path to an order.

## What they are for

| Tool | Use in MIA research |
|---|---|
| **NautilusTrader** | An independent event-driven backtester with a simulated venue. Use it as a second opinion on MIA's paper-OMS behaviour: fills, fees, partial fills, order states and position accounting on the same data, and as a reference design for the future certified Live adapter behind `exec/environment.ts`. |
| **Freqtrade** | A mature strategy and backtest toolkit. Use it to compare strategy results (ROI and stop handling, fees, trade counts) with MIA's Strategy Lab, and to borrow evaluation ideas. Strategies proven here are **not** promoted automatically; they would have to pass MIA's own lab, risk policy and release gates. |

## Start

You need Python 3.13. `uv` is optional but faster.

```bash
scripts/research-python.sh setup all
```

```bash
scripts/research-python.sh smoke all
```

You can also set up or test one tool at a time, e.g. `scripts/research-python.sh smoke nautilus`.

- **Nautilus smoke:** runs `research/python/nautilus/smoke_backtest.py` with Nautilus's own `EMACross` example on a simulated venue. Fully offline and deterministic (fixed seed).
- **Freqtrade smoke:**
  1. Checks the strategy loads.
  2. Writes synthetic candles (`make_synthetic_data.py`).
  3. Runs `freqtrade backtesting` with `MiaResearchEmaCross`.

  It needs to reach `api.kraken.com` once to load the public market list. No keys are used.

**The results come from random synthetic data. They say nothing about profitability.** For real research, download real history inside the lab, e.g. `freqtrade download-data` (still keyless, public endpoints).

## Guard rails

| Rule | Where it is enforced |
|---|---|
| Freqtrade keyless dry run | `dry_run: true`; empty `key`/`secret`; `initial_state: stopped`; `force_entry_enable: false`; no `api_server`; Telegram off. Checked by `server/test/research-python-guard.test.ts` in the **required** CI test job. |
| No live node or exchange adapters | The same test fails if lab code imports `nautilus_trader.live`, `nautilus_trader.adapters`, `TradingNode`, `ccxt`, `requests`, `web3` and similar, or mentions keys, secrets or mnemonics. |
| Pinned dependencies | Exact `==` versions, checked by the same test. |
| Nothing large committed | Environments, data, logs and results are git-ignored. |
| Optional full CI run | `.github/workflows/research-python.yml` runs setup + smoke when lab files change, or on demand. It is not a required check. |

## Behind a forced HTTPS proxy (sandboxes only)

CCXT's async HTTP client ignores proxy settings by default. If `HTTPS_PROXY` is set and you set `MIA_RESEARCH_CA_FILE`, the script adds a temporary extra Freqtrade config that turns on `aiohttp_trust_env` and that CA file. It is never committed. Normal machines don't need this.

## Rollback

Revert this PR, or delete:

- `research/python/`;
- `scripts/research-python.sh`;
- `.github/workflows/research-python.yml`;
- the guard test;
- the `.gitignore` lines.

Delete the local `.venv` folders to free about 1.2 GB.
