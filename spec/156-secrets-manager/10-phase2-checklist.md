# Phase 2 Checklist: CLI Parameter Addition

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-31
**Phase**: DECO - Checklist (Phase 2)

## Overview

This checklist provides granular, trackable tasks for implementing Phase 2: CLI Parameter Addition. Each task maps to episodes defined in [09-phase2-episodes.md](./09-phase2-episodes.md) and follows the design in [08-phase2-design.md](./08-phase2-design.md).

**Purpose**: Ensure all requirements met, tests written, and quality gates passed.

**Usage**: Check off items as completed. Each item should be independently verifiable.

## Pre-Implementation Setup

### Environment Preparation

- [ ] Verify Phase 1 is complete and merged
- [ ] Pull latest changes from main branch
- [ ] Create new branch for Phase 2 implementation
- [ ] Verify all tests pass on clean branch
- [ ] Verify Phase 1 validation functions available at `/Users/ernest/GitHub/benchling-webhook/lib/utils/secrets.ts`
- [ ] Review Phase 2 design document completely
- [ ] Review Phase 2 episodes document completely
- [ ] Set up test coverage reporting
- [ ] Verify development environment ready

### Dependencies Verification

- [ ] Verify `commander` package available (for CLI)
- [ ] Verify `chalk` package available (for colors)
- [ ] Verify `ora` package available (for spinners)
- [ ] Verify `jest` configured for TypeScript
- [ ] Verify `@types/node` includes fs and path types
- [ ] Verify existing test infrastructure works

## Episode 1: File Input Processing Function

### Tests (RED Phase)

- [ ] Create test file `lib/utils/config.test.ts` if not exists
- [ ] Test: Should return trimmed ARN string unchanged
- [ ] Test: Should return trimmed JSON string unchanged
- [ ] Test: Should read file content when input starts with @
- [ ] Test: Should throw error when @file not found with clear message
- [ ] Test: Should throw error when file not readable
- [ ] Test: Should handle relative file paths correctly
- [ ] Test: Should handle absolute file paths correctly
- [ ] Test: Should trim whitespace from file content
- [ ] Test: Should include resolved path in error messages
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests with message: "test(config): add tests for file input processing"

### Implementation (GREEN Phase)

- [ ] Open `lib/utils/config.ts`
- [ ] Add import: `import { readFileSync } from "fs"`
- [ ] Add import: `import { resolve } from "path"` (if not present)
- [ ] Add function `processBenchlingSecretsInput(input: string): string` after `loadDotenv()`
- [ ] Implement @ prefix detection with `input.trim().startsWith("@")`
- [ ] Implement file path extraction with `.slice(1)`
- [ ] Implement path resolution with `resolve(filePath)`
- [ ] Implement file existence check with `existsSync(resolvedPath)`
- [ ] Implement error handling for file not found with clear message including resolved path
- [ ] Implement file reading with `readFileSync(resolvedPath, "utf-8")`
- [ ] Implement error handling for read errors with clear message
- [ ] Implement passthrough for non-@ inputs with trimming
- [ ] Run tests and verify they PASS
- [ ] Verify test coverage >90% for new function

### Refactoring (REFACTOR Phase)

- [ ] Add JSDoc comment to `processBenchlingSecretsInput()`
- [ ] Document parameters: `@param input - The benchling-secrets value (ARN, JSON, or @filepath)`
- [ ] Document return: `@returns Processed secret string`
- [ ] Document errors: `@throws Error if file not found or not readable`
- [ ] Add usage example in JSDoc
- [ ] Review error messages for clarity
- [ ] Review code for readability improvements
- [ ] Run `make lint` and fix any issues
- [ ] Run `make test` and verify all pass
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All tests pass (unit tests for file processing)
- [ ] Coverage >90% for `processBenchlingSecretsInput()`
- [ ] TypeScript compiles without errors
- [ ] ESLint passes without warnings
- [ ] Error messages are clear and actionable
- [ ] Function handles all input types correctly
- [ ] Edge cases covered (empty string, null, whitespace)

### Commit

- [ ] Stage changes: `git add lib/utils/config.ts lib/utils/config.test.ts`
- [ ] Commit with message from episode 1
- [ ] Verify commit includes all necessary changes
- [ ] Push to remote branch

---

## Episode 2: Configuration Options Interface Update

### Tests (RED Phase)

