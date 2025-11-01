# Phase 4 Design: Container Runtime Secret Resolution

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Phase**: Phase 4 - Container Runtime Resolution
**Date**: 2025-10-31

## Overview

This phase implements runtime secret resolution in the Python Flask application, enabling the container to load Benchling credentials from AWS Secrets Manager or fall back to environment variables. This provides flexibility for different deployment scenarios (production with Secrets Manager, local development with env vars) while maintaining backward compatibility.

## Objective

Enable the Python Flask container to:
1. Check for `BENCHLING_SECRETS` environment variable first
2. If it's an ARN, fetch from AWS Secrets Manager and parse JSON
3. If it's JSON string, parse directly
4. Fall back to individual environment variables (`BENCHLING_TENANT`, `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`)
5. Provide clear error messages when secrets are unavailable or invalid
6. Add proper error handling for AWS API calls

## Context and Dependencies

### Prerequisites (Completed Phases)
- **Phase 1**: Secret validation framework ✅
- **Phase 2**: CLI parameter addition ✅
- **Phase 3**: CDK stack refactoring ✅

### What This Phase Enables
- Production deployments can use Secrets Manager for secure secret storage
- Local development can use environment variables (backward compatible)
- Container fails fast with clear errors if secrets are misconfigured
- Health endpoints can report secret source and status

## Technical Design

### 1. Secret Resolution Strategy

**Hierarchical Resolution Order**:
```python
1. BENCHLING_SECRETS env var (ARN format) → Fetch from Secrets Manager
2. BENCHLING_SECRETS env var (JSON format) → Parse directly
3. Individual env vars (BENCHLING_TENANT, etc.) → Legacy fallback
4. None available → Fail with clear error message
```

**Design Rationale**:
- Explicit configuration (`BENCHLING_SECRETS`) takes precedence
- Backward compatibility maintained via fallback to individual vars
- Fail-fast approach prevents silent misconfigurations

### 2. Module Structure

**New Module**: `docker/src/secrets_resolver.py`

This module will contain:
- `BenchlingSecrets` dataclass - typed secret structure
- `detect_secret_format()` - ARN vs JSON detection
- `fetch_from_secrets_manager()` - AWS Secrets Manager client
- `parse_secrets_json()` - JSON parsing and validation
- `resolve_benchling_secrets()` - Main resolution orchestrator
- Custom exceptions for clear error handling

**Modified Module**: `docker/src/config.py`

Changes:
- Use `resolve_benchling_secrets()` instead of direct `os.getenv()`
- Maintain Config dataclass structure
- Update validation to work with resolved secrets

### 3. Secret Data Structure

**BenchlingSecrets Dataclass**:
```python
@dataclass
class BenchlingSecrets:
    """Benchling credentials resolved from Secrets Manager or environment."""
    tenant: str
    client_id: str
    client_secret: str

    def validate(self) -> None:
        """Validate that all required fields are present and non-empty."""
        if not self.tenant:
            raise SecretsResolutionError("tenant is required")
        if not self.client_id:
            raise SecretsResolutionError("client_id is required")
        if not self.client_secret:
            raise SecretsResolutionError("client_secret is required")
```

**JSON Format** (matches CLI/CDK format):
```json
{
  "tenant": "mycompany",
  "clientId": "benchling_app_client_id",
  "clientSecret": "benchling_app_client_secret"
}
```

**Field Mapping**: JSON uses camelCase, Python dataclass uses snake_case:
- `tenant` → `tenant`
- `clientId` → `client_id`
- `clientSecret` → `client_secret`

### 4. Resolution Functions

#### 4.1 Format Detection

```python
def detect_secret_format(value: str) -> SecretFormat:
    """
    Detect if value is an ARN or JSON string.

    Args:
        value: String value from BENCHLING_SECRETS env var

    Returns:
        SecretFormat.ARN or SecretFormat.JSON

    Raises:
        SecretsResolutionError: If format is invalid
    """
    # ARN pattern: arn:aws:secretsmanager:region:account-id:secret:name
    if value.startswith("arn:aws:secretsmanager:"):
        return SecretFormat.ARN
    elif value.strip().startswith("{"):
        return SecretFormat.JSON
    else:
        raise SecretsResolutionError(
            f"Invalid BENCHLING_SECRETS format. Must be ARN or JSON, got: {value[:50]}..."
        )
```

