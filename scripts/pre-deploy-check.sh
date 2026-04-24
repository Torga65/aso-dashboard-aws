#!/usr/bin/env bash
# pre-deploy-check.sh
# Run this before every deployment to verify nothing is broken.
# Exit code 0 = safe to deploy. Non-zero = investigate before deploying.

set -euo pipefail

PASS=0
FAIL=0
SKIPPED=0

green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[0;33m%s\033[0m\n' "$*"; }
header(){ printf '\n\033[1;34m=== %s ===\033[0m\n' "$*"; }

run_check() {
  local name="$1"
  shift
  printf '  %-40s' "$name..."
  if "$@" > /tmp/pre-deploy-output 2>&1; then
    green "PASS"
    ((PASS++)) || true
  else
    red "FAIL"
    ((FAIL++)) || true
    cat /tmp/pre-deploy-output | tail -20
  fi
}

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        ASO Dashboard Pre-Deploy Check    ║"
echo "╚══════════════════════════════════════════╝"

# ── 1. TypeScript ─────────────────────────────────────────────────────────────
header "TypeScript"
run_check "Type check (tsc --noEmit)" npm run typecheck

# ── 2. Lint ───────────────────────────────────────────────────────────────────
header "Linting"
run_check "ESLint" npm run lint

# ── 3. Unit tests ─────────────────────────────────────────────────────────────
header "Unit Tests"
run_check "Mappers (data transforms)" \
  npx vitest run tests/unit/lib/mappers.test.ts --reporter=verbose

run_check "IMS Auth (session expiry / token logic)" \
  npx vitest run tests/unit/auth/ims-auth.test.js --reporter=verbose

run_check "StatusBadge component" \
  npx vitest run tests/unit/components/ui/StatusBadge.test.tsx --reporter=verbose

run_check "EngagementBadge component" \
  npx vitest run tests/unit/components/ui/EngagementBadge.test.tsx --reporter=verbose

run_check "HealthBar component" \
  npx vitest run tests/unit/components/ui/HealthBar.test.tsx --reporter=verbose

# ── 4. Integration tests ──────────────────────────────────────────────────────
header "Integration Tests (API Routes)"
run_check "GET /api/customers" \
  npx vitest run tests/integration/api/customers.test.ts --reporter=verbose

run_check "GET|PUT|DELETE /api/progression" \
  npx vitest run tests/integration/api/progression.test.ts --reporter=verbose

# ── 5. E2E tests (optional — requires running dev server) ─────────────────────
header "E2E Tests (Playwright)"
if curl -sf http://localhost:3000 > /dev/null 2>&1; then
  run_check "Navigation smoke tests" \
    npx playwright test tests/e2e/navigation.spec.ts --reporter=list

  run_check "Customer history API contract" \
    npx playwright test tests/e2e/customer-history.spec.ts --reporter=list

  run_check "Auth guard & session expiry" \
    npx playwright test tests/e2e/auth.spec.ts --reporter=list
else
  yellow "  SKIPPED E2E — dev server not running on localhost:3000"
  yellow "  Run 'npm run dev' in another terminal then re-run this script."
  ((SKIPPED+=3)) || true
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
printf "  Passed:  "; green "$PASS"
if [ "$FAIL" -gt 0 ]; then
  printf "  Failed:  "; red "$FAIL"
fi
if [ "$SKIPPED" -gt 0 ]; then
  printf "  Skipped: "; yellow "$SKIPPED"
fi
echo "══════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  red "❌  Pre-deploy checks FAILED. Do not deploy."
  exit 1
else
  green "✅  All checks passed. Safe to deploy."
  exit 0
fi
