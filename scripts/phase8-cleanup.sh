#!/bin/bash
# Phase 8 Cleanup Script for v0.7.0
# Removes legacy code and outdated TODOs

set -e  # Exit on error

echo "=== Phase 8: Final Cleanup ==="
echo ""

# 1. Remove legacy file
echo "Step 1: Removing xdg-config-legacy.ts..."
if [ -f "lib/xdg-config-legacy.ts" ]; then
  git rm lib/xdg-config-legacy.ts
  echo "   ✅ Removed lib/xdg-config-legacy.ts"
else
  echo "   ℹ️  File already removed"
fi

# 2. Check for createStack usage
echo ""
echo "Step 2: Checking createStack usage..."
if grep -r "import.*createStack\|from.*createStack" \
   --include="*.ts" --include="*.js" \
   --exclude="**/benchling-webhook.ts" \
   --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . > /dev/null 2>&1; then
  echo "   ⚠️  createStack IS imported/used - manual review needed"
  echo "   👉 Review bin/benchling-webhook.ts before removing createStack()"
else
  echo "   ✅ createStack NOT imported anywhere (safe to remove)"
  echo "   💡 Consider removing createStack() and legacyConfigToProfileConfig() from bin/benchling-webhook.ts"
fi

# 3. Run tests
echo ""
echo "Step 3: Running test suite..."
if npm run test > /dev/null 2>&1; then
  echo "   ✅ All tests passing"
else
  echo "   ❌ Tests failing - fix before committing"
  exit 1
fi

# 4. Commit changes
echo ""
echo "Step 4: Creating commit..."
if git diff --cached --quiet; then
  echo "   ℹ️  No staged changes to commit"
else
  git commit -m "chore(v0.7.0): remove legacy xdg-config-legacy.ts file

- Delete lib/xdg-config-legacy.ts (not imported anywhere)
- File was Phase 2 backup, no longer needed
- Part of Phase 8 cleanup for v0.7.0 release

Related: #176, #189"
  echo "   ✅ Commit created"
fi

echo ""
echo "=== Cleanup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Review bin/benchling-webhook.ts for unused createStack()"
echo "  2. Remove outdated TODO comments in:"
echo "     - bin/commands/sync-secrets.ts (lines 5-8)"
echo "     - bin/commands/config-profiles.ts (lines 5-8)"
echo "     - bin/benchling-webhook.ts (lines 78-79, 128)"
echo "  3. Run manual testing checklist from PHASE8-FINAL-VALIDATION-REPORT.md"
echo "  4. Run 'npm run test:local'"
echo "  5. Review PR #189 for final approval"
echo ""
