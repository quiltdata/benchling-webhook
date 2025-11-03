# Phase 0 Design: Pre-factoring for Configuration System Refactoring

**Specification**: `spec/156c-secrets-config/03-specifications.md`
**Phases Plan**: `spec/156c-secrets-config/04-phases.md`
**Phase**: Phase 0 - Pre-factoring
**Status**: Design
**Last Updated**: 2025-11-02

---

## Overview

This document provides the technical design for Phase 0 of the configuration system refactoring. Phase 0 is a **pre-factoring phase** focused on simplifying and consolidating existing configuration logic before introducing the XDG-based architecture in subsequent phases.

### Goals

1. Extract scattered configuration reading logic into centralized modules
2. Consolidate Makefile variables and improve documentation
3. Standardize Python configuration patterns
4. Create clear boundaries for future XDG integration
5. **Maintain 100% backward compatibility** - no behavior changes

### Success Criteria

- All CDK stacks use centralized configuration reading
- Makefile has consistent variable naming and complete documentation
- Python configuration uses single dataclass pattern
- All existing tests pass without modification
- No changes to external interfaces or environment variable requirements

---

## Architectural Context

### Current State (from Analysis)

The codebase currently has **scattered configuration reading**:

**TypeScript/CDK Layer**:
- `bin/benchling-webhook.ts` reads from `process.env` directly
- `bin/commands/deploy.ts` reads from `process.env` with CLI option fallbacks
- `lib/benchling-webhook-stack.ts` accepts configuration as constructor props
- `lib/utils/config.ts`, `lib/utils/config-loader.ts`, `lib/utils/config-resolver.ts` provide various configuration utilities

**Python Layer**:
- `docker/src/config.py` uses a dataclass with `ConfigResolver` for AWS-based resolution
- Environment variables accessed via `os.getenv()` in `__post_init__`
- Current implementation already uses secrets-only mode (v0.6.0)

**Makefile Layer**:
- `docker/Makefile` includes `.env` and exports all variables
- Mix of hardcoded values and environment variable references
- Limited documentation via `help` target

### Target State (for Phase 0)

**Consolidated Configuration Reading**:
- Single TypeScript module (`lib/config-reader.ts`) for environment variable access
- Enhanced Python configuration module with validation helpers
- Standardized Makefile variables with comprehensive documentation

**Clear Separation of Concerns**:
- Configuration **reading** (Phase 0 focus)
- Configuration **resolution** (existing AWS-based logic, preserved)
- Configuration **validation** (enhanced in Phase 0)
- Configuration **storage** (Phase 1: XDG implementation)

---

## Phase 0 Deliverables

### 0.1: Extract Configuration Reading Logic (`lib/config-reader.ts`)

**Purpose**: Centralize all TypeScript environment variable access to enable future XDG migration.

#### Design Decisions

**Single Responsibility**: This module is **only** responsible for reading configuration from environment variables. It does NOT:
- Perform AWS API calls
- Resolve CloudFormation outputs
- Validate credentials against external services
- Store or persist configuration

