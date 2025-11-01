# Phase 4 Checklist: Container Runtime Secret Resolution

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Phase**: Phase 4 - Container Runtime Resolution
**Date**: 2025-10-31

## Overview

This checklist provides granular task tracking for implementing Phase 4. Follow each task in order, checking boxes as completed. Each episode includes pre-implementation, implementation, and post-implementation tasks.

## Pre-Implementation Setup

### Environment Setup
- [ ] Verify working directory: `/Users/ernest/GitHub/benchling-webhook`
- [ ] Verify branch: `156-secrets-manager`
- [ ] Verify Python environment active (uv or venv)
- [ ] Run `make test` to ensure baseline tests pass
- [ ] Verify boto3 is in dependencies (`grep boto3 docker/pyproject.toml`)

### Documentation Review
- [ ] Read Phase 4 Design document (`14-phase4-design.md`)
- [ ] Read Phase 4 Episodes document (`15-phase4-episodes.md`)
- [ ] Review current `docker/src/config.py` implementation
- [ ] Review current `docker/src/app.py` implementation
- [ ] Review existing test patterns in `docker/tests/`

---

## Episode 1: Project Setup and Data Structures

### Pre-Episode Tasks
- [ ] Review Episode 1 in episodes document
- [ ] Understand BenchlingSecrets dataclass requirements
- [ ] Understand SecretsResolutionError requirements

