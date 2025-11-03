# Test Spec: CI-Safe Docker Tests with Secret Validation

## Problem Statement

The deployment to ECS failed because `app_definition_id` was missing from AWS Secrets Manager, but local tests passed because:
1. Tests mocked the config with empty string for `app_definition_id`
2. Tests never actually instantiate `Config()` to trigger `__post_init__` validation
3. No integration tests validate the actual secret structure matches deployment requirements

**ECS Error:**
```
ResourceInitializationError: retrieved secret from Secrets Manager did not contain json key app_definition_id
```

## Root Causes

1. **Mock-heavy tests bypass validation**: `test_app.py` mocks config entirely, never calling `Config.__post_init__()`
2. **No secret structure validation**: No tests verify the secret JSON structure matches ECS task definition requirements
3. **CI runs subset of tests**: Integration tests marked `@pytest.mark.local` don't run in CI
4. **Dev/prod secret parity**: No mechanism ensures local dev secrets match production secret structure

## Requirements

### 1. CI-Safe Docker Tests
- [ ] Run docker tests in CI without AWS credentials
- [ ] Detect missing secrets early in development
- [ ] Validate secret structure matches deployment requirements
- [ ] Don't expose actual secret values in test output

### 2. Secret Validation Tests
- [ ] Test that `Config.__post_init__()` enforces required fields
- [ ] Test secret resolver handles all three secret sources (JSON, ARN, env vars)
- [ ] Test secret structure matches ECS task definition expectations
- [ ] Test deployment will fail fast if secrets are misconfigured

### 3. Integration with CI
- [ ] Tests run on every PR
- [ ] Tests fail if required secret keys are missing
- [ ] Tests work without actual AWS access
- [ ] Clear error messages guide developers to fix issues

## Proposed Solution

### Phase 1: Add Secret Structure Validation Tests

Create `docker/tests/test_config_validation.py`:
- Test `Config()` instantiation with missing `app_definition_id`
- Test `Config()` instantiation with all required fields
- Test secret resolver validates structure
- Use environment variables (not mocks) to simulate production

### Phase 2: Add Secret Structure Validator

Create `docker/src/secret_validator.py`:
- Define expected secret structure schema
- Validate against ECS task definition requirements
- Provide clear error messages for missing keys
- Can be used in tests and deployment validation

### Phase 3: Add Pre-deployment Validation Script

Create `bin/validate-secrets.ts`:
- Check AWS Secrets Manager secret structure
- Compare against ECS task definition
- Run as part of deployment process
- Fail deployment if secrets are misconfigured

### Phase 4: Update CI Configuration

Update `.github/workflows/test.yml` (or similar):
- Run docker tests with mock secret structure
- Validate secret structure without AWS access
- Ensure tests fail if validation fails

## Implementation Plan

### Step 1: Create test_config_validation.py
```python
# docker/tests/test_config_validation.py
import pytest
import os
from src.config import Config

class TestConfigValidation:
    def test_config_requires_app_definition_id(self, monkeypatch):
        """Test that Config raises error if app_definition_id is missing."""
        # Set all required env vars except app_definition_id
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_TENANT", "test-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "test-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "test-secret")
        # app_definition_id NOT set

        with pytest.raises(ValueError, match="benchling_app_definition_id"):
            Config()

    def test_config_accepts_valid_app_definition_id(self, monkeypatch):
        """Test that Config succeeds with all required fields."""
        # Set ALL required env vars including app_definition_id
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_TENANT", "test-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "test-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "test-secret")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

        config = Config()
        assert config.benchling_app_definition_id == "app-123"
```

### Step 2: Create secret structure validator
```python
# docker/src/secret_validator.py
from dataclasses import dataclass
from typing import Dict, List

@dataclass
class SecretSchema:
    """Expected secret structure for ECS deployment."""
    required_keys: List[str]

    @classmethod
    def ecs_task_definition_schema(cls):
        """Schema matching ECS task definition requirements."""
        return cls(required_keys=[
            "client_id",
            "client_secret",
            "tenant",
            "app_definition_id"  # MISSING from current secret!
        ])

    def validate(self, secret_dict: Dict[str, str]) -> List[str]:
        """Return list of missing keys."""
        return [key for key in self.required_keys if key not in secret_dict]
```

### Step 3: Add pre-deployment validation
```typescript
// bin/validate-secrets.ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function validateSecrets() {
  const client = new SecretsManagerClient({ region: "us-east-1" });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: "benchling-webhook/credentials" })
  );

  const secret = JSON.parse(response.SecretString!);
  const required = ["client_id", "client_secret", "tenant", "app_definition_id"];
  const missing = required.filter(key => !(key in secret));

  if (missing.length > 0) {
    console.error(`ERROR: Secret missing required keys: ${missing.join(", ")}`);
    console.error("Current keys:", Object.keys(secret));
    process.exit(1);
  }

  console.log("✓ Secret structure validated");
}

validateSecrets();
```

### Step 4: Update CI configuration
```yaml
# .github/workflows/test.yml
jobs:
  test-docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          cd docker
          pip install -r requirements.txt
          pip install -r requirements-dev.txt
      - name: Run config validation tests
        run: |
          cd docker
          pytest tests/test_config_validation.py -v
        env:
          # Provide minimal secret structure for CI
          BENCHLING_TENANT: ci-test
          BENCHLING_CLIENT_ID: ci-test
          BENCHLING_CLIENT_SECRET: ci-test
          BENCHLING_APP_DEFINITION_ID: ci-test
          AWS_REGION: us-east-1
          QUILT_USER_BUCKET: ci-test
          QUEUE_ARN: arn:aws:sqs:us-east-1:123456789012:ci-test
          QUILT_CATALOG: ci-test
```

## Success Criteria

1. **Tests catch missing secrets**: New tests fail if `app_definition_id` is not set
2. **CI validates structure**: CI runs validation tests on every PR
3. **Pre-deployment check**: Deployment script validates secret structure before deploy
4. **Clear error messages**: Developers get actionable guidance when secrets are misconfigured
5. **No AWS credentials needed**: Tests run without real AWS credentials in CI

## Testing Strategy

1. **Unit tests** (no AWS): Test config validation with environment variables
2. **Integration tests** (local only): Test with actual AWS Secrets Manager
3. **Pre-deployment validation** (deployment time): Validate before ECS deployment
4. **CI tests** (every PR): Run unit tests with mock secrets

## Rollout Plan

1. Create validation tests (this PR)
2. Fix existing tests to not bypass validation
3. Add pre-deployment validation script
4. Update deployment process to run validation
5. Update CI to run validation tests
6. Document secret structure requirements

## Related Files

- `docker/src/config.py` - Config with validation
- `docker/tests/test_app.py` - Tests that bypass validation (line 22)
- `lib/fargate-service.ts` - ECS task definition with secret references
- `.github/workflows/*.yml` - CI configuration