**Interface Design**:
```typescript
// lib/config-reader.ts

/**
 * Configuration source priority (for future XDG integration)
 */
export enum ConfigSource {
    Environment = "environment",
    // XDG = "xdg",        // Phase 1
    // Inferred = "inferred", // Phase 2
}

/**
 * Configuration structure matching current environment variable model
 * Supports both secrets-only mode (v0.6.0+) and legacy mode
 */
export interface ConfigData {
    // Secrets-only mode (v0.6.0+) - REQUIRED
    quiltStackArn?: string;
    benchlingSecret?: string;

    // AWS context
    cdkAccount?: string;
    cdkRegion?: string;

    // Optional overrides
    logLevel?: string;
    imageTag?: string;
    createEcrRepository?: string;
    ecrRepositoryName?: string;

    // Metadata
    source: ConfigSource;
}

/**
 * ConfigReader: Centralized environment variable access
 *
 * Phase 0: Reads from environment variables only
 * Phase 1: Will add XDG file reading with environment fallback
 */
export class ConfigReader {
    /**
     * Read configuration from environment variables
     * Returns all available configuration without validation
     */
    static readFromEnvironment(): ConfigData {
        return {
            // Secrets-only mode parameters
            quiltStackArn: process.env.QUILT_STACK_ARN,
            benchlingSecret: process.env.BENCHLING_SECRET,

            // AWS context (from AWS CLI or CDK inference)
            cdkAccount: process.env.CDK_DEFAULT_ACCOUNT,
            cdkRegion: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION,

            // Optional parameters
            logLevel: process.env.LOG_LEVEL || process.env.BENCHLING_LOG_LEVEL,
            imageTag: process.env.IMAGE_TAG,
            createEcrRepository: process.env.CREATE_ECR_REPOSITORY,
            ecrRepositoryName: process.env.ECR_REPOSITORY_NAME,

            source: ConfigSource.Environment,
        };
    }

    /**
     * Validate required fields for secrets-only mode (v0.6.0+)
     * Throws descriptive error if validation fails
     */
    static validateSecretsOnlyMode(config: ConfigData): void {
        const errors: string[] = [];

        if (!config.quiltStackArn) {
            errors.push("QUILT_STACK_ARN is required (CloudFormation stack ARN)");
        }

        if (!config.benchlingSecret) {
            errors.push("BENCHLING_SECRET is required (Secrets Manager secret name)");
        }

        if (errors.length > 0) {
            throw new Error(
                "Configuration validation failed:\n" +
                errors.map(e => `  - ${e}`).join("\n") +
                "\n\nSee: https://github.com/quiltdata/benchling-webhook/issues/156"
            );
        }
    }

    /**
     * Get validated configuration for CDK stack creation
     * Reads from environment and validates required fields
     */
    static getValidatedConfig(): ConfigData {
        const config = this.readFromEnvironment();
        this.validateSecretsOnlyMode(config);
        return config;
    }
}
```

#### Integration Points

**Replace Direct Environment Access**:
1. `bin/benchling-webhook.ts`: Replace `process.env` access with `ConfigReader`
2. `bin/commands/deploy.ts`: Use `ConfigReader` as fallback for CLI options
3. `lib/utils/config-loader.ts`: Update to use `ConfigReader` internally

**Preserved Behavior**:
- Same environment variables required
- Same error messages for missing configuration
- Same validation logic
- CLI options continue to override environment variables

#### Testing Strategy

**Unit Tests** (`test/config-reader.test.ts`):
```typescript
describe("ConfigReader", () => {
    describe("readFromEnvironment", () => {
        it("reads QUILT_STACK_ARN from environment", () => {
            process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:...";
            const config = ConfigReader.readFromEnvironment();
            expect(config.quiltStackArn).toBe("arn:aws:cloudformation:...");
        });

        it("returns undefined for missing variables", () => {
            delete process.env.QUILT_STACK_ARN;
            const config = ConfigReader.readFromEnvironment();
            expect(config.quiltStackArn).toBeUndefined();
        });

        it("handles log level from multiple sources", () => {
            process.env.LOG_LEVEL = "DEBUG";
            const config = ConfigReader.readFromEnvironment();
            expect(config.logLevel).toBe("DEBUG");
        });

        it("marks source as environment", () => {
            const config = ConfigReader.readFromEnvironment();
            expect(config.source).toBe(ConfigSource.Environment);
        });
    });

    describe("validateSecretsOnlyMode", () => {
        it("passes validation with required fields", () => {
            const config: ConfigData = {
                quiltStackArn: "arn:aws:cloudformation:...",
                benchlingSecret: "benchling-webhook-secret",
                source: ConfigSource.Environment,
            };
            expect(() => ConfigReader.validateSecretsOnlyMode(config)).not.toThrow();
        });

        it("throws error for missing QUILT_STACK_ARN", () => {
            const config: ConfigData = {
                benchlingSecret: "secret",
                source: ConfigSource.Environment,
            };
            expect(() => ConfigReader.validateSecretsOnlyMode(config))
                .toThrow("QUILT_STACK_ARN is required");
        });

        it("throws error with multiple missing fields", () => {
            const config: ConfigData = {
                source: ConfigSource.Environment,
            };
            expect(() => ConfigReader.validateSecretsOnlyMode(config))
                .toThrow(/QUILT_STACK_ARN.*BENCHLING_SECRET/s);
        });
    });

    describe("getValidatedConfig", () => {
        it("returns config when validation passes", () => {
            process.env.QUILT_STACK_ARN = "arn:aws:cloudformation:...";
            process.env.BENCHLING_SECRET = "secret";
            const config = ConfigReader.getValidatedConfig();
            expect(config.quiltStackArn).toBeDefined();
            expect(config.benchlingSecret).toBeDefined();
        });

        it("throws error when validation fails", () => {
            delete process.env.QUILT_STACK_ARN;
            delete process.env.BENCHLING_SECRET;
            expect(() => ConfigReader.getValidatedConfig()).toThrow();
        });
    });
});
```

