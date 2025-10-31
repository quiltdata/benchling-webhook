# Phase 4 Episodes: Container Runtime Secret Resolution

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Phase**: Phase 4 - Container Runtime Resolution
**Date**: 2025-10-31

## Overview

This document breaks down the Phase 4 implementation into atomic, testable episodes. Each episode follows the Test-Driven Development (TDD) cycle: Red (failing test) → Green (implementation) → Refactor. Episodes are designed to be independently committable while maintaining a working state throughout.

## Episode Sequencing

```
Episode 1: Project Setup
    ↓
Episode 2: Format Detection
    ↓
Episode 3: JSON Parsing and Validation
    ↓
Episode 4: Secrets Manager Fetch (Mocked)
    ↓
Episode 5: Resolution Orchestrator
    ↓
Episode 6: Config Integration
    ↓
Episode 7: Health Check Enhancement
    ↓
Episode 8: Final Integration and Verification
```

---

## Episode 1: Project Setup and Data Structures

### Objective
Create module structure, data classes, and custom exceptions for secret resolution.

### Red: Failing Tests First

**Test File**: `docker/tests/test_secrets_resolver.py`

```python
"""Test suite for secrets_resolver module."""

import pytest
from src.secrets_resolver import (
    BenchlingSecrets,
    SecretsResolutionError,
    SecretFormat,
)


def test_benchling_secrets_dataclass_creation():
    """Test BenchlingSecrets dataclass can be created with valid data."""
    secrets = BenchlingSecrets(
        tenant="test-tenant",
        client_id="test-client-id",
        client_secret="test-client-secret"
    )

    assert secrets.tenant == "test-tenant"
    assert secrets.client_id == "test-client-id"
    assert secrets.client_secret == "test-client-secret"


def test_benchling_secrets_validation_success():
    """Test validation passes with all required fields."""
    secrets = BenchlingSecrets(
        tenant="test-tenant",
        client_id="test-client-id",
        client_secret="test-client-secret"
    )

    # Should not raise
    secrets.validate()


def test_benchling_secrets_validation_missing_tenant():
    """Test validation fails when tenant is missing."""
    secrets = BenchlingSecrets(
        tenant="",
        client_id="test-client-id",
        client_secret="test-client-secret"
    )

    with pytest.raises(SecretsResolutionError, match="tenant is required"):
        secrets.validate()


def test_benchling_secrets_validation_missing_client_id():
    """Test validation fails when client_id is missing."""
    secrets = BenchlingSecrets(
        tenant="test-tenant",
        client_id="",
        client_secret="test-client-secret"
    )

    with pytest.raises(SecretsResolutionError, match="client_id is required"):
        secrets.validate()


def test_benchling_secrets_validation_missing_client_secret():
    """Test validation fails when client_secret is missing."""
    secrets = BenchlingSecrets(
        tenant="test-tenant",
        client_id="test-client-id",
        client_secret=""
    )

    with pytest.raises(SecretsResolutionError, match="client_secret is required"):
        secrets.validate()


def test_secret_format_enum_exists():
    """Test SecretFormat enum has expected values."""
    assert SecretFormat.ARN
    assert SecretFormat.JSON
```

**Expected Outcome**: All tests fail because module doesn't exist yet. ❌

### Green: Minimal Implementation

**New File**: `docker/src/secrets_resolver.py`

```python
"""Secret resolution for Benchling credentials.

This module provides runtime resolution of Benchling secrets from:
1. AWS Secrets Manager (via ARN)
2. Environment variable (JSON format)
3. Individual environment variables (legacy)
"""

import json
import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


class SecretsResolutionError(Exception):
    """Raised when secrets cannot be resolved or are invalid."""
    pass


class SecretFormat(Enum):
    """Format of BENCHLING_SECRETS environment variable."""
    ARN = "arn"
    JSON = "json"


@dataclass
class BenchlingSecrets:
    """Benchling credentials resolved from Secrets Manager or environment."""
    tenant: str
    client_id: str
    client_secret: str

    def validate(self) -> None:
        """Validate that all required fields are present and non-empty.

        Raises:
            SecretsResolutionError: If any required field is missing or empty
        """
        if not self.tenant:
            raise SecretsResolutionError("tenant is required")
        if not self.client_id:
            raise SecretsResolutionError("client_id is required")
        if not self.client_secret:
            raise SecretsResolutionError("client_secret is required")
```

**Expected Outcome**: All tests pass. ✅

### Refactor
- Add comprehensive docstrings
- Add type hints to all functions
- Ensure module imports work correctly