#### 4.2 Secrets Manager Fetch

```python
def fetch_from_secrets_manager(arn: str, aws_region: str) -> BenchlingSecrets:
    """
    Fetch secret from AWS Secrets Manager and parse.

    Args:
        arn: Secret ARN
        aws_region: AWS region for client

    Returns:
        BenchlingSecrets with parsed data

    Raises:
        SecretsResolutionError: If fetch fails or secret is invalid
    """
    try:
        import boto3
        from botocore.exceptions import ClientError

        client = boto3.client('secretsmanager', region_name=aws_region)
        response = client.get_secret_value(SecretId=arn)
        secret_string = response['SecretString']

        return parse_secrets_json(secret_string)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ResourceNotFoundException':
            raise SecretsResolutionError(f"Secret not found: {arn}")
        elif error_code == 'AccessDeniedException':
            raise SecretsResolutionError(
                f"Access denied to secret: {arn}. "
                "Check IAM permissions for secretsmanager:GetSecretValue"
            )
        else:
            raise SecretsResolutionError(f"Failed to fetch secret: {str(e)}")
    except Exception as e:
        raise SecretsResolutionError(f"Unexpected error fetching secret: {str(e)}")
```

#### 4.3 JSON Parsing

```python
def parse_secrets_json(json_str: str) -> BenchlingSecrets:
    """
    Parse JSON string into BenchlingSecrets.

    Args:
        json_str: JSON string with Benchling credentials

    Returns:
        BenchlingSecrets with validated data

    Raises:
        SecretsResolutionError: If JSON is invalid or missing required fields
    """
    try:
        data = json.loads(json_str)

        # Map from JSON camelCase to Python snake_case
        secrets = BenchlingSecrets(
            tenant=data.get('tenant', ''),
            client_id=data.get('clientId', ''),
            client_secret=data.get('clientSecret', '')
        )

        secrets.validate()
        return secrets

    except json.JSONDecodeError as e:
        raise SecretsResolutionError(f"Invalid JSON in BENCHLING_SECRETS: {str(e)}")
    except KeyError as e:
        raise SecretsResolutionError(f"Missing required field in secret JSON: {str(e)}")
```

#### 4.4 Main Resolution Orchestrator

```python
def resolve_benchling_secrets(aws_region: str) -> BenchlingSecrets:
    """
    Resolve Benchling secrets from environment with hierarchical fallback.

    Resolution order:
    1. BENCHLING_SECRETS (ARN) → Fetch from Secrets Manager
    2. BENCHLING_SECRETS (JSON) → Parse directly
    3. Individual env vars → Legacy fallback
    4. None → Fail with error

    Args:
        aws_region: AWS region for Secrets Manager client

    Returns:
        BenchlingSecrets with resolved credentials

    Raises:
        SecretsResolutionError: If secrets cannot be resolved
    """
    benchling_secrets_env = os.getenv("BENCHLING_SECRETS")

    # Priority 1: BENCHLING_SECRETS env var
    if benchling_secrets_env:
        format = detect_secret_format(benchling_secrets_env)

        if format == SecretFormat.ARN:
            logger.info("Resolving Benchling secrets from Secrets Manager", arn=benchling_secrets_env)
            return fetch_from_secrets_manager(benchling_secrets_env, aws_region)
        else:  # JSON
            logger.info("Resolving Benchling secrets from JSON environment variable")
            return parse_secrets_json(benchling_secrets_env)

    # Priority 2: Individual environment variables (backward compatibility)
    tenant = os.getenv("BENCHLING_TENANT", "")
    client_id = os.getenv("BENCHLING_CLIENT_ID", "")
    client_secret = os.getenv("BENCHLING_CLIENT_SECRET", "")

    if tenant and client_id and client_secret:
        logger.info("Resolving Benchling secrets from individual environment variables")
        return BenchlingSecrets(
            tenant=tenant,
            client_id=client_id,
            client_secret=client_secret
        )

    # Priority 3: None found - fail with clear error
    raise SecretsResolutionError(
        "No Benchling secrets found. Configure one of:\n"
        "1. BENCHLING_SECRETS (ARN to Secrets Manager)\n"
        "2. BENCHLING_SECRETS (JSON with tenant, clientId, clientSecret)\n"
        "3. Individual vars: BENCHLING_TENANT, BENCHLING_CLIENT_ID, BENCHLING_CLIENT_SECRET"
    )
```

