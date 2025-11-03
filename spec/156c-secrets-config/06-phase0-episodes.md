# Phase 0 Episodes: Atomic Change Units

**Specification**: `spec/156c-secrets-config/03-specifications.md`
**Phases Plan**: `spec/156c-secrets-config/04-phases.md`
**Design**: `spec/156c-secrets-config/05-phase0-design.md`
**Phase**: Phase 0 - Configuration Refactoring
**Status**: Episodes Definition
**Last Updated**: 2025-11-02

---

## Overview

This document defines atomic change units (episodes) for Phase 0 implementation. Each episode represents a single, testable, committable change focused on XDG-compliant configuration management.

### Episode Principles

1. **Atomic**: Single responsibility, one logical change
2. **Testable**: Clear success criteria with automated tests
3. **Committable**: Can be merged independently without breaking functionality
4. **Sequential**: Builds on previous episodes, maintains working state
5. **TDD Cycle**: Red → Green → Refactor for each episode

### Phase 0 Structure

Phase 0 has three main deliverables, each broken into atomic episodes:

- **0.1**: XDG Configuration File Management (npm/TypeScript) - 4 episodes
- **0.2**: CLI Configuration Inference - 3 episodes
- **0.3**: Authentication and Validation - 3 episodes

**Total**: 10 atomic episodes

---

## Deliverable 0.1: XDG Configuration File Management

**Goal**: Implement three-file XDG configuration model with clear separation of user, derived, and deployment configurations.

### Episode 0.1.1: Create XDG Configuration Structure

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: None

#### Description

Define the configuration file structure for XDG-compliant configuration management.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("XDGConfig", () => {
    it("should define configuration file paths", () => {
        const paths = XDGConfig.getPaths();
        expect(paths).toEqual({
            userConfig: expandHomeDir("~/.config/benchling-webhook/default.json"),
            derivedConfig: expandHomeDir("~/.config/benchling-webhook/config/default.json"),
            deployConfig: expandHomeDir("~/.config/benchling-webhook/deploy/default.json")
        });
    });

    it("should create config directory if not exists", () => {
        const configDir = expandHomeDir("~/.config/benchling-webhook");
        expect(() => XDGConfig.ensureDirectories()).not.toThrow();
        expect(fs.existsSync(configDir)).toBe(true);
    });
});
```

**Green** (Implementation):
- Create `lib/xdg-config.ts`
- Implement `XDGConfig` class with configuration paths
- Add methods to ensure directories exist
- Use `fs` and `path` for path resolution

**Refactor**:
- Add error handling
- Ensure cross-platform compatibility
- Add comprehensive documentation

#### Success Criteria

- [ ] `XDGConfig` class with configuration paths defined
- [ ] Methods to create configuration directories
- [ ] Supports expanding home directory
- [ ] Works across different platforms
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- xdg-config.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement XDG configuration file structure

- Define configuration file paths for user, derived, and deployment configs
- Support cross-platform home directory expansion
- Ensure configuration directories exist
- Prepare for three-file configuration model

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.2: Implement Configuration File Reading

**Status**: Pending
**Duration**: 25 minutes
**Dependencies**: Episode 0.1.1

#### Description

Implement methods to read and parse configuration files with type safety and error handling.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("XDGConfig.readConfig", () => {
    it("should read user configuration file", () => {
        const config = XDGConfig.readConfig("user");
        expect(config).toMatchSchema(ConfigSchema);
    });

    it("should handle missing user configuration file", () => {
        // Temporarily remove user config
        expect(() => XDGConfig.readConfig("user")).toThrow("Configuration file not found");
    });

    it("should validate configuration schema", () => {
        const invalidConfig = { /* incomplete config */ };
        expect(() => XDGConfig.readConfig("user", invalidConfig))
            .toThrow("Invalid configuration schema");
    });
});
```

**Green** (Implementation):
- Add `readConfig` method to `XDGConfig`
- Implement JSON parsing with schema validation
- Support reading user, derived, and deployment configs
- Add error handling for missing or invalid files

**Refactor**:
- Use `ajv` for JSON schema validation
- Improve error messages
- Add logging for configuration reads

#### Success Criteria

- [ ] Read configuration from different config types
- [ ] Validate configuration against schema
- [ ] Handle missing configuration files
- [ ] Descriptive error messages
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- xdg-config.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement configuration file reading