- [ ] Open or create `lib/utils/config.test.ts`
- [ ] Test: TypeScript should compile with `benchlingSecrets` in `ConfigOptions`
- [ ] Test: `loadConfigSync()` should accept `benchlingSecrets` in options parameter
- [ ] Test: `loadConfigSync()` should return `benchlingSecrets` in result
- [ ] Test: Priority - CLI option should override environment variable
- [ ] Test: Priority - Environment variable should override .env file
- [ ] Run tests and verify type-level tests work

### Implementation (GREEN Phase)

- [ ] Open `lib/utils/config.ts`
- [ ] Locate `ConfigOptions` interface (around line 41)
- [ ] Verify `benchlingSecrets?: string` exists in interface
- [ ] If missing, add `benchlingSecrets?: string` field
- [ ] Locate `Config` interface (around line 7)
- [ ] Verify `benchlingSecrets?: string` exists in interface (should be line 20)
- [ ] Verify field ordering is consistent with other Benchling fields
- [ ] Run TypeScript compiler and verify no errors

### Refactoring (REFACTOR Phase)

- [ ] Add JSDoc comment to `benchlingSecrets` field if missing
- [ ] Ensure consistent formatting with other fields
- [ ] Review interface documentation for completeness
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] TypeScript compiles without errors
- [ ] Interface properly exported
- [ ] Tests verify type safety
- [ ] Documentation clear and complete
- [ ] No breaking changes to existing code

### Commit

- [ ] Stage changes: `git add lib/utils/config.ts lib/utils/config.test.ts`
- [ ] Commit with message from episode 2
- [ ] Push to remote branch

---

## Episode 3: Configuration Loading with File Processing

### Tests (RED Phase)

- [ ] Open `lib/utils/config.test.ts`
- [ ] Test: Should process @file syntax in CLI option
- [ ] Test: Should process @file syntax in environment variable
- [ ] Test: Should process @file syntax in .env file
- [ ] Test: Should pass through ARN without modification
- [ ] Test: Should pass through JSON without modification
- [ ] Test: Should throw error for missing @file
- [ ] Test: Priority - CLI option beats environment variable
- [ ] Test: Priority - Environment variable beats .env file
- [ ] Test: Should return undefined when no secrets provided
- [ ] Create test fixtures: sample secrets.json file for tests
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `lib/utils/config.ts`
- [ ] Locate `loadConfigSync()` function (around line 120)
- [ ] Find benchlingSecrets loading line (around line 145)
- [ ] Modify to extract raw value first: `const rawSecrets = options.benchlingSecrets || envVars.BENCHLING_SECRETS`
- [ ] Modify to process value: `benchlingSecrets: rawSecrets ? processBenchlingSecretsInput(rawSecrets) : undefined`
- [ ] Verify change maintains priority chain
- [ ] Run tests and verify they PASS
- [ ] Verify existing tests still pass

### Refactoring (REFACTOR Phase)

- [ ] Add comment explaining file processing step
- [ ] Consider extracting to local variable for clarity
- [ ] Ensure error handling preserves context
- [ ] Review surrounding code for consistency
- [ ] Run `make lint` and fix any issues
- [ ] Run `make test` and verify all pass
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All new tests pass
- [ ] All existing tests still pass
- [ ] Priority chain works correctly
- [ ] File syntax processed in all sources (CLI, env, .env)
- [ ] Error messages clear when file missing
- [ ] No regression in existing functionality

### Commit

- [ ] Stage changes: `git add lib/utils/config.ts lib/utils/config.test.ts`
- [ ] Commit with message from episode 3
- [ ] Push to remote branch

---

## Episode 4: CLI Option Declaration

### Tests (RED Phase)

