# Queue ARN Migration - Implementation Checklist

This document provides step-by-step instructions for completing the remaining QUEUE_URL to QUEUE_ARN migration work.

---

## Pre-Implementation Checklist

Before starting, verify:
- [ ] Current branch is up to date with main
- [ ] All existing tests pass: `cd docker && pytest && cd .. && npm test`
- [ ] No uncommitted changes that might interfere

---

## Phase 1: Critical Fixes (HIGH PRIORITY)

These are actual bugs that will cause failures. Complete these first.

### Task 1.1: Fix test_app.py

**File**: `/Users/ernest/GitHub/benchling-webhook/docker/tests/test_app.py`

**Current State** (Line 20):
```python
config.queue_url = "https://sqs.us-west-2.amazonaws.com/123456789012/test"
```

**Change Required**:
```python
config.queue_arn = "arn:aws:sqs:us-west-2:123456789012:test"
```

**Steps**:
1. Open `/Users/ernest/GitHub/benchling-webhook/docker/tests/test_app.py`
2. Find line 20 (search for `config.queue_url`)
3. Replace with: `config.queue_arn = "arn:aws:sqs:us-west-2:123456789012:test"`
4. Save file

**Verification**:
```bash
cd /Users/ernest/GitHub/benchling-webhook/docker
pytest tests/test_app.py -v
```

**Expected**: Test should pass (or fail for other reasons, but not AttributeError about queue_url)

**Checklist**:
- [ ] File edited
- [ ] Test runs without AttributeError
- [ ] Changes committed

---

### Task 1.2: Fix docker-compose.yml

**File**: `/Users/ernest/GitHub/benchling-webhook/docker/docker-compose.yml`

**Current State** (Lines 17 and 55):
```yaml
environment:
  - QUEUE_URL=${QUEUE_URL}
```

**Change Required**:
```yaml
environment:
  - QUEUE_ARN=${QUEUE_ARN}
```