- Add methods to read XDG configuration files
- Support user, derived, and deployment configs
- Implement JSON schema validation
- Improve error handling for missing/invalid configs

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.3: Implement Configuration Writing

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.1.2

#### Description

Implement methods to write configuration files with atomic write and backup.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("XDGConfig.writeConfig", () => {
    it("should write configuration file atomically", () => {
        const config = { /* valid config */ };
        XDGConfig.writeConfig("user", config);
        const writtenConfig = XDGConfig.readConfig("user");
        expect(writtenConfig).toEqual(config);
    });

    it("should create backup before overwriting", () => {
        const originalConfig = XDGConfig.readConfig("user");
        const newConfig = { /* modified config */ };
        XDGConfig.writeConfig("user", newConfig);

        const backupPath = XDGConfig.getBackupPath("user");
        expect(fs.existsSync(backupPath)).toBe(true);
        expect(XDGConfig.readConfig("user")).toEqual(newConfig);
    });

    it("should prevent writing invalid configuration", () => {
        const invalidConfig = { /* invalid config */ };
        expect(() => XDGConfig.writeConfig("user", invalidConfig))
            .toThrow("Invalid configuration schema");
    });
});
```

**Green** (Implementation):
- Add `writeConfig` method to `XDGConfig`
- Implement atomic write with backup
- Add schema validation before writing
- Support writing to user, derived, and deployment configs

**Refactor**:
- Use temporary file and rename for atomic write
- Improve backup management
- Add logging for configuration writes

#### Success Criteria

- [ ] Write configuration files atomically
- [ ] Create backups before overwriting
- [ ] Validate configuration before writing
- [ ] Support different config types
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- xdg-config.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement atomic configuration file writing

- Add methods to write XDG configuration files
- Support atomic write with backup
- Implement schema validation before writing
- Improve configuration file management

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.1.4: Merge Configuration Sources

**Status**: Pending
**Duration**: 25 minutes
**Dependencies**: Episode 0.1.3

#### Description

Implement configuration merging logic to combine user, derived, and deployment configurations.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("XDGConfig.mergeConfigs", () => {
    it("should merge configurations with correct precedence", () => {
        const userConfig = { /* user settings */ };
        const derivedConfig = { /* derived settings */ };
        const deployConfig = { /* deployment settings */ };

        const mergedConfig = XDGConfig.mergeConfigs({
            user: userConfig,
            derived: derivedConfig,
            deploy: deployConfig
        });

        expect(mergedConfig).toEqual({
            // Expected merged configuration
        });
    });

    it("should override configurations in correct order", () => {
        const configs = {
            user: { logLevel: "INFO" },
            derived: { logLevel: "DEBUG" },
            deploy: { logLevel: "ERROR" }
        };

        const mergedConfig = XDGConfig.mergeConfigs(configs);
        expect(mergedConfig.logLevel).toBe("ERROR");
    });

    it("should handle partial configurations", () => {
        const configs = {
            user: { tenant: "test" },
            derived: {},
            deploy: { region: "us-east-1" }
        };

        const mergedConfig = XDGConfig.mergeConfigs(configs);
        expect(mergedConfig).toEqual({
            tenant: "test",
            region: "us-east-1"
        });
    });
});
```

**Green** (Implementation):
- Add `mergeConfigs` method to `XDGConfig`
- Implement deep merge with priority order
- Handle partial configurations
- Validate merged configuration schema

**Refactor**:
- Use lodash for deep merge
- Add comprehensive type definitions
- Improve merge algorithm

#### Success Criteria

- [ ] Merge configurations from different sources
- [ ] Respect configuration precedence
- [ ] Handle partial configurations
- [ ] Validate merged configuration
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- xdg-config.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement configuration merging logic

- Add method to merge user, derived, and deployment configs
- Implement configuration precedence rules
- Support partial configuration merging
- Validate merged configuration schema

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

## Deliverable 0.2: CLI Configuration Inference

**Goal**: Use Quilt3 CLI to infer configuration details with minimal user interaction.

### Episode 0.2.1: Implement Quilt Catalog Configuration Inference

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.1.4

#### Description

Use `quilt3 config` command to automatically infer catalog and S3 configuration.

#### TDD Cycle