- [ ] Create test file `bin/cli.test.ts` if not exists
- [ ] Set up test harness for CLI testing (commander.js)
- [ ] Test: Deploy command should parse --benchling-secrets option
- [ ] Test: Option value should be passed to deploy function
- [ ] Test: Help text should list --benchling-secrets option
- [ ] Test: Option should accept string values
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/cli.ts`
- [ ] Locate deploy command options (around line 26)
- [ ] Add new option after line 31: `.option("--benchling-secrets <value>", "Benchling secrets configuration (ARN, JSON, or @file)")`
- [ ] Update existing secret options with "(deprecated, use --benchling-secrets)":
  - [ ] Update --tenant description (line 28)
  - [ ] Update --client-id description (line 29)
  - [ ] Update --client-secret description (line 30)
  - [ ] Update --app-id description (line 31)
- [ ] Verify option placement is logical (group with Benchling options)
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Review option descriptions for clarity
- [ ] Ensure consistent formatting with other options
- [ ] Verify option order is logical
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] CLI parser accepts --benchling-secrets option
- [ ] Option value correctly passed to deploy command handler
- [ ] Help text displays option correctly
- [ ] Deprecated markers on old options
- [ ] TypeScript types updated if needed
- [ ] No breaking changes to existing options

### Commit

- [ ] Stage changes: `git add bin/cli.ts bin/cli.test.ts`
- [ ] Commit with message from episode 4
- [ ] Push to remote branch

---

## Episode 5: CLI Help Text Enhancement

### Tests (RED Phase)

- [ ] Open `bin/cli.test.ts`
- [ ] Test: Help output should include "Examples:" section
- [ ] Test: Examples should show ARN usage
- [ ] Test: Examples should show JSON usage
- [ ] Test: Examples should show file usage with @ syntax
- [ ] Test: Examples should show environment variable usage
- [ ] Test: Help should include documentation link
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/cli.ts`
- [ ] Locate deploy command after option definitions (after line 38)
- [ ] Add `.addHelpText('after', ...)` call with examples
- [ ] Include ARN example with realistic format
- [ ] Include inline JSON example with proper quoting
- [ ] Include @file example
- [ ] Include environment variable example
- [ ] Add documentation link
- [ ] Verify formatting (indentation, line breaks)
- [ ] Test help output: `npx ts-node bin/cli.ts deploy --help`
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Ensure examples are copy-pasteable
- [ ] Verify line lengths are reasonable
- [ ] Check formatting consistency
- [ ] Verify all examples are accurate
- [ ] Test help display in terminal
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] Help text displays correctly
- [ ] Examples are clear and accurate
- [ ] All input methods documented
- [ ] Link is valid
- [ ] Formatting is consistent
- [ ] Examples tested manually

### Commit

- [ ] Stage changes: `git add bin/cli.ts bin/cli.test.ts`
- [ ] Commit with message from episode 5
- [ ] Push to remote branch

---

## Episode 6: ARN Masking Utility Function

### Tests (RED Phase)

- [ ] Create test file `bin/commands/deploy.test.ts` if not exists
- [ ] Test: Should mask account ID in valid ARN
- [ ] Test: Should show last 4 digits of account ID
- [ ] Test: Should preserve region in ARN
- [ ] Test: Should preserve secret name in ARN
- [ ] Test: Should return input unchanged for invalid ARN format
- [ ] Test: Should handle empty string gracefully
- [ ] Test: Should handle malformed ARN gracefully
- [ ] Test: Masked format should be `arn:aws:secretsmanager:region:****1234:secret:name`
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/commands/deploy.ts`
- [ ] Add `maskArn(arn: string): string` function at end of file
- [ ] Implement ARN pattern matching: `/^(arn:aws:secretsmanager:[^:]+:)(\d{12})(:.+)$/`
- [ ] Extract prefix, account, suffix from match
- [ ] Create masked account: `"****" + account.slice(-4)`
- [ ] Return reconstructed ARN with masked account
- [ ] Return original input if no match
- [ ] Run tests and verify they PASS
- [ ] Verify coverage >90%

### Refactoring (REFACTOR Phase)

- [ ] Add JSDoc comment to `maskArn()`
- [ ] Document purpose: "Mask sensitive parts of ARN for display"
- [ ] Add parameter documentation
- [ ] Add return value documentation
- [ ] Add example in JSDoc
- [ ] Review regex for clarity
- [ ] Consider extracting regex to constant
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All tests pass
- [ ] Account ID properly masked
- [ ] Region and secret name preserved
- [ ] Invalid input handled gracefully
- [ ] Coverage >90%
- [ ] Function is pure (no side effects)

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts bin/commands/deploy.test.ts`
- [ ] Commit with message from episode 6
- [ ] Push to remote branch

---

## Episode 7: Secret Validation Integration

### Tests (RED Phase)

