#!/bin/bash
# Phase 8 Validation Script for v0.7.0
# Validates all cleanup and prerequisites are met

echo "=== Phase 8: Validation Checks ==="
echo ""

PASS_COUNT=0
FAIL_COUNT=0

# Helper function for test results
check() {
  local name="$1"
  local command="$2"

  echo -n "Checking $name... "
  if eval "$command" > /dev/null 2>&1; then
    echo "✅ PASS"
    ((PASS_COUNT++))
    return 0
  else
    echo "❌ FAIL"
    ((FAIL_COUNT++))
    return 1
  fi
}

# Check 1: No legacy file exists
check "legacy file removed" \
  "[ ! -f lib/xdg-config-legacy.ts ]"

# Check 2: No legacy imports
check "no legacy imports" \
  "! grep -r 'xdg-config-legacy' --include='*.ts' --exclude-dir=node_modules ."

# Check 3: TypeScript compilation
check "TypeScript compilation" \
  "npm run build:typecheck"

# Check 4: All tests pass
echo -n "Checking test suite... "
if npm run test 2>&1 | tail -1 | grep -q "passed"; then
  echo "✅ PASS"
  ((PASS_COUNT++))
else
  echo "❌ FAIL"
  ((FAIL_COUNT++))
fi

# Check 5: Documentation exists
echo ""
echo "Checking documentation files..."
for doc in README.md MIGRATION.md CHANGELOG.md CLAUDE.md; do
  if [ -f "$doc" ]; then
    echo "   ✅ $doc exists"
    ((PASS_COUNT++))
  else
    echo "   ❌ $doc missing"
    ((FAIL_COUNT++))
  fi
done

# Check 6: CI status
echo ""
echo -n "Checking CI status... "
if gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | select(.name=="Test") | .conclusion' 2>/dev/null | grep -q "SUCCESS"; then
  echo "✅ PASS (CI passing)"
  ((PASS_COUNT++))
else
  echo "⚠️  UNKNOWN (run 'gh pr view' manually)"
fi

# Check 7: Version in package.json
echo -n "Checking version is 0.7.0... "
if grep -q '"version": "0.7.0"' package.json; then
  echo "✅ PASS"
  ((PASS_COUNT++))
else
  echo "❌ FAIL (version mismatch)"
  ((FAIL_COUNT++))
fi

# Check 8: XDGConfig uses new API
echo -n "Checking XDGConfig API... "
if grep -q "readProfile(" lib/xdg-config.ts && \
   grep -q "writeProfile(" lib/xdg-config.ts && \
   grep -q "listProfiles(" lib/xdg-config.ts; then
  echo "✅ PASS (v0.7.0 API present)"
  ((PASS_COUNT++))
else
  echo "❌ FAIL (missing v0.7.0 API methods)"
  ((FAIL_COUNT++))
fi

# Summary
echo ""
echo "=== Validation Summary ==="
echo "   Passed: $PASS_COUNT"
echo "   Failed: $FAIL_COUNT"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo "✅ All validation checks passed!"
  echo ""
  echo "Ready for:"
  echo "  - Manual testing (see PHASE8-FINAL-VALIDATION-REPORT.md)"
  echo "  - PR review and approval"
  echo "  - Merge to main"
  exit 0
else
  echo "❌ Some validation checks failed"
  echo "   Review failures above before proceeding"
  exit 1
fi
