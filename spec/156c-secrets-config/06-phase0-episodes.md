# Phase 0 Episodes: Atomic Change Units

**Specification**: `spec/156c-secrets-config/03-specifications.md`
**Phases Plan**: `spec/156c-secrets-config/04-phases.md`
**Design**: `spec/156c-secrets-config/05-phase0-design.md`
**Phase**: Phase 0 - Pre-factoring
**Status**: Episodes Definition
**Last Updated**: 2025-11-02

---

## Overview

This document defines atomic change units (episodes) for Phase 0 implementation. Each episode represents a single, testable, committable change that can be independently validated and pushed.

### Episode Principles

1. **Atomic**: Single responsibility, one logical change
2. **Testable**: Clear success criteria with automated tests
3. **Committable**: Can be merged independently without breaking functionality
4. **Sequential**: Builds on previous episodes, maintains working state
5. **TDD Cycle**: Red → Green → Refactor for each episode

### Phase 0 Structure

Phase 0 has three main deliverables, each broken into atomic episodes:

- **0.1**: Extract Configuration Reading Logic (TypeScript) - 6 episodes
- **0.2**: Consolidate Makefile Variables - 4 episodes
- **0.3**: Python Configuration Module Enhancement - 4 episodes

**Total**: 14 atomic episodes

---

## Deliverable 0.1: Extract Configuration Reading Logic

**Goal**: Centralize TypeScript environment variable access to enable future XDG migration.

### Episode 0.1.1: Create ConfigReader Module Structure

**Status**: Pending
**Duration**: 15 minutes
**Dependencies**: None

#### Description

Create the basic structure for `lib/config-reader.ts` with enums and interfaces only. No implementation logic yet.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
// test/config-reader.test.ts
describe("ConfigReader", () => {
    it("should define ConfigSource enum", () => {
        expect(ConfigSource.Environment).toBe("environment");
    });

    it("should define ConfigData interface with required fields", () => {
        const config: ConfigData = {
            quiltStackArn: "test",
            benchlingSecret: "test",
            source: ConfigSource.Environment,
        };
        expect(config).toBeDefined();
    });
});
```

**Green** (Implementation):
- Create `lib/config-reader.ts`
- Define `ConfigSource` enum
- Define `ConfigData` interface
- Export both types

**Refactor**:
- Add JSDoc comments
- Organize imports
- Verify TypeScript compilation

#### Success Criteria

- [ ] File `lib/config-reader.ts` exists
- [ ] `ConfigSource` enum defined with `Environment` value
- [ ] `ConfigData` interface includes all fields from design
- [ ] Tests pass: `npm run test:ts -- config-reader.test.ts`
- [ ] TypeScript compilation succeeds: `npm run typecheck`
- [ ] No linting errors: `npm run lint`

#### Validation Commands

```bash
npm run typecheck
npm run test:ts -- config-reader.test.ts
npm run lint
```

#### Commit Message

```
feat(config): add ConfigReader type definitions

- Add ConfigSource enum for configuration source tracking
- Add ConfigData interface matching environment variable model
- Support secrets-only mode (v0.6.0+) with required fields
- Add optional override fields for flexibility

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.2: Implement readFromEnvironment Method

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.1.1

#### Description