- [ ] Open `bin/commands/deploy.test.ts`
- [ ] Test: Should validate ARN format using Phase 1 functions
- [ ] Test: Should validate JSON structure using Phase 1 functions
- [ ] Test: Should display formatted error for invalid ARN
- [ ] Test: Should display formatted error for invalid JSON
- [ ] Test: Should display format help text on error
- [ ] Test: Should exit with code 1 on validation failure
- [ ] Test: Should continue deployment on validation success
- [ ] Test: Should use spinner for validation status
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/commands/deploy.ts`
- [ ] Add imports at top:
  - [ ] `import { parseAndValidateSecrets, SecretsValidationError } from "../../lib/utils/secrets"`
- [ ] Locate configuration loading section (after line 48)
- [ ] Add validation block BEFORE existing config validation (before line 51)
- [ ] Check if `config.benchlingSecrets` exists
- [ ] If exists, call `parseAndValidateSecrets(config.benchlingSecrets)`
- [ ] Wrap in try-catch block
- [ ] On success: store result, continue
- [ ] On error: check if `SecretsValidationError`
- [ ] If `SecretsValidationError`: display with `error.formatForCLI()`
- [ ] Add format help text after error
- [ ] Call `process.exit(1)` on error
- [ ] Use spinner for status updates
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Consider extracting validation to helper function
- [ ] Review error message formatting
- [ ] Ensure consistent use of chalk for colors
- [ ] Verify spinner states (start, succeed, fail)
- [ ] Add comments explaining validation flow
- [ ] Run `make lint` and fix any issues
- [ ] Run `make test` and verify all pass
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] Validation runs before CDK deployment
- [ ] Invalid secrets block deployment
- [ ] Error messages use `SecretsValidationError.formatForCLI()`
- [ ] Format help displayed on error
- [ ] Tests verify all error scenarios
- [ ] No regression in existing validation

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts bin/commands/deploy.test.ts`
- [ ] Commit with message from episode 7
- [ ] Push to remote branch

---

## Episode 8: Deprecation Warning Display

### Tests (RED Phase)

- [ ] Open `bin/commands/deploy.test.ts`
- [ ] Test: Should show warning when both new and old params present
- [ ] Test: Should NOT show warning when only new param present
- [ ] Test: Should NOT show warning when only old params present
- [ ] Test: Should clear old params from config when new param present
- [ ] Test: Warning should include "DEPRECATION WARNING" text
- [ ] Test: Warning should include migration guide link
- [ ] Test: Warning should use chalk.yellow for visibility
- [ ] Test: Old params should be set to undefined after warning
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/commands/deploy.ts`
- [ ] Locate validation block created in Episode 7
- [ ] After successful validation, check for old parameters:
  - [ ] Check `config.benchlingTenant`
  - [ ] Check `config.benchlingClientId`
  - [ ] Check `config.benchlingClientSecret`
- [ ] If any old params present:
  - [ ] Call `spinner.warn()` with message
  - [ ] Display warning with `chalk.yellow()`
  - [ ] Include "DEPRECATION WARNING:" header
  - [ ] Explain individual parameters are deprecated
  - [ ] Explain new parameter takes precedence
  - [ ] Include migration guide link
  - [ ] Clear old parameters: set to undefined
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Consider extracting detection logic to helper function
- [ ] Ensure warning is appropriately visible
- [ ] Improve warning message clarity
- [ ] Verify consistent formatting
- [ ] Review placement in deployment flow
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] Warning displays only when mixing parameters
- [ ] Warning is clear and actionable
- [ ] Migration guide link included
- [ ] Old parameters cleared when new present
- [ ] No warning when using old params alone
- [ ] Tests verify all scenarios
- [ ] Warning does not block deployment

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts bin/commands/deploy.test.ts`
- [ ] Commit with message from episode 8
- [ ] Push to remote branch

---

## Episode 9: Deployment Plan Display Update

### Tests (RED Phase)

- [ ] Open `bin/commands/deploy.test.ts`
- [ ] Test: Should display masked ARN when using --benchling-secrets ARN
- [ ] Test: Should display tenant when using --benchling-secrets JSON
- [ ] Test: Should display client_id when using --benchling-secrets JSON
- [ ] Test: Should mask client_secret when using --benchling-secrets JSON
- [ ] Test: Should display app_definition_id when present in JSON
- [ ] Test: Should fall back to old display when using old params
- [ ] Test: Should use `maskArn()` for ARN display
- [ ] Test: Should show last 4 digits of client_secret
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/commands/deploy.ts`
- [ ] Locate deployment plan display section (lines 122-127)
- [ ] Replace fixed display with conditional logic:
  - [ ] Check if `config.benchlingSecrets` exists
  - [ ] If exists: call `parseAndValidateSecrets()` to get config
  - [ ] If format is ARN: display masked ARN using `maskArn()`
  - [ ] If format is JSON: display individual fields from `data`
  - [ ] Mask client_secret with `***${data.client_secret.slice(-4)}`
  - [ ] Display app_definition_id if present
  - [ ] If not exists: fall back to old display (backward compatible)
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Consider extracting display logic to helper function
- [ ] Ensure consistent formatting
- [ ] Verify alignment with other fields
- [ ] Review for code duplication
- [ ] Improve readability
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] Secrets properly masked in all displays
- [ ] ARN shows masked account ID
- [ ] JSON shows individual fields with masked secret
- [ ] Backward compatible with old params
- [ ] Display is clear and readable
- [ ] Tests verify all scenarios
- [ ] No secrets exposed in plain text

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts bin/commands/deploy.test.ts`
- [ ] Commit with message from episode 9
- [ ] Push to remote branch