**Red** (Failing Tests):
```typescript
describe("QuiltConfigResolver", () => {
    it("should infer configuration from quilt3 CLI", async () => {
        const result = await QuiltConfigResolver.resolve();
        expect(result).toEqual({
            catalogUrl: "https://quilt.example.com",
            userBucket: "my-user-bucket",
            defaultRegion: "us-west-2"
        });
    });

    it("should throw error if quilt3 config is not available", async () => {
        // Simulate missing quilt3 configuration
        await expect(QuiltConfigResolver.resolve())
            .rejects.toThrow("Quilt configuration not found");
    });

    it("should support manual override of inferred configuration", async () => {
        const manualConfig = {
            catalogUrl: "https://custom.quilt.com",
            userBucket: "override-bucket"
        };
        const result = await QuiltConfigResolver.resolve(manualConfig);
        expect(result.catalogUrl).toBe("https://custom.quilt.com");
    });
});
```

**Green** (Implementation):
- Create `QuiltConfigResolver` class
- Implement CLI command execution
- Parse Quilt configuration
- Add manual configuration override support

**Refactor**:
- Use `execa` for CLI command execution
- Add robust error handling
- Improve type definitions

#### Success Criteria

- [ ] Infer configuration from Quilt3 CLI
- [ ] Support manual configuration override
- [ ] Handle missing configuration
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- quilt-config-resolver.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement Quilt configuration inference

- Add QuiltConfigResolver to infer configuration via quilt3 CLI
- Support automatic catalog and S3 bucket detection
- Allow manual configuration override
- Improve configuration discovery process

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.2.2: Interactive Configuration Completion

**Status**: Pending
**Duration**: 25 minutes
**Dependencies**: Episode 0.2.1

#### Description

Create interactive CLI prompts to complete missing configuration details.

#### TDD Cycle

**Red** (Integration Tests):
```typescript
describe("ConfigurationWizard", () => {
    it("should prompt for missing Benchling credentials", async () => {
        const result = await ConfigurationWizard.run({
            partialConfig: { catalogUrl: "https://quilt.example.com" }
        });
        expect(result).toEqual({
            benchlingTenant: "expected-tenant",
            benchlingClientId: "expected-client-id"
        });
    });

    it("should validate Benchling authentication during wizard", async () => {
        await expect(ConfigurationWizard.run({
            partialConfig: { benchlingClientSecret: "invalid-secret" }
        })).rejects.toThrow("Benchling authentication failed");
    });
});
```

**Green** (Implementation):
- Create `ConfigurationWizard` class
- Implement interactive prompts using `inquirer`
- Add Benchling authentication validation
- Support partial configuration completion

**Refactor**:
- Improve validation logic
- Add comprehensive error handling
- Create reusable validation methods

#### Success Criteria

- [ ] Interactive configuration wizard
- [ ] Complete partial configurations
- [ ] Validate Benchling credentials
- [ ] Handle authentication failures
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- configuration-wizard.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): add interactive configuration wizard

- Implement ConfigurationWizard for completing partial configs
- Add interactive CLI prompts for missing details
- Validate Benchling authentication during configuration
- Improve user experience for configuration setup

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.2.3: Save Inferred Configuration

**Status**: Pending
**Duration**: 15 minutes
**Dependencies**: Episode 0.2.2

#### Description

Save inferred and completed configuration to XDG files.

#### TDD Cycle

**Red** (Integration Tests):
```typescript
describe("ConfigurationSaver", () => {
    it("should save complete configuration to user config", async () => {
        const config = await ConfigurationSaver.save({
            catalogUrl: "https://quilt.example.com",
            benchlingTenant: "test-tenant",
            benchlingClientId: "client-id"
        });

        const savedConfig = XDGConfig.readConfig("user");
        expect(savedConfig).toEqual(config);
    });

    it("should update derived configuration with inferred values", async () => {
        const config = await ConfigurationSaver.save({
            // Partial configuration
        });

        const derivedConfig = XDGConfig.readConfig("derived");
        expect(derivedConfig).toHaveProperty("inferredAt");
    });
});
```

**Green** (Implementation):
- Create `ConfigurationSaver` class
- Implement save methods for user and derived configs
- Add timestamp and source tracking
- Ensure configuration validation

**Refactor**:
- Improve error handling
- Add logging for configuration saves
- Create comprehensive validation

#### Success Criteria

- [ ] Save complete configuration
- [ ] Update derived configuration
- [ ] Track configuration source and timestamp
- [ ] Validate before saving
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- configuration-saver.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement configuration persistence

