# Analysis: Secrets Manager Architecture Implementation

**Spec**: 156b
**Date**: 2025-11-01
**Status**: In Progress
**Branch**: 156b-secrets-fix

## Executive Summary

This analysis examines the current state of the secrets-only architecture implementation in the benchling-webhook codebase, assesses gaps between current implementation and requirements (Issue #156), and identifies technical challenges that must be addressed.

**Key Finding**: The current implementation is **partially complete**. The infrastructure for secrets-only mode exists and works, but only **4 out of 10 required runtime parameters** are stored in the Benchling secret. The remaining 6 parameters use hardcoded defaults or are resolved from CloudFormation, preventing full customizability as specified in Issue #156.

**Updated After Clarifications (2025-11-01)**: ECR_REPOSITORY_NAME is deployment-time configuration (not runtime), reducing the requirement from 11 to 10 runtime parameters in secret.

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Architecture Analysis](#architecture-analysis)
3. [Gap Analysis](#gap-analysis)
4. [Implementation Constraints](#implementation-constraints)
5. [Technical Debt](#technical-debt)
6. [Open Questions](#open-questions)

---

## 1. Current State Assessment

### 1.1 What Works Today

#### Secrets-Only Mode Infrastructure (v0.6.0+)

The application successfully implements secrets-only mode deployment:

**✅ Container Startup**:
- Requires exactly 2 environment variables: `QuiltStackARN` and `BenchlingSecret`
- Fails fast with clear error messages if variables are missing
- File: `/Users/ernest/GitHub/benchling-webhook/docker/src/config.py` (lines 43-55)

**✅ Configuration Resolution**:
- `ConfigResolver` class successfully fetches data from AWS
- Parses CloudFormation ARN to extract region/account
- Queries CloudFormation DescribeStacks API for stack outputs
- Fetches Benchling secret from Secrets Manager
- Caches configuration for container lifetime
- File: `/Users/ernest/GitHub/benchling-webhook/docker/src/config_resolver.py`

**✅ CDK Deployment**:
- `npm run cdk:dev` successfully deploys with secrets-only mode
- Passes `QuiltStackARN` and `BenchlingSecret` as environment variables
- File: `/Users/ernest/GitHub/benchling-webhook/bin/dev-deploy.ts` (lines 240-244)

**✅ Test Infrastructure**:
- Tests use mocked `ConfigResolver` (same code path as production)
- No environment variables required for tests
- File: `/Users/ernest/GitHub/benchling-webhook/docker/tests/conftest.py` (lines 44-84)

**✅ ECS Circuit Breaker Fixed**:
- Recent commits (`f47b04c`, `8a800b8`) fixed the deployment failure
- Deployment now succeeds without Circuit Breaker trigger
- As confirmed in spec/156b-secrets-fix/README.md

### 1.2 What's Currently Stored in Secrets

#### Benchling Secret Structure (Current - 4 Parameters)

The `BenchlingSecretData` dataclass shows what's currently stored:

```python
# File: docker/src/config_resolver.py (lines 64-72)
@dataclass
class BenchlingSecretData:
    tenant: str
    client_id: str
    client_secret: str
    app_definition_id: Optional[str] = None
    api_url: Optional[str] = None
```

**Current Secret Validation** (lines 226-233):
```python
required = ["client_id", "client_secret", "tenant"]
missing = [f for f in required if not data.get(f)]
```

**Reality**: Only 3 required fields + 2 optional fields = **5 parameters maximum** in secret today.

#### Other Parameters (Hardcoded or Missing)

**Hardcoded Defaults in `ResolvedConfig`** (lines 96-100):
```python
pkg_prefix: str = "benchling"         # Should be in secret per Issue #156
pkg_key: str = "experiment_id"        # Should be in secret per Issue #156
log_level: str = "INFO"               # Should be in secret per Issue #156
webhook_allow_list: Optional[str] = None  # Should be in secret per Issue #156
enable_webhook_verification: bool = True  # Should be in secret per Issue #156
```

**Resolved from CloudFormation** (lines 361):
```python
quilt_user_bucket = outputs.get("UserBucket") or outputs.get("BucketName")
```

**Not Implemented**:
- `ECR_REPOSITORY_NAME` - Not present anywhere in Python code

### 1.3 Deployment Status

**Development Deployment** (`npm run cdk:dev`):
- ✅ Works with current 4-parameter secret
- ✅ ECS tasks start successfully
- ✅ Health endpoint returns `200 OK`
- ⚠️  Config endpoint shows hardcoded values for missing parameters

**Test Execution**:
- ✅ `npm run test` passes with mocked 4-parameter config
- ✅ Integration tests not yet updated for 11-parameter secret
- ⚠️  Tests validate 2 environment variables but only 4 secret parameters

---

## 2. Architecture Analysis

### 2.1 Code Idioms and Patterns

#### Pattern: Secrets-Only Configuration Resolution

**File**: `docker/src/config_resolver.py`

**Strengths**:
1. **Single Responsibility**: `ConfigResolver` handles all AWS interaction
2. **Error Handling**: Custom `ConfigResolverError` with suggestions
3. **Caching**: Configuration cached for container lifetime (line 372)
4. **Validation**: Required outputs validated before assembly (lines 383-398)

**Current Flow**:
```
Environment Variables (2) → ConfigResolver → AWS APIs → ResolvedConfig (16 fields)
    QuiltStackARN        ┌──→ CloudFormation DescribeStacks
    BenchlingSecret      └──→ Secrets Manager GetSecretValue
                              └──→ Assemble + Cache
```

#### Pattern: Dataclass-Based Configuration

**Files**: `config_resolver.py`, `config.py`

**Observation**: The codebase uses Python dataclasses for type-safe configuration:
- `ParsedStackArn` - CloudFormation ARN components
- `BenchlingSecretData` - Secret content
- `ResolvedConfig` - Complete configuration
- `Config` - Application config (legacy wrapper)

**Convention**: All configuration fields use snake_case (e.g., `pkg_prefix`, `log_level`)

#### Pattern: Fail-Fast Validation

**File**: `config_resolver.py` (lines 383-398)

**Observation**: The resolver validates CloudFormation outputs immediately:
```python
def _validate_required_outputs(self, outputs: Dict[str, str]) -> None:
    required = ["UserAthenaDatabaseName", "PackagerQueueArn"]
    if "UserBucket" not in outputs and "BucketName" not in outputs:
        required.append("UserBucket or BucketName")
    missing = [key for key in required if key not in outputs]
    if missing:
        raise ConfigResolverError(...)
```

**Implication**: We should add similar validation for secret parameters.

### 2.2 Current System Constraints

#### Constraint 1: Secret Field Naming Convention

**File**: `docker/src/config_resolver.py` (lines 235-241)

**Current Implementation**:
```python
return BenchlingSecretData(
    tenant=data["tenant"],
    client_id=data["client_id"],
    client_secret=data["client_secret"],
    app_definition_id=data.get("app_definition_id"),
    api_url=data.get("api_url"),
)
```

**Observation**: Secret uses snake_case keys (`client_id`, not `clientId`)

**Constraint**: Must maintain snake_case for backward compatibility with existing secrets.

#### Constraint 2: CloudFormation Stack Outputs

**File**: `docker/src/config_resolver.py` (lines 360-362)

**Current Dependencies**:
```python
quilt_database=outputs["UserAthenaDatabaseName"]
quilt_user_bucket=outputs.get("UserBucket") or outputs.get("BucketName")
queue_arn=outputs["PackagerQueueArn"]
```

**Issue**: `USER_BUCKET` is currently resolved from CloudFormation, but Issue #156 specifies it should be in the secret for full customizability.

**Question**: Should `USER_BUCKET` be:
1. In the secret (per Issue #156) - allows customization
2. From CloudFormation (current) - enforces infrastructure coupling
3. Both (with secret taking precedence) - hybrid approach

#### Constraint 3: TypeScript CDK Configuration

**File**: `lib/utils/config-resolver.ts` (lines 338-343)

**Observation**: The TypeScript ConfigResolver also has hardcoded defaults:
```typescript
pkgPrefix: "benchling",
pkgKey: "experiment_id",
logLevel: "INFO",
enableWebhookVerification: true,
```

**Implication**: Both Python and TypeScript code must be updated in parallel.

#### Constraint 4: Test Fixtures

**File**: `docker/tests/conftest.py` (lines 62-77)

**Current Test Config**:
```python
mock_resolved = ResolvedConfig(
    aws_region="us-east-1",
    aws_account="123456789012",
    # ... 4 Benchling params ...
    pkg_prefix="benchling",        # Hardcoded
    pkg_key="experiment_id",       # Hardcoded
    log_level="INFO",              # Hardcoded
    enable_webhook_verification=True,  # Hardcoded
    # ... missing: webhook_allow_list ...
)
```

**Issue**: Test fixtures must be updated to include all 11 parameters.

### 2.3 Integration Points

#### Integration Point 1: CloudFormation Stack

**Files**:
- `lib/benchling-webhook-stack.ts` (lines 93-103)
- `bin/commands/deploy.ts` (lines 488-493)

**Current Behavior**:
- CDK accepts `quiltStackArn` and `benchlingSecret` as parameters
- Creates CloudFormation parameters for both
- ECS container receives both as environment variables

**Working**: This integration is complete and functional.

#### Integration Point 2: Secrets Manager

**Files**:
- `docker/src/config_resolver.py` (lines 192-271)
- `lib/utils/config-resolver.ts` (lines 198-267)

**Current Behavior**:
- `GetSecretValue` API called with secret name or ARN
- JSON parsed and validated
- Only 4 parameters expected in validation

**Gap**: Validation logic must be updated for 11 parameters.

#### Integration Point 3: ECS Task Definition

**File**: `lib/fargate-service.ts` (lines 91-169)

**Current Behavior**:
```typescript
if (useSecretsOnlyMode) {
    // Grant CloudFormation read access
    taskRole.addToPolicy(new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks", ...],
        resources: [props.quiltStackArn!],
    }));

    // Grant Secrets Manager read access
    taskRole.addToPolicy(new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", ...],
        resources: [`arn:aws:secretsmanager:${region}:${account}:secret:${benchlingSecret}*`],
    }));
}
```

**Working**: IAM permissions are correctly configured for secrets-only mode.

#### Integration Point 4: Health/Config Endpoints

**File**: `docker/src/app.py` (lines 154-221)

**Current Behavior**:
```python
@app.route("/config", methods=["GET"])
def config_status():
    response = {
        "config_mode": "secrets-only" if (quilt_stack_arn and benchling_secret_name) else "legacy",
        "optional": {
            "pkg_prefix": config.pkg_prefix,
            "pkg_key": config.pkg_key,
            "log_level": config.log_level,
            "webhook_allow_list": config.webhook_allow_list if config.webhook_allow_list else None,
            "enable_webhook_verification": config.enable_webhook_verification,
        },
    }
```

**Gap**: Config endpoint should report **11 parameters from secret** but currently shows hardcoded defaults for 7 of them.

---

## 3. Gap Analysis

### 3.1 Requirements vs. Current Implementation

#### R1: Single Configuration Source (CRITICAL)

**Requirement**: All 11 runtime parameters must be stored in the Benchling secret.

**Current State** (Updated 2025-11-01):
- ✅ 4 parameters in secret (tenant, client_id, client_secret, app_definition_id)
- ❌ 6 parameters hardcoded or missing:
  1. `LOG_LEVEL` - hardcoded to "INFO"
  2. `PKG_PREFIX` - hardcoded to "benchling"
  3. `PKG_KEY` - hardcoded to "experiment_id"
  4. `USER_BUCKET` - **Decision**: must move to secret (currently from CloudFormation)
  5. `WEBHOOK_ALLOW_LIST` - hardcoded to None
  6. `ENABLE_WEBHOOK_VERIFICATION` - hardcoded to True
- ✅ `ECR_REPOSITORY_NAME` - **Decision**: CDK deployment-time only, not a runtime parameter
- ✅ `api_url` - **Decision**: CloudFormation OUTPUT, should be removed from secret structure

**Gap Severity**: HIGH - Core requirement not met

**Impact**: Users cannot customize 6 out of 10 runtime parameters without code changes

#### R2: Two Environment Variables Only

**Requirement**: Container must require exactly 2 environment variables.

**Current State**: ✅ FULLY IMPLEMENTED
- Container reads only `QuiltStackARN` and `BenchlingSecret`
- Test validates this: `docker/tests/test_config_env_vars.py` (lines 31-34)

**Gap Severity**: NONE - Requirement met

#### R3: Configuration Resolver

**Requirement**: Application must have a configuration resolver that fetches and assembles complete configuration from AWS.

**Current State**: ✅ MOSTLY IMPLEMENTED
- `ConfigResolver` class exists and works
- Fetches from CloudFormation and Secrets Manager
- Validates required outputs
- Caches configuration

**Gap**: Resolver doesn't fetch/validate all 11 parameters from secret

**Gap Severity**: MEDIUM - Infrastructure exists, needs parameter expansion

#### R4: No Legacy Mode

**Requirement**: Application must not support reading individual environment variables.

**Current State**: ✅ FULLY IMPLEMENTED
- Legacy mode removed in commit `8a800b8`
- Config.py only reads `QuiltStackARN` and `BenchlingSecret`
- Test validates this: `docker/tests/test_config_env_vars.py`

**Gap Severity**: NONE - Requirement met

#### R5: Production and Tests Use Identical Code Path

**Requirement**: Production and tests must execute the exact same configuration resolution logic.

**Current State**: ✅ FULLY IMPLEMENTED
- Tests mock `ConfigResolver.resolve()` method
- Both execute same `config.py` logic
- File: `docker/tests/conftest.py` (lines 44-84)

**Gap Severity**: NONE - Requirement met

#### R6: NPM Scripts (Make Targets)

**Requirement**: `npm run test`, `npm run docker:test`, `npm run cdk:dev` must work.

**Current State**:
- ✅ `npm run test` - works with 4-parameter mocked config
- ⚠️  `npm run docker:test` - not verified, likely works with 4-parameter secret
- ✅ `npm run cdk:dev` - works with 4-parameter secret (confirmed in README)

**Gap**: Scripts work but only with 4-parameter secret, not full 11-parameter implementation

**Gap Severity**: LOW - Infrastructure works, needs expansion

#### R7: Clear Error Messages

**Requirement**: Configuration errors must provide actionable guidance.

**Current State**: ✅ WELL IMPLEMENTED
- `ConfigResolverError` class with suggestions (lines 35-50)
- Clear error messages for missing env vars, invalid ARN, missing secret
- Example: `docker/src/config.py` (lines 47-55)

**Gap Severity**: NONE - Requirement met (will need to expand for 11 parameters)

#### R8: Backward Compatibility NOT Required

**Requirement**: Individual environment variables are deprecated.

**Current State**: ✅ FULLY IMPLEMENTED
- Legacy mode completely removed
- No backward compatibility code

**Gap Severity**: NONE - Requirement met

#### R9: Full Customizability

**Requirement**: Users must be able to customize all 11 parameters without code changes.

**Current State**: ❌ NOT IMPLEMENTED
- Only 4 parameters customizable via secret
- 7 parameters hardcoded or from CloudFormation

**Gap Severity**: CRITICAL - Core value proposition not delivered

**Impact**: Cannot change LOG_LEVEL, PKG_PREFIX, USER_BUCKET, etc. without rebuilding container

### 3.2 Specification vs. Current Implementation

#### Secret JSON Schema (from 02-spec.md)

**Required Keys** (lines 52-63) **UPDATED 2025-11-01**:
```
CLIENT_ID, CLIENT_SECRET, TENANT, APP_DEFINITION_ID,
LOG_LEVEL, PKG_PREFIX, PKG_KEY, USER_BUCKET,
ENABLE_WEBHOOK_VERIFICATION, WEBHOOK_ALLOW_LIST
```

**Deployment-Time Only** (not in secret):
```
ECR_REPOSITORY_NAME (CDK deployment configuration)
VERSION (CloudFormation parameter)
```

**CloudFormation Outputs** (not in secret):
```
api_url (may be obsoleted by ApiGatewayEndpoint)
ApiGatewayEndpoint (different from WebHostName/Catalog)
```

**Current Implementation** (`BenchlingSecretData`):
```
tenant, client_id, client_secret, app_definition_id, api_url
```

**Required Changes**:

- Remove: `api_url` (CloudFormation output, not input)
- Add: 6 missing runtime parameters

**Missing from Secret Structure**:
1. `LOG_LEVEL`
2. `PKG_PREFIX`
3. `PKG_KEY`
4. `USER_BUCKET` (**Decision**: must be in secret)
5. ~~`ECR_REPOSITORY_NAME`~~ (**Decision**: CDK deployment-time only, not in secret)
6. `ENABLE_WEBHOOK_VERIFICATION`
7. `WEBHOOK_ALLOW_LIST`

**Actually Missing**: 6 parameters (ECR_REPOSITORY_NAME excluded)

**Missing from Secret Validation** (lines 226-233):
- Only validates 3 required fields (tenant, client_id, client_secret)
- Should validate all 11 fields

#### Configuration Assembly (from 02-spec.md)

**Specified Behavior** (lines 160-167):
> The secret must contain these exact keys (case-sensitive):
> Missing keys must cause application startup to fail with a clear error message

**Current Behavior**:
- Missing keys are replaced with hardcoded defaults (no error)
- No validation for optional parameters

**Gap**: Startup doesn't fail when parameters are missing from secret

### 3.3 Discrepancies Found

#### Discrepancy 1: USER_BUCKET Source

**Requirements** (01-requirements.md line 33):
> `USER_BUCKET` | string | `my-s3-bucket` | S3 bucket for Benchling exports

**Current Implementation** (config_resolver.py line 361):
```python
quilt_user_bucket = outputs.get("UserBucket") or outputs.get("BucketName")
```

**Issue**: USER_BUCKET comes from CloudFormation, not secret

**DECISION (2025-11-01)**: USER_BUCKET **must** be specified in secrets, NOT in CloudFormation or environment variables. This allows full customizability per Issue #156 requirements.

#### Discrepancy 2: ECR_REPOSITORY_NAME Usage

**Requirements** (01-requirements.md line 28):
> `ECR_REPOSITORY_NAME` | string | `quiltdata/benchling` | Custom ECR repository name

**Current Implementation**: Not present in Python code at all

**Question**: What is ECR_REPOSITORY_NAME used for?
- Is it for runtime behavior (which ECR to pull from)?
- Is it only for CDK deployment (which ECR to push to)?
- Is it actually needed in the secret?

**Analysis**: Looking at CDK code, ECR repository name is a deployment-time parameter, not a runtime parameter. It doesn't appear to be needed in the application container.

**DECISION (2025-11-01)**: ECR_REPOSITORY_NAME is specified for CDK deployment only, NOT stored in secret. VERSION should be specified as a CloudFormation parameter for runtime. ECR_REPOSITORY_NAME is deployment-time configuration, not runtime configuration.

#### Discrepancy 3: Health Endpoint Design

**Specification** (02-spec.md lines 422-424):
```json
{
  "config_source": "secrets-only-mode",
  "config_parameters": 11
}
```

**Current Implementation** (app.py lines 84-96):
```python
"config_source": "secrets-only-mode",
"config_version": "v0.6.0+"
```

**DECISION (2025-11-01)**: Health check should balance traditional health monitoring (200 OK for alive) with informational metadata. Should report:

- Basic health status (alive/ready)
- Configuration mode (secrets-only)
- Key metadata (version, parameter count)
- NOT sensitive configuration details

#### Discrepancy 4: api_url vs ApiGatewayEndpoint

**Current Implementation**: `BenchlingSecretData` includes `api_url` field

**Requirements**: No mention of `api_url` in the 11-parameter list

**DECISION (2025-11-01)**:

- `api_url` is a CloudFormation stack OUTPUT, not an input (and may be obsoleted by `ApiGatewayEndpoint`)
- `ApiGatewayEndpoint`/`api_url` is different than Catalog (`WebHostName`)
- `api_url` should be resolved from CloudFormation outputs, not stored in secret
- Remove `api_url` from `BenchlingSecretData` structure

---

## 4. Implementation Constraints

### 4.1 CloudFormation Stack Dependencies

**Constraint**: The Quilt CloudFormation stack must export specific outputs.

**Required Outputs** (validated in config_resolver.py lines 385-386):
- `UserAthenaDatabaseName` - Required
- `PackagerQueueArn` - Required
- `UserBucket` OR `BucketName` - At least one required
- `Catalog`, `CatalogDomain`, OR `ApiGatewayEndpoint` - At least one required

**Impact**: If USER_BUCKET moves to secret, should we still require it from CloudFormation?

**Recommendation**: Keep CloudFormation output as fallback, but allow secret to override.

### 4.2 Secret Size Limits

**AWS Constraint**: Secrets Manager secrets limited to 65,536 bytes

**Current Secret Size**: ~200 bytes (4 parameters as JSON)

**Projected Secret Size**: ~500 bytes (11 parameters as JSON)

**Assessment**: No concern - well within limits

### 4.3 IAM Permission Boundaries

**Current Permissions** (fargate-service.ts lines 114-124):
```typescript
taskRole.addToPolicy(new iam.PolicyStatement({
    actions: [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
    ],
    resources: [
        `arn:aws:secretsmanager:${region}:${account}:secret:${benchlingSecret}*`,
    ],
}));
```

**Constraint**: Secret name/ARN must match the pattern expected by IAM policy

**Impact**: Users must use consistent secret naming

**Assessment**: Current implementation is flexible (supports both name and ARN)

### 4.4 Testing Infrastructure Constraints

**Current Mock Structure** (conftest.py lines 62-77):
- Tests provide complete `ResolvedConfig` object
- No actual AWS API calls made
- Mock must match production data structure exactly

**Constraint**: Any changes to `ResolvedConfig` must update test fixtures

**Impact**: Medium - test fixtures need updating for 11-parameter config

### 4.5 Deployment Workflow Dependencies

**Current Workflow** (dev-deploy.ts lines 240-244):
```javascript
const quiltStackArn = 'arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/...';
const benchlingSecret = 'benchling-webhook-dev';
```

**Constraint**: Development secret must exist before deployment

**Current Process**:
1. Create secret in AWS Secrets Manager manually (one-time)
2. Run `npm run cdk:dev` (uses existing secret)

**Gap**: No `npm run config` command to generate secret (future work per requirements)

---

## 5. Technical Debt

### 5.1 Legacy Code Remnants

**File**: `docker/src/secrets_resolver.py`

**Status**: Entire file appears to be legacy code

**Evidence**:
- Implements hierarchical fallback (BENCHLING_SECRETS env var, then individual vars)
- File docstring mentions "legacy: BENCHLING_TENANT" (line 8)
- Not imported or used anywhere in current codebase

**Assessment**: This file should be removed after confirming it's not used

**Verification Needed**: Grep for imports of `secrets_resolver`

### 5.2 Hardcoded Defaults Proliferation

**Locations**:
1. `docker/src/config_resolver.py` (lines 96-100) - ResolvedConfig defaults
2. `lib/utils/config-resolver.ts` (lines 338-343) - TypeScript defaults
3. `docker/tests/conftest.py` (lines 70-76) - Test fixtures

**Issue**: Same defaults repeated in 3 places (DRY violation)

**Risk**: Changing default requires updating 3 files

**Recommendation**: After moving to secret, these defaults should only exist as documentation

### 5.3 Inconsistent Parameter Naming and Terminology

#### 5.3.1 Case Conventions Across the Codebase

**Observations**: The same logical parameter is represented in multiple case styles across different layers:

##### Example 1: Package Prefix Parameter

- Requirements doc: `PKG_PREFIX` (SCREAMING_SNAKE_CASE)
- Secret JSON key: `pkg_prefix` (snake_case) - if implemented
- Python code: `pkg_prefix` (snake_case)
- TypeScript code: `pkgPrefix` (camelCase)
- Environment variable (legacy): `PKG_PREFIX` (SCREAMING_SNAKE_CASE)

##### Example 2: Client Credentials

- Requirements doc: `CLIENT_ID`, `CLIENT_SECRET` (SCREAMING_SNAKE_CASE)
- Secret JSON keys: `client_id`, `client_secret` (snake_case)
- Python dataclass: `client_id`, `client_secret` (snake_case)
- TypeScript interface: `clientId`, `clientSecret` (camelCase)

##### Example 3: CloudFormation Outputs

- CloudFormation template: `UserBucket`, `BucketName`, `PackagerQueueArn` (PascalCase)
- Python code: `quilt_user_bucket`, `queue_arn` (snake_case)
- TypeScript code: `userBucket`, `queueArn` (camelCase)

#### 5.3.2 Terminology Inconsistencies

##### Bucket Parameter Names

- CloudFormation output 1: `UserBucket`
- CloudFormation output 2 (fallback): `BucketName`
- Requirements doc: `USER_BUCKET`
- Python variable: `quilt_user_bucket`
- Logical concept: "S3 bucket for Benchling exports"

**Risk**: Confusion about which bucket name is canonical

##### API Endpoint Naming

- Current secret field: `api_url`
- CloudFormation output 1: `ApiGatewayEndpoint`
- CloudFormation output 2 (legacy?): `Catalog`
- CloudFormation output 3 (legacy?): `CatalogDomain`
- CloudFormation output 4 (legacy?): `WebHostName`

**Risk**: Unclear which endpoint serves which purpose

##### ARN vs Name for Secrets

- Parameter name in CDK: `benchlingSecret`
- Environment variable name: `BenchlingSecret` (PascalCase)
- Python variable: `benchling_secret_name`
- Usage: Can be either name or full ARN

**Risk**: Ambiguity about whether value should be name or ARN

#### 5.3.3 Current Naming Conventions by Layer

| Layer | Convention | Example |
|-------|-----------|---------|
| Requirements/Specs Docs | SCREAMING_SNAKE_CASE | `PKG_PREFIX`, `USER_BUCKET` |
| Secret JSON Keys | snake_case | `client_id`, `pkg_prefix` |
| Environment Variables | PascalCase | `QuiltStackARN`, `BenchlingSecret` |
| CloudFormation Outputs | PascalCase | `UserBucket`, `PackagerQueueArn` |
| Python Variables | snake_case | `pkg_prefix`, `client_id` |
| Python Dataclass Fields | snake_case | `pkg_prefix`, `client_id` |
| TypeScript Variables | camelCase | `pkgPrefix`, `clientId` |
| TypeScript Interface Fields | camelCase | `pkgPrefix`, `clientId` |

#### 5.3.4 Standardization Recommendations

##### RECOMMENDATION 1: Establish Clear Case Convention Rules

Define canonical case per layer:

1. **Secret JSON Keys**: snake_case (MANDATORY)
   - Rationale: Python-native, already in use for existing secrets
   - Example: `client_id`, `pkg_prefix`, `log_level`, `user_bucket`
   - Breaking this would require migrating existing secrets

2. **Documentation (Requirements/Specs)**: SCREAMING_SNAKE_CASE
   - Rationale: Distinguishes config parameters from regular text
   - Example: `PKG_PREFIX`, `USER_BUCKET`, `LOG_LEVEL`
   - Purpose: Documentation and reference only

3. **Environment Variables**: PascalCase (EXISTING CONVENTION)
   - Rationale: Already established for `QuiltStackARN`, `BenchlingSecret`
   - Keep for consistency with current implementation
   - Only 2 environment variables total

4. **CloudFormation Outputs**: PascalCase (AWS CONVENTION)
   - Rationale: AWS CloudFormation standard
   - Cannot change without breaking CloudFormation stacks
   - Example: `UserBucket`, `PackagerQueueArn`, `ApiGatewayEndpoint`

5. **Python Code**: snake_case (PYTHON CONVENTION)
   - Rationale: PEP 8 standard
   - Example: `pkg_prefix`, `client_id`, `user_bucket`

6. **TypeScript Code**: camelCase (TYPESCRIPT CONVENTION)
   - Rationale: TypeScript/JavaScript standard
   - Example: `pkgPrefix`, `clientId`, `userBucket`

##### RECOMMENDATION 2: Create Naming Translation Table

Document authoritative mappings in code comments and docs:

```markdown
| Concept | Docs | Secret Key | Python | TypeScript | CFN Output |
|---------|------|------------|--------|------------|------------|
| Package prefix | PKG_PREFIX | pkg_prefix | pkg_prefix | pkgPrefix | N/A |
| S3 bucket | USER_BUCKET | user_bucket | quilt_user_bucket | userBucket | UserBucket |
| Client ID | CLIENT_ID | client_id | client_id | clientId | N/A |
| Log level | LOG_LEVEL | log_level | log_level | logLevel | N/A |
| Queue ARN | N/A | N/A | queue_arn | queueArn | PackagerQueueArn |
```

##### RECOMMENDATION 3: Consolidate CloudFormation Output Names

**Current Problem**: Multiple fallback names for same concept:

- Bucket: `UserBucket` OR `BucketName`
- Endpoint: `Catalog` OR `CatalogDomain` OR `WebHostName` OR `ApiGatewayEndpoint`

**Recommendation**:

- Standardize on ONE canonical name per output
- Deprecate legacy aliases in CloudFormation template
- Document mapping from old to new names
- Example:
  - Canonical bucket output: `UserBucket`
  - Canonical endpoint output: `ApiGatewayEndpoint`
  - Add migration guide for stacks using old names

##### RECOMMENDATION 4: Add Type-Safe Name Conversions

Create utility functions to convert between naming conventions:

```python
# Python example
def secret_key_to_env_var(key: str) -> str:
    """Convert snake_case secret key to SCREAMING_SNAKE_CASE env var name"""
    return key.upper()

def secret_key_to_python_var(key: str) -> str:
    """Convert secret key to Python variable name (already snake_case)"""
    return key
```

```typescript
// TypeScript example
function secretKeyToCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
```

##### RECOMMENDATION 5: Update Documentation

Add a "Naming Conventions" section to main README:

1. List the canonical name for each parameter in all contexts
2. Explain why different layers use different conventions
3. Provide translation table for developers
4. Document CloudFormation output migration path

##### RECOMMENDATION 6: Validate Consistency in Tests

Add tests that verify naming consistency:

```python
def test_secret_keys_are_snake_case():
    """Verify all secret keys follow snake_case convention"""
    secret_data = get_example_secret()
    for key in secret_data.keys():
        assert key == key.lower()  # No uppercase
        assert key.replace('_', '').isalnum()  # Only alphanumeric + underscore
```

#### 5.3.5 Risk Assessment

##### HIGH RISK: Changing secret JSON key names

- Would break all existing secrets
- Requires coordinated migration across all deployments
- **Decision**: Keep snake_case for secret keys (no breaking changes)

##### MEDIUM RISK: CloudFormation output name changes

- Would break existing CDK deployments
- Requires stack updates
- **Mitigation**: Support both old and new names during transition

##### LOW RISK: Python/TypeScript variable naming

- Internal implementation detail
- Can be refactored safely with IDE tools
- No external API impact

#### 5.3.6 Implementation Priority

1. **Immediate** (Critical Path):
   - Document naming convention table (add to 03-analysis.md or README)
   - Ensure new secret keys use snake_case consistently
   - Add name-to-snake_case conversion when reading secret

2. **Phase 1** (With Secret Expansion):
   - Add 6 new secret keys using snake_case: `log_level`, `pkg_prefix`, `pkg_key`, `user_bucket`, `enable_webhook_verification`, `webhook_allow_list`
   - Update BenchlingSecretData with snake_case fields
   - Remove `api_url` from secret (CloudFormation output)

3. **Phase 2** (After Core Implementation):
   - Create naming conversion utilities
   - Add naming consistency tests
   - Update documentation with naming conventions section

4. **Future** (Low Priority):
   - Deprecate CloudFormation output aliases
   - Consolidate to single canonical name per output
   - Provide migration guide

**Current Convention**: Secret uses snake_case, code uses snake_case

**Risk**: Manageable if we maintain snake_case in secret and document conventions clearly

**Summary**: Keep snake_case for secret keys (mandatory for backward compatibility), document case conventions clearly per layer, create translation tables for developer reference

### 5.4 Missing Secret Validation

**File**: `docker/src/config_resolver.py` (lines 226-233)

**Current Validation**:
```python
required = ["client_id", "client_secret", "tenant"]
missing = [f for f in required if not data.get(f)]
if missing:
    raise ConfigResolverError(...)
```

**Issue**: Only validates 3 fields, no validation for other 8 parameters

**Risk**: Missing parameters silently use defaults instead of failing fast

**Recommendation**: Add validation for all 11 required parameters

### 5.5 TypeScript Code Duplication

**Files**:
- `lib/utils/config-resolver.ts` - Full ConfigResolver implementation in TypeScript
- `docker/src/config_resolver.py` - Same logic in Python

**Observation**: Both implementations must stay in sync

**Current State**: Both work correctly for 4-parameter secret

**Risk**: Changes to Python must be mirrored in TypeScript

**Question**: Is TypeScript ConfigResolver actually used, or only for type checking?

**Investigation Needed**: Check if TypeScript version is used at runtime

---

## 6. Open Questions

### 6.1 Parameter Usage Questions

**Q1**: ~~What is `ECR_REPOSITORY_NAME` actually used for?~~ **RESOLVED (2025-11-01)**

- ✅ ECR_REPOSITORY_NAME is CDK deployment-time only, not runtime
- ✅ VERSION should be CloudFormation parameter
- ✅ NOT stored in secret

**Q2**: ~~Should `USER_BUCKET` be in the secret or from CloudFormation?~~ **RESOLVED (2025-11-01)**

- ✅ USER_BUCKET **must** be in secret
- ✅ NOT from CloudFormation or environment variables
- ✅ Enables full customizability per Issue #156

**Q3**: ~~Should `api_url` remain as an undocumented optional parameter?~~ **RESOLVED (2025-11-01)**

- ✅ `api_url` is CloudFormation OUTPUT, not input
- ✅ May be obsoleted by `ApiGatewayEndpoint`
- ✅ Remove from secret, resolve from CloudFormation
- ✅ `ApiGatewayEndpoint`/`api_url` ≠ Catalog (`WebHostName`)

### 6.2 Architecture Questions

**Q4**: Is the TypeScript ConfigResolver used at runtime?
- If yes: Must implement 11-parameter logic in TypeScript
- If no: Can we simplify to type definitions only?

**Q5**: Should we support partial secrets (with CloudFormation fallbacks)?
- Simpler migration path
- Or require all 11 parameters (fail-fast)?

**Q6**: How should we handle boolean parameters in JSON?
- Store as strings "true"/"false" (spec says this)
- Or actual JSON booleans true/false?
- Python must parse either way?

### 6.3 Migration Questions

**Q7**: How do existing deployments migrate to 11-parameter secrets?
- Do we need a migration script?
- Can deployments fail if secret is missing parameters?
- Or provide backward compatibility (allow 4-parameter secrets)?

**Q8**: What happens to existing 4-parameter secrets during upgrade?
- Deployment fails until secret is updated?
- Or container starts with defaults (current behavior)?

### 6.4 Testing Questions

**Q9**: How do we test with real AWS resources?
- `npm run docker:test` creates temporary secret?
- What format/content?
- How do we clean up?

**Q10**: Should we add secret validation tests?
- Test that secret with missing parameters fails startup?
- Test that invalid JSON fails with clear error?

### 6.5 Documentation Questions

**Q11**: What's the recommended secret creation workflow?
- AWS Console?
- AWS CLI?
- Future `npm run config` command?

**Q12**: How do we document the breaking change?
- Existing 4-parameter secrets will need updating?
- Or is this backward compatible (treat missing params as optional)?

---

## 7. Architectural Challenges

### 7.1 Backward Compatibility Dilemma

**Challenge**: Existing secrets have only 4 parameters. New implementation requires 11.

**Options**:

**Option A: Strict Validation (Fail Fast)**
- Startup fails if any parameter missing
- Forces users to update secrets before deployment
- Clear error messages guide users

**Pros**: Simple, predictable, enforces correctness
**Cons**: Breaks existing deployments, requires migration

**Option B: Gradual Migration (Defaults for Missing)**
- Missing parameters use hardcoded defaults
- Warn in logs when using defaults
- Allow gradual secret updates

**Pros**: Smooth migration, no downtime
**Cons**: Defeats purpose of Issue #156 (full customizability)

**Option C: Hybrid Approach**
- CloudFormation provides infrastructure params (bucket, queue, database)
- Secret provides application params (log level, prefix, verification)
- Clear separation of concerns

**Pros**: Logical separation, simpler secrets
**Cons**: Not aligned with Issue #156 specification

**Recommendation Needed**: Which approach should we take?

### 7.2 Parameter Source Ambiguity

**Challenge**: Some parameters could come from multiple sources.

**Example**: `USER_BUCKET`
- CloudFormation output (infrastructure)
- Secret (application override)
- Environment variable (local development)

**Question**: What's the precedence order?

**Proposed Precedence** (highest to lowest):
1. Secret (explicit user override)
2. CloudFormation (infrastructure default)
3. Hardcoded default (fallback)

**Implication**: Requires refactoring assembly logic

### 7.3 Secret Schema Evolution

**Challenge**: How do we handle future parameter additions?

**Current Approach**: Dataclass with fixed fields

**Future Needs**:
- Add new parameters without breaking existing secrets
- Support optional/experimental parameters
- Version secret schema

**Recommendation**:
- Use dict-based validation instead of dataclass
- Validate known fields, ignore unknown fields (forward compatibility)
- Add `schema_version` field to secret

### 7.4 Error Message Clarity

**Challenge**: Distinguishing between different types of missing parameters.

**Current Behavior**: Generic "missing parameter" error

**Needed Distinctions**:
- Parameter missing from secret (user error)
- Parameter missing from CloudFormation (infrastructure error)
- Parameter has invalid value (validation error)

**Recommendation**: Enhance `ConfigResolverError` with error types/categories

### 7.5 Testing All Parameter Combinations

**Challenge**: 11 parameters × multiple invalid states = many test cases

**Required Tests**:
- All parameters present (happy path)
- Each parameter missing (11 test cases)
- Each parameter invalid value (11 test cases)
- Multiple parameters missing (combinations)
- Boolean parameters (true/false/"true"/"false")

**Strategy Needed**: Parameterized tests or fixture generation

---

## 8. Summary of Key Findings

### Critical Gaps (Must Address)

1. **Only 4 out of 10 runtime parameters in secret** (R1, R9 failures) **UPDATED 2025-11-01**
   - 6 parameters hardcoded or missing from secret
   - ECR_REPOSITORY_NAME is deployment-time (not runtime) - removed from count
   - Users cannot customize 6 parameters without code changes
   - **Severity**: CRITICAL

2. **No validation for 7 out of 10 runtime parameters** (from Gap 5.4) **UPDATED 2025-11-01**
   - Missing parameters silently use defaults
   - No fail-fast behavior for missing params
   - ECR_REPOSITORY_NAME excluded (deployment-time only)
   - **Severity**: HIGH

3. ~~**USER_BUCKET source ambiguity** (Discrepancy 1)~~ **RESOLVED (2025-11-01)**
   - ✅ USER_BUCKET must be in secret (not CloudFormation)
   - ✅ Architectural decision made
   - **Severity**: ~~MEDIUM~~ RESOLVED

### Working Well (No Changes Needed)

1. **2 environment variables only** (R2 fully implemented)
2. **Configuration resolver infrastructure** (R3 mostly done)
3. **No legacy mode** (R4 fully implemented)
4. **Test infrastructure** (R5 fully implemented)
5. **Clear error messages** (R7 well implemented)
6. **Deployment workflow** (R6 works for 4 params)

### Technical Debt to Address

1. **Remove unused secrets_resolver.py** (Section 5.1)
2. **Consolidate hardcoded defaults** (Section 5.2)
3. **Add comprehensive secret validation** (Section 5.4)
4. **TypeScript/Python parity** (Section 5.5)

### Open Architectural Questions

1. Backward compatibility strategy (Section 7.1)
2. ~~Parameter source precedence (Section 7.2)~~ **RESOLVED** - Secret is primary source for app config
3. ~~ECR_REPOSITORY_NAME necessity (Q1)~~ **RESOLVED** - CDK deployment-time only
4. ~~USER_BUCKET source decision (Q2)~~ **RESOLVED** - Must be in secret

---

## 9. Next Steps

Based on this analysis, the implementation requires:

1. **Expand Secret Structure** (High Priority) **UPDATED 2025-11-01**
   - Add 6 missing runtime parameters to `BenchlingSecretData`:
     - `LOG_LEVEL`, `PKG_PREFIX`, `PKG_KEY`, `USER_BUCKET`
     - `ENABLE_WEBHOOK_VERIFICATION`, `WEBHOOK_ALLOW_LIST`
   - Remove `api_url` from `BenchlingSecretData` (CloudFormation output)
   - Update secret JSON parsing logic
   - Update secret validation to check all 10 runtime parameters

2. **Update Configuration Assembly** (High Priority) **UPDATED 2025-11-01**
   - Modify `ConfigResolver.resolve()` to read all params from secret
   - Move `USER_BUCKET` from CloudFormation resolution to secret
   - Keep `api_url`/`ApiGatewayEndpoint` from CloudFormation (output, not input)
   - Remove hardcoded defaults for secret-based parameters
   - Document ECR_REPOSITORY_NAME as CDK deployment-time configuration
   - Document VERSION as CloudFormation parameter

3. **Enhance Validation** (High Priority) **UPDATED 2025-11-01**
   - Validate all 10 runtime parameters from secret
   - Validate CloudFormation outputs (api_url, endpoints, etc.)
   - Fail fast with clear errors for missing parameters
   - Support boolean parameters (string and native formats)

4. **Update Tests** (Medium Priority) **UPDATED 2025-11-01**
   - Expand test fixtures to include all 10 runtime parameters
   - Remove `api_url` from test fixtures (CloudFormation output)
   - Add validation tests for missing parameters
   - Test boolean parameter parsing

5. **Update Documentation** (Medium Priority) **UPDATED 2025-11-01**
   - Document all 10 runtime secret parameters with examples
   - Document ECR_REPOSITORY_NAME as CDK deployment-time configuration
   - Document VERSION as CloudFormation parameter
   - Document api_url as CloudFormation output (may be obsoleted by ApiGatewayEndpoint)
   - Clarify ApiGatewayEndpoint vs WebHostName (Catalog) difference
   - Provide migration guide for 4-parameter secrets
   - Clarify breaking changes

6. **Resolve Remaining Open Questions** (Before Implementation) **UPDATED 2025-11-01**
   - ~~Decide on ECR_REPOSITORY_NAME necessity~~ ✅ **RESOLVED** - CDK deployment-time only
   - ~~Decide on USER_BUCKET source strategy~~ ✅ **RESOLVED** - Must be in secret
   - ~~Decide on api_url handling~~ ✅ **RESOLVED** - CloudFormation output, remove from secret
   - Decide on backward compatibility approach (Section 7.1)
   - Verify TypeScript ConfigResolver usage (Q4)
   - Decide on health endpoint design (balance traditional vs informational)

---

**Document Status**: Complete
**Last Updated**: 2025-11-01
**Next Document**: Implementation plan to address identified gaps