**Integration Tests**:
- Verify `bin/benchling-webhook.ts` continues to work with `ConfigReader`
- Ensure CLI commands read configuration correctly
- Validate CDK synthesis uses `ConfigReader` values

---

### 0.2: Consolidate Makefile Variables (`docker/Makefile`)

**Purpose**: Standardize Makefile variable naming and improve documentation for maintainability.

#### Design Decisions

**Variable Naming Convention**:
- Prefix internal variables with `BW_` (Benchling Webhook)
- Use UPPERCASE for constants
- Use lowercase for derived values
- Preserve existing behavior exactly

**Documentation Strategy**:
- Complete `.PHONY` declarations for all targets
- Expand `help` target with clear categories
- Add inline comments for complex logic
- Document variable defaults

**Structure** (Top of `docker/Makefile`):
```makefile
# Benchling-Quilt Integration Makefile
# Configuration consolidated for clarity and maintainability

# Import .env from parent directory if exists
-include ../.env
.EXPORT_ALL_VARIABLES:

# Include deployment targets
include make.deploy

# ==============================================================================
# Configuration Variables
# ==============================================================================

# Log level configuration
BW_LOG_LEVEL ?= $(LOG_LEVEL)
BW_LOG_LEVEL ?= INFO

# Port configuration for different environments
BW_PORT_LOCAL := 5001
BW_PORT_DEV := 5002
BW_PORT_PROD := 5003

# Docker configuration
BW_IMAGE_NAME := benchling-webhook
BW_ECR_REPO := quiltdata/benchling

# Architecture detection for multi-platform builds
BW_ARCH := $(shell uname -m)

# AWS configuration (resolved from environment or AWS CLI)
BW_AWS_REGION ?= $(AWS_REGION)
BW_AWS_REGION ?= $(CDK_DEFAULT_REGION)
BW_AWS_REGION ?= us-east-1

# ==============================================================================
# PHONY Targets Declaration
# ==============================================================================
.PHONY: help install clean build test test-unit test-local test-integration
.PHONY: run run-dev run-local run-local-verbose run-prod run-ecr run-ngrok
.PHONY: health health-local health-dev health-prod
.PHONY: logs logs-dev logs-prod
.PHONY: lint kill check-env check-ngrok
.PHONY: test-benchling test-query test-dev test-prod test-ecr
.PHONY: docker-clean

# ... (rest of Makefile with standardized variable usage)
```

#### Refactoring Changes

**Variable Standardization**:
1. Replace `PORT_LOCAL` → `BW_PORT_LOCAL` (etc.)
2. Replace `LOG_LEVEL` → `BW_LOG_LEVEL` (with fallback to `LOG_LEVEL`)
3. Add `BW_IMAGE_NAME`, `BW_ECR_REPO` constants

**Documentation Improvements**:
1. Group related targets in help output
2. Add variable documentation section
3. Improve target descriptions
4. Add examples for common workflows

**Preserved Behavior**:
- All existing targets work identically
- Same environment variable names accepted
- Same default values
- Same execution behavior

#### Testing Strategy

**Manual Testing**:
```bash
# Verify help output
make -C docker help

# Test common targets
make -C docker check-env
make -C docker build
make -C docker test-unit

# Verify variables are set correctly
make -C docker test BW_LOG_LEVEL=DEBUG
```

**Validation Script** (`scripts/test-makefile.sh`):
```bash
#!/bin/bash
# Test Makefile variable consolidation

echo "Testing Makefile targets..."

# Test help
make -C docker help > /dev/null || exit 1

# Test variable defaults
PORT=$(make -C docker -n run-local | grep -o "5001" | head -1)
if [ "$PORT" != "5001" ]; then
    echo "Error: PORT_LOCAL not set correctly"
    exit 1
fi

echo "✅ Makefile tests passed"
```

---

### 0.3: Python Configuration Module Enhancement (`docker/src/config.py`)

**Purpose**: Improve Python configuration validation and error reporting while maintaining existing behavior.

#### Current State Analysis

The existing `docker/src/config.py`:
- Uses `@dataclass` for configuration structure ✓
- Integrates with `ConfigResolver` for AWS resolution ✓
- Validates required environment variables ✓
- Provides clear error messages ✓

**Strengths to Preserve**:
- Clean dataclass design
- Integration with `ConfigResolver`
- Secrets-only mode support
- AWS-based configuration resolution