- Add ConfigurationSaver to save inferred configurations
- Update user and derived configuration files
- Track configuration source and timestamp
- Ensure configuration validation before saving

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

## Deliverable 0.3: Authentication and Validation

**Goal**: Implement robust configuration validation and authentication checks.

### Episode 0.3.1: Benchling Authentication Validation

**Status**: Pending
**Duration**: 25 minutes
**Dependencies**: Episode 0.2.3

#### Description

Implement Benchling authentication validation with comprehensive checks.

#### TDD Cycle

**Red** (Validation Tests):
```typescript
describe("BenchlingAuthValidator", () => {
    it("should validate Benchling credentials successfully", async () => {
        const result = await BenchlingAuthValidator.validate({
            tenant: "test-tenant",
            clientId: "valid-client-id",
            clientSecret: "valid-secret"
        });
        expect(result.isValid).toBe(true);
    });

    it("should detect invalid Benchling credentials", async () => {
        const result = await BenchlingAuthValidator.validate({
            tenant: "test-tenant",
            clientId: "invalid-client-id",
            clientSecret: "wrong-secret"
        });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Invalid client credentials");
    });

    it("should validate tenant and app permissions", async () => {
        const result = await BenchlingAuthValidator.validate({
            tenant: "test-tenant",
            clientId: "limited-permissions-client"
        });
        expect(result.hasRequiredPermissions).toBe(false);
    });
});
```

**Green** (Implementation):
- Create `BenchlingAuthValidator` class
- Implement Benchling API token validation
- Check tenant and app-level permissions
- Provide detailed validation results

**Refactor**:
- Use official Benchling API client
- Improve error message generation
- Add comprehensive permission checks

#### Success Criteria

- [ ] Validate Benchling credentials
- [ ] Check tenant and app permissions
- [ ] Provide detailed validation results
- [ ] Handle various error scenarios
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- benchling-auth-validator.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(auth): implement Benchling authentication validation

- Add BenchlingAuthValidator for credential verification
- Check tenant and app-level permissions
- Provide comprehensive authentication validation
- Improve security and configuration integrity

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.3.2: S3 Bucket Access Validation

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.3.1

#### Description

Validate S3 bucket access and configuration with comprehensive checks.

#### TDD Cycle

**Red** (Validation Tests):
```typescript
describe("S3BucketValidator", () => {
    it("should validate S3 bucket access successfully", async () => {
        const result = await S3BucketValidator.validate({
            bucketName: "valid-test-bucket",
            region: "us-west-2"
        });
        expect(result.hasAccess).toBe(true);
    });

    it("should detect insufficient S3 bucket permissions", async () => {
        const result = await S3BucketValidator.validate({
            bucketName: "restricted-bucket",
            region: "us-east-1"
        });
        expect(result.hasAccess).toBe(false);
        expect(result.errors).toContain("Insufficient write permissions");
    });

    it("should validate bucket configuration", async () => {
        const result = await S3BucketValidator.validate({
            bucketName: "misconfigured-bucket"
        });
        expect(result.isConfigured).toBe(false);
        expect(result.errors).toContain("Missing lifecycle configuration");
    });
});
```

**Green** (Implementation):
- Create `S3BucketValidator` class
- Implement S3 access and permission checks
- Validate bucket configuration
- Provide detailed validation results

**Refactor**:
- Use AWS SDK for comprehensive checks
- Improve error message generation
- Add nuanced permission validation

#### Success Criteria

- [ ] Validate S3 bucket access
- [ ] Check bucket permissions
- [ ] Validate bucket configuration
- [ ] Provide detailed validation results
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- s3-bucket-validator.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement S3 bucket access validation

- Add S3BucketValidator for bucket access checks
- Validate S3 bucket permissions and configuration
- Provide comprehensive access validation
- Improve configuration reliability

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

### Episode 0.3.3: Comprehensive Configuration Validation

**Status**: Pending
**Duration**: 20 minutes
**Dependencies**: Episode 0.3.2

#### Description

Create a comprehensive configuration validation process that combines all validation checks.

#### TDD Cycle