**Steps**:
1. Open `/Users/ernest/GitHub/benchling-webhook/docker/docker-compose.yml`
2. Find line 17 (in first service's environment section)
3. Replace `QUEUE_URL` with `QUEUE_ARN` (both the key and the variable)
4. Find line 55 (in second service's environment section)
5. Replace `QUEUE_URL` with `QUEUE_ARN` (both the key and the variable)
6. Save file

**Verification**:
```bash
cd /Users/ernest/GitHub/benchling-webhook/docker
docker-compose config
```

**Expected**: No errors, and output should show `QUEUE_ARN` in environment

**Checklist**:
- [ ] Line 17 updated
- [ ] Line 55 updated
- [ ] docker-compose config validates
- [ ] Changes committed

---

### Task 1.3: Fix run_local.py

**File**: `/Users/ernest/GitHub/benchling-webhook/docker/scripts/run_local.py`

**Current State** (Line 32):
```python
os.environ.setdefault("QUEUE_URL", "https://sqs.us-west-2.amazonaws.com/123456789012/test-queue")
```

**Change Required**:
```python
os.environ.setdefault("QUEUE_ARN", "arn:aws:sqs:us-west-2:123456789012:test-queue")
```

**Steps**:
1. Open `/Users/ernest/GitHub/benchling-webhook/docker/scripts/run_local.py`
2. Find line 32 (search for `QUEUE_URL`)
3. Replace `"QUEUE_URL"` with `"QUEUE_ARN"`
4. Replace the URL value with ARN format: `"arn:aws:sqs:us-west-2:123456789012:test-queue"`
5. Save file

**Verification**:
```bash
cd /Users/ernest/GitHub/benchling-webhook/docker/scripts
python run_local.py --help
# or
python -c "import run_local"  # Should not raise ImportError
```

**Expected**: Script runs without errors about missing QUEUE_URL

**Checklist**:
- [ ] Environment variable name changed to QUEUE_ARN
- [ ] Value changed from URL format to ARN format
- [ ] Script runs without errors
- [ ] Changes committed

---

### Phase 1 Verification

After completing all Phase 1 tasks:

```bash
# Run all tests
cd /Users/ernest/GitHub/benchling-webhook
npm test

cd docker
pytest

# Validate docker-compose
docker-compose config

# Check for remaining QUEUE_URL references (excluding this spec)
cd /Users/ernest/GitHub/benchling-webhook
grep -r "QUEUE_URL" --exclude-dir=.git --exclude-dir=spec/queue_arn --exclude=CHANGELOG.md . | grep -v "QUEUE_ARN"
```

**Expected**:
- All tests pass
- docker-compose validates
- Only documentation files show QUEUE_URL

**Checklist**:
- [ ] All Phase 1 tasks complete
- [ ] All tests passing
- [ ] No critical QUEUE_URL references remain in code
- [ ] Phase 1 changes committed

---

## Phase 2: User-Facing Documentation (MEDIUM PRIORITY)

These updates improve documentation for developers using the project.

### Task 2.1: Update AGENTS.md

**File**: `/Users/ernest/GitHub/benchling-webhook/AGENTS.md`

**Current State** (Line 102):
```markdown
| `SQS_QUEUE_URL` | From Quilt stack outputs |
```

**Change Required**:
```markdown
| `QUEUE_ARN` | SQS queue ARN from Quilt stack outputs (PackagerQueueArn) |
```

**Steps**:
1. Open `/Users/ernest/GitHub/benchling-webhook/AGENTS.md`
2. Find line 102 (search for `SQS_QUEUE_URL`)
3. Replace entire line with new format
4. Save file

**Checklist**:
- [ ] Table row updated
- [ ] File saved
- [ ] Changes committed

---

### Task 2.2: Update Docker README files

**Files**:
- `/Users/ernest/GitHub/benchling-webhook/docker/README.md` (line 182)
- `/Users/ernest/GitHub/benchling-webhook/docker/src/README.md` (line 101)

**Current State**:
```markdown
- `SQS_QUEUE_URL` - SQS queue for Quilt packaging
```

**Change Required**:
```markdown
- `QUEUE_ARN` - SQS queue ARN for Quilt packaging (from CloudFormation PackagerQueueArn output)
```

**Steps**:
1. Open `/Users/ernest/GitHub/benchling-webhook/docker/README.md`
2. Find line 182 (search for `SQS_QUEUE_URL`)
3. Replace with new format
4. Save file
5. Open `/Users/ernest/GitHub/benchling-webhook/docker/src/README.md`
6. Find line 101 (search for `SQS_QUEUE_URL`)
7. Replace with new format
8. Save file

**Checklist**:
- [ ] docker/README.md updated
- [ ] docker/src/README.md updated
- [ ] Files saved
- [ ] Changes committed

---

### Task 2.3: Review and Fix validate.ts

**File**: `/Users/ernest/GitHub/benchling-webhook/bin/commands/validate.ts`

**Current State** (Line 89):
```typescript
"sqsQueueUrl",
```

**Issue**: This field name doesn't exist in the Config interface (which uses `queueArn`)

**Investigation Required**:
1. Read the full validate.ts file to understand what this validation does
2. Check if "sqsQueueUrl" is used anywhere in the validation logic
3. Determine if this is:
   - A. Dead code (should be removed)
   - B. Incorrect field name (should be "queueArn")
   - C. Part of a different config structure (needs context)

**Steps**:
1. Open `/Users/ernest/GitHub/benchling-webhook/bin/commands/validate.ts`
2. Read the context around line 89
3. Search for "sqsQueueUrl" usage in the file
4. Choose fix based on findings:

**Option A** (if dead code):
```typescript
// Remove the line entirely
```

**Option B** (if should be queueArn):
```typescript
// Change from:
"sqsQueueUrl",

// To:
"queueArn",
```

**Verification**:
```bash
cd /Users/ernest/GitHub/benchling-webhook
npm run validate  # or whatever command runs validation
```

**Checklist**:
- [ ] validate.ts reviewed
- [ ] Issue understood
- [ ] Fix applied
- [ ] Validation command tested
- [ ] Changes committed

---

### Phase 2 Verification

After completing all Phase 2 tasks:

```bash
# Check documentation consistency
cd /Users/ernest/GitHub/benchling-webhook
grep -r "SQS_QUEUE_URL" *.md docker/*.md --exclude=CHANGELOG.md
```

**Expected**: No matches (except in CHANGELOG.md which is historical)

**Checklist**:
- [ ] All Phase 2 tasks complete
- [ ] Documentation consistent
- [ ] No SQS_QUEUE_URL in current docs
- [ ] Phase 2 changes committed

---

## Phase 3: Specification Documents (LOW PRIORITY)

These are internal spec documents. Update for consistency, but they don't affect runtime.

### Task 3.1: Update spec/cli/ files

**Files to Update**:
1. `/Users/ernest/GitHub/benchling-webhook/spec/cli/QUICK_REFERENCE.md`
2. `/Users/ernest/GitHub/benchling-webhook/spec/cli/DOCUMENTATION_UPDATES.md`
3. `/Users/ernest/GitHub/benchling-webhook/spec/cli/CLI_SPEC.md`
4. `/Users/ernest/GitHub/benchling-webhook/spec/cli/IMPLEMENTATION_SUMMARY.md`
5. `/Users/ernest/GitHub/benchling-webhook/spec/cli/REFACTORING_GUIDE.md`
6. `/Users/ernest/GitHub/benchling-webhook/spec/cli/EXAMPLES.md`

**Changes Required in Each File**:

#### Pattern 1: Environment Variable Examples
```markdown
# Change from:
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/QuiltStack-PackagerQueue-ABC123

# To:
QUEUE_ARN=arn:aws:sqs:us-east-1:123456789012:QuiltStack-PackagerQueue-ABC123
```

#### Pattern 2: TypeScript Interface Definitions
```typescript
// Change from:
sqsQueueUrl: string;

// To:
queueArn: string;
```

#### Pattern 3: Config Loading
```typescript
// Change from:
sqsQueueUrl: envVars.SQS_QUEUE_URL || inferredVars.SQS_QUEUE_URL,

// To:
queueArn: envVars.QUEUE_ARN || inferredVars.QUEUE_ARN,
```

#### Pattern 4: Validation Arrays
```typescript
// Change from:
'sqsQueueUrl',

// To:
'queueArn',
```

**Steps for Each File**:
1. Open the file
2. Search for: `SQS_QUEUE_URL`
3. Replace with: `QUEUE_ARN`
4. Search for: `sqsQueueUrl`
5. Replace with: `queueArn`
6. Review context to ensure changes make sense
7. Save file
8. Move to next file

**Checklist** (one per file):
- [ ] QUICK_REFERENCE.md updated and committed
- [ ] DOCUMENTATION_UPDATES.md updated and committed
- [ ] CLI_SPEC.md updated and committed
- [ ] IMPLEMENTATION_SUMMARY.md updated and committed
- [ ] REFACTORING_GUIDE.md updated and committed
- [ ] EXAMPLES.md updated and committed

---

### Task 3.2: Decide on QUEUE_NAME

**Question**: Should QUEUE_NAME be kept in specs?

**Current Situation**:
- QUEUE_NAME appears in many spec files
- NOT used in actual production code
- May have been from an earlier design

**Decision Options**:

**Option A: Remove QUEUE_NAME**
- Reason: Not used in production, adds confusion
- Action: Remove all QUEUE_NAME references from specs
- Impact: Cleaner, matches actual implementation

**Option B: Keep QUEUE_NAME**
- Reason: Useful for extracting queue name from ARN
- Action: Document as derived value: extract from ARN
- Impact: More complete spec, but adds complexity

**Option C: Defer Decision**
- Reason: Need more context from team
- Action: Add TODO comments in specs
- Impact: Leaves specs incomplete

**Recommendation**: Option A (Remove)

**Steps if Removing**:
1. Search for QUEUE_NAME in all spec files
2. Remove or comment out QUEUE_NAME references
3. Update examples to only show QUEUE_ARN
4. Save all files

**Checklist**:
- [ ] Decision made on QUEUE_NAME
- [ ] Action taken based on decision
- [ ] All spec files consistent
- [ ] Changes committed

---

### Phase 3 Verification

After completing all Phase 3 tasks:

```bash
# Check for old patterns in spec files
cd /Users/ernest/GitHub/benchling-webhook/spec/cli
grep -r "SQS_QUEUE_URL" .
grep -r "sqsQueueUrl" .
grep -r "QUEUE_NAME" .  # Should be empty if removed
```

**Expected**:
- No SQS_QUEUE_URL references
- No sqsQueueUrl references
- No QUEUE_NAME references (if removed)

**Checklist**:
- [ ] All Phase 3 tasks complete
- [ ] Spec files consistent with implementation
- [ ] Phase 3 changes committed

---

## Phase 4: Review Items (OPTIONAL)

### Task 4.1: Review test_benchling.py

**File**: `/Users/ernest/GitHub/benchling-webhook/docker/scripts/test_benchling.py`

**Question**: Is this script still used?

**Investigation**:
1. Check when file was last modified: `git log -1 docker/scripts/test_benchling.py`
2. Search for references to this script in docs or other files
3. Try running it to see if it works

**Steps**:
```bash
cd /Users/ernest/GitHub/benchling-webhook
git log -1 --format="%ai %an" docker/scripts/test_benchling.py
grep -r "test_benchling.py" .
```

**Decision Options**:

**If Used**:
- Update parameter name from `queue_url` to `queue_arn`
- Update value to ARN format

**If Unused**:
- Remove the script
- Or add deprecation comment

**Checklist**:
- [ ] Script usage investigated
- [ ] Decision made
- [ ] Action taken
- [ ] Changes committed (if any)

---

## Final Verification (ALL PHASES)

After completing all phases, run comprehensive verification:

### Step 1: Code Verification
```bash
cd /Users/ernest/GitHub/benchling-webhook

# Search for old patterns (should only find CHANGELOG and this spec)
echo "=== Checking for QUEUE_URL (excluding QUEUE_ARN) ==="
grep -r "QUEUE_URL" --exclude-dir=.git --exclude-dir=spec/queue_arn --exclude=CHANGELOG.md . | grep -v "QUEUE_ARN" || echo "✓ None found"

echo "=== Checking for queue_url (excluding queue_arn) ==="
grep -r "queue_url" --exclude-dir=.git --exclude-dir=spec/queue_arn . | grep -v "queue_arn" | grep -v ".pyc" || echo "✓ None found"

echo "=== Checking for sqsQueueUrl ==="
grep -r "sqsQueueUrl" --exclude-dir=.git --exclude-dir=spec/queue_arn . || echo "✓ None found"

echo "=== Checking for SQS_QUEUE_URL ==="
grep -r "SQS_QUEUE_URL" --exclude-dir=.git --exclude-dir=spec/queue_arn --exclude=CHANGELOG.md . || echo "✓ None found"
```

### Step 2: Test Verification
```bash
cd /Users/ernest/GitHub/benchling-webhook

# Run TypeScript tests
echo "=== Running TypeScript tests ==="
npm test

# Run Python tests
echo "=== Running Python tests ==="
cd docker
pytest -v

# Validate docker-compose
echo "=== Validating docker-compose ==="
docker-compose config > /dev/null && echo "✓ docker-compose valid"

# Try CDK synth
echo "=== Testing CDK synthesis ==="
cd ..
npm run cdk synth > /dev/null && echo "✓ CDK synth successful"
```

### Step 3: Documentation Verification
```bash
cd /Users/ernest/GitHub/benchling-webhook

echo "=== Checking documentation mentions QUEUE_ARN ==="
grep -r "QUEUE_ARN" README.md docker/README.md AGENTS.md env.template || echo "⚠ Should find QUEUE_ARN in docs"

echo "=== Checking for SQS_QUEUE_URL in docs (should be none) ==="
grep -r "SQS_QUEUE_URL" README.md docker/README.md AGENTS.md env.template --exclude=CHANGELOG.md || echo "✓ None found in current docs"
```

### Final Checklist

**Code Quality**:
- [ ] No QUEUE_URL references (except CHANGELOG)
- [ ] No SQS_QUEUE_URL references (except CHANGELOG)
- [ ] No sqsQueueUrl references (except CHANGELOG)
- [ ] ARN-to-URL conversion preserved in entry_packager.py
- [ ] boto3 QueueUrl parameter unchanged

**Tests**:
- [ ] All TypeScript tests pass
- [ ] All Python tests pass
- [ ] docker-compose validates
- [ ] CDK synth succeeds

**Documentation**:
- [ ] Main README uses QUEUE_ARN
- [ ] Docker docs use QUEUE_ARN
- [ ] AGENTS.md uses QUEUE_ARN
- [ ] env.template shows QUEUE_ARN
- [ ] All spec files consistent

**Git**:
- [ ] All changes committed
- [ ] Commit messages are clear
- [ ] No uncommitted files

---

## Commit Strategy

### Phase 1 Commits (one per file)
```bash
git add docker/tests/test_app.py
git commit -m "fix: correct queue_url to queue_arn in test_app.py"

git add docker/docker-compose.yml
git commit -m "fix: update QUEUE_URL to QUEUE_ARN in docker-compose.yml"

git add docker/scripts/run_local.py
git commit -m "fix: update QUEUE_URL to QUEUE_ARN in run_local.py"
```

### Phase 2 Commits (grouped by topic)
```bash
git add AGENTS.md docker/README.md docker/src/README.md
git commit -m "docs: update SQS_QUEUE_URL to QUEUE_ARN in documentation"

git add bin/commands/validate.ts
git commit -m "fix: correct sqsQueueUrl to queueArn in validate command"
```

### Phase 3 Commits (all spec files together)
```bash
git add spec/cli/
git commit -m "docs: update queue references in CLI specification files

- Replace SQS_QUEUE_URL with QUEUE_ARN throughout specs
- Replace sqsQueueUrl with queueArn in TypeScript examples
- Remove/update QUEUE_NAME references for consistency"
```

### Final Commit (verification)
```bash
git add spec/queue_arn/
git commit -m "docs: add comprehensive queue ARN migration audit

- findings.md: Complete audit of all queue references
- plan.md: Implementation plan and risk assessment
- implementation.md: Step-by-step execution checklist"
```

---

## Rollback Plan

If issues arise during implementation:

### Rollback Individual Changes
```bash
# Rollback specific file
git checkout HEAD -- <file-path>

# Or rollback specific commit
git revert <commit-hash>
```

### Rollback Entire Phase
```bash
# Find commits for the phase
git log --oneline -10

# Revert the commits in reverse order
git revert <commit-3>
git revert <commit-2>
git revert <commit-1>
```

### Emergency Rollback
```bash
# Reset to before all changes (ONLY if not pushed)
git reset --hard <commit-before-changes>

# If already pushed, create revert commits
git revert <last-commit>..<first-commit>
```

---

## Success Metrics

After completion, you should have:

1. **Zero Critical Bugs**
   - test_app.py uses correct attribute
   - docker-compose has correct env var
   - run_local.py uses correct env var

2. **Consistent Documentation**
   - All docs reference QUEUE_ARN
   - No confusing references to old patterns
   - Examples match implementation

3. **Clean Codebase**
   - Only CHANGELOG mentions QUEUE_URL (historical)
   - All production code uses QUEUE_ARN
   - All specs match implementation

4. **Working Tests**
   - 100% test pass rate
   - No environment variable errors
   - Docker compose validates

5. **Clear History**
   - Meaningful commit messages
   - Changes grouped logically
   - Easy to review in PR

---

## Post-Implementation

After all tasks complete:

1. **Create Pull Request**
   ```bash
   git push origin <your-branch>
   # Create PR with title: "Complete QUEUE_URL to QUEUE_ARN migration"
   ```

2. **PR Description Should Include**:
   - Link to spec/queue_arn/ documentation
   - Summary of changes by phase
   - Testing performed
   - Breaking changes (none, already completed)

3. **Update Related Documentation**:
   - Close any related issues
   - Update project roadmap if applicable
   - Notify team of documentation updates

4. **Archive This Spec**:
   - These docs can be kept for historical reference
   - Or moved to a "completed-migrations" folder

---

## Questions During Implementation?

If you encounter unexpected issues:

1. **Check findings.md** - May have notes about edge cases
2. **Check plan.md** - May have risk assessment for the issue
3. **Run git blame** - See when/why code was written
4. **Check git log** - Look for related commits
5. **Ask team** - Someone may remember context

Remember: When in doubt, commit small changes and test frequently!
