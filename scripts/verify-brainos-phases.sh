#!/usr/bin/env bash
set -euo pipefail
# Local offline engineering verification, NOT a release certificate.
# Requires npm ci (including devDependencies) beforehand. Never targets a deployed server.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
case "${1:---full}" in
  --full|--p0-only) mode="${1:---full}" ;;
  *) echo "Usage: bash scripts/verify-brainos-phases.sh [--full|--p0-only]" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then exit 2; fi
HEAD_SHA="$(git rev-parse HEAD)"
if [[ -n "${EXPECTED_SHA:-}" && "$HEAD_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Unexpected tested commit" >&2; exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked worktree changes: commit or stash before verification" >&2; exit 1
fi
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22||(major===22&&minor<13))process.exit(1)'
if [[ ! -f node_modules/vitest/vitest.mjs ]]; then echo "Install dependencies with npm ci first" >&2; exit 1; fi
umask 077
WORK="$(mktemp -d "${RUNNER_TEMP:-/tmp}/mia-brainos-verify.XXXXXXXX")"
mkdir -p "$WORK/data" "$WORK/home" "$WORK/tmp" "$WORK/logs"
cleanup() {
  local status=$?
  trap - EXIT
  rm -rf -- "$WORK/data" "$WORK/home" "$WORK/tmp"
  if [[ "$status" -eq 0 ]]; then rm -rf -- "$WORK"; else
    printf "Verification failed; sanitized-environment test logs: %s/logs\n" "$WORK" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Start from an empty environment: no inherited wallet/provider credentials,
# live-test flag, production DB path, NODE_OPTIONS or deployment URL.
run_offline() {
  env -i PATH="$PATH" HOME="$WORK/home" TMPDIR="$WORK/tmp" CI=true \
    MIA_OFFLINE=1 MIA_AUTH_MODE=passphrase MIA_HOST=127.0.0.1 \
    MIA_DATA_DIR="$WORK/data" MIA_LOG=warn "$@"
}
step() {
  local name="$1"; shift
  printf "\n[%s] %s\n" "$HEAD_SHA" "$name"
  run_offline "$@" 2>&1 | tee "$WORK/logs/$name.log"
}
if [[ "$mode" == --full ]]; then
  step secret-scan node scripts/secret-scan.mjs
  step typecheck npm run typecheck
  step build npm run build
  # Full canonical suite includes AST boundaries, PAPER lifecycle, OMS, QCI,
  # backtest, DITAS and release-lock tests. Do not filter away missing assertions.
  step server-tests npm test -w server
  step web-tests npm test -w web
fi
(
  cd server
  for seed in 13701 13702 13703; do
    step "p0-$seed" node ../node_modules/vitest/vitest.mjs run \
      --sequence.shuffle --sequence.seed="$seed" \
      test/runtime-shutdown.test.ts test/brainos-wal-audit.test.ts
  done
)
printf "\nOffline verification passed for %s (%s).\n" "$HEAD_SHA" "$mode"
echo "Not certified: historical profitability, external venue settlement, real Railway/Privy/Cloudflare, prospective soak or LIVE."
echo "Browser E2E and dependency audit remain separate existing CI checks."