#### Design Decisions

**Enhancement Areas**:
1. Add validation helper methods
2. Improve error message formatting
3. Add configuration dump for debugging (with secrets masked)
4. Standardize field naming

**Enhanced Implementation**:
```python
# docker/src/config.py
import os
from dataclasses import dataclass, asdict
from typing import Dict, Any

from .config_resolver import ConfigResolver, ConfigResolverError


@dataclass
class Config:
    """Application configuration - production uses secrets-only mode.

    In production (ECS/Fargate):
        - Only requires QuiltStackARN and BenchlingSecret environment variables
        - All other configuration derived from AWS CloudFormation and Secrets Manager

    In tests:
        - ConfigResolver is mocked to return test data
        - No environment variables needed
    """

    # Flask configuration
    flask_env: str = ""
    log_level: str = ""

    # AWS configuration
    aws_region: str = ""

    # S3 configuration
    s3_bucket_name: str = ""
    s3_prefix: str = ""

    # Quilt configuration
    quilt_catalog: str = ""
    quilt_database: str = ""
    queue_arn: str = ""

    # Package configuration
    package_key: str = ""
    pkg_prefix: str = ""

    # Benchling configuration
    benchling_tenant: str = ""
    benchling_client_id: str = ""
    benchling_client_secret: str = ""
    benchling_app_definition_id: str = ""
    enable_webhook_verification: bool = True
    webhook_allow_list: str = ""

    def __post_init__(self):
        """Initialize configuration from AWS CloudFormation and Secrets Manager.

        Requires environment variables:
            - QuiltStackARN: CloudFormation stack ARN for Quilt infrastructure
            - BenchlingSecret: Secrets Manager secret name for Benchling credentials

        All other configuration is automatically resolved from AWS.
        """
        quilt_stack_arn = os.getenv("QuiltStackARN")
        benchling_secret = os.getenv("BenchlingSecret")

        # Validate required environment variables
        if not quilt_stack_arn or not benchling_secret:
            raise ValueError(self._format_missing_env_error())

        # Resolve all configuration from AWS
        try:
            resolver = ConfigResolver()
            resolved = resolver.resolve(quilt_stack_arn, benchling_secret)

            # Map resolved config to Config fields
            self._apply_resolved_config(resolved)
            self.flask_env = "production"

        except (ConfigResolverError, ValueError) as e:
            raise ValueError(f"Failed to resolve configuration from AWS: {str(e)}")

    def _format_missing_env_error(self) -> str:
        """Format error message for missing environment variables."""
        return (
            "Missing required environment variables: QuiltStackARN and BenchlingSecret\n"
            "\n"
            "Secrets-only mode requires exactly 2 environment variables:\n"
            "  - QuiltStackARN: CloudFormation stack ARN (e.g., arn:aws:cloudformation:...)\n"
            "  - BenchlingSecret: Secrets Manager secret name (e.g., benchling-webhook-prod)\n"
            "\n"
            "All other configuration is automatically resolved from AWS.\n"
        )

    def _apply_resolved_config(self, resolved):
        """Apply resolved configuration to Config fields."""
        self.aws_region = resolved.aws_region
        self.s3_bucket_name = resolved.user_bucket
        self.s3_prefix = resolved.pkg_prefix
        self.package_key = resolved.pkg_key
        self.quilt_catalog = resolved.quilt_catalog
        self.quilt_database = resolved.quilt_database
        self.queue_arn = resolved.queue_arn
        self.benchling_tenant = resolved.benchling_tenant
        self.benchling_client_id = resolved.benchling_client_id
        self.benchling_client_secret = resolved.benchling_client_secret
        self.benchling_app_definition_id = resolved.benchling_app_definition_id
        self.enable_webhook_verification = resolved.enable_webhook_verification
        self.webhook_allow_list = resolved.webhook_allow_list
        self.pkg_prefix = resolved.pkg_prefix
        self.log_level = resolved.log_level

    def validate_benchling_config(self) -> None:
        """Validate Benchling configuration fields.

        Raises:
            ValueError: If required Benchling fields are missing or invalid
        """
        errors = []

        if not self.benchling_tenant:
            errors.append("benchling_tenant is required")

        if not self.benchling_client_id:
            errors.append("benchling_client_id is required")

        if not self.benchling_client_secret:
            errors.append("benchling_client_secret is required")

        if errors:
            raise ValueError(
                "Benchling configuration validation failed:\n" +
                "\n".join(f"  - {err}" for err in errors)
            )

    def validate_s3_config(self) -> None:
        """Validate S3 configuration fields.

        Raises:
            ValueError: If required S3 fields are missing or invalid
        """
        errors = []

        if not self.s3_bucket_name:
            errors.append("s3_bucket_name is required")

        if not self.aws_region:
            errors.append("aws_region is required")

        if errors:
            raise ValueError(
                "S3 configuration validation failed:\n" +
                "\n".join(f"  - {err}" for err in errors)
            )

    def to_dict(self, mask_secrets: bool = True) -> Dict[str, Any]:
        """Convert configuration to dictionary.

        Args:
            mask_secrets: If True, mask sensitive fields (default: True)

        Returns:
            Dictionary representation of configuration
        """
        data = asdict(self)

        if mask_secrets:
            # Mask sensitive fields
            sensitive_fields = [
                "benchling_client_secret",
                "benchling_client_id",
            ]
            for field in sensitive_fields:
                if field in data and data[field]:
                    data[field] = "***MASKED***"

        return data

    def dump(self, mask_secrets: bool = True) -> str:
        """Generate human-readable configuration dump.

        Args:
            mask_secrets: If True, mask sensitive fields (default: True)

        Returns:
            Formatted configuration string
        """
        data = self.to_dict(mask_secrets=mask_secrets)
        lines = ["Configuration:"]

        # Group by category
        categories = {
            "AWS": ["aws_region", "s3_bucket_name", "queue_arn"],
            "Quilt": ["quilt_catalog", "quilt_database", "package_key", "pkg_prefix"],
            "Benchling": [
                "benchling_tenant",
                "benchling_client_id",
                "benchling_client_secret",
                "benchling_app_definition_id",
                "enable_webhook_verification",
            ],
            "Application": ["flask_env", "log_level"],
        }

        for category, fields in categories.items():
            lines.append(f"\n{category}:")
            for field in fields:
                if field in data:
                    value = data[field]
                    lines.append(f"  {field}: {value}")

        return "\n".join(lines)


def get_config() -> Config:
    """Get application configuration singleton."""
    return Config()
```