### Commit Message
```
test(secrets): add data structures for secret resolution

- Add BenchlingSecrets dataclass with validation
- Add SecretFormat enum for ARN vs JSON detection
- Add SecretsResolutionError custom exception
- Add unit tests with >90% coverage for data structures

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 2: Format Detection

### Objective
Implement detection of ARN vs JSON format for `BENCHLING_SECRETS` value.

### Red: Failing Tests First

**Add to**: `docker/tests/test_secrets_resolver.py`

```python
from src.secrets_resolver import detect_secret_format


class TestFormatDetection:
    """Test suite for secret format detection."""

    def test_detect_arn_format(self):
        """Test ARN format is correctly detected."""
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"
        result = detect_secret_format(arn)
        assert result == SecretFormat.ARN

    def test_detect_json_format(self):
        """Test JSON format is correctly detected."""
        json_str = '{"tenant": "test", "clientId": "id", "clientSecret": "secret"}'
        result = detect_secret_format(json_str)
        assert result == SecretFormat.JSON

    def test_detect_json_format_with_whitespace(self):
        """Test JSON format with leading whitespace."""
        json_str = '  \n  {"tenant": "test", "clientId": "id", "clientSecret": "secret"}'
        result = detect_secret_format(json_str)
        assert result == SecretFormat.JSON

    def test_detect_invalid_format(self):
        """Test invalid format raises error."""
        invalid = "not-an-arn-or-json"
        with pytest.raises(SecretsResolutionError, match="Invalid BENCHLING_SECRETS format"):
            detect_secret_format(invalid)

    def test_detect_empty_string(self):
        """Test empty string raises error."""
        with pytest.raises(SecretsResolutionError, match="Invalid BENCHLING_SECRETS format"):
            detect_secret_format("")

    def test_detect_partial_arn(self):
        """Test partial ARN (wrong service) raises error."""
        invalid_arn = "arn:aws:s3:::my-bucket"
        with pytest.raises(SecretsResolutionError, match="Invalid BENCHLING_SECRETS format"):
            detect_secret_format(invalid_arn)
```

**Expected Outcome**: All tests fail because function doesn't exist. ❌

### Green: Minimal Implementation

**Add to**: `docker/src/secrets_resolver.py`

```python
def detect_secret_format(value: str) -> SecretFormat:
    """Detect if value is an ARN or JSON string.

    Args:
        value: String value from BENCHLING_SECRETS env var

    Returns:
        SecretFormat.ARN or SecretFormat.JSON

    Raises:
        SecretsResolutionError: If format is invalid or cannot be determined
    """
    if not value or not value.strip():
        raise SecretsResolutionError(
            "Invalid BENCHLING_SECRETS format: empty value"
        )

    # Check for ARN format
    if value.startswith("arn:aws:secretsmanager:"):
        return SecretFormat.ARN

    # Check for JSON format
    if value.strip().startswith("{"):
        return SecretFormat.JSON

    # Neither format recognized
    raise SecretsResolutionError(
        f"Invalid BENCHLING_SECRETS format. Must be ARN starting with "
        f"'arn:aws:secretsmanager:' or JSON starting with '{{'. "
        f"Got: {value[:50]}..."
    )
```

**Expected Outcome**: All tests pass. ✅

### Refactor
- Improve error messages with examples
- Add edge case handling
- Optimize string operations

### Commit Message
```
feat(secrets): implement format detection for ARN vs JSON

- Add detect_secret_format() function
- Support ARN and JSON format detection
- Handle edge cases (whitespace, empty strings)
- Provide clear error messages for invalid formats
- Add comprehensive unit tests

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 3: JSON Parsing and Validation

### Objective
Implement JSON parsing with field validation and camelCase to snake_case mapping.

### Red: Failing Tests First

**Add to**: `docker/tests/test_secrets_resolver.py`