Implement `ConfigReader.readFromEnvironment()` method that reads all configuration from environment variables without validation.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("ConfigReader.readFromEnvironment", () => {
    beforeEach(() => {
        // Clear environment
        delete process.env.QUILT_STACK_ARN;
        delete process.env.BENCHLING_SECRET;
        delete process.env.LOG_LEVEL;
    });

    it("should read QUILT_STACK_ARN from environment", () => {
        process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:us-east-1:123:stack/test";
        const config = ConfigReader.readFromEnvironment();
        expect(config.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123:stack/test");
    });

    it("should return undefined for missing variables", () => {
        const config = ConfigReader.readFromEnvironment();
        expect(config.quiltStackArn).toBeUndefined();
        expect(config.benchlingSecret).toBeUndefined();
    });

    it("should handle LOG_LEVEL fallback to BENCHLING_LOG_LEVEL", () => {
        process.env.LOG_LEVEL = "DEBUG";
        const config = ConfigReader.readFromEnvironment();
        expect(config.logLevel).toBe("DEBUG");
    });

    it("should mark source as Environment", () => {
        const config = ConfigReader.readFromEnvironment();
        expect(config.source).toBe(ConfigSource.Environment);
    });

    it("should read AWS context variables", () => {
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";
        const config = ConfigReader.readFromEnvironment();
        expect(config.cdkAccount).toBe("123456789012");
        expect(config.cdkRegion).toBe("us-east-1");
    });
});
```

**Green** (Implementation):
- Add `ConfigReader` class to `lib/config-reader.ts`
- Implement `readFromEnvironment()` static method
- Read all environment variables per design spec
- Return `ConfigData` with source marked as `Environment`

**Refactor**:
- Add JSDoc comments for method
- Ensure consistent formatting
- Verify edge cases (empty strings vs undefined)

#### Success Criteria

- [ ] `readFromEnvironment()` method reads all environment variables
- [ ] Method returns `ConfigData` with correct source
- [ ] Handles missing variables gracefully (undefined)
- [ ] Supports LOG_LEVEL fallback to BENCHLING_LOG_LEVEL
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- config-reader.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement readFromEnvironment method

- Read configuration from environment variables
- Support secrets-only mode required fields
- Handle optional overrides and AWS context
- Return undefined for missing variables (no validation)
- Mark source as Environment for future XDG integration

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.3: Implement validateSecretsOnlyMode Method

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.1.2

#### Description

Implement validation method for secrets-only mode that checks required fields and throws descriptive errors.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("ConfigReader.validateSecretsOnlyMode", () => {
    it("should pass validation with all required fields", () => {
        const config: ConfigData = {
            quiltStackArn: "arn:aws:cloudformation:us-east-1:123:stack/test",
            benchlingSecret: "benchling-webhook-secret",
            source: ConfigSource.Environment,
        };
        expect(() => ConfigReader.validateSecretsOnlyMode(config)).not.toThrow();
    });

    it("should throw error for missing QUILT_STACK_ARN", () => {
        const config: ConfigData = {
            benchlingSecret: "secret",
            source: ConfigSource.Environment,
        };
        expect(() => ConfigReader.validateSecretsOnlyMode(config))
            .toThrow("QUILT_STACK_ARN is required");
    });

    it("should throw error for missing BENCHLING_SECRET", () => {
        const config: ConfigData = {
            quiltStackArn: "arn:aws:cloudformation:us-east-1:123:stack/test",
            source: ConfigSource.Environment,
        };
        expect(() => ConfigReader.validateSecretsOnlyMode(config))
            .toThrow("BENCHLING_SECRET is required");
    });

    it("should throw error with multiple missing fields", () => {
        const config: ConfigData = {
            source: ConfigSource.Environment,
        };
        expect(() => ConfigReader.validateSecretsOnlyMode(config))
            .toThrow(/QUILT_STACK_ARN.*BENCHLING_SECRET/s);
    });

    it("should include reference URL in error message", () => {
        const config: ConfigData = {
            source: ConfigSource.Environment,
        };
        expect(() => ConfigReader.validateSecretsOnlyMode(config))
            .toThrow(/github\.com\/quiltdata\/benchling-webhook\/issues\/156/);
    });
});
```

**Green** (Implementation):
- Add `validateSecretsOnlyMode()` static method
- Check `quiltStackArn` and `benchlingSecret` are present
- Build error array for missing fields
- Throw descriptive error with remediation guidance
- Include GitHub issue reference

**Refactor**:
- Extract error message formatting to helper
- Add JSDoc with examples
- Ensure error messages are actionable

#### Success Criteria

- [ ] Method validates required fields for secrets-only mode
- [ ] Throws descriptive error for missing QUILT_STACK_ARN
- [ ] Throws descriptive error for missing BENCHLING_SECRET
- [ ] Error message includes multiple missing fields
- [ ] Error message includes GitHub issue reference
- [ ] All tests pass
- [ ] TypeScript compilation succeeds

#### Validation Commands

```bash
npm run test:ts -- config-reader.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): add secrets-only mode validation

- Implement validateSecretsOnlyMode method
- Validate QUILT_STACK_ARN and BENCHLING_SECRET presence
- Throw descriptive errors with remediation guidance
- Include GitHub issue reference for troubleshooting
- Support multiple missing field error reporting

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.4: Implement getValidatedConfig Method

**Status**: Pending
**Duration**: 15 minutes
**Dependencies**: Episode 0.1.3

#### Description

Implement convenience method that reads from environment and validates in one call.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("ConfigReader.getValidatedConfig", () => {
    beforeEach(() => {
        delete process.env.QUILT_STACK_ARN;
        delete process.env.BENCHLING_SECRET;
    });

    it("should return validated config when all fields present", () => {
        process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:us-east-1:123:stack/test";
        process.env.BENCHLING_SECRET = "benchling-webhook-secret";

        const config = ConfigReader.getValidatedConfig();
        expect(config.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123:stack/test");
        expect(config.benchlingSecret).toBe("benchling-webhook-secret");
        expect(config.source).toBe(ConfigSource.Environment);
    });

    it("should throw error when validation fails", () => {
        expect(() => ConfigReader.getValidatedConfig())
            .toThrow("Configuration validation failed");
    });

    it("should include all optional fields when present", () => {
        process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:us-east-1:123:stack/test";
        process.env.BENCHLING_SECRET = "benchling-webhook-secret";
        process.env.LOG_LEVEL = "DEBUG";
        process.env.IMAGE_TAG = "v1.0.0";

        const config = ConfigReader.getValidatedConfig();
        expect(config.logLevel).toBe("DEBUG");
        expect(config.imageTag).toBe("v1.0.0");
    });
});
```

**Green** (Implementation):
- Add `getValidatedConfig()` static method
- Call `readFromEnvironment()` internally
- Call `validateSecretsOnlyMode()` on result
- Return validated config

**Refactor**:
- Add JSDoc with usage examples
- Ensure error messages propagate correctly

#### Success Criteria

- [ ] Method combines reading and validation
- [ ] Returns validated config when successful
- [ ] Throws validation errors when fields missing
- [ ] Includes optional fields when present
- [ ] All tests pass
- [ ] TypeScript compilation succeeds

#### Validation Commands

```bash
npm run test:ts -- config-reader.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): add getValidatedConfig convenience method

- Combine environment reading and validation in single call
- Return validated ConfigData when successful
- Propagate validation errors with clear messages
- Simplify CDK stack initialization code path

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.5: Integrate ConfigReader with bin/benchling-webhook.ts

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.1.4

#### Description

Replace direct `process.env` access in CDK app entry point with `ConfigReader`.

#### TDD Cycle

**Red** (Integration Tests):
```typescript
// test/integration/cdk-app.test.ts
describe("CDK App Configuration", () => {
    beforeEach(() => {
        delete process.env.QUILT_STACK_ARN;
        delete process.env.BENCHLING_SECRET;
    });

    it("should fail with descriptive error when config missing", () => {
        expect(() => {
            // Attempt to synthesize stack without config
            require("../../bin/benchling-webhook");
        }).toThrow("QUILT_STACK_ARN is required");
    });

    it("should initialize stack with valid configuration", () => {
        process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:us-east-1:123:stack/test";
        process.env.BENCHLING_SECRET = "benchling-webhook-secret";
        process.env.CDK_DEFAULT_ACCOUNT = "123456789012";
        process.env.CDK_DEFAULT_REGION = "us-east-1";

        expect(() => {
            require("../../bin/benchling-webhook");
        }).not.toThrow();
    });
});
```

**Green** (Implementation):
- Update `bin/benchling-webhook.ts`
- Import `ConfigReader` and `ConfigData`
- Replace `process.env` access with `ConfigReader.getValidatedConfig()`
- Pass config to stack constructor

**Refactor**:
- Remove now-unused environment variable reads
- Update comments to reference ConfigReader
- Ensure error handling is clear

#### Success Criteria

- [ ] `bin/benchling-webhook.ts` uses `ConfigReader`
- [ ] No direct `process.env` access in file
- [ ] Stack initialization uses validated config
- [ ] Error messages are descriptive when config missing
- [ ] Integration tests pass
- [ ] CDK synthesis works: `npx cdk synth`

#### Validation Commands

```bash
npm run test:ts
npm run typecheck
npx cdk synth --quiet
npm run lint
```

#### Commit Message

```
refactor(cdk): integrate ConfigReader in CDK app entry point

- Replace process.env access with ConfigReader.getValidatedConfig()
- Use centralized configuration reading for CDK stack
- Maintain backward compatibility with environment variables
- Improve error messages for missing configuration

No behavior change - same environment variables required.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.6: Integrate ConfigReader with bin/commands/deploy.ts

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.1.4

#### Description

Update deploy command to use `ConfigReader` as fallback for CLI options.

#### TDD Cycle

**Red** (CLI Tests):
```typescript
// test/cli/deploy.test.ts
describe("Deploy Command", () => {
    it("should use ConfigReader as fallback for missing CLI options", () => {
        process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:us-east-1:123:stack/test";
        process.env.BENCHLING_SECRET = "benchling-webhook-secret";

        // Deploy command without explicit options
        const result = executeDeployCommand([]);
        expect(result.config.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123:stack/test");
    });

    it("should prefer CLI options over environment variables", () => {
        process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:us-east-1:123:stack/env";

        const result = executeDeployCommand([
            "--quilt-stack-arn", "arn:aws:cloudformation:us-east-1:123:stack/cli"
        ]);
        expect(result.config.quiltStackArn).toBe("arn:aws:cloudformation:us-east-1:123:stack/cli");
    });
});
```

**Green** (Implementation):
- Update `bin/commands/deploy.ts`
- Import `ConfigReader`
- Use `ConfigReader.readFromEnvironment()` for fallback values
- Maintain CLI option priority over environment variables

**Refactor**:
- Simplify fallback logic with ConfigReader
- Update comments to document precedence
- Ensure CLI help text is accurate

#### Success Criteria

- [ ] Deploy command uses ConfigReader for fallback
- [ ] CLI options override environment variables
- [ ] Environment variables work when CLI options absent
- [ ] CLI tests pass
- [ ] Command help documentation is accurate
- [ ] TypeScript compilation succeeds

#### Validation Commands

```bash
npm run test:ts
npx ts-node bin/cli.ts deploy --help
npm run typecheck
npm run lint
```

#### Commit Message

```
refactor(cli): integrate ConfigReader in deploy command

- Use ConfigReader.readFromEnvironment() as fallback for CLI options
- Maintain CLI option precedence over environment variables
- Simplify configuration resolution logic
- Improve consistency with CDK app configuration

No behavior change - same CLI options and environment variables work.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

## Deliverable 0.2: Consolidate Makefile Variables

**Goal**: Standardize Makefile variable naming and improve documentation.

### Episode 0.2.1: Add Makefile Header and Variable Documentation

**Status**: Pending
**Duration**: 15 minutes
**Dependencies**: None

#### Description

Add comprehensive header to `docker/Makefile` with variable documentation and configuration section.

#### TDD Cycle

**Red** (Manual Test):
```bash
# Verify help output includes new documentation
make -C docker help | grep "Configuration Variables"
```

**Green** (Implementation):
- Add file header with purpose description
- Create "Configuration Variables" section
- Document each variable with purpose and default
- Add inline comments explaining variable precedence

**Refactor**:
- Organize variables by category (Logging, Ports, Docker, AWS)
- Ensure consistent formatting
- Add examples where helpful

#### Success Criteria

- [ ] Makefile has clear header comment
- [ ] Configuration Variables section exists
- [ ] All variables documented with purpose
- [ ] Inline comments explain complex logic
- [ ] `make -C docker help` shows documentation
- [ ] No behavior changes to existing targets

#### Validation Commands

```bash
make -C docker help
make -C docker check-env
```

#### Commit Message

```
docs(makefile): add comprehensive variable documentation

- Add file header describing Makefile purpose
- Create Configuration Variables section
- Document all variables with purpose and defaults
- Add inline comments for complex logic
- Organize variables by category for clarity

No behavior change - documentation only.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.2.2: Standardize Variable Names with BW_ Prefix

**Status**: Pending
**Duration**: 25 minutes
**Dependencies**: Episode 0.2.1

#### Description

Rename internal Makefile variables to use `BW_` (Benchling Webhook) prefix for consistency.

#### TDD Cycle

**Red** (Validation Script):
```bash
# scripts/test-makefile.sh
#!/bin/bash
set -e

echo "Testing Makefile variable standardization..."

# Test PORT_LOCAL renamed to BW_PORT_LOCAL
PORT=$(make -C docker -n run-local | grep -o "5001" | head -1)
if [ "$PORT" != "5001" ]; then
    echo "Error: BW_PORT_LOCAL not set correctly"
    exit 1
fi

# Test LOG_LEVEL fallback to BW_LOG_LEVEL
LOG_LEVEL_OUTPUT=$(make -C docker -n run | grep "LOG_LEVEL" || echo "")
if [ -z "$LOG_LEVEL_OUTPUT" ]; then
    echo "Error: BW_LOG_LEVEL not working"
    exit 1
fi

echo "✅ Makefile variable tests passed"
```

**Green** (Implementation):
- Rename `PORT_LOCAL` → `BW_PORT_LOCAL`
- Rename `PORT_DEV` → `BW_PORT_DEV`
- Rename `PORT_PROD` → `BW_PORT_PROD`
- Add `BW_IMAGE_NAME` constant
- Add `BW_ECR_REPO` constant
- Add `BW_LOG_LEVEL` with fallback to `LOG_LEVEL`
- Update all usages throughout Makefile

**Refactor**:
- Ensure consistent variable naming convention
- Group related variables together
- Verify no hardcoded values remain

#### Success Criteria

- [ ] All internal variables use `BW_` prefix
- [ ] Fallback to non-prefixed environment variables preserved
- [ ] All existing targets work identically
- [ ] Validation script passes
- [ ] No hardcoded ports or names remain
- [ ] `make -C docker build` succeeds
- [ ] `make -C docker test-unit` succeeds

#### Validation Commands

```bash
bash scripts/test-makefile.sh
make -C docker build
make -C docker test-unit
```

#### Commit Message

```
refactor(makefile): standardize variable names with BW_ prefix

- Rename PORT_LOCAL → BW_PORT_LOCAL (etc.)
- Add BW_IMAGE_NAME and BW_ECR_REPO constants
- Add BW_LOG_LEVEL with fallback to LOG_LEVEL
- Update all usages throughout Makefile
- Maintain backward compatibility with environment variables

No behavior change - same functionality with clearer naming.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.2.3: Expand .PHONY Declarations

**Status**: Pending
**Duration**: 10 minutes
**Dependencies**: Episode 0.2.2

#### Description

Add comprehensive `.PHONY` declarations for all targets in the Makefile.

#### TDD Cycle

**Red** (Manual Validation):
```bash
# Verify all targets are marked .PHONY
make -C docker -p | grep "^[a-z]" | cut -d: -f1 | sort > /tmp/targets.txt
grep "^.PHONY:" docker/Makefile | tr ' ' '\n' | tail -n +2 | sort > /tmp/phony.txt
diff /tmp/targets.txt /tmp/phony.txt
```

**Green** (Implementation):
- Add complete `.PHONY` declarations at top of file
- Group related targets on same line
- Document purpose of `.PHONY` in comments

**Refactor**:
- Organize declarations by category
- Ensure alphabetical order within categories
- Verify no targets are missing

#### Success Criteria

- [ ] All targets declared as `.PHONY`
- [ ] Targets grouped logically
- [ ] Comment explains `.PHONY` purpose
- [ ] No missing targets in declaration
- [ ] `make -C docker help` works
- [ ] All targets execute correctly

#### Validation Commands

```bash
make -C docker help
make -C docker build
make -C docker test-unit
```

#### Commit Message

```
refactor(makefile): add comprehensive .PHONY declarations

- Declare all targets as .PHONY to prevent file conflicts
- Group related targets for better organization
- Add comment explaining .PHONY purpose
- Ensure consistency across all targets

No behavior change - prevents edge cases with file name conflicts.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.2.4: Enhance help Target with Categories

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.2.3

#### Description

Improve `help` target output with clear categories and better descriptions.

#### TDD Cycle

**Red** (Validation):
```bash
# Verify help output includes categories
make -C docker help | grep "Configuration:"
make -C docker help | grep "Development:"
make -C docker help | grep "Testing:"
make -C docker help | grep "Deployment:"
```

**Green** (Implementation):
- Update `help` target to show categories
- Group targets by purpose (Configuration, Development, Testing, Deployment)
- Improve target descriptions
- Add usage examples

**Refactor**:
- Align descriptions for readability
- Add color coding if supported
- Ensure consistent formatting

#### Success Criteria

- [ ] Help output shows clear categories
- [ ] Target descriptions are helpful
- [ ] Examples provided for common workflows
- [ ] Output is well-formatted and readable
- [ ] `make -C docker help` displays categories
- [ ] Documentation matches actual targets

#### Validation Commands

```bash
make -C docker help
```

#### Commit Message

```
docs(makefile): enhance help target with categories

- Group targets by purpose (Configuration, Development, Testing, Deployment)
- Improve target descriptions with clear explanations
- Add usage examples for common workflows
- Format output for better readability

No behavior change - documentation improvement only.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

## Deliverable 0.3: Python Configuration Module Enhancement

**Goal**: Improve Python configuration validation and error reporting.

### Episode 0.3.1: Add Configuration Validation Helper Methods

**Status**: Pending
**Duration**: 25 minutes
**Dependencies**: None

#### Description

Add `validate_benchling_config()` and `validate_s3_config()` methods to Python Config class.

#### TDD Cycle

**Red** (Failing Tests):
```python
# docker/tests/test_config.py
def test_validate_benchling_config_success(config):
    """Test successful Benchling configuration validation."""
    config.benchling_tenant = "test"
    config.benchling_client_id = "client-id"
    config.benchling_client_secret = "secret"

    # Should not raise
    config.validate_benchling_config()


def test_validate_benchling_config_missing_tenant(config):
    """Test validation fails for missing tenant."""
    config.benchling_tenant = ""
    config.benchling_client_id = "client-id"
    config.benchling_client_secret = "secret"

    with pytest.raises(ValueError, match="benchling_tenant is required"):
        config.validate_benchling_config()


def test_validate_benchling_config_multiple_errors(config):
    """Test validation reports multiple missing fields."""
    config.benchling_tenant = ""
    config.benchling_client_id = ""

    with pytest.raises(ValueError) as exc_info:
        config.validate_benchling_config()

    error_msg = str(exc_info.value)
    assert "benchling_tenant is required" in error_msg
    assert "benchling_client_id is required" in error_msg


def test_validate_s3_config_success(config):
    """Test successful S3 configuration validation."""
    config.s3_bucket_name = "test-bucket"
    config.aws_region = "us-east-1"

    # Should not raise
    config.validate_s3_config()


def test_validate_s3_config_missing_bucket(config):
    """Test validation fails for missing bucket."""
    config.s3_bucket_name = ""
    config.aws_region = "us-east-1"

    with pytest.raises(ValueError, match="s3_bucket_name is required"):
        config.validate_s3_config()
```

**Green** (Implementation):
- Add `validate_benchling_config()` method to `docker/src/config.py`
- Add `validate_s3_config()` method
- Implement validation logic per design spec
- Build error arrays for missing fields
- Raise descriptive errors

**Refactor**:
- Extract error formatting helper
- Add type hints
- Add docstrings with examples

#### Success Criteria

- [ ] `validate_benchling_config()` method exists
- [ ] `validate_s3_config()` method exists
- [ ] Methods check required fields
- [ ] Multiple errors reported together
- [ ] Clear error messages with field names
- [ ] All tests pass: `make -C docker test-unit`
- [ ] Python type checking passes: `make -C docker lint`

#### Validation Commands

```bash
make -C docker test-unit
make -C docker lint
```

#### Commit Message

```
feat(config): add configuration validation helper methods

- Add validate_benchling_config() to check Benchling fields
- Add validate_s3_config() to check S3 configuration
- Report multiple validation errors together
- Provide clear, actionable error messages

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.3.2: Add Configuration Dump Methods

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: None (can run parallel with 0.3.1)

#### Description

Add `to_dict()` and `dump()` methods for configuration debugging with secret masking.

#### TDD Cycle

**Red** (Failing Tests):
```python
def test_config_to_dict_masks_secrets(config):
    """Test that to_dict masks sensitive fields by default."""
    config.benchling_client_secret = "super-secret-value"
    config.benchling_client_id = "client-id"

    data = config.to_dict(mask_secrets=True)
    assert data["benchling_client_secret"] == "***MASKED***"
    assert data["benchling_client_id"] == "***MASKED***"


def test_config_to_dict_no_masking(config):
    """Test that to_dict can skip masking when requested."""
    config.benchling_client_secret = "super-secret-value"

    data = config.to_dict(mask_secrets=False)
    assert data["benchling_client_secret"] == "super-secret-value"


def test_config_dump_formats_correctly(config):
    """Test configuration dump formatting."""
    config.benchling_tenant = "test-tenant"
    config.aws_region = "us-east-1"
    config.s3_bucket_name = "test-bucket"

    dump = config.dump()
    assert "Configuration:" in dump
    assert "AWS:" in dump
    assert "Benchling:" in dump
    assert "benchling_tenant: test-tenant" in dump
    assert "aws_region: us-east-1" in dump


def test_config_dump_masks_secrets(config):
    """Test that dump masks secrets by default."""
    config.benchling_client_secret = "super-secret"

    dump = config.dump(mask_secrets=True)
    assert "***MASKED***" in dump
    assert "super-secret" not in dump
```

**Green** (Implementation):
- Add `to_dict()` method using `dataclasses.asdict()`
- Implement secret masking for sensitive fields
- Add `dump()` method with category grouping
- Format output for readability

**Refactor**:
- Define sensitive fields list as class constant
- Add clear docstrings with examples
- Ensure consistent formatting

#### Success Criteria

- [ ] `to_dict()` method converts config to dictionary
- [ ] Method masks sensitive fields by default
- [ ] `dump()` method formats config for debugging
- [ ] Output grouped by category (AWS, Quilt, Benchling, Application)
- [ ] Secrets masked in dump output
- [ ] All tests pass: `make -C docker test-unit`
- [ ] Python type checking passes

#### Validation Commands

```bash
make -C docker test-unit
make -C docker lint
```

#### Commit Message

```
feat(config): add configuration dump methods for debugging

- Add to_dict() method to convert config to dictionary
- Add dump() method for human-readable output
- Mask sensitive fields (secrets, credentials) by default
- Group output by category for better readability
- Support opt-in raw output for troubleshooting

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.3.3: Refactor Error Message Formatting

**Status**: Pending
**Duration**: 15 minutes
**Dependencies**: Episode 0.3.1

#### Description

Extract error message formatting into helper method and improve consistency.

#### TDD Cycle

**Red** (Failing Tests):
```python
def test_format_missing_env_error():
    """Test error message formatting for missing environment variables."""
    config = Config.__new__(Config)  # Create without __post_init__
    error_msg = config._format_missing_env_error()

    assert "Missing required environment variables" in error_msg
    assert "QuiltStackARN" in error_msg
    assert "BenchlingSecret" in error_msg
    assert "CloudFormation stack ARN" in error_msg
    assert "Secrets Manager secret name" in error_msg
```

**Green** (Implementation):
- Add `_format_missing_env_error()` private method
- Move error message formatting from `__post_init__`
- Ensure consistent formatting across all error messages
- Include examples in error messages

**Refactor**:
- Use method for consistent error formatting
- Add type hints
- Improve error message clarity

#### Success Criteria

- [ ] `_format_missing_env_error()` method exists
- [ ] Method returns formatted error message
- [ ] Error message includes remediation guidance
- [ ] Consistent formatting with validation errors
- [ ] All tests pass: `make -C docker test-unit`
- [ ] Python type checking passes

#### Validation Commands

```bash
make -C docker test-unit
make -C docker lint
```

#### Commit Message

```
refactor(config): extract error message formatting

- Add _format_missing_env_error() helper method
- Improve error message consistency
- Include remediation guidance in all errors
- Add examples for required values

No behavior change - improves code organization only.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.3.4: Add Configuration Resolution Helper

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: None (can run parallel with others)

#### Description

Extract configuration field mapping into `_apply_resolved_config()` helper method.

#### TDD Cycle

**Red** (Failing Tests):
```python
def test_apply_resolved_config(config):
    """Test configuration field mapping from resolver."""
    from unittest.mock import MagicMock

    # Create mock resolved config
    resolved = MagicMock()
    resolved.aws_region = "us-west-2"
    resolved.user_bucket = "test-bucket"
    resolved.pkg_prefix = "benchling"
    resolved.benchling_tenant = "test-tenant"
    resolved.log_level = "DEBUG"

    # Apply to config
    config._apply_resolved_config(resolved)

    # Verify mapping
    assert config.aws_region == "us-west-2"
    assert config.s3_bucket_name == "test-bucket"
    assert config.s3_prefix == "benchling"
    assert config.benchling_tenant == "test-tenant"
    assert config.log_level == "DEBUG"
```

**Green** (Implementation):
- Add `_apply_resolved_config()` method to Config class
- Move field mapping logic from `__post_init__`
- Map all resolved fields to Config attributes

**Refactor**:
- Add docstring explaining field mapping
- Ensure consistent field naming
- Add type hints for resolved parameter

#### Success Criteria

- [ ] `_apply_resolved_config()` method exists
- [ ] Method maps all resolved fields correctly
- [ ] `__post_init__` uses helper method
- [ ] Configuration initialization works identically
- [ ] All tests pass: `make -C docker test-unit`
- [ ] Python type checking passes

#### Validation Commands

```bash
make -C docker test-unit
make -C docker lint
```

#### Commit Message

```
refactor(config): extract resolved config mapping

- Add _apply_resolved_config() helper method
- Move field mapping logic for better organization
- Improve testability of configuration resolution
- Maintain identical initialization behavior

No behavior change - improves code structure only.

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

## Episode Sequencing Strategy

### Parallel Execution Opportunities

Some episodes can be executed in parallel since they have no dependencies:

**Parallel Group 1** (can start immediately):
- Episode 0.1.1: ConfigReader structure
- Episode 0.2.1: Makefile documentation
- Episode 0.3.2: Python dump methods

**Parallel Group 2** (after Group 1):
- Episode 0.3.1: Python validation methods
- Episode 0.3.4: Python resolution helper

**Sequential Path** (must be sequential):
- 0.1.1 → 0.1.2 → 0.1.3 → 0.1.4 → 0.1.5/0.1.6
- 0.2.1 → 0.2.2 → 0.2.3 → 0.2.4

### Recommended Execution Order

For single developer working sequentially:

1. **Week 1 - Core Infrastructure**:
   - Day 1: Episodes 0.1.1, 0.1.2, 0.1.3
   - Day 2: Episodes 0.1.4, 0.1.5, 0.1.6
   - Day 3: Episodes 0.2.1, 0.2.2

2. **Week 2 - Documentation and Validation**:
   - Day 4: Episodes 0.2.3, 0.2.4
   - Day 5: Episodes 0.3.1, 0.3.2
   - Day 6: Episodes 0.3.3, 0.3.4

3. **Week 2 - Integration Testing**:
   - Day 7: Full integration testing, bug fixes, documentation updates

---

## Integration Testing Strategy

### After Each Deliverable

**After 0.1 (TypeScript ConfigReader)**:
```bash
npm run test
npm run typecheck
npm run lint
npx cdk synth --quiet
npx ts-node bin/cli.ts deploy --help
```

**After 0.2 (Makefile Consolidation)**:
```bash
make -C docker help
make -C docker build
make -C docker test-unit
bash scripts/test-makefile.sh
```

**After 0.3 (Python Config Enhancement)**:
```bash
make -C docker test-unit
make -C docker lint
make -C docker test-local  # If environment available
```

### Full Phase 0 Integration Test

After all episodes complete:

```bash
# TypeScript tests
npm run test
npm run typecheck
npm run lint

# Python tests
make -C docker test-unit
make -C docker lint

# Integration tests
npx cdk synth --quiet
make -C docker build
make -C docker test-local  # If environment available

# Verification
bash scripts/test-makefile.sh
git diff main --stat  # Review changes
```

---

## Rollback Strategy

### Per-Episode Rollback

Each episode is independently revertible:

```bash
# Revert last commit (episode)
git revert HEAD

# Revert specific episode
git revert <commit-hash>
```

### Per-Deliverable Rollback

If entire deliverable needs rollback:

```bash
# Revert all episodes for deliverable 0.1
git revert <episode-0.1.6-hash>^..<episode-0.1.1-hash>

# Or reset to before deliverable (if not pushed)
git reset --hard <commit-before-0.1.1>
```

### Safety Checks

Before each commit:
- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] Python linting succeeds
- [ ] No IDE diagnostics
- [ ] Commit message follows convention

---

## Episode Metrics

### Success Tracking

For each episode, track:
- **Duration**: Actual time vs. estimated
- **Test Coverage**: Lines covered by new tests
- **Issues Found**: Bugs discovered during implementation
- **Refactoring**: Additional improvements made

### Phase 0 Goals

- **Total Episodes**: 14
- **Total Estimated Time**: ~4.5 hours
- **Target Test Coverage**: 100% for new code
- **Target Success Rate**: All episodes complete without rollback

---

## Next Steps

After Phase 0 episodes complete:

1. **Create Phase 0 Checklist**: `07-phase0-checklist.md`
2. **Begin Implementation**: Execute episodes in sequence
3. **Track Progress**: Update checklist after each episode
4. **Integration Testing**: Validate after each deliverable
5. **Review**: Document lessons learned

---

## Document Control

**Version**: 1.0
**Author**: Python Expert Agent
**Status**: Episodes Definition
**Next Document**: `07-phase0-checklist.md`
**Implementation**: Ready to begin
**Estimated Duration**: 4.5 hours (14 episodes)