#### Testing Strategy

**Unit Tests** (`docker/tests/test_config.py`):
```python
import pytest
from unittest.mock import patch, MagicMock
from src.config import Config


def test_config_missing_env_vars():
    """Test error when required environment variables are missing."""
    with patch.dict('os.environ', {}, clear=True):
        with pytest.raises(ValueError, match="Missing required environment variables"):
            Config()


def test_config_validation_helpers():
    """Test configuration validation methods."""
    config = Config()
    config.benchling_tenant = "test"
    config.benchling_client_id = "id"
    config.benchling_client_secret = "secret"

    # Should not raise
    config.validate_benchling_config()

    # Test validation failure
    config.benchling_tenant = ""
    with pytest.raises(ValueError, match="benchling_tenant is required"):
        config.validate_benchling_config()


def test_config_to_dict_masks_secrets():
    """Test that to_dict masks sensitive fields."""
    config = Config()
    config.benchling_client_secret = "super-secret"

    data = config.to_dict(mask_secrets=True)
    assert data["benchling_client_secret"] == "***MASKED***"


def test_config_dump_formats_correctly():
    """Test configuration dump formatting."""
    config = Config()
    config.benchling_tenant = "test"
    config.aws_region = "us-east-1"

    dump = config.dump()
    assert "Configuration:" in dump
    assert "AWS:" in dump
    assert "Benchling:" in dump
    assert "benchling_tenant: test" in dump
```

---

## Integration Strategy

### Migration Path

**Step 1**: Create new modules alongside existing code
- Add `lib/config-reader.ts` without modifying existing files
- Add validation helpers to `docker/src/config.py`
- Update `docker/Makefile` with variable prefixes (backward compatible)

**Step 2**: Update consumers incrementally
- Replace `process.env` access in `bin/benchling-webhook.ts`
- Update `bin/commands/deploy.ts` to use `ConfigReader`
- Update tests to use new interfaces

**Step 3**: Validate backward compatibility
- Run full test suite
- Manual testing of common workflows
- Verify CLI commands work identically

### Rollback Plan

If issues arise:
1. Revert commits for specific deliverable (0.1, 0.2, or 0.3)
2. Each deliverable is independently revertible
3. No breaking changes to external interfaces

---

## Testing Strategy

### Unit Test Coverage

**TypeScript Tests**:
- `test/config-reader.test.ts` - ConfigReader module (100% coverage target)
- Update existing tests to use `ConfigReader` where applicable