```python
from src.secrets_resolver import parse_secrets_json


class TestJSONParsing:
    """Test suite for JSON secret parsing."""

    def test_parse_valid_json(self):
        """Test parsing valid JSON with all required fields."""
        json_str = json.dumps({
            "tenant": "test-tenant",
            "clientId": "test-client-id",
            "clientSecret": "test-client-secret"
        })

        secrets = parse_secrets_json(json_str)

        assert secrets.tenant == "test-tenant"
        assert secrets.client_id == "test-client-id"
        assert secrets.client_secret == "test-client-secret"

    def test_parse_json_missing_tenant(self):
        """Test parsing fails when tenant is missing."""
        json_str = json.dumps({
            "clientId": "test-client-id",
            "clientSecret": "test-client-secret"
        })

        with pytest.raises(SecretsResolutionError, match="tenant is required"):
            parse_secrets_json(json_str)

    def test_parse_json_missing_client_id(self):
        """Test parsing fails when clientId is missing."""
        json_str = json.dumps({
            "tenant": "test-tenant",
            "clientSecret": "test-client-secret"
        })

        with pytest.raises(SecretsResolutionError, match="client_id is required"):
            parse_secrets_json(json_str)

    def test_parse_json_missing_client_secret(self):
        """Test parsing fails when clientSecret is missing."""
        json_str = json.dumps({
            "tenant": "test-tenant",
            "clientId": "test-client-id"
        })

        with pytest.raises(SecretsResolutionError, match="client_secret is required"):
            parse_secrets_json(json_str)

    def test_parse_json_empty_fields(self):
        """Test parsing fails when fields are empty strings."""
        json_str = json.dumps({
            "tenant": "",
            "clientId": "test-client-id",
            "clientSecret": "test-client-secret"
        })

        with pytest.raises(SecretsResolutionError, match="tenant is required"):
            parse_secrets_json(json_str)

    def test_parse_invalid_json(self):
        """Test parsing fails with invalid JSON syntax."""
        invalid_json = '{"tenant": "test", invalid}'

        with pytest.raises(SecretsResolutionError, match="Invalid JSON"):
            parse_secrets_json(invalid_json)

    def test_parse_json_extra_fields_ignored(self):
        """Test extra fields are ignored gracefully."""
        json_str = json.dumps({
            "tenant": "test-tenant",
            "clientId": "test-client-id",
            "clientSecret": "test-client-secret",
            "extraField": "ignored"
        })

        secrets = parse_secrets_json(json_str)

        # Should succeed, extra field ignored
        assert secrets.tenant == "test-tenant"
```

**Expected Outcome**: All tests fail because function doesn't exist. ❌

### Green: Minimal Implementation

**Add to**: `docker/src/secrets_resolver.py`

```python
def parse_secrets_json(json_str: str) -> BenchlingSecrets:
    """Parse JSON string into BenchlingSecrets.

    Args:
        json_str: JSON string with Benchling credentials

    Returns:
        BenchlingSecrets with validated data

    Raises:
        SecretsResolutionError: If JSON is invalid or missing required fields
    """
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise SecretsResolutionError(
            f"Invalid JSON in BENCHLING_SECRETS: {str(e)}"
        )

    # Map from JSON camelCase to Python snake_case
    secrets = BenchlingSecrets(
        tenant=data.get('tenant', ''),
        client_id=data.get('clientId', ''),
        client_secret=data.get('clientSecret', '')
    )

    # Validate all required fields are present and non-empty
    secrets.validate()

    return secrets
```

**Expected Outcome**: All tests pass. ✅

### Refactor
- Add better error context
- Consider alternative field names for backward compatibility
- Optimize dictionary access

### Commit Message
```
feat(secrets): implement JSON parsing with validation

- Add parse_secrets_json() function
- Map camelCase JSON to snake_case Python
- Validate all required fields present and non-empty
- Handle invalid JSON with clear error messages
- Add comprehensive unit tests for all scenarios

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 4: Secrets Manager Fetch (Mocked)

### Objective
Implement AWS Secrets Manager fetch with comprehensive error handling, using mocked boto3 for tests.

### Red: Failing Tests First

**Add to**: `docker/tests/test_secrets_resolver.py`

```python
from unittest.mock import Mock
from botocore.exceptions import ClientError
from src.secrets_resolver import fetch_from_secrets_manager