### 5. Config Integration

**Modified `config.py`**:

```python
@dataclass
class Config:
    # ... existing fields ...
    benchling_tenant: str
    benchling_client_id: str
    benchling_client_secret: str
    # ... existing fields ...

    def __post_init__(self):
        # Resolve secrets first
        try:
            secrets = resolve_benchling_secrets(self.aws_region)
            self.benchling_tenant = secrets.tenant
            self.benchling_client_id = secrets.client_id
            self.benchling_client_secret = secrets.client_secret
        except SecretsResolutionError as e:
            raise ValueError(f"Failed to resolve Benchling secrets: {str(e)}")

        # Continue with existing validation
        required_fields = [
            "aws_region",
            "s3_bucket_name",
            "queue_arn",
            "quilt_catalog",
            "benchling_tenant",
            "benchling_client_id",
            "benchling_client_secret",
            "benchling_app_definition_id",
        ]

        missing = [field for field in required_fields if not getattr(self, field)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")
```

**Key Design Decision**: Initialize fields as empty strings, populate in `__post_init__` after secret resolution. This maintains the existing Config interface while adding flexible secret loading.

### 6. Error Handling

**Custom Exception**:
```python
class SecretsResolutionError(Exception):
    """Raised when secrets cannot be resolved or are invalid."""
    pass
```

**Error Scenarios**:

| Scenario | Error Message | HTTP Status |
|----------|---------------|-------------|
| No secrets found | "No Benchling secrets found. Configure one of: ..." | 503 |
| Invalid ARN format | "Invalid BENCHLING_SECRETS format. Must be ARN or JSON" | 500 |
| Secret not found in AWS | "Secret not found: {arn}" | 503 |
| Access denied to secret | "Access denied to secret. Check IAM permissions" | 503 |
| Invalid JSON | "Invalid JSON in BENCHLING_SECRETS: {error}" | 500 |
| Missing required field | "Missing required field in secret JSON: {field}" | 500 |
| AWS API error | "Failed to fetch secret: {error}" | 503 |

**Design Principle**: All errors provide actionable remediation steps for operators.

### 7. Logging Strategy

**Log Events**:
1. **Secret Source Discovery**: Log which resolution method succeeded
2. **AWS API Calls**: Log Secrets Manager fetch attempts
3. **Validation Failures**: Log specific validation errors
4. **Fallback Behavior**: Log when falling back to legacy env vars

**Security Constraint**: NEVER log secret values (tenant, client_id, client_secret)

**Example Log Statements**:
```python
logger.info("Resolving Benchling secrets from Secrets Manager", arn=arn)
logger.info("Resolving Benchling secrets from JSON environment variable")
logger.info("Resolving Benchling secrets from individual environment variables")
logger.error("Failed to resolve Benchling secrets", error=str(e))
```

### 8. Dependencies

**New Dependency**: boto3 (already in pyproject.toml ✅)

**Version**: `boto3==1.40.62` (already specified)

**Rationale**: boto3 is AWS SDK for Python, required for Secrets Manager API access.

### 9. Testing Strategy

#### Unit Tests (`test_secrets_resolver.py`)

**Test Coverage Areas**:
1. Format detection (ARN vs JSON vs invalid)
2. JSON parsing (valid, invalid, missing fields)
3. Secrets Manager fetch (mock boto3 calls)
4. Error handling (all error scenarios)
5. Fallback logic (priority order)
6. Secret validation (empty fields, missing fields)

**Mocking Strategy**:
- Mock `boto3.client` for Secrets Manager tests
- Mock `os.getenv` for environment variable tests
- Use pytest fixtures for test data

#### Integration Tests (`test_config.py` updates)