---

## Episode 10: Secret Source Information Display

### Tests (RED Phase)

- [ ] Open `bin/commands/deploy.test.ts`
- [ ] Test: Should display info message when using ARN
- [ ] Test: Should display info message when using JSON
- [ ] Test: Info message should include masked ARN for ARN format
- [ ] Test: Info message should indicate JSON for JSON format
- [ ] Test: Should use `spinner.info()` for display
- [ ] Test: Info display should not block deployment
- [ ] Run tests and verify they FAIL
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Open `bin/commands/deploy.ts`
- [ ] Locate validation block (Episode 7 implementation)
- [ ] After successful `parseAndValidateSecrets()` call
- [ ] Add conditional logic based on `secretsConfig.format`:
  - [ ] If format is "arn": call `spinner.info()` with masked ARN
  - [ ] If format is "json": call `spinner.info()` with JSON indicator
- [ ] Use `maskArn()` for ARN display
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Ensure info messages are clear and concise
- [ ] Verify consistent with other spinner messages
- [ ] Review message formatting
- [ ] Ensure proper color usage
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] User sees which format is being used
- [ ] ARN is masked in display
- [ ] Messages are clear and informative
- [ ] Display does not block deployment
- [ ] Tests verify display logic
- [ ] Consistent with other info messages

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts bin/commands/deploy.test.ts`
- [ ] Commit with message from episode 10
- [ ] Push to remote branch

---

## Episode 11: Integration Testing Suite

### Tests (RED Phase)

- [ ] Create test file `bin/commands/deploy.integration.test.ts`
- [ ] Set up test infrastructure for integration tests
- [ ] Set up AWS SDK mocks (CloudFormation, Secrets Manager)
- [ ] Set up file system mocks for @file tests
- [ ] Test: Deploy with --benchling-secrets ARN (full flow)
- [ ] Test: Deploy with --benchling-secrets inline JSON (full flow)
- [ ] Test: Deploy with --benchling-secrets @file.json (full flow)
- [ ] Test: Deploy with BENCHLING_SECRETS env var (full flow)
- [ ] Test: Deploy with old params only (no warning, full flow)
- [ ] Test: Deploy with mixed params (warning shown, full flow)
- [ ] Test: Deploy with invalid ARN (error displayed, exit)
- [ ] Test: Deploy with invalid JSON (error displayed, exit)
- [ ] Test: Deploy with missing file (error displayed, exit)
- [ ] Test: Verify secret masking in all outputs
- [ ] Test: Verify deprecation warnings display correctly
- [ ] Run tests and verify they FAIL (no implementation yet)
- [ ] Commit failing tests

### Implementation (GREEN Phase)

- [ ] Implement test utilities for mocking:
  - [ ] AWS SDK mock factory
  - [ ] File system mock factory
  - [ ] Console output capture
  - [ ] Process exit mock
- [ ] Implement each test case with proper mocks
- [ ] Verify tests cover all input methods
- [ ] Verify tests cover all error scenarios
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Extract common test setup to helper functions
- [ ] Improve test readability with descriptive names
- [ ] Add test documentation explaining scenarios
- [ ] Review for test duplication
- [ ] Ensure tests are maintainable
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All integration tests pass
- [ ] Tests cover ARN, JSON, and file inputs
- [ ] Tests verify error scenarios
- [ ] Tests verify backward compatibility
- [ ] Test coverage >85% for deploy command
- [ ] Mocks properly isolated
- [ ] Tests run reliably

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.integration.test.ts`
- [ ] Commit with message from episode 11
- [ ] Push to remote branch

---

## Episode 12: Configuration Priority Chain Testing

### Tests (RED Phase)