class TestSecretsManagerFetch:
    """Test suite for AWS Secrets Manager fetching."""

    @pytest.fixture
    def valid_secrets_json(self):
        """Valid secrets JSON for testing."""
        return json.dumps({
            "tenant": "test-tenant",
            "clientId": "test-client-id",
            "clientSecret": "test-client-secret"
        })

    @pytest.fixture
    def mock_secrets_manager_success(self, mocker, valid_secrets_json):
        """Mock successful Secrets Manager fetch."""
        mock_client = Mock()
        mock_client.get_secret_value.return_value = {
            'SecretString': valid_secrets_json
        }
        mocker.patch('boto3.client', return_value=mock_client)
        return mock_client

    def test_fetch_from_secrets_manager_success(self, mock_secrets_manager_success, valid_secrets_json):
        """Test successful secret fetch from Secrets Manager."""
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        secrets = fetch_from_secrets_manager(arn, "us-east-2")

        assert secrets.tenant == "test-tenant"
        assert secrets.client_id == "test-client-id"
        assert secrets.client_secret == "test-client-secret"

        # Verify boto3 client was called correctly
        mock_secrets_manager_success.get_secret_value.assert_called_once_with(SecretId=arn)

    def test_fetch_resource_not_found(self, mocker):
        """Test fetch fails gracefully when secret doesn't exist."""
        mock_client = Mock()
        mock_client.get_secret_value.side_effect = ClientError(
            {'Error': {'Code': 'ResourceNotFoundException', 'Message': 'Secret not found'}},
            'GetSecretValue'
        )
        mocker.patch('boto3.client', return_value=mock_client)

        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:nonexistent-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Secret not found"):
            fetch_from_secrets_manager(arn, "us-east-2")

    def test_fetch_access_denied(self, mocker):
        """Test fetch fails gracefully when IAM permissions insufficient."""
        mock_client = Mock()
        mock_client.get_secret_value.side_effect = ClientError(
            {'Error': {'Code': 'AccessDeniedException', 'Message': 'Access denied'}},
            'GetSecretValue'
        )
        mocker.patch('boto3.client', return_value=mock_client)

        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Access denied.*IAM permissions"):
            fetch_from_secrets_manager(arn, "us-east-2")

    def test_fetch_generic_aws_error(self, mocker):
        """Test fetch handles generic AWS errors."""
        mock_client = Mock()
        mock_client.get_secret_value.side_effect = ClientError(
            {'Error': {'Code': 'InternalServiceError', 'Message': 'AWS service error'}},
            'GetSecretValue'
        )
        mocker.patch('boto3.client', return_value=mock_client)

        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Failed to fetch secret"):
            fetch_from_secrets_manager(arn, "us-east-2")

    def test_fetch_invalid_json_in_secret(self, mocker):
        """Test fetch fails when secret contains invalid JSON."""
        mock_client = Mock()
        mock_client.get_secret_value.return_value = {
            'SecretString': 'not valid json'
        }
        mocker.patch('boto3.client', return_value=mock_client)

        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"

        with pytest.raises(SecretsResolutionError, match="Invalid JSON"):
            fetch_from_secrets_manager(arn, "us-east-2")