### Red Phase: Write Failing Tests
- [ ] Create new file: `docker/tests/test_secrets_resolver.py`
- [ ] Add imports for pytest and dataclasses
- [ ] Write test: `test_benchling_secrets_dataclass_creation`
- [ ] Write test: `test_benchling_secrets_validation_success`
- [ ] Write test: `test_benchling_secrets_validation_missing_tenant`
- [ ] Write test: `test_benchling_secrets_validation_missing_client_id`
- [ ] Write test: `test_benchling_secrets_validation_missing_client_secret`
- [ ] Write test: `test_secret_format_enum_exists`
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement Data Structures
- [ ] Create new file: `docker/src/secrets_resolver.py`
- [ ] Add module docstring
- [ ] Add imports (json, os, dataclasses, enum, structlog)
- [ ] Implement `SecretsResolutionError` exception class
- [ ] Implement `SecretFormat` enum (ARN, JSON)
- [ ] Implement `BenchlingSecrets` dataclass
- [ ] Implement `BenchlingSecrets.validate()` method
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Add comprehensive docstrings to all classes and methods
- [ ] Add type hints to all functions
- [ ] Run linter: `cd docker && python -m black src/secrets_resolver.py`
- [ ] Run linter: `cd docker && python -m isort src/secrets_resolver.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify test coverage: `pytest tests/test_secrets_resolver.py --cov=src.secrets_resolver --cov-report=term-missing`
- [ ] Commit changes with message from Episode 1
- [ ] Push commit to remote

### Critical Test Cases
1. **Valid dataclass creation**: Verify all fields accessible
2. **Validation success**: All fields present and non-empty
3. **Validation failure**: Each required field validated individually
4. **Enum values**: ARN and JSON format types exist

---

## Episode 2: Format Detection

### Pre-Episode Tasks
- [ ] Review Episode 2 in episodes document
- [ ] Understand ARN format pattern
- [ ] Understand JSON format detection

### Red Phase: Write Failing Tests
- [ ] Add test class: `TestFormatDetection` in `test_secrets_resolver.py`
- [ ] Write test: `test_detect_arn_format`
- [ ] Write test: `test_detect_json_format`
- [ ] Write test: `test_detect_json_format_with_whitespace`
- [ ] Write test: `test_detect_invalid_format`
- [ ] Write test: `test_detect_empty_string`
- [ ] Write test: `test_detect_partial_arn`
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestFormatDetection -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement Format Detection
- [ ] Add `detect_secret_format(value: str) -> SecretFormat` function
- [ ] Check for empty/whitespace strings
- [ ] Check for ARN pattern: `arn:aws:secretsmanager:`
- [ ] Check for JSON pattern: starts with `{`
- [ ] Raise `SecretsResolutionError` for invalid formats
- [ ] Include clear error messages with examples
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestFormatDetection -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Optimize string operations
- [ ] Improve error message clarity
- [ ] Add edge case handling
- [ ] Run linter: `cd docker && python -m black src/secrets_resolver.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify coverage: `pytest tests/test_secrets_resolver.py --cov=src.secrets_resolver`
- [ ] Commit changes with message from Episode 2
- [ ] Push commit to remote

### Critical Test Cases
1. **ARN detection**: Correctly identifies Secrets Manager ARN
2. **JSON detection**: Correctly identifies JSON string
3. **Whitespace handling**: Strips whitespace before checking
4. **Invalid format**: Raises error with clear message
5. **Edge cases**: Empty string, partial ARN handled

---

## Episode 3: JSON Parsing and Validation

### Pre-Episode Tasks
- [ ] Review Episode 3 in episodes document
- [ ] Understand camelCase to snake_case mapping
- [ ] Review JSON parsing error handling

### Red Phase: Write Failing Tests
- [ ] Add test class: `TestJSONParsing` in `test_secrets_resolver.py`
- [ ] Write test: `test_parse_valid_json`
- [ ] Write test: `test_parse_json_missing_tenant`
- [ ] Write test: `test_parse_json_missing_client_id`
- [ ] Write test: `test_parse_json_missing_client_secret`
- [ ] Write test: `test_parse_json_empty_fields`
- [ ] Write test: `test_parse_invalid_json`
- [ ] Write test: `test_parse_json_extra_fields_ignored`
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestJSONParsing -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement JSON Parsing
- [ ] Add `parse_secrets_json(json_str: str) -> BenchlingSecrets` function
- [ ] Parse JSON with `json.loads()` in try-except
- [ ] Handle `json.JSONDecodeError` with clear message
- [ ] Map `tenant` → `tenant`
- [ ] Map `clientId` → `client_id`
- [ ] Map `clientSecret` → `client_secret`
- [ ] Call `secrets.validate()` to check all fields
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestJSONParsing -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Improve error context in exceptions
- [ ] Optimize dictionary access
- [ ] Consider alternative field names (future compatibility)
- [ ] Run linter: `cd docker && python -m black src/secrets_resolver.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify coverage: `pytest tests/test_secrets_resolver.py --cov=src.secrets_resolver`
- [ ] Commit changes with message from Episode 3
- [ ] Push commit to remote

### Critical Test Cases
1. **Valid JSON parsing**: All fields mapped correctly (camelCase to snake_case)
2. **Missing fields**: Each required field validated independently
3. **Empty fields**: Validation catches empty strings
4. **Invalid JSON**: JSON syntax errors caught with clear message
5. **Extra fields**: Additional fields ignored gracefully

---

## Episode 4: Secrets Manager Fetch (Mocked)

### Pre-Episode Tasks
- [ ] Review Episode 4 in episodes document
- [ ] Understand boto3 Secrets Manager API
- [ ] Understand pytest-mock usage for boto3

### Red Phase: Write Failing Tests
- [ ] Add pytest fixtures in `test_secrets_resolver.py`:
  - [ ] `valid_secrets_json` fixture
  - [ ] `mock_secrets_manager_success` fixture
- [ ] Add test class: `TestSecretsManagerFetch`
- [ ] Write test: `test_fetch_from_secrets_manager_success`
- [ ] Write test: `test_fetch_resource_not_found`
- [ ] Write test: `test_fetch_access_denied`
- [ ] Write test: `test_fetch_generic_aws_error`
- [ ] Write test: `test_fetch_invalid_json_in_secret`
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestSecretsManagerFetch -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement Secrets Manager Fetch
- [ ] Add `fetch_from_secrets_manager(arn: str, aws_region: str) -> BenchlingSecrets` function
- [ ] Import boto3 and botocore.exceptions inside try-except
- [ ] Create Secrets Manager client with region
- [ ] Call `get_secret_value(SecretId=arn)`
- [ ] Handle `ClientError` with `ResourceNotFoundException`
- [ ] Handle `ClientError` with `AccessDeniedException`
- [ ] Handle generic `ClientError` exceptions
- [ ] Handle unexpected exceptions
- [ ] Parse secret string with `parse_secrets_json()`
- [ ] Add debug logging for fetch attempts
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestSecretsManagerFetch -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Improve error messages with remediation steps
- [ ] Add structured logging for troubleshooting
- [ ] Optimize boto3 client creation
- [ ] Run linter: `cd docker && python -m black src/secrets_resolver.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify coverage: `pytest tests/test_secrets_resolver.py --cov=src.secrets_resolver`
- [ ] Commit changes with message from Episode 4
- [ ] Push commit to remote

### Critical Test Cases
1. **Successful fetch**: boto3 called correctly, secret parsed
2. **ResourceNotFoundException**: Clear error when secret doesn't exist
3. **AccessDeniedException**: IAM permission guidance in error
4. **Generic AWS errors**: Handled gracefully with message
5. **Invalid JSON in secret**: Parsing error caught and reported

---

## Episode 5: Resolution Orchestrator

### Pre-Episode Tasks
- [ ] Review Episode 5 in episodes document
- [ ] Understand hierarchical resolution order
- [ ] Review fallback logic requirements

### Red Phase: Write Failing Tests
- [ ] Add test class: `TestResolutionOrchestrator` in `test_secrets_resolver.py`
- [ ] Write test: `test_resolve_from_arn` (with mocked fetch)
- [ ] Write test: `test_resolve_from_json`
- [ ] Write test: `test_resolve_from_individual_env_vars`
- [ ] Write test: `test_resolve_priority_benchling_secrets_over_individual`
- [ ] Write test: `test_resolve_no_secrets_configured`
- [ ] Write test: `test_resolve_partial_individual_vars`
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestResolutionOrchestrator -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement Resolution Orchestrator
- [ ] Add `resolve_benchling_secrets(aws_region: str) -> BenchlingSecrets` function
- [ ] Get `BENCHLING_SECRETS` environment variable
- [ ] If present, detect format with `detect_secret_format()`
- [ ] If ARN, call `fetch_from_secrets_manager()`
- [ ] If JSON, call `parse_secrets_json()`
- [ ] If not present, check individual env vars:
  - [ ] `BENCHLING_TENANT`
  - [ ] `BENCHLING_CLIENT_ID`
  - [ ] `BENCHLING_CLIENT_SECRET`
- [ ] If all individual vars present, create and validate `BenchlingSecrets`
- [ ] If none found, raise `SecretsResolutionError` with multi-line help
- [ ] Add info logging for each resolution path
- [ ] Run tests: `pytest docker/tests/test_secrets_resolver.py::TestResolutionOrchestrator -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Improve logging for troubleshooting
- [ ] Optimize environment variable access
- [ ] Consider caching resolved secrets (future)
- [ ] Run linter: `cd docker && python -m black src/secrets_resolver.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify coverage: `pytest tests/test_secrets_resolver.py --cov=src.secrets_resolver`
- [ ] Commit changes with message from Episode 5
- [ ] Push commit to remote

### Critical Test Cases
1. **ARN resolution**: BENCHLING_SECRETS ARN fetches from Secrets Manager
2. **JSON resolution**: BENCHLING_SECRETS JSON parsed directly
3. **Individual vars fallback**: Legacy env vars work when no BENCHLING_SECRETS
4. **Priority order**: BENCHLING_SECRETS takes priority over individual vars
5. **No secrets**: Clear error with all configuration options
6. **Partial individual vars**: Fails when individual vars incomplete

---

## Episode 6: Config Integration

### Pre-Episode Tasks
- [ ] Review Episode 6 in episodes document
- [ ] Review current `docker/src/config.py` implementation
- [ ] Understand Config dataclass structure

### Red Phase: Write Failing Tests
- [ ] Open `docker/tests/test_config_env_vars.py`
- [ ] Add pytest fixture: `minimal_env_vars` (sets non-Benchling vars)
- [ ] Add test class: `TestConfigWithSecretsResolver`
- [ ] Write test: `test_config_with_benchling_secrets_json`
- [ ] Write test: `test_config_with_individual_env_vars`
- [ ] Write test: `test_config_fails_without_secrets`
- [ ] Write test: `test_config_priority_benchling_secrets_over_individual`
- [ ] Run tests: `pytest docker/tests/test_config_env_vars.py::TestConfigWithSecretsResolver -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement Config Integration
- [ ] Open `docker/src/config.py`
- [ ] Add import: `from .secrets_resolver import resolve_benchling_secrets, SecretsResolutionError`
- [ ] Change Benchling field defaults to empty strings:
  - [ ] `benchling_tenant: str = ""`
  - [ ] `benchling_client_id: str = ""`
  - [ ] `benchling_client_secret: str = ""`
- [ ] Update `__post_init__` method:
  - [ ] Call `resolve_benchling_secrets(self.aws_region)` in try-except
  - [ ] Set `self.benchling_tenant = secrets.tenant`
  - [ ] Set `self.benchling_client_id = secrets.client_id`
  - [ ] Set `self.benchling_client_secret = secrets.client_secret`
  - [ ] Catch `SecretsResolutionError` and raise `ValueError` with message
- [ ] Keep existing required fields validation
- [ ] Run tests: `pytest docker/tests/test_config_env_vars.py::TestConfigWithSecretsResolver -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Ensure error messages are clear
- [ ] Update Config docstring
- [ ] Run linter: `cd docker && python -m black src/config.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify existing config tests still pass
- [ ] Verify coverage: `pytest tests/test_config_env_vars.py --cov=src.config`
- [ ] Commit changes with message from Episode 6
- [ ] Push commit to remote

### Critical Test Cases
1. **JSON secret config**: Config initialized with BENCHLING_SECRETS JSON
2. **Individual vars config**: Backward compatibility maintained
3. **No secrets**: Config initialization fails with clear error
4. **Priority order**: BENCHLING_SECRETS takes priority in Config
5. **All required fields**: Validation still works after resolution

---

## Episode 7: Health Check Enhancement

### Pre-Episode Tasks
- [ ] Review Episode 7 in episodes document
- [ ] Review current health endpoints in `docker/src/app.py`
- [ ] Understand health check patterns

### Red Phase: Write Failing Tests
- [ ] Open `docker/tests/test_app.py`
- [ ] Add imports for json and secrets_resolver
- [ ] Write test: `test_health_secrets_endpoint_with_json`
- [ ] Write test: `test_health_secrets_endpoint_with_arn` (with mock)
- [ ] Write test: `test_health_secrets_endpoint_with_individual_vars`
- [ ] Write test: `test_health_secrets_endpoint_not_configured`
- [ ] Run tests: `pytest docker/tests/test_app.py -k health_secrets -v`
- [ ] Verify all tests fail ❌

### Green Phase: Implement Health Endpoint
- [ ] Open `docker/src/app.py`
- [ ] Add new route after `/health/live`:
  - [ ] Route: `@app.route("/health/secrets", methods=["GET"])`
  - [ ] Function: `def secrets_health():`
- [ ] Check `BENCHLING_SECRETS` env var:
  - [ ] If starts with "arn:", source = "secrets_manager"
  - [ ] Else, source = "environment_json"
- [ ] If not present, check `BENCHLING_TENANT`:
  - [ ] If present, source = "environment_vars"
  - [ ] Else, source = "not_configured"
- [ ] Check secrets validity:
  - [ ] Verify config.benchling_tenant non-empty
  - [ ] Verify config.benchling_client_id non-empty
  - [ ] Verify config.benchling_client_secret non-empty
- [ ] Return JSON response:
  - [ ] status: "healthy" or "unhealthy"
  - [ ] source: determined source
  - [ ] secrets_valid: boolean
  - [ ] tenant_configured: boolean
- [ ] Add exception handler returning 503 on error
- [ ] Run tests: `pytest docker/tests/test_app.py -k health_secrets -v`
- [ ] Verify all tests pass ✅

### Refactor Phase
- [ ] Ensure no secret values exposed in response
- [ ] Add structured logging
- [ ] Consider adding last_resolution_time (future)
- [ ] Run linter: `cd docker && python -m black src/app.py`
- [ ] Fix any IDE diagnostics

### Post-Episode Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify coverage: `pytest tests/test_app.py -k health --cov=src.app`
- [ ] Manual test: `curl http://localhost:5000/health/secrets` (if app running)
- [ ] Commit changes with message from Episode 7
- [ ] Push commit to remote

### Critical Test Cases
1. **JSON source**: Reports "environment_json" correctly
2. **ARN source**: Reports "secrets_manager" correctly
3. **Individual vars**: Reports "environment_vars" correctly
4. **Not configured**: Reports "not_configured" and unhealthy
5. **No secret exposure**: Response never contains secret values

---

## Episode 8: Final Integration and Verification

### Pre-Episode Tasks
- [ ] Review Episode 8 in episodes document
- [ ] Review all previous episodes for completeness
- [ ] Prepare for final testing

### Documentation Tasks
- [ ] Update `docker/src/secrets_resolver.py` module docstring
- [ ] Add usage examples to module docstring
- [ ] Document environment variables
- [ ] Document error handling
- [ ] Document security considerations

### Testing Tasks
- [ ] Run full test suite: `cd docker && pytest tests/ -v`
- [ ] Verify all tests pass ✅
- [ ] Check test coverage: `pytest tests/ --cov=src --cov-report=term-missing`
- [ ] Verify coverage >85% for:
  - [ ] `src/secrets_resolver.py`
  - [ ] Modified portions of `src/config.py`
  - [ ] Health endpoint in `src/app.py`

### Linting Tasks
- [ ] Run black: `cd docker && python -m black src/`
- [ ] Run isort: `cd docker && python -m isort src/`
- [ ] Run flake8: `cd docker && python -m flake8 src/`
- [ ] Fix all linting errors
- [ ] Fix all IDE diagnostics

### Manual Testing Tasks
- [ ] Test with JSON environment variable:
  ```bash
  export BENCHLING_SECRETS='{"tenant":"test","clientId":"id","clientSecret":"secret"}'
  python -c "from src.config import get_config; c = get_config(); print(c.benchling_tenant)"
  ```
- [ ] Test with individual environment variables:
  ```bash
  unset BENCHLING_SECRETS
  export BENCHLING_TENANT=test
  export BENCHLING_CLIENT_ID=id
  export BENCHLING_CLIENT_SECRET=secret
  python -c "from src.config import get_config; c = get_config(); print(c.benchling_tenant)"
  ```
- [ ] Test error case:
  ```bash
  unset BENCHLING_SECRETS
  unset BENCHLING_TENANT
  unset BENCHLING_CLIENT_ID
  unset BENCHLING_CLIENT_SECRET
  python -c "from src.config import get_config; c = get_config()"  # Should fail
  ```

### Flask App Integration Testing
- [ ] Set all required environment variables
- [ ] Start Flask app: `python -m src.app`
- [ ] Test health endpoint: `curl http://localhost:5000/health`
- [ ] Test secrets health: `curl http://localhost:5000/health/secrets`
- [ ] Verify response shows correct source
- [ ] Stop Flask app

### Security Verification
- [ ] Review all log statements in `secrets_resolver.py`
- [ ] Verify no secret values logged
- [ ] Review all error messages
- [ ] Verify no secret values in error messages
- [ ] Review health endpoint response
- [ ] Verify no secret values in health response
- [ ] Check exception stack traces don't leak secrets

### Backward Compatibility Verification
- [ ] Verify individual env vars still work (existing tests pass)
- [ ] Verify Config validation still works
- [ ] Verify no breaking changes to Config interface
- [ ] Verify existing deployments will work unchanged

### Post-Episode Tasks
- [ ] Run `make test` from project root
- [ ] Run `make lint` from project root
- [ ] Commit all changes with message from Episode 8
- [ ] Push final commit to remote

### Verification Checklist
- [ ] All 43+ unit tests pass
- [ ] All integration tests pass
- [ ] Test coverage >85%
- [ ] No linting errors
- [ ] No IDE diagnostics
- [ ] Manual testing successful
- [ ] Health endpoint works correctly
- [ ] No secrets in logs or errors
- [ ] Documentation complete
- [ ] Backward compatibility verified
- [ ] Security review complete

---

## Post-Implementation Tasks

### Final Review
- [ ] Review all committed code
- [ ] Verify all episodes completed
- [ ] Verify all tests pass
- [ ] Verify documentation complete

### Pull Request Preparation
- [ ] Update CHANGELOG.md with Phase 4 changes
- [ ] Create PR description summarizing changes
- [ ] List all new files and modified files
- [ ] Highlight backward compatibility maintained
- [ ] Note test coverage achieved
- [ ] Include example usage

### PR Creation
- [ ] Create PR from implementation branch to `156-secrets-manager`
- [ ] Add labels: `enhancement`, `phase-4`, `secrets-manager`
- [ ] Request review from team
- [ ] Link to issue #156
- [ ] Monitor CI/CD pipeline

### Post-PR Tasks
- [ ] Address review comments
- [ ] Update documentation based on feedback
- [ ] Re-run tests after changes
- [ ] Merge when approved

---

## Troubleshooting Guide

### Common Issues

#### Tests failing to import secrets_resolver
**Symptom**: `ModuleNotFoundError: No module named 'src.secrets_resolver'`
**Solution**:
- Ensure file created: `docker/src/secrets_resolver.py`
- Check PYTHONPATH includes `docker/src`
- Try: `cd docker && pytest tests/`

#### boto3 mock not working
**Symptom**: Tests calling real AWS API
**Solution**:
- Verify pytest-mock installed: `pip list | grep pytest-mock`
- Check mock is patching correct path: `'boto3.client'`
- Verify fixture is used in test function signature

#### Config tests failing
**Symptom**: Config.__post_init__ raises unexpected errors
**Solution**:
- Verify all required env vars set in fixtures
- Check `minimal_env_vars` fixture sets all non-Benchling vars
- Verify monkeypatch is clearing old env vars

#### Health endpoint not found
**Symptom**: 404 error for `/health/secrets`
**Solution**:
- Verify route added to `docker/src/app.py`
- Check route decorator syntax: `@app.route("/health/secrets", methods=["GET"])`
- Restart Flask app after changes

#### Coverage below 85%
**Symptom**: Coverage report shows <85% for new code
**Solution**:
- Review uncovered lines in coverage report
- Add tests for error paths
- Add tests for edge cases
- Verify all branches covered

### Getting Help

If stuck:
1. Review design document for intended behavior
2. Review episodes document for implementation guidance
3. Check existing test patterns in codebase
4. Search for similar implementations in other modules
5. Consult team for architecture questions

---

## File Modification Summary

### New Files Created
- [ ] `docker/src/secrets_resolver.py` (~200 lines)
- [ ] `docker/tests/test_secrets_resolver.py` (~400 lines)

### Files Modified
- [ ] `docker/src/config.py` (~20 lines changed)
- [ ] `docker/src/app.py` (~30 lines added)
- [ ] `docker/tests/test_config_env_vars.py` (~50 lines added)
- [ ] `docker/tests/test_app.py` (~30 lines added)

### Files NOT Modified (Already Compatible)
- `docker/pyproject.toml` (boto3 already present)
- `docker/Dockerfile` (no new system dependencies)
- `lib/` (CDK stack - Phase 3 already configured)

---

## Success Criteria Verification

### Functional Requirements
- [ ] ✅ ARN resolution works (fetch from Secrets Manager)
- [ ] ✅ JSON resolution works (parse from env var)
- [ ] ✅ Individual vars fallback works (backward compatible)
- [ ] ✅ Priority order correct (ARN > JSON > Individual)
- [ ] ✅ Health endpoint reports secret source

### Quality Requirements
- [ ] ✅ All tests pass (43+ tests)
- [ ] ✅ Test coverage >85%
- [ ] ✅ No linting errors
- [ ] ✅ No IDE diagnostics
- [ ] ✅ Documentation complete

### Security Requirements
- [ ] ✅ No secret values in logs
- [ ] ✅ No secret values in error messages
- [ ] ✅ No secret values in health response
- [ ] ✅ No secret values in stack traces
- [ ] ✅ IAM permissions checked for Secrets Manager

### Compatibility Requirements
- [ ] ✅ Backward compatibility maintained
- [ ] ✅ Existing tests still pass
- [ ] ✅ Config interface unchanged
- [ ] ✅ No breaking changes to deployments

---

## Completion Status

### Episode Completion
- [ ] Episode 1: Data Structures ✅
- [ ] Episode 2: Format Detection ✅
- [ ] Episode 3: JSON Parsing ✅
- [ ] Episode 4: Secrets Manager Fetch ✅
- [ ] Episode 5: Resolution Orchestrator ✅
- [ ] Episode 6: Config Integration ✅
- [ ] Episode 7: Health Check Enhancement ✅
- [ ] Episode 8: Final Integration ✅

### Phase Completion
- [ ] All episodes complete ✅
- [ ] All tests passing ✅
- [ ] All documentation complete ✅
- [ ] PR created and reviewed ✅
- [ ] Changes merged ✅

---

**Phase 4 Status**: Ready to Execute
**Estimated Time**: 1-2 days
**Next Action**: Begin Episode 1 - Project Setup and Data Structures
