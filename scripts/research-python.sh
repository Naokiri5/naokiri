#!/usr/bin/env bash
# Isolated Python research labs for MIA: NautilusTrader and Freqtrade.
# Each tool gets its own virtual environment under research/python/<tool>/.venv (git-ignored). Nothing here is part of
# MIA's runtime, and nothing here may trade: Nautilus runs a simulated venue only; Freqtrade runs dry-run backtests
# with no exchange keys. MIA's decision engine, risk gate and paper OMS stay the only trading path.
#
# Usage:  scripts/research-python.sh setup  [nautilus|freqtrade|all]
#         scripts/research-python.sh smoke  [nautilus|freqtrade|all]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAB="$ROOT/research/python"
PY="${MIA_RESEARCH_PYTHON:-3.13}"
cmd="${1:-}"; target="${2:-all}"

tools() { case "$target" in all) echo nautilus freqtrade ;; nautilus|freqtrade) echo "$target" ;; *) echo "unknown tool: $target" >&2; exit 2 ;; esac; }

setup_one() {
  local dir="$LAB/$1"
  echo "==> $1: creating isolated environment in $dir/.venv"
  if command -v uv >/dev/null 2>&1; then
    (cd "$dir" && uv venv -q --python "$PY" .venv && VIRTUAL_ENV="$dir/.venv" uv pip install -q -r requirements.txt)
  else
    (cd "$dir" && "python$PY" -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt)
  fi
}

# Only inside a network that forces an HTTPS proxy (e.g. a sandbox): let CCXT's aiohttp use it and trust its CA.
# Normal machines skip this. The extra config is temporary and never committed.
proxy_config() {
  local ca="${MIA_RESEARCH_CA_FILE:-${SSL_CERT_FILE:-}}"
  if [[ -n "${HTTPS_PROXY:-}" && -n "$ca" ]]; then
    local t; t="$(mktemp --suffix .json)"
    printf '{"exchange":{"ccxt_config":{"cafile":"%s"},"ccxt_async_config":{"aiohttp_trust_env":true,"cafile":"%s"}}}' "$ca" "$ca" > "$t"
    echo "$t"
  fi
}

smoke_one() {
  local dir="$LAB/$1"
  [[ -x "$dir/.venv/bin/python" ]] || { echo "$1: not set up. Run: scripts/research-python.sh setup $1" >&2; exit 1; }
  case "$1" in
    nautilus)
      echo "==> nautilus: offline backtest on synthetic bars (simulated venue)"
      (cd "$dir" && .venv/bin/python -W ignore smoke_backtest.py) ;;
    freqtrade)
      echo "==> freqtrade: strategy check + dry-run backtest on synthetic candles (no keys)"
      local extra; extra="$(proxy_config)"
      local cfg=(-c user_data/config.json); [[ -n "$extra" ]] && cfg+=(-c "$extra")
      (cd "$dir" && .venv/bin/freqtrade create-userdir --userdir user_data >/dev/null \
        && rm -f user_data/strategies/sample_strategy.py \
        && .venv/bin/freqtrade list-strategies --userdir user_data "${cfg[@]}" \
        && .venv/bin/python make_synthetic_data.py \
        && .venv/bin/freqtrade backtesting --userdir user_data "${cfg[@]}" --strategy MiaResearchEmaCross \
             --timerange 20260105-20260430 --cache none --export none)
      [[ -n "$extra" ]] && rm -f "$extra" ;;
  esac
}

case "$cmd" in
  setup) for t in $(tools); do setup_one "$t"; done ;;
  smoke) for t in $(tools); do smoke_one "$t"; done ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