```

**Expected Outcome**: All tests fail because function doesn't exist. ❌

### Green: Minimal Implementation

**Add to**: `docker/src/secrets_resolver.py`

```python
def fetch_from_secrets_manager(arn: str, aws_region: str) -> BenchlingSecrets:
    """Fetch secret from AWS Secrets Manager and parse.

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

        logger.debug("Fetching secret from Secrets Manager", arn=arn, region=aws_region)

        client = boto3.client('secretsmanager', region_name=aws_region)
        response = client.get_secret_value(SecretId=arn)
        secret_string = response['SecretString']

        logger.debug("Successfully fetched secret from Secrets Manager")

        return parse_secrets_json(secret_string)

    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ResourceNotFoundException':
            raise SecretsResolutionError(
                f"Secret not found: {arn}. "
                "Verify the ARN is correct and the secret exists."
            )
        elif error_code == 'AccessDeniedException':
            raise SecretsResolutionError(
                f"Access denied to secret: {arn}. "
                "Check IAM permissions for secretsmanager:GetSecretValue"
            )
        else:
            raise SecretsResolutionError(
                f"Failed to fetch secret: {e.response['Error']['Message']}"
            )
    except SecretsResolutionError:
        # Re-raise secrets resolution errors (from parse_secrets_json)
        raise
    except Exception as e:
        raise SecretsResolutionError(
            f"Unexpected error fetching secret from Secrets Manager: {str(e)}"
        )
```

**Expected Outcome**: All tests pass. ✅

### Refactor
- Improve error messages with remediation steps
- Add debug logging
- Optimize boto3 client creation

### Commit Message
```
feat(secrets): implement Secrets Manager fetch with error handling

- Add fetch_from_secrets_manager() function
- Handle ResourceNotFoundException with clear message
- Handle AccessDeniedException with IAM guidance
- Handle generic AWS errors gracefully
- Add comprehensive unit tests with mocked boto3
- Include debug logging for troubleshooting

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 5: Resolution Orchestrator

### Objective
Implement main resolution orchestrator with hierarchical fallback logic.

### Red: Failing Tests First

**Add to**: `docker/tests/test_secrets_resolver.py`

```python
from src.secrets_resolver import resolve_benchling_secrets


class TestResolutionOrchestrator:
    """Test suite for main secret resolution orchestrator."""

    def test_resolve_from_arn(self, mocker, monkeypatch):
        """Test resolution from BENCHLING_SECRETS ARN."""
        arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"
        monkeypatch.setenv("BENCHLING_SECRETS", arn)

        # Mock Secrets Manager fetch
        mock_secrets = BenchlingSecrets("test-tenant", "test-id", "test-secret")
        mocker.patch('src.secrets_resolver.fetch_from_secrets_manager', return_value=mock_secrets)

        secrets = resolve_benchling_secrets("us-east-2")

        assert secrets.tenant == "test-tenant"
        assert secrets.client_id == "test-id"
        assert secrets.client_secret == "test-secret"

    def test_resolve_from_json(self, monkeypatch):
        """Test resolution from BENCHLING_SECRETS JSON."""
        json_str = json.dumps({
            "tenant": "json-tenant",
            "clientId": "json-id",
            "clientSecret": "json-secret"
        })
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)

        secrets = resolve_benchling_secrets("us-east-2")

        assert secrets.tenant == "json-tenant"
        assert secrets.client_id == "json-id"
        assert secrets.client_secret == "json-secret"

    def test_resolve_from_individual_env_vars(self, monkeypatch):
        """Test fallback to individual environment variables."""
        # No BENCHLING_SECRETS
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)

        # Set individual vars
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "env-secret")

        secrets = resolve_benchling_secrets("us-east-2")

        assert secrets.tenant == "env-tenant"
        assert secrets.client_id == "env-id"
        assert secrets.client_secret == "env-secret"

    def test_resolve_priority_benchling_secrets_over_individual(self, mocker, monkeypatch):
        """Test BENCHLING_SECRETS takes priority over individual vars."""
        # Set both
        json_str = json.dumps({
            "tenant": "json-tenant",
            "clientId": "json-id",
            "clientSecret": "json-secret"
        })
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "env-secret")

        secrets = resolve_benchling_secrets("us-east-2")

        # Should use BENCHLING_SECRETS (JSON), not individual vars
        assert secrets.tenant == "json-tenant"
        assert secrets.client_id == "json-id"
        assert secrets.client_secret == "json-secret"

    def test_resolve_no_secrets_configured(self, monkeypatch):
        """Test resolution fails when no secrets configured."""
        # Remove all env vars
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
        monkeypatch.delenv("BENCHLING_TENANT", raising=False)
        monkeypatch.delenv("BENCHLING_CLIENT_ID", raising=False)
        monkeypatch.delenv("BENCHLING_CLIENT_SECRET", raising=False)

        with pytest.raises(SecretsResolutionError, match="No Benchling secrets found"):
            resolve_benchling_secrets("us-east-2")

    def test_resolve_partial_individual_vars(self, monkeypatch):
        """Test resolution fails when individual vars are incomplete."""
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        # Missing BENCHLING_CLIENT_SECRET

        with pytest.raises(SecretsResolutionError, match="No Benchling secrets found"):
            resolve_benchling_secrets("us-east-2")
```

**Expected Outcome**: All tests fail because function doesn't exist. ❌

### Green: Minimal Implementation

**Add to**: `docker/src/secrets_resolver.py`

```python
def resolve_benchling_secrets(aws_region: str) -> BenchlingSecrets:
    """Resolve Benchling secrets from environment with hierarchical fallback.

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
        secret_format = detect_secret_format(benchling_secrets_env)

        if secret_format == SecretFormat.ARN:
            logger.info("Resolving Benchling secrets from Secrets Manager")
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
        secrets = BenchlingSecrets(
            tenant=tenant,
            client_id=client_id,
            client_secret=client_secret
        )
        secrets.validate()
        return secrets

    # Priority 3: None found - fail with clear error
    raise SecretsResolutionError(
        "No Benchling secrets found. Configure one of:\n"
        "1. BENCHLING_SECRETS (ARN to Secrets Manager)\n"
        "2. BENCHLING_SECRETS (JSON with tenant, clientId, clientSecret)\n"
        "3. Individual vars: BENCHLING_TENANT, BENCHLING_CLIENT_ID, BENCHLING_CLIENT_SECRET"
    )
```

**Expected Outcome**: All tests pass. ✅

### Refactor
- Improve logging for troubleshooting
- Add performance optimization for frequent calls
- Consider caching resolved secrets (for future optimization)

### Commit Message
```
feat(secrets): implement resolution orchestrator with fallback

- Add resolve_benchling_secrets() main orchestrator
- Implement hierarchical resolution: ARN > JSON > Individual vars
- Support backward compatibility with individual env vars
- Provide clear error when no secrets found
- Add comprehensive unit tests for all resolution paths
- Include structured logging for each resolution method

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 6: Config Integration

### Objective
Integrate secret resolution into Config class, maintaining backward compatibility.

### Red: Failing Tests First

**Add to**: `docker/tests/test_config_env_vars.py`