**Test Scenarios**:
1. Config initialization with `BENCHLING_SECRETS` ARN (mocked)
2. Config initialization with `BENCHLING_SECRETS` JSON
3. Config initialization with individual env vars (existing tests)
4. Config initialization with no secrets (should fail)
5. Config initialization with invalid secrets (should fail)

#### Test Data Fixtures

```python
@pytest.fixture
def valid_secrets_json():
    return json.dumps({
        "tenant": "test-tenant",
        "clientId": "test-client-id",
        "clientSecret": "test-client-secret"
    })

@pytest.fixture
def valid_secrets_arn():
    return "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-secrets-AbCdEf"

@pytest.fixture
def mock_secrets_manager(mocker, valid_secrets_json):
    mock_client = mocker.Mock()
    mock_client.get_secret_value.return_value = {
        'SecretString': valid_secrets_json
    }
    mocker.patch('boto3.client', return_value=mock_client)
    return mock_client
```

### 10. Health Check Enhancement

**New Endpoint**: `/health/secrets`

```python
@app.route("/health/secrets", methods=["GET"])
def secrets_health():
    """Report secret resolution status and source."""
    try:
        # Determine secret source (without exposing values)
        benchling_secrets_env = os.getenv("BENCHLING_SECRETS")
        if benchling_secrets_env:
            if benchling_secrets_env.startswith("arn:"):
                source = "secrets_manager"
            else:
                source = "environment_json"
        elif os.getenv("BENCHLING_TENANT"):
            source = "environment_vars"
        else:
            source = "not_configured"

        # Check if secrets are valid
        config = get_config()
        secrets_valid = bool(
            config.benchling_tenant and
            config.benchling_client_id and
            config.benchling_client_secret
        )

        return jsonify({
            "status": "healthy" if secrets_valid else "unhealthy",
            "source": source,
            "secrets_valid": secrets_valid,
            "tenant_configured": bool(config.benchling_tenant),
        })
    except Exception as e:
        logger.error("Secrets health check failed", error=str(e))
        return jsonify({
            "status": "unhealthy",
            "error": str(e)
        }), 503
```

**Design Rationale**: Separate endpoint for secret-specific health checks allows operators to diagnose secret configuration issues independently from general application health.

## Backward Compatibility

### Compatibility Matrix

| Configuration | Before Phase 4 | After Phase 4 |
|---------------|----------------|---------------|
| Individual env vars | ✅ Works | ✅ Works (fallback) |
| BENCHLING_SECRETS (ARN) | ❌ Not supported | ✅ Works |
| BENCHLING_SECRETS (JSON) | ❌ Not supported | ✅ Works |
| No secrets | ❌ Fails at startup | ❌ Fails at startup (same) |

**Migration Impact**: Zero breaking changes. All existing deployments continue to work.

### Deprecation Strategy (Future)

**Not in Phase 4 scope**, but planned:
- Phase 7 (Documentation): Document migration from individual vars to `BENCHLING_SECRETS`
- Phase 8 (Deprecation): Add warning logs when using individual env vars
- v1.0: Remove individual env var support (require `BENCHLING_SECRETS`)

## Security Considerations

### Secret Protection

1. **Never Log Secret Values**: All logging must mask/omit secret contents
2. **Memory Protection**: Secrets stored in Config instance only, not global vars
3. **Error Messages**: Never include secret values in error messages
4. **Health Endpoint**: Never expose secret values in health check responses

### IAM Permissions

**Required for Secrets Manager Resolution**:
```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue"
  ],
  "Resource": "arn:aws:secretsmanager:region:account:secret:name-*"
}
```

**Already configured in Phase 3** ✅ (CDK stack grants task execution role permission)

### AWS SDK Authentication

**boto3 Authentication Order**:
1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
2. ECS task role (in production) ✅ Preferred
3. EC2 instance profile (if applicable)
4. AWS credentials file (~/.aws/credentials)

**Design Decision**: No explicit credential configuration. Rely on IAM task role in ECS (most secure).

## Performance Considerations

### Secrets Manager API Call

**Latency**: ~100-200ms per API call

**Mitigation**: Call once at application startup, cache in Config instance

