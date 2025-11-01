# Implementation Summary: CI-Safe Docker Tests with Secret Validation

## Problem Identified

**ECS Deployment Failure:**
```
ResourceInitializationError: unable to pull secrets or registry auth:
retrieved secret from Secrets Manager did not contain json key app_definition_id
```

**Root Cause Analysis:**
1. ECS task definition expects `app_definition_id` key in AWS Secrets Manager
2. The secret only contained: `client_id`, `client_secret`, `tenant`
3. Local tests passed because they:
   - Mocked config entirely, never calling `Config.__post_init__()`
   - Environment had `BENCHLING_APP_DEFINITION_ID` set locally
   - `Config` class captured env vars at import time (not instantiation time)

## Critical Bug Discovered

The `Config` dataclass in [config.py](docker/src/config.py) was reading environment variables at **module import time**, not **instance creation time**:

```python
# BEFORE (BROKEN):
@dataclass
class Config:
    benchling_app_definition_id: str = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
    # ^^^ This is evaluated when the module is imported, not when Config() is called!
```

**Why this is broken:**
- Tests use `monkeypatch` to override env vars
- But `os.getenv()` in the class definition is evaluated at import time
- So even deleting env vars in tests has no effect
- Tests cannot properly validate missing configuration

**Impact:**
- Tests were untestable and non-deterministic
- Production deployment failures weren't caught by tests
- Local environment leaked into test results

## Solution Implemented

### 1. Fixed Config Class ([config.py:7-55](docker/src/config.py#L7-L55))

Moved all `os.getenv()` calls from class definition to `__post_init__()`:

```python
# AFTER (FIXED):
@dataclass
class Config:
    benchling_app_definition_id: str = ""  # Empty default

    def __post_init__(self):
        # Read environment variables at instantiation time
        self.benchling_app_definition_id = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
        # Now tests can properly control env vars!
```

**Benefits:**
- Environment variables read at instantiation time
- Tests can use `monkeypatch` to override env vars
- Testable and deterministic behavior
- Validation in `__post_init__` actually runs

### 2. Added Test Isolation ([tests/conftest.py](docker/tests/conftest.py))

Created auto-use fixture to isolate tests from local environment:

```python
@pytest.fixture(scope="function", autouse=True)
def isolate_environment(monkeypatch):
    """Automatically isolate each test from the host environment."""
    env_vars_to_clear = [
        "BENCHLING_APP_DEFINITION_ID",
        "BENCHLING_SECRETS",
        # ... all sensitive vars
    ]
    for var in env_vars_to_clear:
        monkeypatch.delenv(var, raising=False)
    yield
```

**Benefits:**
- Tests run the same way locally and in CI
- No leakage from developer environment
- Consistent, reproducible test results

### 3. Added Config Validation Tests ([tests/test_config_validation.py](docker/tests/test_config_validation.py))

Created comprehensive tests that catch deployment issues:

```python
def test_config_requires_app_definition_id(self, monkeypatch):
    """Test that Config raises error if app_definition_id is missing."""
    # Set all required env vars EXCEPT app_definition_id
    monkeypatch.delenv("BENCHLING_APP_DEFINITION_ID", raising=False)
    # ... set other vars ...

    # Should fail - matches ECS behavior!
    with pytest.raises(ValueError, match="benchling_app_definition_id"):
        Config()
```

**Test Coverage:**
- ✅ Missing `app_definition_id` raises error
- ✅ Empty `app_definition_id` raises error
- ✅ Valid `app_definition_id` succeeds
- ✅ All three secret sources validated
- ✅ ECS task definition requirements matched

### 4. Created Test Specification ([phase-5/04-test-spec.md](spec/156-secrets-manager/phase-5/04-test-spec.md))

Comprehensive spec documenting:
- Problem statement and root causes
- Requirements for CI-safe tests
- Implementation plan with code examples
- Future enhancements (pre-deployment validation)

## Test Results

**Before Fix:**
- 6 tests failed (DID NOT RAISE errors)
- Tests picked up `appdef_wqFfaXBVMu` from environment
- Non-deterministic based on local environment

**After Fix:**
```
8 passed in 0.04s
```

**Full Test Suite:**
```
252 passed, 1 failed (unrelated), 4 warnings in 19.41s
```

The single failure is pre-existing (deprecated upload link functionality).

## Files Changed

### Created:
1. [spec/156-secrets-manager/phase-5/04-test-spec.md](spec/156-secrets-manager/phase-5/04-test-spec.md) - Test specification
2. [docker/tests/test_config_validation.py](docker/tests/test_config_validation.py) - Validation tests (8 tests)
3. [docker/tests/conftest.py](docker/tests/conftest.py) - Test isolation fixture

### Modified:
1. [docker/src/config.py](docker/src/config.py) - Fixed env var reading timing

## Impact

### Immediate Benefits:
1. **Deployment failures caught early**: Tests now fail if required config is missing
2. **Testable config**: `Config` class can be properly tested with `monkeypatch`
3. **CI/Local parity**: Tests run identically in CI and locally
4. **Clear error messages**: Developers get actionable guidance

### Long-term Benefits:
1. **Foundation for pre-deployment validation**: Can add script to validate secrets before deploy
2. **Prevents similar issues**: Pattern can be extended to other config validation
3. **Improved developer experience**: Fast feedback on misconfiguration

## Next Steps

1. **Fix the actual secret**: Add `app_definition_id` to AWS Secrets Manager
   ```bash
   aws secretsmanager update-secret \
     --secret-id benchling-webhook/credentials \
     --secret-string '{"client_id":"...","client_secret":"...","tenant":"...","app_definition_id":"appdef_wqFfaXBVMu"}'
   ```

2. **Consider adding to ECS task definition**: Read `app_definition_id` from secret instead of env var
   ```typescript
   // In lib/fargate-service.ts
   {
     name: "BENCHLING_APP_DEFINITION_ID",
     valueFrom: `${secretArn}:app_definition_id::`
   }
   ```

3. **Add pre-deployment validation script** (optional future enhancement):
   - Validate secret structure before deployment
   - Run as part of `npm run deploy`
   - Fail fast if misconfigured

## Lessons Learned

1. **Class-level defaults with side effects are dangerous**: `os.getenv()` in class definition is evaluated at import time
2. **Mock-heavy tests can mask issues**: Mocking config bypasses validation logic
3. **Test isolation is critical**: Auto-use fixtures prevent environment leakage
4. **Dev/prod parity matters**: Local environment differences can hide production issues

## References

- ECS Error Logs: Service events show repeated `ResourceInitializationError`
- Task Definition: `benchling-webhook-task:20` with secrets configuration
- Secrets Manager: `benchling-webhook/credentials` missing `app_definition_id` key