```python
import json
import pytest
from src.config import get_config
from src.secrets_resolver import SecretsResolutionError


class TestConfigWithSecretsResolver:
    """Test Config integration with secrets resolver."""

    @pytest.fixture
    def minimal_env_vars(self, monkeypatch):
        """Set minimal required env vars (non-Benchling)."""
        monkeypatch.setenv("AWS_REGION", "us-east-2")
        monkeypatch.setenv("QUILT_USER_BUCKET", "test-bucket")
        monkeypatch.setenv("QUEUE_ARN", "arn:aws:sqs:us-east-2:123456789012:test-queue")
        monkeypatch.setenv("QUILT_CATALOG", "test.quiltdata.com")
        monkeypatch.setenv("BENCHLING_APP_DEFINITION_ID", "app-123")

    def test_config_with_benchling_secrets_json(self, monkeypatch, minimal_env_vars):
        """Test Config initialization with BENCHLING_SECRETS JSON."""
        json_str = json.dumps({
            "tenant": "json-tenant",
            "clientId": "json-id",
            "clientSecret": "json-secret"
        })
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)

        config = get_config()

        assert config.benchling_tenant == "json-tenant"
        assert config.benchling_client_id == "json-id"
        assert config.benchling_client_secret == "json-secret"

    def test_config_with_individual_env_vars(self, monkeypatch, minimal_env_vars):
        """Test Config with individual Benchling env vars (backward compatible)."""
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "env-secret")

        config = get_config()

        assert config.benchling_tenant == "env-tenant"
        assert config.benchling_client_id == "env-id"
        assert config.benchling_client_secret == "env-secret"

    def test_config_fails_without_secrets(self, monkeypatch, minimal_env_vars):
        """Test Config fails when no Benchling secrets provided."""
        # Remove all Benchling env vars
        monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
        monkeypatch.delenv("BENCHLING_TENANT", raising=False)
        monkeypatch.delenv("BENCHLING_CLIENT_ID", raising=False)
        monkeypatch.delenv("BENCHLING_CLIENT_SECRET", raising=False)

        with pytest.raises(ValueError, match="Failed to resolve Benchling secrets"):
            get_config()

    def test_config_priority_benchling_secrets_over_individual(self, monkeypatch, minimal_env_vars):
        """Test BENCHLING_SECRETS takes priority over individual vars."""
        # Set both
        json_str = json.dumps({
            "tenant": "json-tenant",
            "clientId": "json-id",
            "clientSecret": "json-secret"
        })
        monkeypatch.setenv("BENCHLING_SECRETS", json_str)
        monkeypatch.setenv("BENCHLING_TENANT", "env-tenant")
        monkeypatch.setenv("BENCHLING_CLIENT_ID", "env-id")
        monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "env-secret")

        config = get_config()

        # Should use BENCHLING_SECRETS (JSON)
        assert config.benchling_tenant == "json-tenant"
```

**Expected Outcome**: All tests fail because Config doesn't use resolver yet. ❌

### Green: Minimal Implementation

**Modify**: `docker/src/config.py`

```python
import os
from dataclasses import dataclass

from .secrets_resolver import resolve_benchling_secrets, SecretsResolutionError


@dataclass
class Config:
    flask_env: str = os.getenv("FLASK_ENV", "development")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    aws_region: str = os.getenv("AWS_REGION", "us-east-2")
    s3_bucket_name: str = os.getenv("QUILT_USER_BUCKET", "")
    s3_prefix: str = os.getenv("PKG_PREFIX", "benchling")
    package_key: str = os.getenv("PKG_KEY", "experiment_id")
    quilt_catalog: str = os.getenv("QUILT_CATALOG", "stable.quilttest.com")
    quilt_database: str = os.getenv("QUILT_DATABASE", "")
    queue_arn: str = os.getenv("QUEUE_ARN", "")
    benchling_tenant: str = ""  # Will be resolved in __post_init__
    benchling_client_id: str = ""  # Will be resolved in __post_init__
    benchling_client_secret: str = ""  # Will be resolved in __post_init__
    benchling_app_definition_id: str = os.getenv("BENCHLING_APP_DEFINITION_ID", "")
    enable_webhook_verification: bool = os.getenv("ENABLE_WEBHOOK_VERIFICATION", "true").lower() == "true"

    def __post_init__(self):
        # Resolve Benchling secrets first
        try:
            secrets = resolve_benchling_secrets(self.aws_region)
            self.benchling_tenant = secrets.tenant
            self.benchling_client_id = secrets.client_id
            self.benchling_client_secret = secrets.client_secret
        except SecretsResolutionError as e:
            raise ValueError(f"Failed to resolve Benchling secrets: {str(e)}")

        # Required fields - validate after resolution
        required_fields = [
            # AWS & Quilt
            "aws_region",
            "s3_bucket_name",
            "queue_arn",
            "quilt_catalog",
            # Benchling
            "benchling_tenant",
            "benchling_client_id",
            "benchling_client_secret",
            "benchling_app_definition_id",
        ]

        missing = [field for field in required_fields if not getattr(self, field)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")


def get_config() -> Config:
    return Config()
```

