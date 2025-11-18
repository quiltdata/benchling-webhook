# Remove Temporary File Usage and Simplify Role Management

**Date:** 2025-11-18
**Related:** [21-tmpdir-analysis.md](21-tmpdir-analysis.md)
**Status:** Requirements

## Overview

This document specifies the requirements for fixing the temporary directory error by eliminating filesystem writes entirely and simplifying IAM role management by removing the unused read role infrastructure.

## Problem Statement

From [21-tmpdir-analysis.md](21-tmpdir-analysis.md):

1. **Temporary file creation fails** because no writable temp directory exists in the container
2. **Read role is unused** - all S3 operations use write role, making read role infrastructure redundant
3. **Unnecessary disk I/O** - ZIP file is written to disk then immediately read back into memory

## Solution Strategy

### Part 1: Eliminate Filesystem Writes

**Current flow:**

```
HTTP Response → Temp File on Disk → Read from Disk → Extract to Memory → Upload to S3
```

**New flow:**

```
HTTP Response → BytesIO (Memory) → Extract to Memory → Upload to S3
```

### Part 2: Consolidate to Single Write Role

**Current state:**

- Two role ARNs: `QUILT_READ_ROLE_ARN` and `QUILT_WRITE_ROLE_ARN`
- Read role never used in application
- Write role used for all S3 operations

**New state:**

- Single role ARN: `QUILT_WRITE_ROLE_ARN`
- Used for both read and write S3 operations
- Simpler configuration and fewer STS AssumeRole calls

## Requirements

### Phase 1: Remove Temporary File Usage

#### Task 1.1: Update entry_packager.py to use BytesIO

**File:** `docker/src/entry_packager.py:458-507`

**Changes:**

- Replace `tempfile.NamedTemporaryFile()` with `io.BytesIO()`
- Stream HTTP chunks directly into BytesIO buffer
- Add `zip_buffer.seek(0)` before reading
- Remove temp file cleanup code