**Python Tests**:
- `docker/tests/test_config.py` - Enhanced Config validation (100% coverage target)

### Integration Tests

**CDK Synthesis**:
- Verify stack synthesis with `ConfigReader`
- Test CLI commands with environment variables
- Validate error messages for missing configuration

**Docker/Python**:
- Test configuration resolution in container
- Verify validation helpers work correctly
- Test configuration dump output

### Manual Testing Checklist

- [ ] `npm run test` passes
- [ ] `make -C docker test-unit` passes
- [ ] `npx cdk synth` works with environment variables
- [ ] `make -C docker help` displays updated documentation
- [ ] CLI commands work: `npx ts-node bin/cli.ts deploy --help`
- [ ] Error messages are clear and actionable

---

## Documentation Updates

### Code Documentation

**TypeScript**:
- JSDoc comments for all public interfaces
- Usage examples in module headers
- Clear error messages with remediation steps

**Python**:
- Docstrings for all public methods
- Type hints for all parameters and return values
- Examples in class documentation

### Developer Documentation

**No changes to user-facing documentation** - Phase 0 is internal refactoring.

**Internal documentation updates**:
- Update `CLAUDE.md` to reference new configuration modules
- Add comments explaining Phase 0 changes
- Document future XDG integration points

---

## Risk Mitigation

### Identified Risks

**Risk: Breaking Existing Functionality**
- **Mitigation**: 100% backward compatibility requirement
- **Validation**: Comprehensive test suite, manual testing
- **Rollback**: Independent commits per deliverable

**Risk: Incomplete Refactoring**
- **Mitigation**: Clear scope definition (only configuration reading)
- **Validation**: Code review checklist
- **Rollback**: Phase can be abandoned without impact

**Risk: Test Coverage Gaps**
- **Mitigation**: 100% coverage target for new modules
- **Validation**: Coverage reports, mutation testing
- **Rollback**: Do not merge until coverage requirements met

### Contingency Plans

**If tests fail**:
1. Identify specific regression
2. Revert problematic commit
3. Fix issue in isolation
4. Re-test before re-integrating

**If refactoring scope creeps**:
1. Stop work on additional changes
2. Complete in-progress deliverables
3. Create new phase for additional work
4. Maintain Phase 0 focus

---

## Success Metrics

### Quantitative

- [ ] 100% of existing tests pass
- [ ] 100% code coverage for new modules
- [ ] Zero new linting errors
- [ ] All IDE diagnostics resolved
- [ ] Build time unchanged or improved

### Qualitative

- [ ] Configuration reading logic is clearly centralized
- [ ] Error messages are actionable
- [ ] Code is easier to understand for new developers
- [ ] Makefile documentation is comprehensive
- [ ] Python configuration validation is robust

---

## Next Steps

**After Phase 0 completion**:
1. Create Phase 1 design document (XDG infrastructure)
2. Begin implementation of XDG configuration storage
3. Integrate `ConfigReader` with XDG reading capability
4. Maintain backward compatibility with `.env` files

**Phase 0 → Phase 1 Handoff**:
- `ConfigReader` becomes the integration point for XDG
- Makefile variables support both `.env` and XDG
- Python configuration can read from XDG (via environment injection)

---

## Appendix

### File Structure

```
benchling-webhook/
├── lib/
│   ├── config-reader.ts          # NEW: Centralized config reading
│   └── utils/
│       ├── config.ts              # EXISTING: Config interfaces
│       ├── config-loader.ts       # UPDATE: Use ConfigReader
│       └── config-resolver.ts     # EXISTING: AWS resolution
├── docker/
│   ├── Makefile                   # UPDATE: Variable consolidation
│   └── src/
│       └── config.py              # ENHANCE: Validation helpers
└── test/
    ├── config-reader.test.ts      # NEW: ConfigReader tests
    └── ...
```

### Code Review Checklist

**For each deliverable**:
- [ ] All existing tests pass
- [ ] New tests achieve 100% coverage
- [ ] No changes to external interfaces
- [ ] Error messages are clear
- [ ] JSDoc/docstrings complete
- [ ] No hardcoded values
- [ ] Backward compatibility verified
- [ ] IDE diagnostics resolved

---

## Document Control

**Version**: 1.0
**Author**: Python Expert Agent
**Status**: Design Review
**Next Phase**: Episodes (06-phase0-episodes.md)
**Reviewers**: TBD
**Approval**: TBD