- [ ] Open `lib/utils/config.test.ts`
- [ ] Test: CLI option should override env var for benchlingSecrets
- [ ] Test: CLI option should override .env file for benchlingSecrets
- [ ] Test: Env var should override .env file for benchlingSecrets
- [ ] Test: New param should override old params
- [ ] Test: Priority chain should work with @file syntax
- [ ] Test: Priority should work when mixing old and new params
- [ ] Test: Configuration should load from correct source
- [ ] Test: Should handle undefined at each priority level
- [ ] Run tests and verify existing implementation passes
- [ ] If tests fail, identify and fix bugs

### Implementation (GREEN Phase)

- [ ] Verify existing priority implementation in `loadConfigSync()`
- [ ] If bugs found during testing, fix them
- [ ] Ensure priority chain: CLI > env > .env
- [ ] Ensure new param overrides old params
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Add comments documenting priority chain in code
- [ ] Ensure code clearly implements documented priority
- [ ] Improve clarity of priority logic if needed
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All priority tests pass
- [ ] Priority chain documented in code
- [ ] Tests cover all source combinations
- [ ] Behavior matches design specification
- [ ] No unexpected priority conflicts

### Commit

- [ ] Stage changes: `git add lib/utils/config.ts lib/utils/config.test.ts`
- [ ] Commit with message from episode 12
- [ ] Push to remote branch

---

## Episode 13: Error Message Formatting and Display

### Tests (RED Phase)

- [ ] Open `bin/commands/deploy.test.ts`
- [ ] Test: File not found error should include resolved path
- [ ] Test: JSON parse error should include position and message
- [ ] Test: ARN validation error should include expected format
- [ ] Test: Field validation errors should include suggestions
- [ ] Test: Error formatting should match `SecretsValidationError.formatForCLI()`
- [ ] Test: Format help should display after validation errors
- [ ] Test: Errors should use consistent chalk styling
- [ ] Run tests and verify current implementation status

### Implementation (GREEN Phase)

- [ ] Verify error formatting in `processBenchlingSecretsInput()`:
  - [ ] File not found includes resolved path
  - [ ] Read error includes file path
- [ ] Verify error formatting in deploy validation block:
  - [ ] Uses `SecretsValidationError.formatForCLI()`
  - [ ] Displays format help text
  - [ ] Uses consistent chalk styling
- [ ] Fix any formatting inconsistencies found
- [ ] Run tests and verify they PASS

### Refactoring (REFACTOR Phase)

- [ ] Review all error messages for clarity
- [ ] Ensure consistent style across all errors
- [ ] Verify helpful suggestions included
- [ ] Improve error context where needed
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All errors include actionable suggestions
- [ ] File errors show resolved paths
- [ ] Validation errors use `formatForCLI()`
- [ ] Error display is consistent and clear
- [ ] Tests verify error content and format
- [ ] No confusing or unclear error messages

### Commit

- [ ] Stage changes: `git add bin/commands/deploy.ts lib/utils/config.ts` (and tests)
- [ ] Commit with message from episode 13
- [ ] Push to remote branch

---

## Episode 14: Documentation and Type Updates

### Documentation Tasks

- [ ] Open `lib/utils/config.ts`
- [ ] Add JSDoc to `processBenchlingSecretsInput()` if not complete
- [ ] Document all parameters with `@param`
- [ ] Document return value with `@returns`
- [ ] Document errors with `@throws`
- [ ] Add usage example in JSDoc
- [ ] Open `bin/commands/deploy.ts`
- [ ] Add JSDoc to `maskArn()` if not complete
- [ ] Add inline comments for complex validation logic
- [ ] Add inline comments explaining priority resolution
- [ ] Open `lib/utils/secrets.ts`
- [ ] Verify Phase 1 documentation is complete
- [ ] Add cross-references to Phase 2 usage if helpful

### Type Definition Review

- [ ] Verify all function signatures have explicit types
- [ ] Verify all parameters have types
- [ ] Verify all return types specified
- [ ] Verify no implicit `any` types
- [ ] Check TypeScript strict mode compliance
- [ ] Run TypeScript compiler and fix any warnings

### Code Comments

- [ ] Add comments explaining @file syntax processing
- [ ] Add comments explaining priority chain logic
- [ ] Add comments explaining deprecation strategy
- [ ] Add comments for complex regex patterns
- [ ] Ensure comments are helpful, not redundant

### Quality Review

- [ ] Review all documentation for clarity
- [ ] Fix typos and grammar issues
- [ ] Ensure consistent documentation style
- [ ] Verify code examples are accurate
- [ ] Ensure cross-references are correct
- [ ] Run `make lint` and fix any issues
- [ ] Fix IDE diagnostics if any