**Red** (Integration Tests):
```typescript
describe("ConfigurationValidator", () => {
    it("should validate complete configuration", async () => {
        const config = {
            catalogUrl: "https://quilt.example.com",
            benchling: {
                tenant: "test-tenant",
                clientId: "valid-client-id"
            },
            s3: {
                bucketName: "test-bucket",
                region: "us-west-2"
            }
        };

        const result = await ConfigurationValidator.validate(config);
        expect(result.isValid).toBe(true);
    });

    it("should fail validation with multiple errors", async () => {
        const config = {
            catalogUrl: null,
            benchling: {
                tenant: "",
                clientId: "invalid-client"
            },
            s3: {
                bucketName: "inaccessible-bucket"
            }
        };

        const result = await ConfigurationValidator.validate(config);
        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(3);
        expect(result.errors).toContain("Invalid catalog URL");
        expect(result.errors).toContain("Invalid Benchling tenant");
        expect(result.errors).toContain("S3 bucket access denied");
    });
});
```

**Green** (Implementation):
- Create `ConfigurationValidator` class
- Combine Benchling and S3 validation checks
- Provide comprehensive configuration validation
- Generate detailed error reports

**Refactor**:
- Improve error aggregation
- Create modular validation approach
- Add configuration-level sanity checks

#### Success Criteria

- [ ] Validate entire configuration
- [ ] Combine multiple validation checks
- [ ] Generate comprehensive error reports
- [ ] Support partial configuration validation
- [ ] All tests pass
- [ ] TypeScript compilation succeeds
- [ ] No linting errors

#### Validation Commands

```bash
npm run test:ts -- configuration-validator.test.ts
npm run typecheck
npm run lint
```

#### Commit Message

```
feat(config): implement comprehensive configuration validation

- Add ConfigurationValidator to validate entire configuration
- Combine Benchling and S3 validation checks
- Generate detailed error reports
- Improve configuration integrity and reliability

Ref: spec/156c-secrets-config/05-phase0-design.md
Issue: #156
```

---

## Episode Sequencing Strategy

### Parallel Execution Opportunities

Some episodes can be executed in parallel:

**Parallel Group 1** (can start immediately):
- Episode 0.1.1: XDG Configuration Structure
- Episode 0.2.1: Quilt Catalog Configuration Inference

**Parallel Group 2** (after Group 1):
- Episode 0.1.2: Configuration File Reading
- Episode 0.2.2: Interactive Configuration Completion

**Sequential Path** (must be sequential):
- 0.1.1 → 0.1.2 → 0.1.3 → 0.1.4
- 0.2.1 → 0.2.2 → 0.2.3
- 0.3.1 → 0.3.2 → 0.3.3

### Recommended Execution Order

For a single developer working sequentially:

1. **Week 1 - Core Infrastructure**:
   - Day 1-2: Deliverable 0.1 (XDG Configuration Management)
   - Day 3: Deliverable 0.2 (CLI Configuration Inference)

2. **Week 2 - Validation and Testing**:
   - Day 4-5: Deliverable 0.3 (Authentication and Validation)
   - Day 6: Full integration testing and documentation

### Integration Testing Strategy

**After Each Deliverable**:

**After 0.1 (XDG Configuration Management)**:
```bash
npm run test
npm run typecheck
npm run lint
```

**After 0.2 (CLI Configuration Inference)**:
```bash
npm run test
npm run lint
npx ts-node bin/cli.ts config --help
```

**After 0.3 (Authentication and Validation)**:
```bash
npm run test
npm run typecheck
npm run lint
```

### Full Phase 0 Integration Test

After all episodes complete:

```bash
# TypeScript tests
npm run test
npm run typecheck
npm run lint

# CLI validation
npx ts-node bin/cli.ts config --help
npx ts-node bin/cli.ts config validate

# Verification
git diff main --stat  # Review changes
```

### Rollback Strategy

Each episode is independently revertible:

```bash
# Revert last commit (episode)
git revert HEAD

# Revert specific episode
git revert <commit-hash>
```

### Next Steps

After Phase 0 episodes complete:

1. **Create Phase 0 Checklist**: `07-phase0-checklist.md`
2. **Begin Implementation**: Execute episodes in sequence
3. **Track Progress**: Update checklist after each episode
4. **Integration Testing**: Validate after each deliverable
5. **Review**: Document lessons learned

---

## Document Control

**Version**: 1.1
**Author**: Business Analyst Agent
**Status**: Episodes Definition (Revised)
**Next Document**: `07-phase0-checklist.md`
**Implementation**: Ready to begin
**Estimated Duration**: 4 hours (10 episodes)