#!/usr/bin/env bash
# preflight.sh — Run exactly what blocks in CI, nothing more.
# Usage: pnpm preflight
#
# This mirrors the BLOCKING CI jobs so you catch failures before push.
# Estimated time: ~45s on a modern machine.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; }
info() { echo -e "${YELLOW}>>>${NC} ${BOLD}$1${NC}"; }
skip() { echo -e "${YELLOW}SKIP${NC} $1"; }

FAILED=0

# 1. Typecheck (backend + client)
info "Typecheck (backend + client)"
if pnpm typecheck 2>&1; then
  pass "typecheck"
else
  fail "typecheck"
  FAILED=1
fi

echo ""

# 2. Lint (backend + client + landing)
info "Lint"
if pnpm lint 2>&1; then
  pass "lint"
else
  fail "lint — backend auto-fix: 'pnpm --filter backend lint:fix'; client/landing: fix reported errors"
  FAILED=1
fi

echo ""

# 3. Format check
info "Format check"
if pnpm format:check 2>&1; then
  pass "format"
else
  fail "format — run 'pnpm format' to fix"
  FAILED=1
fi

echo ""

# 4. Backend tests (unit only, no coverage — fast)
info "Backend tests"
if pnpm --filter backend test --no-coverage 2>&1; then
  pass "backend tests"
else
  fail "backend tests"
  FAILED=1
fi

echo ""

# 5. Client tests (unit only, no coverage — fast)
info "Client tests"
if pnpm --filter client test --no-coverage 2>&1; then
  pass "client tests"
else
  fail "client tests"
  FAILED=1
fi

echo ""

# 6. Dependency audit (high/critical only) — osv-scanner (base OSV).
#    `pnpm audit` is dead since npm retired its audit endpoints (HTTP 410). CI
#    installs osv-scanner pinned; locally it may be absent, so degrade gracefully
#    with an explicit skip (never a silent pass) — CI remains the authoritative gate.
info "Dependency audit"
if command -v osv-scanner >/dev/null 2>&1; then
  if pnpm audit:dependencies 2>&1; then
    pass "audit"
  else
    fail "audit — high/critical vulnerabilities (update deps or add pnpm.overrides in pnpm-workspace.yaml)"
    FAILED=1
  fi
else
  skip "audit — osv-scanner not installed; local audit skipped (CI remains the gate). Install: brew install osv-scanner"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAILED" -ne 0 ]; then
  echo -e "${RED}${BOLD}Preflight FAILED${NC} — fix the above before pushing."
  exit 1
else
  echo -e "${GREEN}${BOLD}Preflight PASSED${NC} — safe to push."
fi