**Expected Outcome**: All tests pass. ✅

### Refactor
- Ensure error messages are clear
- Consider lazy loading optimization (future)
- Update docstrings

### Commit Message
```
feat(config): integrate secret resolution into Config

- Update Config.__post_init__ to use resolve_benchling_secrets()
- Initialize Benchling fields as empty, populate after resolution
- Maintain backward compatibility with individual env vars
- Raise clear ValueError when secret resolution fails
- Add comprehensive integration tests
- Validate all required fields after resolution

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 7: Health Check Enhancement

### Objective
Add `/health/secrets` endpoint to report secret source and status.

### Red: Failing Tests First

**Add to**: `docker/tests/test_app.py`

```python
def test_health_secrets_endpoint_with_json(client, monkeypatch):
    """Test /health/secrets reports JSON secret source."""
    json_str = json.dumps({
        "tenant": "test-tenant",
        "clientId": "test-id",
        "clientSecret": "test-secret"
    })
    monkeypatch.setenv("BENCHLING_SECRETS", json_str)

    # Reinitialize app with new env vars
    from src.app import create_app
    app = create_app()
    client = app.test_client()

    response = client.get("/health/secrets")
    assert response.status_code == 200

    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["source"] == "environment_json"
    assert data["secrets_valid"] is True
    assert data["tenant_configured"] is True


def test_health_secrets_endpoint_with_arn(client, mocker, monkeypatch):
    """Test /health/secrets reports Secrets Manager source."""
    arn = "arn:aws:secretsmanager:us-east-2:123456789012:secret:benchling-AbCdEf"
    monkeypatch.setenv("BENCHLING_SECRETS", arn)

    # Mock Secrets Manager
    mock_secrets = BenchlingSecrets("test-tenant", "test-id", "test-secret")
    mocker.patch('src.secrets_resolver.fetch_from_secrets_manager', return_value=mock_secrets)

    from src.app import create_app
    app = create_app()
    client = app.test_client()

    response = client.get("/health/secrets")
    assert response.status_code == 200

    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["source"] == "secrets_manager"


def test_health_secrets_endpoint_with_individual_vars(client, monkeypatch):
    """Test /health/secrets reports individual env var source."""
    monkeypatch.delenv("BENCHLING_SECRETS", raising=False)
    monkeypatch.setenv("BENCHLING_TENANT", "test-tenant")
    monkeypatch.setenv("BENCHLING_CLIENT_ID", "test-id")
    monkeypatch.setenv("BENCHLING_CLIENT_SECRET", "test-secret")

    from src.app import create_app
    app = create_app()
    client = app.test_client()

    response = client.get("/health/secrets")
    assert response.status_code == 200

    data = response.get_json()
    assert data["status"] == "healthy"
    assert data["source"] == "environment_vars"


def test_health_secrets_endpoint_not_configured(client, monkeypatch):
    """Test /health/secrets reports unhealthy when not configured."""
    # Remove all secret env vars
    for var in ["BENCHLING_SECRETS", "BENCHLING_TENANT", "BENCHLING_CLIENT_ID", "BENCHLING_CLIENT_SECRET"]:
        monkeypatch.delenv(var, raising=False)

    # This should fail during app creation
    from src.app import create_app
    with pytest.raises(Exception):
        app = create_app()
```

**Expected Outcome**: All tests fail because endpoint doesn't exist. ❌

### Green: Minimal Implementation

**Modify**: `docker/src/app.py`

Add after the existing `/health/live` endpoint:

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

**Expected Outcome**: All tests pass. ✅

### Refactor
- Ensure no secret values are exposed
- Add structured logging
- Consider adding last_resolution_time (future)

### Commit Message
```
feat(health): add /health/secrets endpoint for diagnostics

- Add GET /health/secrets endpoint
- Report secret source (secrets_manager, environment_json, environment_vars)
- Report secret validation status
- Never expose secret values in response
- Add comprehensive unit tests for all sources
- Include error handling with 503 status

Part of Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode 8: Final Integration and Verification

### Objective
Final integration testing, documentation updates, and comprehensive verification.

### Tasks

1. **Run Full Test Suite**
   ```bash
   cd docker
   pytest tests/ -v --cov=src --cov-report=term-missing
   ```

2. **Verify Coverage** (Target: >85%)
   - Check `secrets_resolver.py` coverage
   - Check `config.py` coverage
   - Check health endpoint coverage

3. **Run Linting**
   ```bash
   make lint
   ```

4. **Fix IDE Diagnostics**
   - Check for any type errors
   - Fix import order
   - Fix formatting issues

