# Design: Secrets Manager Architecture - 10 Runtime Parameters

**Spec**: 156b
**Date**: 2025-11-01
**Status**: Final Design
**Related**: GitHub Issue #156, [Requirements](./01-requirements.md), [Specification](./02-spec.md), [Analysis](./03-analysis.md)

## Executive Summary

This design document defines the complete architectural solution for implementing GitHub Issue #156's vision: storing **10 runtime parameters** in AWS Secrets Manager, requiring only 2 environment variables for container startup, and enabling full customizability without code changes.

**Key Design Principles**:
- **Fail Fast**: Strict validation over silent defaults
- **Single Source of Truth**: All runtime config in secret, no ambiguity
- **Type Safety**: Dataclasses enforce structure
- **DRY**: No hardcoded defaults duplication
- **Clear Errors**: Actionable error messages for all failures
- **Breaking Changes Accepted**: Long-term maintainability over backward compatibility

**Architectural Decision**: This is a **breaking change**. Existing 4-parameter secrets will no longer work. Migration is required but simple: add 6 missing parameters to existing secrets.

---

## Table of Contents

1. [Design Goals and Principles](#1-design-goals-and-principles)
2. [Secret Schema Design](#2-secret-schema-design)
3. [Configuration Resolution Design](#3-configuration-resolution-design)
4. [Validation Strategy](#4-validation-strategy)
5. [Error Handling Design](#5-error-handling-design)
6. [Health Endpoint Design](#6-health-endpoint-design)
7. [Migration Strategy (Breaking Changes)](#7-migration-strategy-breaking-changes)
8. [Testing Strategy](#8-testing-strategy)
9. [Quality Gates](#9-quality-gates)
10. [Success Criteria](#10-success-criteria)
11. [Risks and Mitigations](#11-risks-and-mitigations)

---

## 1. Design Goals and Principles

### 1.1 Primary Goals

**Goal 1: Maximum Simplicity**
- Require exactly 2 environment variables for container startup
- All runtime configuration stored in single AWS Secrets Manager secret
- No hardcoded defaults for runtime parameters
- No ambiguity about configuration source

**Goal 2: Full Customizability**
- Users can change any runtime parameter by updating secret only
- No code changes required to customize behavior
- No container rebuild required to change parameters
- All 10 runtime parameters stored in secret

**Goal 3: Fail-Fast Validation**
- Container startup fails immediately if any required parameter missing
- Clear, actionable error messages for all configuration failures
- No silent fallback to defaults
- Validate at AWS boundary, not deep in application logic

**Goal 4: Single Code Path**
- Production and tests execute identical configuration logic
- Tests mock at AWS boundary (ConfigResolver)
- No conditional logic based on environment (test vs production)
- No legacy mode code paths

### 1.2 Design Principles

**Principle 1: Secret Is Authoritative**
- The Benchling secret contains ALL 10 runtime parameters
- No hardcoded defaults in code
- CloudFormation provides only infrastructure outputs (bucket ARN, queue ARN, database name, API endpoint)
- Environment variables provide only 2 AWS resource identifiers (stack ARN, secret name)

**Principle 2: Strict Validation**
- All 10 runtime parameters MUST be present in secret
- Missing parameters cause immediate startup failure
- Invalid values cause immediate startup failure
- No partial secrets, no fallbacks, no silent defaults

**Principle 3: Type Safety First**
- Use Python dataclasses for all configuration structures
- Enforce types via dataclass field annotations
- Parse and validate types at AWS boundary
- Application code receives fully-typed, validated configuration

**Principle 4: Clear Error Messages**
- Every failure mode has specific error message
- Error messages include:
  - What went wrong
  - Which parameter(s) are missing/invalid
  - Expected format/values
  - Link to documentation
- Operators can diagnose issues without reading code

**Principle 5: No Technical Debt**
- Remove ALL legacy mode code
- Remove ALL hardcoded defaults for runtime parameters
- Consolidate validation logic in single location
- Use DRY principles (single definition of parameter list)

### 1.3 Non-Goals

**Explicitly Out of Scope**:
- ✗ Backward compatibility with 4-parameter secrets
- ✗ Support for individual environment variables (legacy mode)
- ✗ Reading configuration from `.env` files in production
- ✗ Dynamic secret rotation during runtime
- ✗ Schema versioning (future enhancement)
- ✗ `npm run config` command (future enhancement)

### 1.4 Architectural Constraints

**Constraint 1: AWS Secrets Manager Limits**
- Maximum secret size: 65,536 bytes
- Projected secret size: ~500 bytes (10 parameters as JSON)
- Assessment: Well within limits, no concern

**Constraint 2: CloudFormation Stack Outputs**
- Quilt stack MUST export specific outputs:
  - `UserAthenaDatabaseName` (required)
  - `PackagerQueueArn` (required)
  - At least one of: `Catalog`, `CatalogDomain`, `WebHostName`, `ApiGatewayEndpoint`
- These are infrastructure details, NOT runtime configuration

**Constraint 3: IAM Permissions**
- ECS task role MUST have permissions:
  - `secretsmanager:GetSecretValue` on Benchling secret
  - `secretsmanager:DescribeSecret` on Benchling secret
  - `cloudformation:DescribeStacks` on Quilt stack
- Permissions already correctly configured in CDK

**Constraint 4: Python/TypeScript Parity**
- Both implementations must support same secret structure
- Both must validate same parameters
- TypeScript is used for CDK deployment, Python for runtime
- Decision required: Does TypeScript ConfigResolver need full runtime implementation?

---

## 2. Secret Schema Design

### 2.1 Runtime Parameters (10 Total)

**Design Decision**: Store exactly 10 runtime parameters in secret. All parameters MUST be present (no optional parameters).

**Parameter Categories**:

#### Benchling Authentication (4 parameters)
| Parameter | Type | Example | Purpose |
| ----------- | ------ | --------- | --------- |
| `tenant` | string | `quilt-dtt` | Benchling subdomain |
| `client_id` | string | `wqFfVOhbYe` | OAuth client ID |
| `client_secret` | string | `6NUPNtpWP7f...` | OAuth client secret (sensitive) |
| `app_definition_id` | string | `appdef_wqFfaXBVMu` | App ID for webhook signature verification |

#### Quilt Package Configuration (3 parameters)
| Parameter | Type | Example | Purpose |
| ----------- | ------ | --------- | --------- |
| `pkg_prefix` | string | `benchling` | Quilt package name prefix |
| `pkg_key` | string | `experiment_id` | Metadata key for linking entries to packages |
| `user_bucket` | string | `my-s3-bucket` | S3 bucket name for Benchling exports |

#### Application Behavior (3 parameters)
| Parameter | Type | Example | Purpose |
| ----------- | ------ | --------- | --------- |
| `log_level` | string | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL) |
| `enable_webhook_verification` | string/bool | `"true"` | Verify webhook signatures |
| `webhook_allow_list` | string | `""` | Comma-separated IP allowlist (empty = no restriction) |

### 2.2 Naming Conventions

**Design Decision**: Use **snake_case** for all secret JSON keys. This is mandatory for backward compatibility with existing secrets.

**Rationale**:
- Python-native convention
- Already in use for existing 4-parameter secrets
- Breaking this would require migrating ALL existing secrets
- Consistent with Python dataclass field naming

**Naming Translation Table**:
| Concept | Documentation | Secret Key | Python Field | TypeScript Field |
| --------- | -------------- | ------------ | -------------- | ------------------ |
| Tenant | `TENANT` | `tenant` | `tenant` | `tenant` |
| Client ID | `CLIENT_ID` | `client_id` | `client_id` | `clientId` |
| Client Secret | `CLIENT_SECRET` | `client_secret` | `client_secret` | `clientSecret` |
| App Definition | `APP_DEFINITION_ID` | `app_definition_id` | `app_definition_id` | `appDefinitionId` |
| Package Prefix | `PKG_PREFIX` | `pkg_prefix` | `pkg_prefix` | `pkgPrefix` |
| Package Key | `PKG_KEY` | `pkg_key` | `pkg_key` | `pkgKey` |
| User Bucket | `USER_BUCKET` | `user_bucket` | `user_bucket` | `userBucket` |
| Log Level | `LOG_LEVEL` | `log_level` | `log_level` | `logLevel` |
| Webhook Verification | `ENABLE_WEBHOOK_VERIFICATION` | `enable_webhook_verification` | `enable_webhook_verification` | `enableWebhookVerification` |
| Webhook Allowlist | `WEBHOOK_ALLOW_LIST` | `webhook_allow_list` | `webhook_allow_list` | `webhookAllowList` |

### 2.3 Secret JSON Schema

**Design Decision**: Define strict JSON schema with all 10 required fields.

**Schema Structure**:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": [
    "tenant",
    "client_id",
    "client_secret",
    "app_definition_id",
    "pkg_prefix",
    "pkg_key",
    "user_bucket",
    "log_level",
    "enable_webhook_verification",
    "webhook_allow_list"
  ],
  "properties": {
    "tenant": {
      "type": "string",
      "minLength": 1,
      "description": "Benchling subdomain (e.g., 'quilt-dtt' from 'quilt-dtt.benchling.com')"
    },
    "client_id": {
      "type": "string",
      "minLength": 1,
      "description": "OAuth client ID from Benchling app"
    },
    "client_secret": {
      "type": "string",
      "minLength": 1,
      "description": "OAuth client secret from Benchling app (sensitive)"
    },
    "app_definition_id": {
      "type": "string",
      "minLength": 1,
      "description": "App definition ID for webhook signature verification"
    },
    "pkg_prefix": {
      "type": "string",
      "minLength": 1,
      "description": "Quilt package name prefix"
    },
    "pkg_key": {
      "type": "string",
      "minLength": 1,
      "description": "Metadata key for linking Benchling entries to Quilt packages"
    },
    "user_bucket": {
      "type": "string",
      "minLength": 1,
      "description": "S3 bucket name for Benchling exports"
    },
    "log_level": {
      "type": "string",
      "enum": ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
      "description": "Application logging level"
    },
    "enable_webhook_verification": {
      "type": ["string", "boolean"],
      "description": "Verify webhook signatures (boolean or string 'true'/'false')"
    },
    "webhook_allow_list": {
      "type": "string",
      "description": "Comma-separated IP allowlist (empty string for no restrictions)"
    }
  },
  "additionalProperties": false
}
```

**Design Decision on additionalProperties**: Set to `false` (reject unknown fields).

**Rationale**:
- Fail fast on typos (user types `client_id` as `clientId`)
- Fail fast on obsolete fields (user still has `api_url` from old schema)
- Forces users to keep secrets clean and current
- Trade-off: Less forward-compatible, but clearer errors

**Alternative Considered**: `additionalProperties: true` (allow unknown fields, ignore them)
- Pros: Forward-compatible with future schema changes
- Cons: Silently ignores typos and obsolete fields
- **Decision**: Choose strict validation for immediate error feedback

### 2.4 Type Conversion Rules

**Design Decision**: Support both native JSON booleans and string representations for `enable_webhook_verification`.

**Boolean Parsing Logic**:
```python
# Acceptable values (case-insensitive):
# - JSON boolean: true, false
# - JSON string: "true", "false", "True", "False", "TRUE", "FALSE", "1", "0"
```

**Rationale**: Secrets Manager Console stores all values as strings, but programmatic creation may use native booleans. Supporting both reduces user friction.

### 2.5 Removed: api_url Field

**Design Decision**: Remove `api_url` from secret structure.

**Rationale**:
- `api_url` is a CloudFormation **output** (infrastructure), not an **input** (configuration)
- Benchling API URL may be resolved from tenant: `https://{tenant}.benchling.com/api/v2`
- If custom API URL needed, it should be resolved from CloudFormation outputs (`ApiGatewayEndpoint`)
- Currently in secret structure but not in Issue #156 requirements
- Removing reduces confusion between inputs and outputs

**Impact**: Breaking change - existing secrets with `api_url` field must remove it.

### 2.6 Deployment-Time vs Runtime Parameters

**Design Decision**: Clearly distinguish deployment-time parameters (CDK configuration) from runtime parameters (secret).

**Deployment-Time Parameters** (CDK/CloudFormation only):
- `ECR_REPOSITORY_NAME` - Which ECR repository to push/pull Docker image
- `VERSION` - Which Docker image tag to deploy
- `DESIRED_COUNT` - How many ECS tasks to run
- `MEMORY`, `CPU` - ECS task resource allocation

**Runtime Parameters** (Secret only):
- All 10 parameters listed in section 2.1

**Rationale**: Deployment configuration affects infrastructure; runtime configuration affects application behavior. Clear separation prevents confusion.

---

## 3. Configuration Resolution Design

### 3.1 Resolution Flow

**Design Decision**: Implement strict, sequential resolution with fail-fast at each step.

**Flow**:
```
Container Startup
    ↓
1. Read Environment Variables (QuiltStackARN, BenchlingSecret)
    ↓ [Fail fast if either missing]
2. Parse CloudFormation ARN
    ↓ [Fail fast if invalid format]
3. Create AWS Clients (CloudFormation, Secrets Manager)
    ↓ [Use region from ARN]
4. Fetch CloudFormation Stack Outputs
    ↓ [Fail fast if stack not found or outputs missing]
5. Fetch Benchling Secret
    ↓ [Fail fast if secret not found or invalid JSON]
6. Validate Secret Parameters (all 10 required)
    ↓ [Fail fast if any parameter missing or invalid]
7. Assemble ResolvedConfig
    ↓ [Combine CloudFormation outputs + secret parameters]
8. Cache Configuration
    ↓ [Single resolution, cached for container lifetime]
Application Initialization
```

### 3.2 BenchlingSecretData Structure

**Design Decision**: Replace current 5-field dataclass with 10-field dataclass.

**Current Structure** (4 required + 1 optional):
```python
@dataclass
class BenchlingSecretData:
    tenant: str
    client_id: str
    client_secret: str
    app_definition_id: Optional[str] = None
    api_url: Optional[str] = None  # REMOVE THIS
```

**New Structure** (10 required, 0 optional):
```python
@dataclass
class BenchlingSecretData:
    """All runtime parameters from Benchling secret.

    All fields are REQUIRED. Missing fields cause startup failure.
    """
    # Benchling Authentication
    tenant: str
    client_id: str
    client_secret: str
    app_definition_id: str

    # Quilt Package Configuration
    pkg_prefix: str
    pkg_key: str
    user_bucket: str

    # Application Behavior
    log_level: str
    enable_webhook_verification: bool
    webhook_allow_list: str
```

**Design Decision**: All fields are required (no Optional, no defaults).

**Rationale**:
- Enforces fail-fast validation
- Prevents silent fallback to defaults
- Makes requirements explicit in type system
- Aligns with design principle: strict validation

### 3.3 ResolvedConfig Structure

**Design Decision**: Update ResolvedConfig to source all runtime parameters from secret.

**Current Structure** (hardcoded defaults):
```python
@dataclass
class ResolvedConfig:
    # ... CloudFormation outputs ...
    pkg_prefix: str = "benchling"        # REMOVE DEFAULT
    pkg_key: str = "experiment_id"       # REMOVE DEFAULT
    log_level: str = "INFO"              # REMOVE DEFAULT
    webhook_allow_list: Optional[str] = None  # REMOVE DEFAULT
    enable_webhook_verification: bool = True  # REMOVE DEFAULT
```

**New Structure** (no defaults):
```python
@dataclass
class ResolvedConfig:
    """Complete resolved configuration from AWS sources.

    All fields are required. No defaults.
    """
    # AWS Context (from ARN parsing)
    aws_region: str
    aws_account: str

    # Infrastructure (from CloudFormation outputs)
    quilt_catalog: str
    quilt_database: str
    queue_arn: str

    # Runtime Configuration (from Benchling secret)
    benchling_tenant: str
    benchling_client_id: str
    benchling_client_secret: str
    benchling_app_definition_id: str
    pkg_prefix: str
    pkg_key: str
    user_bucket: str
    log_level: str
    enable_webhook_verification: bool
    webhook_allow_list: str
```

**Key Changes**:
- `quilt_user_bucket` renamed to `user_bucket` (consistency with secret)
- All runtime parameters have no defaults
- `benchling_api_url` removed (resolved from CloudFormation if needed)
- Clear separation: infrastructure vs runtime configuration

### 3.4 CloudFormation Output Resolution

**Design Decision**: USER_BUCKET comes from secret, not CloudFormation.

**Current Implementation**:
```python
quilt_user_bucket = outputs.get("UserBucket") or outputs.get("BucketName")
```

**New Implementation**:
```python
# USER_BUCKET now comes from secret, not CloudFormation
user_bucket = secret_data.user_bucket
```

**Rationale**:
- Issue #156 specifies USER_BUCKET in secret for full customizability
- Users may want to use a different bucket than the one in Quilt stack
- CloudFormation outputs provide infrastructure details; secret provides runtime behavior

**Required CloudFormation Outputs** (unchanged):
- `UserAthenaDatabaseName` → `quilt_database`
- `PackagerQueueArn` → `queue_arn`
- At least one of: `Catalog`, `CatalogDomain`, `WebHostName`, `ApiGatewayEndpoint` → `quilt_catalog`

### 3.5 Configuration Caching

**Design Decision**: Maintain single resolution with lifetime caching (no change from current).

**Caching Strategy**:
- Configuration resolved ONCE during `Config.__post_init__()`
- Cached in `ResolvedConfig` instance
- No subsequent AWS API calls during container lifetime
- Configuration changes require container restart

**Rationale**:
- Efficient (no repeated AWS API calls)
- Predictable (configuration doesn't change during runtime)
- Simpler error handling (all failures happen at startup)
- Aligns with immutable infrastructure principles

---

## 4. Validation Strategy

### 4.1 Validation Layers

**Design Decision**: Implement validation at 3 layers (fail-fast at each).

**Layer 1: Environment Variables** (config.py lines 43-55)
- Validate `QuiltStackARN` and `BenchlingSecret` are present
- Fail immediately if either missing
- No AWS calls yet

**Layer 2: AWS Resources** (config_resolver.py)
- Validate CloudFormation stack exists
- Validate required outputs present
- Validate secret exists and is valid JSON
- Validate secret has all 10 required parameters

**Layer 3: Parameter Values** (config_resolver.py)
- Validate parameter types (string, boolean)
- Validate parameter formats (log level enum)
- Validate parameter values (non-empty strings)
- Convert boolean representations to native booleans

### 4.2 Secret Parameter Validation

**Design Decision**: Define explicit list of required parameters and validate ALL.

**Current Validation** (lines 226-233):
```python
required = ["client_id", "client_secret", "tenant"]
missing = [f for f in required if not data.get(f)]
```

**New Validation**:
```python
# All 10 parameters are required
required = [
    "tenant",
    "client_id",
    "client_secret",
    "app_definition_id",
    "pkg_prefix",
    "pkg_key",
    "user_bucket",
    "log_level",
    "enable_webhook_verification",
    "webhook_allow_list",
]

missing = [f for f in required if not data.get(f)]
if missing:
    raise ConfigResolverError(
        f"Missing required parameters in secret '{secret_name}'",
        f"Missing: {', '.join(missing)}",
        "Expected secret format: {...complete JSON example...}",
        "See: https://github.com/quiltdata/benchling-webhook#secret-format"
    )
```

**Design Decision**: Use explicit list (not derived from dataclass).

**Rationale**:
- Clear, auditable list of requirements
- Easy to maintain and update
- Error messages reference exact list
- No magic/reflection required

**Alternative Considered**: Derive list from dataclass fields via `dataclasses.fields(BenchlingSecretData)`
- Pros: DRY, single source of truth
- Cons: Less explicit, harder to customize error messages
- **Decision**: Explicit list is clearer and more maintainable

### 4.3 Type Validation

**Design Decision**: Validate types AND values, not just presence.

**Type Validations**:

**String Parameters** (8 parameters):
- Must be non-empty strings
- Check: `isinstance(value, str) and len(value) > 0`
- Parameters: tenant, client_id, client_secret, app_definition_id, pkg_prefix, pkg_key, user_bucket, webhook_allow_list

**Log Level Parameter**:
- Must be valid Python logging level
- Check: `value in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]`
- Case-sensitive

**Boolean Parameter**:
- Must be convertible to boolean
- Accept: `true`, `false`, `"true"`, `"false"`, `"True"`, `"False"`, `"1"`, `"0"`
- Reject: `"yes"`, `"no"`, `"enabled"`, `"disabled"`

**Boolean Conversion Logic**:
```python
def parse_bool(value: any) -> bool:
    """Parse boolean from JSON (native bool or string representation)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.lower() in ["true", "1"]:
            return True
        if value.lower() in ["false", "0"]:
            return False
    raise ValueError(f"Invalid boolean value: {value}")
```

### 4.4 CloudFormation Output Validation

**Design Decision**: Validate required outputs with clear error messages (no change from current).

**Required Outputs**:
1. `UserAthenaDatabaseName` (required)
2. `PackagerQueueArn` (required)
3. At least one of: `Catalog`, `CatalogDomain`, `WebHostName`, `ApiGatewayEndpoint` (required)

**Validation Logic** (maintain current implementation):
```python
def _validate_required_outputs(self, outputs: Dict[str, str]) -> None:
    required = ["UserAthenaDatabaseName", "PackagerQueueArn"]

    # Require at least one endpoint output
    endpoint_keys = ["Catalog", "CatalogDomain", "WebHostName", "ApiGatewayEndpoint"]
    has_endpoint = any(key in outputs for key in endpoint_keys)
    if not has_endpoint:
        required.append(f"at least one of: {', '.join(endpoint_keys)}")

    missing = [key for key in required if key not in outputs]
    if missing:
        raise ConfigResolverError(
            f"Missing required outputs from CloudFormation stack",
            f"Missing: {', '.join(missing)}",
            "Check that Quilt stack has all required exports"
        )
```

---

## 5. Error Handling Design

### 5.1 Error Message Structure

**Design Decision**: Use structured error messages with 4 components.

**Error Message Template**:
```
❌ Configuration Error: {title}

{description}

{details}

See: {documentation_link}
```

**Example 1: Missing Environment Variables**:
```
❌ Configuration Error: Missing required environment variables

Secrets-only mode requires exactly 2 environment variables.

Missing:
  - QuiltStackARN
  - BenchlingSecret

Expected:
  QuiltStackARN=arn:aws:cloudformation:region:account:stack/name/id
  BenchlingSecret=benchling-webhook-prod

See: https://github.com/quiltdata/benchling-webhook#configuration
```

**Example 2: Missing Secret Parameters**:
```
❌ Configuration Error: Missing required parameters in secret 'benchling-webhook-dev'

The secret must contain all 10 runtime parameters.

Missing: log_level, pkg_prefix, user_bucket

Expected secret format (JSON):
{
  "tenant": "quilt-dtt",
  "client_id": "wqFfVOhbYe",
  "client_secret": "6NUPNtpWP7f...",
  "app_definition_id": "appdef_wqFfaXBVMu",
  "pkg_prefix": "benchling",
  "pkg_key": "experiment_id",
  "user_bucket": "my-s3-bucket",
  "log_level": "INFO",
  "enable_webhook_verification": "true",
  "webhook_allow_list": ""
}

See: https://github.com/quiltdata/benchling-webhook#secret-format
```

**Example 3: Invalid Parameter Value**:
```
❌ Configuration Error: Invalid value for parameter 'log_level'

The log_level parameter must be a valid Python logging level.

Received: "TRACE"
Expected: DEBUG, INFO, WARNING, ERROR, or CRITICAL

See: https://github.com/quiltdata/benchling-webhook#configuration-parameters
```

### 5.2 ConfigResolverError Structure

**Design Decision**: Maintain current error class structure (no changes needed).

**Current Implementation**:
```python
class ConfigResolverError(Exception):
    """Error during configuration resolution with helpful suggestions."""

    def __init__(self, message: str, *suggestions: str):
        self.message = message
        self.suggestions = list(suggestions)
        super().__init__(self._format_error())

    def _format_error(self) -> str:
        lines = [f"❌ Configuration Error: {self.message}"]
        lines.extend(f"\n{s}" for s in self.suggestions)
        return "\n".join(lines)
```

**Assessment**: Current structure is perfect for structured error messages. No changes needed.

### 5.3 Error Categories

**Design Decision**: Define explicit error categories for common failures.

**Error Categories**:
1. **Environment Variable Errors**: Missing QuiltStackARN or BenchlingSecret
2. **ARN Format Errors**: Invalid CloudFormation ARN format
3. **AWS Permission Errors**: IAM role lacks required permissions
4. **Stack Not Found Errors**: CloudFormation stack doesn't exist
5. **Missing Outputs Errors**: Stack exists but missing required outputs
6. **Secret Not Found Errors**: Secrets Manager secret doesn't exist
7. **Invalid JSON Errors**: Secret content is not valid JSON
8. **Missing Parameters Errors**: Secret missing required parameters (list which ones)
9. **Invalid Parameter Errors**: Parameter has invalid value (show expected values)
10. **Type Conversion Errors**: Cannot convert parameter to expected type

**Design Decision**: Each error category has specific, actionable message.

---

## 6. Health Endpoint Design

### 6.1 Health Check Philosophy

**Design Decision**: Balance traditional health monitoring with informational metadata.

**Principles**:
- Health check returns 200 OK if service is alive and ready
- Include metadata about configuration mode and version
- Do NOT expose sensitive configuration details
- Do NOT expose full parameter values
- Provide enough information for debugging without security risk

### 6.2 Health Endpoint Response

**Design Decision**: Update health endpoint to report 10-parameter secret mode.

**Current Response**:
```json
{
  "status": "healthy",
  "service": "benchling-webhook",
  "version": "v0.6.0+",
  "config_source": "secrets-only-mode"
}
```

**New Response**:
```json
{
  "status": "healthy",
  "service": "benchling-webhook",
  "version": "1.0.0",
  "config_source": "secrets-only-mode",
  "config_parameters": 10,
  "aws_region": "us-east-1"
}
```

**Fields**:
- `status`: "healthy" or "unhealthy"
- `service`: Service name (constant)
- `version`: Application version (from environment or CloudFormation)
- `config_source`: Always "secrets-only-mode"
- `config_parameters`: Number of parameters loaded from secret (10)
- `aws_region`: AWS region (non-sensitive, useful for debugging)

### 6.3 Config Endpoint Response

**Design Decision**: Update config endpoint to show all parameters (masked).

**Current Response** (partial):
```json
{
  "config_mode": "secrets-only",
  "optional": {
    "pkg_prefix": "benchling",
    "pkg_key": "experiment_id"
  }
}
```

**New Response** (comprehensive):
```json
{
  "mode": "secrets-only",
  "region": "us-east-1",
  "account": "712023778557",
  "benchling": {
    "tenant": "quilt-dtt",
    "client_id": "wqF***Ye",
    "has_client_secret": true,
    "has_app_definition": true
  },
  "quilt": {
    "catalog": "nightly.quilttest.com",
    "database": "user***",
    "queue_arn": "arn:aws:sqs:us-east-1:712023778557:queue/***"
  },
  "parameters": {
    "pkg_prefix": "benchling",
    "pkg_key": "experiment_id",
    "user_bucket": "quilt-***",
    "log_level": "INFO",
    "webhook_verification": true,
    "webhook_allow_list": ""
  }
}
```

**Masking Rules**:
- `client_id`: Show first 3 and last 2 characters, mask middle
- `client_secret`: Show only boolean `has_client_secret`
- `app_definition_id`: Show only boolean `has_app_definition`
- `user_bucket`: Show prefix, mask suffix
- `database`: Mask most characters
- `queue_arn`: Mask queue name, show structure
- All other parameters: Show full value (non-sensitive)

---

## 7. Migration Strategy (Breaking Changes)

### 7.1 Breaking Change Acceptance

**Design Decision**: Accept breaking changes for long-term maintainability.

**Rationale**:
- Issue #156 specifies 10-parameter architecture
- Current 4-parameter implementation is incomplete
- Hardcoded defaults defeat purpose of customizability
- Clean break is simpler than gradual migration
- Clear migration path reduces user friction

**Breaking Changes**:
1. Existing 4-parameter secrets will cause startup failure
2. `api_url` field in secret must be removed
3. 6 new parameters must be added to all secrets
4. No backward compatibility with legacy mode (already removed)

### 7.2 Migration Steps

**Design Decision**: Provide clear, step-by-step migration guide in documentation.

**Migration Process**:

**Step 1: Audit Current Secret**
```bash
# View current secret
aws secretsmanager get-secret-value \
  --secret-id benchling-webhook-prod \
  --query 'SecretString' \
  --output text | jq
```

**Step 2: Add Missing Parameters**
```json
{
  "tenant": "existing-value",
  "client_id": "existing-value",
  "client_secret": "existing-value",
  "app_definition_id": "existing-value",
  "pkg_prefix": "benchling",
  "pkg_key": "experiment_id",
  "user_bucket": "my-benchling-exports-bucket",
  "log_level": "INFO",
  "enable_webhook_verification": "true",
  "webhook_allow_list": ""
}
```

**Step 3: Remove Obsolete Fields**
- Remove `api_url` if present
- Remove any other undocumented fields

**Step 4: Update Secret**
```bash
aws secretsmanager update-secret \
  --secret-id benchling-webhook-prod \
  --secret-string file://secret.json
```

**Step 5: Deploy Updated Application**
```bash
npm run cli -- deploy \
  --quilt-stack-arn arn:aws:cloudformation:... \
  --benchling-secret benchling-webhook-prod \
  --image-tag v1.0.0
```

**Step 6: Verify**
```bash
# Check health endpoint
curl https://benchling.example.com/health

# Check config endpoint (shows all 10 parameters)
curl https://benchling.example.com/config
```

### 7.3 Migration Validation

**Design Decision**: Provide pre-deployment validation script (future enhancement).

**Validation Script** (future work):
```bash
npm run validate-secret -- benchling-webhook-prod
```

**Validation Checks**:
- Secret exists in Secrets Manager
- Secret contains valid JSON
- All 10 required parameters present
- No obsolete parameters present (`api_url`)
- Parameter values have correct types
- Log level is valid enum value
- Boolean value is parseable

**Output**:
```
✅ Secret validation passed

Secret: benchling-webhook-prod
Region: us-east-1
Parameters: 10/10 present

Ready for deployment.
```

---

## 8. Testing Strategy

### 8.1 Unit Test Strategy

**Design Decision**: Expand test fixtures to include all 10 parameters.

**Current Test Fixture** (conftest.py lines 62-77):
```python
mock_resolved = ResolvedConfig(
    # Only 4 Benchling params + hardcoded defaults
    pkg_prefix="benchling",  # Hardcoded
    pkg_key="experiment_id",  # Hardcoded
)
```

**New Test Fixture**:
```python
@pytest.fixture
def mock_resolved_config():
    """Complete mock configuration with all 10 secret parameters."""
    return ResolvedConfig(
        # AWS Context
        aws_region="us-east-1",
        aws_account="123456789012",

        # Infrastructure (CloudFormation)
        quilt_catalog="catalog.example.com",
        quilt_database="test_database",
        queue_arn="arn:aws:sqs:us-east-1:123456789012:queue/test-queue",

        # Runtime Configuration (Secret - all 10 parameters)
        benchling_tenant="test-tenant",
        benchling_client_id="test-client-id",
        benchling_client_secret="test-client-secret",
        benchling_app_definition_id="appdef_test123",
        pkg_prefix="test-prefix",
        pkg_key="test-key",
        user_bucket="test-bucket",
        log_level="DEBUG",
        enable_webhook_verification=True,
        webhook_allow_list="192.168.1.0/24,10.0.0.1",
    )
```

### 8.2 Validation Test Cases

**Design Decision**: Add comprehensive validation test suite.

**Test Cases**:

**Test Category 1: Missing Parameters**
- Test missing each of 10 parameters individually
- Test multiple missing parameters
- Verify error message lists exact missing parameters

**Test Category 2: Invalid Parameter Values**
- Test invalid log level (e.g., "TRACE")
- Test invalid boolean (e.g., "yes", "enabled")
- Test empty strings for required parameters
- Verify error message shows expected values

**Test Category 3: Type Conversions**
- Test boolean as JSON boolean (`true`, `false`)
- Test boolean as string (`"true"`, `"false"`, `"1"`, `"0"`)
- Test case-insensitive boolean (`"True"`, `"FALSE"`)
- Verify all formats correctly parsed

**Test Category 4: Complete Happy Path**
- Test with all 10 parameters present and valid
- Verify ResolvedConfig assembled correctly
- Verify all values mapped correctly

**Test Category 5: CloudFormation Integration**
- Test USER_BUCKET from secret (not CloudFormation)
- Test CloudFormation outputs still resolved correctly
- Verify infrastructure parameters separate from runtime parameters

### 8.3 Integration Test Strategy

**Design Decision**: Update `docker:test` to create and use 10-parameter secret.

**Integration Test Flow**:
1. Create temporary secret in AWS with all 10 parameters
2. Build Docker image locally
3. Run container with real AWS (QuiltStackARN, BenchlingSecret)
4. Verify health endpoint returns 200 OK
5. Verify config endpoint shows all 10 parameters
6. Clean up temporary secret

**Integration Test Secret**:
```json
{
  "tenant": "test-tenant",
  "client_id": "test-client-id",
  "client_secret": "test-client-secret",
  "app_definition_id": "appdef_test123",
  "pkg_prefix": "test-prefix",
  "pkg_key": "test-key",
  "user_bucket": "test-bucket",
  "log_level": "DEBUG",
  "enable_webhook_verification": "false",
  "webhook_allow_list": ""
}
```

### 8.4 Test Coverage Goals

**Design Decision**: Maintain >90% code coverage for configuration module.

**Coverage Targets**:
- `config.py`: 100% coverage (simple initialization logic)
- `config_resolver.py`: >95% coverage (all validation paths tested)
- Error handling: 100% coverage (all error messages verified)
- Type conversions: 100% coverage (all boolean formats tested)

**Coverage Verification**:
```bash
pytest --cov=docker/src/config --cov=docker/src/config_resolver --cov-report=html
```

---

## 9. Quality Gates

### 9.1 Pre-Deployment Quality Gates

**Design Decision**: Define strict quality gates that MUST pass before deployment.

**Gate 1: All Tests Pass**
- Unit tests: 100% passing
- Integration tests: 100% passing
- No skipped tests
- No xfail tests

**Gate 2: Code Coverage**
- Overall coverage: >90%
- Configuration module: >95%
- No untested error paths

**Gate 3: Type Checking**
- mypy: 0 errors
- No type: ignore comments added
- All dataclasses fully typed

**Gate 4: Linting**
- ruff: 0 errors, 0 warnings
- All code formatted consistently
- No unused imports

**Gate 5: Documentation**
- README updated with 10-parameter secret format
- Migration guide written
- Breaking changes documented
- All 10 parameters documented with examples

### 9.2 Deployment Validation

**Design Decision**: Define post-deployment validation checklist.

**Validation Checklist**:
- [ ] CloudFormation stack status: `CREATE_COMPLETE` or `UPDATE_COMPLETE`
- [ ] ECS service status: Running
- [ ] ECS desired task count: Met (e.g., 2/2)
- [ ] ECS Circuit Breaker: Not triggered
- [ ] Health endpoint: Returns 200 OK
- [ ] Health endpoint: Shows `config_parameters: 10`
- [ ] Config endpoint: Shows all 10 parameters (masked)
- [ ] CloudWatch logs: No configuration errors
- [ ] CloudWatch logs: Application startup succeeded

### 9.3 Rollback Criteria

**Design Decision**: Define clear rollback triggers.

**Rollback Immediately If**:
- ECS Circuit Breaker triggers
- Health endpoint returns non-200 status
- Health endpoint shows `config_parameters < 10`
- CloudWatch logs show configuration errors
- More than 10% of requests failing

**Rollback Process**:
1. Revert to previous CloudFormation stack version
2. Scale to 0 tasks (stop new deployments)
3. Investigate configuration issue
4. Fix secret or code
5. Re-deploy

---

## 10. Success Criteria

### 10.1 Functional Success Criteria

**Criterion 1: Deployment Success**
- `npm run cdk:dev` completes without errors
- CloudFormation creates all resources
- ECS service starts without Circuit Breaker
- 2 tasks running and healthy
- Health endpoint returns 200 OK with `config_parameters: 10`

**Criterion 2: Configuration Validation**
- Startup fails immediately if any parameter missing
- Error message lists exactly which parameters missing
- Error message shows expected secret format
- Operators can diagnose and fix issues from error message alone

**Criterion 3: Full Customizability**
- All 10 runtime parameters read from secret
- Changing any parameter requires only updating secret
- No container rebuild required for parameter changes
- No code changes required for parameter changes

**Criterion 4: Single Code Path**
- Production and tests execute identical configuration logic
- Tests mock ConfigResolver at AWS boundary
- No conditional logic based on environment

### 10.2 Code Quality Success Criteria

**Criterion 1: No Technical Debt**
- All hardcoded defaults for runtime parameters removed
- Legacy mode code completely removed
- `api_url` field removed from secret structure
- `secrets_resolver.py` file removed (if unused)

**Criterion 2: Test Coverage**
- Configuration module: >95% coverage
- All validation paths tested
- All error messages verified
- All parameter types tested

**Criterion 3: Type Safety**
- All dataclasses fully typed
- No `Any` types in configuration structures
- mypy passes with no errors
- No type: ignore comments

### 10.3 User Experience Success Criteria

**Criterion 1: Clear Documentation**
- README shows complete 10-parameter secret example
- Migration guide shows exact steps
- Breaking changes clearly documented
- All parameters documented with purpose and examples

**Criterion 2: Clear Error Messages**
- All error messages actionable
- All error messages include expected format
- All error messages include documentation link
- Operators can fix issues without reading code

**Criterion 3: Simple Operations**
- Deployment requires only 2 environment variables
- Parameter updates require only secret update
- No code changes for configuration changes

---

## 11. Risks and Mitigations

### 11.1 Breaking Change Risk

**Risk**: Existing deployments break when upgrading.

**Impact**: HIGH - All existing deployments affected

**Mitigation**:
- Provide clear migration guide before release
- Send notification to all users before releasing
- Provide validation script to check secrets
- Document rollback procedure
- Provide example secret with all 10 parameters

**Residual Risk**: LOW - Clear migration path reduces risk

### 11.2 Secret Validation Strictness

**Risk**: Strict validation may be too aggressive (rejects valid configurations).

**Impact**: MEDIUM - Users cannot deploy

**Mitigation**:
- Thoroughly test all validation logic
- Test with real user secrets (with permission)
- Provide clear error messages for all validation failures
- Support multiple boolean formats (strings and native)
- Document exact requirements in README

**Residual Risk**: LOW - Comprehensive testing reduces risk

### 11.3 TypeScript/Python Parity

**Risk**: Python and TypeScript implementations diverge (different validation logic).

**Impact**: MEDIUM - CDK deployment succeeds but runtime fails

**Mitigation**:
- Define single source of truth for parameter list
- Share validation logic where possible
- Test both implementations with same secret
- Document differences (if any) clearly
- Consider if TypeScript implementation is actually needed at runtime

**Investigation Needed**: Determine if TypeScript ConfigResolver is used at runtime.

**Residual Risk**: MEDIUM - Requires ongoing maintenance

### 11.4 Parameter Source Confusion

**Risk**: Users confuse deployment-time vs runtime parameters.

**Impact**: LOW - Configuration confusion

**Mitigation**:
- Clearly document deployment-time parameters (ECR_REPOSITORY_NAME, VERSION)
- Clearly document runtime parameters (10 in secret)
- Show complete examples in documentation
- Error messages clarify which parameters go where

**Residual Risk**: LOW - Clear documentation reduces confusion

### 11.5 Missing CloudFormation Outputs

**Risk**: Quilt stack missing required outputs (infrastructure issue).

**Impact**: HIGH - Deployment fails

**Mitigation**:
- Validate CloudFormation outputs early in resolution flow
- Provide clear error message showing which outputs missing
- Document required outputs in README
- Provide CloudFormation template examples

**Residual Risk**: LOW - Validation catches issues early

### 11.6 Test Fixture Maintenance

**Risk**: Test fixtures not updated with all 10 parameters (tests pass but deployment fails).

**Impact**: HIGH - False confidence from passing tests

**Mitigation**:
- Update all test fixtures before implementation
- Add validation test to ensure fixtures are complete
- Integration tests use real secret (catches fixture gaps)
- Code review checks test fixture completeness

**Residual Risk**: LOW - Multiple checks reduce risk

---

## Appendix A: Design Decisions Summary

| Decision | Choice | Rationale |
| ---------- | -------- | ----------- |
| Number of runtime parameters | 10 (not 11) | ECR_REPOSITORY_NAME is deployment-time only |
| Secret key naming | snake_case | Backward compatibility, Python convention |
| Required vs optional parameters | All 10 required | Fail-fast, no silent defaults |
| Backward compatibility | None (breaking change) | Simplicity over compatibility |
| USER_BUCKET source | Secret (not CloudFormation) | Full customizability per Issue #156 |
| api_url field | Remove from secret | CloudFormation output, not input |
| Boolean format | Support both string and native | User convenience, JSON format flexibility |
| Unknown fields in secret | Reject (fail-fast) | Catch typos, enforce clean secrets |
| Error message structure | 4-component template | Consistent, actionable, documented |
| Health endpoint | Metadata + traditional | Balance debugging and security |
| Config endpoint masking | Mask sensitive, show others | Security + debuggability |
| Validation strictness | Strict (fail-fast) | Predictable, forces correctness |
| Test fixture strategy | Complete 10-parameter mocks | Production parity |
| Quality gate threshold | >90% coverage | High confidence without perfection burden |

---

## Appendix B: Open Questions for Implementation

**Q1**: Is TypeScript ConfigResolver used at runtime or only for type checking?
- **Impact**: Determines if TypeScript needs full 10-parameter implementation
- **Decision Required**: Before implementing TypeScript changes
- **Investigation**: Search for runtime usage in CDK deployment code

**Q2**: Should we support partial secrets with CloudFormation fallbacks?
- **Impact**: Migration complexity vs fail-fast validation
- **Recommendation**: NO - strict validation aligns with design principles
- **Decision**: Accepted - all 10 parameters required

**Q3**: Should health endpoint report secret name?
- **Security**: Leaks secret name (but not values)
- **Debugging**: Useful to verify correct secret loaded
- **Recommendation**: YES - secret name is not sensitive
- **Decision**: Add to health endpoint response

**Q4**: Should we version the secret schema?
- **Future-proofing**: Easier to evolve schema
- **Complexity**: Adds version handling logic
- **Recommendation**: Defer to future enhancement
- **Decision**: No versioning in v1.0.0

---

**Document Status**: Complete
**Last Updated**: 2025-11-01
**Next**: Proceed to implementation based on this design
**Approval Required**: Human review and approval before implementation
