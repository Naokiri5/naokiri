#!/usr/bin/env bash
set -euo pipefail
# Deliberately non-mutating: this revision has no authorized LIVE venue/signer.
# A passing P0 bundle verifies offline regressions, never authorizes execution.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 2 ]]; then
  echo "Usage: bash scripts/promote-live-bounded.sh P0_REPORT_DIR EXPECTED_SHA" >&2
  exit 2
fi
# Resolve caller-relative evidence paths before entering this script's environment.
REPORT_DIR="$(cd "$1" && pwd)"
cd "$ROOT"
EXPECTED_SHA="$2"
if [[ "$EXPECTED_SHA" != "$(git rev-parse HEAD)" ]]; then
  echo "Promotion blocked: evidence revision must match this checkout." >&2
  exit 1
fi
env -i PATH="$PATH" MIA_OFFLINE=1 MIA_AUTH_MODE=passphrase \
  node --import tsx server/src/qa/verify-p0-evidence.ts verify "$REPORT_DIR" "$EXPECTED_SHA"
echo "Promotion blocked: BOUNDED_LIVE is hard-locked in core/mode.ts; offline evidence is not sufficient." >&2
exit 1