5. **Update Module Documentation**

**Add to**: `docker/src/secrets_resolver.py` (module docstring)

```python
"""Secret resolution for Benchling credentials.

This module provides runtime resolution of Benchling secrets from multiple sources
with hierarchical fallback:

1. AWS Secrets Manager (via ARN in BENCHLING_SECRETS env var)
2. JSON environment variable (BENCHLING_SECRETS with JSON content)
3. Individual environment variables (legacy: BENCHLING_TENANT, etc.)

Usage:
    from src.secrets_resolver import resolve_benchling_secrets

    secrets = resolve_benchling_secrets(aws_region="us-east-2")
    print(f"Tenant: {secrets.tenant}")

Environment Variables:
    BENCHLING_SECRETS: ARN or JSON string with Benchling credentials
    BENCHLING_TENANT: (Legacy) Benchling tenant name
    BENCHLING_CLIENT_ID: (Legacy) OAuth client ID
    BENCHLING_CLIENT_SECRET: (Legacy) OAuth client secret

Raises:
    SecretsResolutionError: When secrets cannot be resolved or are invalid

Security:
    - Never logs secret values
    - Validates all required fields
    - Provides clear error messages without exposing secrets
"""
```

6. **Manual Testing (Local)**
   ```bash
   # Test with JSON
   export BENCHLING_SECRETS='{"tenant":"test","clientId":"id","clientSecret":"secret"}'
   python -c "from src.config import get_config; c = get_config(); print(c.benchling_tenant)"

   # Test with individual vars
   unset BENCHLING_SECRETS
   export BENCHLING_TENANT=test
   export BENCHLING_CLIENT_ID=id
   export BENCHLING_CLIENT_SECRET=secret
   python -c "from src.config import get_config; c = get_config(); print(c.benchling_tenant)"
   ```

7. **Integration Test with Flask App**
   ```bash
   # Set required env vars
   export AWS_REGION=us-east-2
   export QUILT_USER_BUCKET=test-bucket
   export QUEUE_ARN=arn:aws:sqs:us-east-2:123456789012:test-queue
   export QUILT_CATALOG=test.quiltdata.com
   export BENCHLING_APP_DEFINITION_ID=app-123
   export BENCHLING_SECRETS='{"tenant":"test","clientId":"id","clientSecret":"secret"}'

   # Start app
   python -m src.app

   # In another terminal
   curl http://localhost:5000/health/secrets
   ```

8. **Verify No Secret Leaks**
   - Check all log statements
   - Check all error messages
   - Check health endpoint response
   - Ensure no secrets in stack traces

### Verification Checklist

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Test coverage >85%
- [ ] No linting errors
- [ ] No IDE diagnostics
- [ ] Manual testing successful
- [ ] Health endpoint works
- [ ] No secrets in logs
- [ ] Documentation complete
- [ ] Backward compatibility verified

### Commit Message
```
docs(secrets): finalize Phase 4 with documentation and verification

- Add comprehensive module documentation
- Verify all tests pass with >85% coverage
- Fix all linting and IDE diagnostics
- Verify no secret exposure in logs or errors
- Confirm backward compatibility maintained
- Update health endpoint documentation

Completes Phase 4 (Container Runtime Resolution) for #156
```

---

## Episode Summary

| Episode | Focus | New Files | Modified Files | Tests | Commits |
|---------|-------|-----------|----------------|-------|---------|
| 1 | Data structures | `secrets_resolver.py` | None | 8 | 1 |
| 2 | Format detection | None | `secrets_resolver.py` | 6 | 1 |
| 3 | JSON parsing | None | `secrets_resolver.py` | 7 | 1 |
| 4 | Secrets Manager | None | `secrets_resolver.py` | 6 | 1 |
| 5 | Orchestrator | None | `secrets_resolver.py` | 7 | 1 |
| 6 | Config integration | None | `config.py` | 5 | 1 |
| 7 | Health endpoint | None | `app.py` | 4 | 1 |
| 8 | Verification | None | Documentation | All | 1 |
| **Total** | | **1 new** | **3 modified** | **43** | **8** |

## Success Metrics

**Phase 4 Complete When**:
- ✅ All 43+ tests pass
- ✅ Test coverage >85% for new code
- ✅ All three resolution methods work (ARN, JSON, individual vars)
- ✅ Health endpoint reports secret source
- ✅ No secrets exposed in logs or errors
- ✅ Backward compatibility maintained
- ✅ All linting passes
- ✅ Documentation complete

---

**Document Status**: ✅ Ready for Implementation
**Estimated Time**: 1-2 days
**Complexity**: Medium
**Risk**: Low (backward compatible, comprehensive tests)