**Code location:** [entry_packager.py:464-467](../docker/src/entry_packager.py#L464-L467)

**Before:**

```python
with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
    for chunk in response.iter_content(chunk_size=8192):
        temp_file.write(chunk)
    zip_path = temp_file.name
```

**After:**

```python
import io

zip_buffer = io.BytesIO()
for chunk in response.iter_content(chunk_size=8192):
    zip_buffer.write(chunk)
zip_buffer.seek(0)  # Reset to beginning for reading
```

**Impact:**

- No filesystem writes required
- No TMPDIR environment variable needed
- Same memory footprint (already loading full file content for S3 upload)
- Faster (no disk I/O overhead)

#### Task 1.2: Update zipfile.ZipFile() to use BytesIO

**File:** `docker/src/entry_packager.py:476`

**Changes:**

- Replace `zipfile.ZipFile(zip_path, "r")` with `zipfile.ZipFile(zip_buffer, "r")`
- Remove temp file path variable
- Remove temp file cleanup in finally block

**Impact:**

- No changes to extraction or upload logic
- Cleaner error handling (no temp files to clean up)

### Phase 2: Remove Read Role from Docker Application

#### Task 2.1: Remove QUILT_READ_ROLE_ARN from docker/src/config.py

**File:** `docker/src/config.py:46, 81`

**Changes:**

- Remove `quilt_read_role_arn: str = ""` field declaration
- Remove `self.quilt_read_role_arn = os.getenv("QUILT_READ_ROLE_ARN", "")` assignment

**Impact:**

- Application no longer reads QUILT_READ_ROLE_ARN environment variable
- Config class simplified

#### Task 2.2: Simplify RoleManager to single write role

**File:** `docker/src/auth/role_manager.py:20-302`

**Changes:**

1. Remove `read_role_arn` parameter from `__init__()` (line 47)
2. Remove `self.read_role_arn` attribute (line 58)
3. Remove `self._read_session` attribute (line 63)
4. Remove `self._read_expires_at` attribute (line 68)
5. Remove `read_only` parameter from `get_s3_client()` (line 245)
6. Simplify `get_s3_client()` to always use `write_role_arn`
7. Remove conditional logic for read vs write role selection (lines 261-299)
8. Update class docstring to reflect single role design
9. Update method docstrings to remove read_only parameter documentation

**After (simplified signature):**

```python
def __init__(self, role_arn: Optional[str] = None, region: str = "us-east-1"):
    """Initialize RoleManager with write role ARN.

    Args:
        role_arn: ARN of IAM role for S3 access (from T4BucketWriteRole)
        region: AWS region for STS and S3 clients
    """
    self.role_arn = role_arn
    self.region = region
    self._session: Optional[boto3.Session] = None
    self._expires_at: Optional[datetime] = None
```

**After (simplified method):**

```python
def get_s3_client(self):
    """Get S3 client with write role credentials.

    Credentials are cached and automatically refreshed before expiration.
    Falls back to default credentials if role ARN not provided.

    Returns:
        boto3 S3 client with assumed role credentials
    """
    session, expiration = self._get_or_create_session(
        self.role_arn,
        self._session,
        self._expires_at,
    )
    self._session = session
    self._expires_at = expiration
    return session.client("s3")
```

**Impact:**

- Simpler credential management (single session cache)
- Fewer STS AssumeRole calls
- Clearer intent (write role for all operations)

#### Task 2.3: Update entry_packager.py RoleManager initialization

**File:** `docker/src/entry_packager.py:176-179`

**Changes:**

```python
# Before
self.role_manager = RoleManager(
    read_role_arn=self.config.quilt_read_role_arn or None,
    write_role_arn=self.config.quilt_write_role_arn or None,
    region=self.config.aws_region,
)

# After
self.role_manager = RoleManager(
    role_arn=self.config.quilt_write_role_arn or None,
    region=self.config.aws_region,
)
```

**Impact:**

- Single role ARN passed to RoleManager
- Clearer configuration

#### Task 2.4: Update entry_packager.py get_s3_client() call

**File:** `docker/src/entry_packager.py:471`

**Changes:**

```python
# Before
s3_client = self.role_manager.get_s3_client(read_only=False)

# After
s3_client = self.role_manager.get_s3_client()
```

**Impact:**

- Simpler method call
- No ambiguity about read vs write access

#### Task 2.5: Update package_query.py to use RoleManager

**File:** `docker/src/package_query.py`

**Changes:**

1. Import RoleManager from auth.role_manager
2. Add RoleManager initialization in `__init__()` (similar to entry_packager.py)
3. Replace direct `boto3.client('athena')` with role-assumed client
4. Replace direct `boto3.client('s3')` with `role_manager.get_s3_client()`

**Rationale:**

- PackageQuery needs to read from Quilt bucket (`.quilt/packages` directory)
- Currently uses default task role, which may not have cross-account access
- Should use same QUILT_WRITE_ROLE_ARN as entry_packager for consistency
- Write role includes read permissions (S3 write implies read)

**Impact:**

- PackageQuery can read package manifests from Quilt bucket
- Fixes Athena query failure from [21-tmpdir-analysis.md:89-92](21-tmpdir-analysis.md#L89-L92)
- Consistent role usage across all Quilt S3 operations

#### Task 2.6: Update app.py health check to remove read role validation

**File:** `docker/src/app.py:61-67, 89-117`

**Changes:**

1. Remove read role ARN logging and validation
2. Keep only write role validation
3. Update health check to test single role assumption
4. Simplify conditional logic

**Impact:**

- Simpler health checks
- Fewer STS calls during startup
- Clearer pass/fail criteria

#### Task 2.7: Update docker/src type hints and docstrings

**Files:**

- `docker/src/auth/role_manager.py`
- `docker/src/entry_packager.py`
- `docker/src/package_query.py`
- `docker/src/app.py`

**Changes:**

- Update all docstrings referencing "read role" or "read_role_arn"
- Update type hints to reflect simplified signatures
- Update inline comments explaining role usage

**Impact:**

- Documentation matches implementation
- Clear intent for future maintainers

### Phase 3: Remove Read Role from CDK Infrastructure

#### Task 3.1: Remove QUILT_READ_ROLE_ARN from fargate-service.ts

**File:** `lib/fargate-service.ts:313-315`

**Changes:**

```typescript
// Before
// IAM Role ARNs for cross-account S3 access (optional)
...(props.readRoleArn ? { QUILT_READ_ROLE_ARN: props.readRoleArn } : {}),
...(props.writeRoleArn ? { QUILT_WRITE_ROLE_ARN: props.writeRoleArn } : {}),

// After
// IAM Role ARN for cross-account S3 access (optional)
...(props.roleArn ? { QUILT_WRITE_ROLE_ARN: props.roleArn } : {}),
```

**Impact:**

- Container receives single role ARN
- Simpler environment variable configuration

#### Task 3.2: Update FargateServiceProps interface

**File:** `lib/fargate-service.ts` (type definition section)

**Changes:**

- Rename `readRoleArn` to `roleArn` (or remove entirely)
- Remove `writeRoleArn` property (replaced by `roleArn`)
- Update JSDoc comments

**Impact:**

- Type safety matches new single-role design
- Clearer property naming

#### Task 3.3: Update benchling-webhook-stack.ts to pass single role

**File:** `lib/benchling-webhook-stack.ts:186-193`

**Changes:**

```typescript
// Before
// NEW: Optional IAM role ARNs for cross-account S3 access
readRoleArn: config.quilt.readRoleArn,
writeRoleArn: config.quilt.writeRoleArn,

// After
// IAM role ARN for cross-account S3 access (write role used for all operations)
roleArn: config.quilt.writeRoleArn,
```

**Impact:**

- Stack passes single role to Fargate service
- Consistent with application changes

#### Task 3.4: Update lib/types/config.ts QuiltConfig interface

**File:** `lib/types/config.ts:265, 280`

**Changes:**

- Remove `readRoleArn?: string;` property
- Keep `writeRoleArn?: string;` property (or rename to `roleArn`)
- Update JSDoc comments and examples
- Update JSON schema validation (lines 683-684)

**Impact:**

- Type definitions match new configuration structure
- Validation enforces single role

#### Task 3.5: Update xdg-launch.ts to use single role

**File:** `bin/xdg-launch.ts`

**Changes:**

1. Remove QUILT_READ_ROLE_ARN references
2. Update environment variable passing to use only QUILT_WRITE_ROLE_ARN
3. Update logging to reflect single role
4. Update comments

**Impact:**

- Local testing uses same single-role configuration
- Consistent between local and deployed environments

#### Task 3.6: Update infer-quilt-config.ts discovery logic

**File:** `bin/commands/infer-quilt-config.ts:543-554`

**Changes:**

- Keep read role discovery (still valid Quilt stack resource)
- But only save `writeRoleArn` to configuration
- Update console logging to indicate read role is not used
- Add informational message: "Read role discovered but not configured (write role used for all operations)"

**Impact:**

- Setup wizard can still discover both roles
- Only write role saved to config
- Clear messaging about single-role design

### Phase 4: Clean Up Dockerfile

#### Task 4.1: Remove TMPDIR environment variable

**File:** `docker/Dockerfile:147`

**Changes:**

```dockerfile
# Before
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app" \
    BUILD_VERSION="${VERSION}" \
    PORT="5000" \
    UV_NO_CACHE="1" \
    UV_CACHE_DIR="/tmp/.uv-cache" \
    TMPDIR="/app/tmp"

# After
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app" \
    FLASK_APP="src.app" \
    BUILD_VERSION="${VERSION}" \
    PORT="5000" \
    UV_NO_CACHE="1" \
    UV_CACHE_DIR="/tmp/.uv-cache"
```

**Rationale:**

- TMPDIR no longer needed (no tempfile usage)
- Simplifies environment configuration

**Impact:**

- One less environment variable to manage
- No behavioral change (tempfile not used)

#### Task 4.2: Remove /app/tmp directory creation

**File:** `docker/Dockerfile:108`

**Changes:**

```dockerfile
# Before
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /app/tmp /home/appuser

# After
RUN groupadd -r appuser && \
    useradd -r -g appuser -u 1000 appuser && \
    mkdir -p /app /home/appuser
```

**Impact:**

- Cleaner container filesystem
- No unused directories

#### Task 4.3: Update Dockerfile comments

**File:** `docker/Dockerfile:140, 147`

**Changes:**

- Remove comment about TMPDIR and writable temp directory
- Update comments to reflect in-memory processing
- Remove references to temp file workarounds

**Impact:**

- Documentation matches implementation
- Clear rationale for environment variables

### Phase 5: Keep Read Role in Setup Wizard

**IMPORTANT:** Do NOT remove read role from setup wizard infrastructure.

**Files to KEEP unchanged:**

- `scripts/install-wizard.ts` - Keep read role prompts
- `scripts/config/wizard.ts` - Keep read role configuration
- `bin/commands/infer-quilt-config.ts` - Keep read role discovery

**Rationale:**

- Read role may be used in future features (e.g., package browsing, validation)
- Setup wizard should discover all available Quilt stack resources
- Configuration schema should remain flexible for future use cases

**Impact:**

- Setup wizard can still configure read role (saved to config but not used)
- Future features can leverage read role without configuration changes
- No breaking changes to existing configurations

### Phase 6: Documentation Updates

#### Task 6.1: Update 21-tmpdir-analysis.md

**File:** `spec/206-service-envars/21-tmpdir-analysis.md`

**Changes:**

- Add "Resolution" section at end of document
- Document in-memory ZIP processing solution
- Document read role removal rationale
- Link to this implementation spec

**Impact:**

- Complete problem → solution documentation chain
- Clear audit trail for future reference

#### Task 6.2: Update CLAUDE.md

**File:** `CLAUDE.md`

**Changes:**

- Update environment variable references (remove QUILT_READ_ROLE_ARN from application)
- Update configuration examples to show single role
- Update testing instructions if needed

**Impact:**

- Developer documentation matches implementation
- Clear guidance for contributors

#### Task 6.3: Create implementation summary

**File:** `spec/206-service-envars/22-implementation-summary.md`

**Changes:**

- Document changes made
- Include before/after comparisons
- Note testing results
- Record any issues encountered

**Impact:**

- Complete implementation record
- Useful for future debugging

## Testing Strategy

### Unit Tests

```bash
# Python unit tests
npm run test:python

# TypeScript unit tests
npm run test:ts
```

**Verify:**

- No regressions in existing tests
- RoleManager tests updated for single role
- Mock S3 operations still work

### Local Docker Testing

```bash
# Build and test local container
npm run test:local
```

**Verify:**

- Container starts without TMPDIR errors
- Health checks pass
- In-memory ZIP processing works
- S3 uploads succeed

### Integration Testing

```bash
# Deploy to dev environment
npm run deploy:dev -- --profile bench --stage dev --yes

# Check logs
npx ts-node bin/check-logs.ts --profile bench --type=ecs --tail=100
```

**Verify:**

- Real Benchling export processing succeeds
- No temporary file errors
- ZIP extraction and S3 upload work end-to-end
- Package creation in S3 succeeds
- Canvas updates show completion

### Production Deployment

```bash
# After successful dev testing
npm run deploy:prod -- --profile bench --stage prod --image-tag <version> --yes

# Monitor logs
npx ts-node bin/check-logs.ts --profile bench --type=ecs --follow
```

**Verify:**

- Production deployment succeeds
- No errors in CloudWatch logs
- Real webhook processing succeeds
- Package creation completes

## Success Criteria

1. ✅ No temporary file creation in entry_packager.py
2. ✅ No TMPDIR environment variable in Dockerfile
3. ✅ Single role ARN (QUILT_WRITE_ROLE_ARN) used for all S3 operations
4. ✅ QUILT_READ_ROLE_ARN removed from docker/src application code
5. ✅ QUILT_READ_ROLE_ARN removed from CDK infrastructure
6. ✅ QUILT_READ_ROLE_ARN kept in setup wizard for future use
7. ✅ PackageQuery uses RoleManager for cross-account access
8. ✅ All unit tests pass
9. ✅ Local Docker testing succeeds
10. ✅ Dev deployment processes real exports successfully
11. ✅ Production deployment works without errors
12. ✅ Documentation updated to reflect changes

## Risk Assessment

### Low Risk

- In-memory ZIP processing (same memory footprint, no disk I/O)
- Removing unused read role infrastructure (never called)
- Dockerfile environment variable cleanup (TMPDIR unused)

### Medium Risk

- RoleManager refactoring (well-tested component)
- CDK infrastructure changes (validated by TypeScript compiler)
- PackageQuery role assumption (new functionality)

### Mitigation

- Comprehensive testing at each phase
- Deploy to dev environment before production
- Monitor CloudWatch logs during rollout
- Keep rollback plan (previous Docker image available)

## Rollback Plan

If issues occur in production:

1. **Immediate:** Revert to previous Docker image tag

   ```bash
   npm run deploy:prod -- --image-tag <previous-version> --yes
   ```

2. **Investigate:** Check CloudWatch logs for errors

   ```bash
   npx ts-node bin/check-logs.ts --profile bench --type=ecs --tail=500
   ```

3. **Fix Forward:** If issue identified, create hotfix branch and redeploy

## Related Documents

- [21-tmpdir-analysis.md](21-tmpdir-analysis.md) - Root cause analysis
- [20-stack-roles-requirements.md](20-stack-roles-requirements.md) - IAM role requirements
- [docker/Dockerfile](../docker/Dockerfile) - Container configuration
- [docker/src/entry_packager.py](../docker/src/entry_packager.py) - ZIP processing code
- [docker/src/auth/role_manager.py](../docker/src/auth/role_manager.py) - IAM role management

## Implementation Order

**Phase 1** (No dependencies):

1. Task 1.1 → Task 1.2 → Test locally

**Phase 2** (Depends on Phase 1):

1. Task 2.1 → Task 2.2 → Task 2.3 → Task 2.4 → Task 2.5 → Task 2.6 → Task 2.7
2. Test after each task
3. Run full test suite

**Phase 3** (Depends on Phase 2):

1. Task 3.1 → Task 3.2 → Task 3.3 → Task 3.4 → Task 3.5 → Task 3.6
2. Test local deployment with xdg-launch
3. Deploy to dev

**Phase 4** (Parallel with Phase 3):

1. Task 4.1 → Task 4.2 → Task 4.3
2. Rebuild Docker image
3. Test locally

**Phase 5** (Validation only):

1. Verify setup wizard unchanged
2. Test setup wizard with new profile
3. Verify read role still discovered but not used

**Phase 6** (Documentation):

1. Task 6.1 → Task 6.2 → Task 6.3
2. Final review and merge