### Quality Gates

- [ ] All public functions have JSDoc
- [ ] All parameters documented
- [ ] All return types documented
- [ ] TypeScript types are correct and explicit
- [ ] Inline comments explain complex logic
- [ ] Documentation is clear and helpful
- [ ] No typos or grammar issues

### Commit

- [ ] Stage all documentation changes
- [ ] Commit with message from episode 14
- [ ] Push to remote branch

---

## Post-Episode Validation

### Overall Test Coverage

- [ ] Run full test suite: `make test`
- [ ] Verify all tests pass
- [ ] Check test coverage report
- [ ] Verify coverage >90% for new code in:
  - [ ] `lib/utils/config.ts` (file processing, priority)
  - [ ] `bin/commands/deploy.ts` (validation, display)
- [ ] Verify coverage >85% for:
  - [ ] `bin/cli.ts` (option parsing)
- [ ] Fix any coverage gaps

### Lint and Type Checking

- [ ] Run linter: `make lint`
- [ ] Fix all linting errors
- [ ] Fix all linting warnings
- [ ] Run TypeScript compiler: `npm run typecheck`
- [ ] Fix all type errors
- [ ] Resolve all IDE diagnostics
- [ ] Verify no `@ts-ignore` comments added

### Manual Testing

- [ ] Test with real secrets file:
  - [ ] Create test secrets.json file
  - [ ] Run: `npx ts-node bin/cli.ts deploy --benchling-secrets @secrets.json --yes`
  - [ ] Verify file is read correctly
  - [ ] Verify secrets are masked in output
- [ ] Test with inline JSON:
  - [ ] Run: `npx ts-node bin/cli.ts deploy --benchling-secrets '{"client_id":"test","client_secret":"secret","tenant":"company"}' --yes`
  - [ ] Verify JSON is parsed correctly
  - [ ] Verify secrets are masked in output
- [ ] Test with ARN:
  - [ ] Run: `npx ts-node bin/cli.ts deploy --benchling-secrets "arn:aws:secretsmanager:us-east-1:123456789012:secret:test" --yes`
  - [ ] Verify ARN is validated
  - [ ] Verify ARN is masked in output
- [ ] Test with environment variable:
  - [ ] Set: `export BENCHLING_SECRETS='{"client_id":"test","client_secret":"secret","tenant":"company"}'`
  - [ ] Run: `npx ts-node bin/cli.ts deploy --yes`
  - [ ] Verify env var is used
- [ ] Test error scenarios:
  - [ ] Missing file: `--benchling-secrets @missing.json`
  - [ ] Invalid JSON: `--benchling-secrets '{bad json}'`
  - [ ] Invalid ARN: `--benchling-secrets "arn:bad:format"`
  - [ ] Verify all errors display clearly
- [ ] Test backward compatibility:
  - [ ] Run with old params only (no warning expected)
  - [ ] Verify old params still work
- [ ] Test deprecation warnings:
  - [ ] Run with both old and new params
  - [ ] Verify warning displays
  - [ ] Verify new param takes precedence
- [ ] Test help display:
  - [ ] Run: `npx ts-node bin/cli.ts deploy --help`
  - [ ] Verify examples section displays
  - [ ] Verify options are marked deprecated

### Integration Validation

- [ ] Verify Phase 1 validation functions integrated correctly
- [ ] Verify `parseAndValidateSecrets()` called properly
- [ ] Verify `SecretsValidationError` handled properly
- [ ] Verify ARN validation works end-to-end
- [ ] Verify JSON validation works end-to-end
- [ ] Verify validation errors display correctly

### Backward Compatibility Verification

- [ ] Test existing deployment with old parameters
- [ ] Verify no breaking changes introduced
- [ ] Verify old parameters still work without new parameter
- [ ] Verify no warnings when using only old parameters
- [ ] Verify existing .env files still work
- [ ] Verify existing CI/CD pipelines unaffected

---

## Quality Gates Summary

### Code Quality

- [ ] All tests pass (unit + integration)
- [ ] Test coverage >90% for new code
- [ ] Test coverage >85% overall for changed files
- [ ] ESLint passes without errors
- [ ] ESLint passes without warnings
- [ ] TypeScript compiles without errors
- [ ] No IDE diagnostics
- [ ] No `@ts-ignore` or `eslint-disable` added

### Functionality