**Cost**: $0.40 per 10,000 API calls (negligible for startup-only access)

### Local Development

**No Performance Impact**: Uses environment variables (no API calls)

### Startup Time Impact

**Estimated**: +100-200ms when using Secrets Manager
**Acceptable**: Within health check timeout (default 30s)

## Success Criteria

**Phase 4 is complete when**:

1. ✅ `secrets_resolver.py` module implemented with all functions
2. ✅ `config.py` integrated with secret resolution
3. ✅ Unit tests for all resolution paths with >85% coverage
4. ✅ Integration tests validate all configuration methods
5. ✅ Error handling tested for all failure scenarios
6. ✅ Health check endpoint reports secret source
7. ✅ Backward compatibility maintained (existing deployments work)
8. ✅ Documentation updated with secret resolution details
9. ✅ All tests pass (`make test`)
10. ✅ No secrets exposed in logs or error messages

## Implementation Notes

### File Changes Summary

**New Files**:
- `docker/src/secrets_resolver.py` (~200 lines)
- `docker/tests/test_secrets_resolver.py` (~400 lines)

**Modified Files**:
- `docker/src/config.py` (~20 lines changed)
- `docker/src/app.py` (~30 lines added for health endpoint)
- `docker/tests/test_config_env_vars.py` (~50 lines added)
- `docker/tests/test_app.py` (~30 lines added for health endpoint)

**No Changes Required**:
- `pyproject.toml` (boto3 already present ✅)
- Dockerfile (no new system dependencies)
- CDK stack (Phase 3 already configured ✅)

### Development Order (TDD)

1. **Red**: Write failing unit test for format detection
2. **Green**: Implement format detection
3. **Red**: Write failing unit test for JSON parsing
4. **Green**: Implement JSON parsing
5. **Red**: Write failing unit test for Secrets Manager fetch
6. **Green**: Implement Secrets Manager fetch (with mocks)
7. **Red**: Write failing unit test for resolution orchestrator
8. **Green**: Implement resolution orchestrator
9. **Red**: Write failing integration test for Config with new secrets
10. **Green**: Update Config to use secret resolution
11. **Red**: Write failing test for health endpoint
12. **Green**: Implement health endpoint
13. **Refactor**: Clean up, add logging, improve error messages

## Risk Mitigation

### Risk: Secrets Manager API Failure

**Mitigation**:
- Clear error messages guide operators to check IAM permissions
- Fallback to environment variables allows emergency recovery
- Health check endpoint exposes configuration issues

### Risk: Breaking Existing Deployments

**Mitigation**:
- Backward compatibility maintained via fallback
- Integration tests validate existing configuration methods
- Phased rollout (no force migration)

### Risk: Secret Exposure in Logs

**Mitigation**:
- Code review checklist includes secret exposure check
- Unit tests verify no secret values in error messages
- Structured logging never includes secret fields

### Risk: boto3 Import Failure

**Mitigation**:
- boto3 already in dependencies (Phase 0)
- Import error caught with clear message
- Requirements.txt / pyproject.toml already specifies version

## Open Questions

None at this stage. All design decisions finalized based on:
- Phase 1: Validation framework patterns ✅
- Phase 2: CLI parameter structure ✅
- Phase 3: CDK environment variable configuration ✅

## References

- [AWS Secrets Manager Python SDK Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/secretsmanager.html)
- [Python dataclasses Documentation](https://docs.python.org/3/library/dataclasses.html)
- [structlog Best Practices](https://www.structlog.org/en/stable/best-practices.html)
- Phase 1 Design: `05-phase1-design.md` (validation patterns)
- Phase 3 Design: `11-phase3-design.md` (CDK environment configuration)
- Current Config Implementation: `docker/src/config.py`

## Next Steps

After design approval:
1. Create Phase 4 Episodes document (15-phase4-episodes.md)
2. Create Phase 4 Checklist document (16-phase4-checklist.md)
3. Commit and push documentation
4. Execute implementation following TDD methodology

---

**Document Status**: ✅ Ready for Review
**Estimated Implementation Time**: 1-2 days
**Complexity**: Medium
**Risk Level**: Low (backward compatible, well-defined scope)