- [ ] CLI accepts `--benchling-secrets` option
- [ ] CLI accepts ARN format
- [ ] CLI accepts inline JSON format
- [ ] CLI accepts @file.json format
- [ ] Environment variable `BENCHLING_SECRETS` works
- [ ] Configuration priority chain works correctly
- [ ] File reading works for @file syntax
- [ ] Secrets validation runs before deployment
- [ ] Invalid secrets block deployment
- [ ] Error messages are clear and actionable

### User Experience

- [ ] Help text includes examples
- [ ] Deprecation warnings display appropriately
- [ ] Secrets are masked in all output
- [ ] ARN account ID is masked
- [ ] Client secret is masked
- [ ] Error messages include suggestions
- [ ] File errors include resolved paths
- [ ] Validation errors are formatted clearly

### Security

- [ ] No secrets exposed in logs
- [ ] No secrets exposed in error messages
- [ ] No secrets exposed in deployment plan
- [ ] ARN account ID masked
- [ ] Client secret masked
- [ ] Only last 4 characters of secrets shown

### Backward Compatibility

- [ ] Existing deployments unaffected
- [ ] Old parameters still work
- [ ] No breaking changes introduced
- [ ] Warnings only when mixing approaches
- [ ] No forced migration required

---

## Final Checklist

### Documentation

- [ ] All functions have JSDoc comments
- [ ] All complex logic has inline comments
- [ ] README updated with new parameter usage (defer to Phase 7)
- [ ] env.template updated with BENCHLING_SECRETS (defer to Phase 7)
- [ ] Migration guide planned (defer to Phase 7)

### Testing

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing complete
- [ ] Test coverage meets targets
- [ ] Edge cases covered

### Code Review Preparation

- [ ] All episodes complete
- [ ] All commits follow convention
- [ ] Commit messages reference issue #156
- [ ] Branch is up to date with main
- [ ] No merge conflicts
- [ ] Code is clean and readable
- [ ] No commented-out code
- [ ] No debug statements
- [ ] No TODO comments

### Deployment Readiness

- [ ] Phase 2 fully implemented
- [ ] All quality gates passed
- [ ] Backward compatibility verified
- [ ] Ready for code review
- [ ] Ready for merge to main
- [ ] Ready for release in v0.6.x

---

## Success Metrics

### Functional Metrics

- [ ] ✅ CLI accepts `--benchling-secrets` with ARN
- [ ] ✅ CLI accepts `--benchling-secrets` with inline JSON
- [ ] ✅ CLI accepts `--benchling-secrets @file.json`
- [ ] ✅ Environment variable `BENCHLING_SECRETS` works
- [ ] ✅ File input reads and validates JSON
- [ ] ✅ Priority resolution works correctly
- [ ] ✅ Deprecation warnings display appropriately
- [ ] ✅ Backward compatibility maintained
- [ ] ✅ Help text updated with examples

### Quality Metrics

- [ ] ✅ Test coverage >90% for new code
- [ ] ✅ All error scenarios have clear messages
- [ ] ✅ All validation uses Phase 1 functions
- [ ] ✅ No breaking changes to existing functionality
- [ ] ✅ IDE diagnostics resolved
- [ ] ✅ ESLint passes
- [ ] ✅ TypeScript compiles without errors

### User Experience Metrics

- [ ] ✅ Error messages are actionable
- [ ] ✅ Help text includes clear examples
- [ ] ✅ Secrets are masked in all output
- [ ] ✅ Deprecation warnings guide migration
- [ ] ✅ Validation happens before deployment
- [ ] ✅ File errors include resolved paths

---

## Next Steps

After completing this checklist:

1. [ ] Create PR against main branch
2. [ ] Request code review
3. [ ] Address review comments
4. [ ] Merge when approved
5. [ ] Proceed to Phase 3 (CDK Secret Handling)
6. [ ] Update WORKFLOW-STATUS.md with Phase 2 completion

---

## References

- **Phase 2 Design**: [08-phase2-design.md](./08-phase2-design.md)
- **Phase 2 Episodes**: [09-phase2-episodes.md](./09-phase2-episodes.md)
- **Phase 1 Implementation**: `/Users/ernest/GitHub/benchling-webhook/lib/utils/secrets.ts`
- **GitHub Issue**: #156
- **WORKFLOW**: [../WORKFLOW.md](../WORKFLOW.md)

---

## Completion Sign-off

**Phase 2 Complete**: _______ (Date)

**Implementer**: _______

**Reviewer**: _______

**Quality Gates Passed**: [ ] Yes [ ] No

**Ready for Phase 3**: [ ] Yes [ ] No

**Notes**:
