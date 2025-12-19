# Phase 2 Episodes: CLI Parameter Addition

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-31
**Phase**: DECO - Episodes (Phase 2)

## Overview

This document breaks down Phase 2 implementation into atomic, testable episodes following Test-Driven Development (TDD) methodology. Each episode represents a single, independently committable change unit that follows the RED → GREEN → REFACTOR cycle.

**Reference**: Phase 2 Design Document [08-phase2-design.md](./08-phase2-design.md)

## Episode Structure

Each episode follows this pattern:

1. **RED**: Write failing test(s) that specify desired behavior
2. **GREEN**: Write minimum code to make tests pass
3. **REFACTOR**: Improve code quality while keeping tests green
4. **COMMIT**: Commit working, tested code

## Episodes Sequence

### Episode 1: File Input Processing Function

**Objective**: Implement `processBenchlingSecretsInput()` function to handle @file syntax.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `lib/utils/config.test.ts` (create new file)
- Test cases:
  - Should return trimmed input for ARN string
  - Should return trimmed input for JSON string
  - Should read file content when input starts with @
  - Should throw error when @file not found
  - Should throw error when file not readable
  - Should handle relative and absolute file paths
  - Should handle whitespace in file content
  - Should throw clear error with resolved path

**GREEN** - Implement function:
- Location: `lib/utils/config.ts` (after `loadDotenv` function)
- Add imports: `readFileSync` from `fs`
- Implement `processBenchlingSecretsInput(input: string): string`
- Handle @ prefix detection
- Handle file reading with error handling
- Return trimmed content

**REFACTOR**:
- Extract path resolution logic if needed
- Improve error messages
- Add JSDoc comments

**Success Criteria**:
- All tests pass
- Coverage > 90% for new function
- Error messages include resolved paths
- Function handles all input types correctly

**Commit Message**:
```
feat(config): add file input processor for benchling secrets

- Implement processBenchlingSecretsInput() function
- Support @file.json syntax for secret file input
- Handle ARN and JSON inline passthrough
- Add comprehensive error handling with resolved paths
- Add unit tests with >90% coverage

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 2: Configuration Options Interface Update

**Objective**: Add `benchlingSecrets` to `ConfigOptions` interface (if not already present).

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `lib/utils/config.test.ts`
- Test cases:
  - TypeScript should accept `benchlingSecrets` in options
  - `loadConfigSync` should accept `benchlingSecrets` CLI option
  - `loadConfigSync` should prioritize CLI over env var
  - `loadConfigSync` should prioritize env var over .env file

**GREEN** - Update interface:
- Location: `lib/utils/config.ts`
- Verify `benchlingSecrets?: string` exists in `ConfigOptions` (line ~52)
- If missing, add it
- Verify `benchlingSecrets?: string` exists in `Config` (line ~20)

**REFACTOR**:
- Ensure consistent ordering with other Benchling fields
- Update JSDoc comments if needed

**Success Criteria**:
- TypeScript compiles without errors
- Interface properly typed
- Tests pass showing priority chain works

**Commit Message**:
```
feat(config): add benchlingSecrets to configuration interfaces

- Add benchlingSecrets field to ConfigOptions interface
- Verify Config interface includes benchlingSecrets
- Update configuration type definitions
- Add tests for configuration priority chain

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 3: Configuration Loading with File Processing

**Objective**: Integrate `processBenchlingSecretsInput()` into `loadConfigSync()`.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `lib/utils/config.test.ts`
- Test cases:
  - Should process @file syntax in CLI option
  - Should process @file syntax in env var
  - Should process @file syntax in .env file
  - Should handle ARN passthrough
  - Should handle JSON passthrough
  - Should throw error for missing file
  - Should respect priority: CLI > env > .env

**GREEN** - Update function:
- Location: `lib/utils/config.ts` in `loadConfigSync()`
- Modify benchlingSecrets loading (around line 145):
  ```typescript
  // Unified secrets (priority: CLI > env > .env)
  const rawSecrets = options.benchlingSecrets || envVars.BENCHLING_SECRETS;
  benchlingSecrets: rawSecrets ? processBenchlingSecretsInput(rawSecrets) : undefined,
  ```

**REFACTOR**:
- Extract to local variable for clarity
- Ensure error handling preserves context
- Update comments

**Success Criteria**:
- All tests pass
- File syntax processed correctly
- Priority chain works as expected
- Errors are clear and actionable

**Commit Message**:
```
feat(config): integrate file processing in config loader

- Call processBenchlingSecretsInput() in loadConfigSync()
- Process @file syntax for CLI, env, and .env sources
- Maintain configuration priority chain
- Add integration tests for file loading

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 4: CLI Option Declaration

**Objective**: Add `--benchling-secrets` option to deploy command in CLI.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/cli.test.ts` (create new file)
- Test cases:
  - Deploy command should accept --benchling-secrets option
  - Option should be passed to deployCommand function
  - Help text should include --benchling-secrets
  - Option should support string values

**GREEN** - Add CLI option:
- Location: `bin/cli.ts` in deploy command (after line 31)
- Add option:
  ```typescript
  .option("--benchling-secrets <value>", "Benchling secrets configuration (ARN, JSON, or @file)")
  ```
- Update existing options to mark as deprecated:
  ```typescript
  .option("--tenant <name>", "Benchling tenant (deprecated, use --benchling-secrets)")
  .option("--client-id <id>", "Benchling OAuth client ID (deprecated, use --benchling-secrets)")
  .option("--client-secret <secret>", "Benchling OAuth client secret (deprecated, use --benchling-secrets)")
  .option("--app-id <id>", "Benchling app definition ID (deprecated, use --benchling-secrets)")
  ```

**REFACTOR**:
- Group related options together
- Ensure consistent formatting
- Update TypeScript types if needed

**Success Criteria**:
- CLI parser accepts option
- Option value passed to command handler
- Help text displays correctly
- TypeScript types match

**Commit Message**:
```
feat(cli): add --benchling-secrets option to deploy command

- Add --benchling-secrets CLI option
- Mark individual secret options as deprecated in help text
- Update option descriptions for clarity
- Add CLI parsing tests

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 5: CLI Help Text Enhancement

**Objective**: Add comprehensive help text with examples for secrets configuration.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/cli.test.ts`
- Test cases:
  - Help text should include examples section
  - Examples should cover ARN, JSON, file inputs
  - Examples should show environment variable usage

**GREEN** - Add help text:
- Location: `bin/cli.ts` in deploy command (after options)
- Add extended help:
  ```typescript
  .addHelpText('after', `
Examples:
  # Using AWS Secrets Manager ARN
  $ npx @quiltdata/benchling-webhook deploy --benchling-secrets "arn:aws:secretsmanager:..."

  # Using inline JSON
  $ npx @quiltdata/benchling-webhook deploy --benchling-secrets '{"client_id":"...","client_secret":"...","tenant":"..."}'

  # Using JSON file
  $ npx @quiltdata/benchling-webhook deploy --benchling-secrets @secrets.json

  # Using environment variable
  $ export BENCHLING_SECRETS='{"client_id":"...","client_secret":"...","tenant":"..."}'
  $ npx @quiltdata/benchling-webhook deploy

For more information: https://github.com/quiltdata/benchling-webhook#secrets-configuration
  `)
  ```

**REFACTOR**:
- Ensure consistent formatting
- Verify examples are copy-pasteable
- Check line lengths and readability

**Success Criteria**:
- Help text displays correctly
- Examples are clear and accurate
- Links are valid
- Formatting is consistent

**Commit Message**:
```
docs(cli): add comprehensive examples to deploy help text

- Add examples section to deploy command help
- Include ARN, JSON, and file input examples
- Document environment variable usage
- Add link to documentation

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 6: ARN Masking Utility Function

**Objective**: Implement `maskArn()` helper function for secure display.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/commands/deploy.test.ts` (create new file)
- Test cases:
  - Should mask account ID in valid ARN
  - Should show last 4 digits of account
  - Should preserve region and secret name
  - Should return input unchanged for invalid ARN
  - Should handle edge cases (empty, malformed)

**GREEN** - Implement function:
- Location: `bin/commands/deploy.ts` (at end of file)
- Implement `maskArn(arn: string): string`
- Pattern match ARN structure
- Replace account with ****XXXX format
- Return original if no match

**REFACTOR**:
- Consider extracting to shared utils if needed
- Improve regex for clarity
- Add JSDoc comments

**Success Criteria**:
- All tests pass
- Account ID properly masked
- Region and secret name preserved
- Invalid input handled gracefully

**Commit Message**:
```
feat(deploy): add ARN masking utility for secure display

- Implement maskArn() function
- Mask AWS account ID while preserving region and secret name
- Show last 4 digits of account for verification
- Handle invalid ARN formats gracefully
- Add comprehensive unit tests

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 7: Secret Validation Integration

**Objective**: Add secret validation step in deploy command using Phase 1 functions.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/commands/deploy.test.ts`
- Test cases:
  - Should validate ARN format
  - Should validate JSON structure
  - Should display error for invalid ARN
  - Should display error for invalid JSON
  - Should show format information in errors
  - Should exit on validation failure

**GREEN** - Add validation:
- Location: `bin/commands/deploy.ts` (after line 48, before existing validation)
- Add imports:
  ```typescript
  import { parseAndValidateSecrets, SecretsValidationError } from "../../lib/utils/secrets";
  ```
- Add validation block (see design doc section 3.1)
- Handle SecretsValidationError specifically
- Display formatted error messages
- Exit with code 1 on failure

**REFACTOR**:
- Extract validation logic to helper function if complex
- Improve error message formatting
- Ensure consistent error handling

**Success Criteria**:
- Validation runs before config validation
- Invalid secrets block deployment
- Error messages are clear and actionable
- Tests verify all error scenarios

**Commit Message**:
```
feat(deploy): add benchling secrets pre-deployment validation

- Integrate parseAndValidateSecrets() from Phase 1
- Validate secrets before CDK deployment
- Display formatted validation errors
- Show secret format help on error
- Add validation integration tests

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 8: Deprecation Warning Display

**Objective**: Show deprecation warning when mixing old and new parameters.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/commands/deploy.test.ts`
- Test cases:
  - Should show warning when both new and old params present
  - Should NOT show warning when only new param present
  - Should NOT show warning when only old params present
  - Should clear old params when new param present
  - Warning should include migration guide link

**GREEN** - Add warning logic:
- Location: `bin/commands/deploy.ts` (in validation block after parseAndValidateSecrets)
- Check for old parameters presence
- Display warning with chalk.yellow
- Clear old parameters from config
- Add migration guide link

**REFACTOR**:
- Extract detection logic to helper function
- Ensure warning is appropriately visible
- Improve warning message clarity

**Success Criteria**:
- Warning displays only when mixing parameters
- Old parameters cleared when new present
- Migration guide link included
- Tests verify all scenarios

**Commit Message**:
```
feat(deploy): add deprecation warnings for old secret parameters

- Detect when mixing --benchling-secrets with old params
- Display clear deprecation warning
- Clear old parameters to avoid confusion
- Include migration guide link in warning
- Add tests for warning scenarios

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 9: Deployment Plan Display Update

**Objective**: Update deployment plan to show secrets configuration appropriately.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/commands/deploy.test.ts`
- Test cases:
  - Should display masked ARN when using ARN
  - Should display tenant/client_id when using JSON
  - Should mask client_secret in JSON display
  - Should fall back to old display when using old params
  - Should show app_definition_id when present

**GREEN** - Update display:
- Location: `bin/commands/deploy.ts` (lines 122-127)
- Add conditional logic for benchlingSecrets
- Parse and display ARN with masking
- Parse and display JSON fields with masking
- Maintain backward compatible display

**REFACTOR**:
- Extract display logic to helper function
- Ensure consistent formatting
- Improve code readability

**Success Criteria**:
- Secrets properly masked in display
- ARN shows masked format
- JSON shows individual fields
- Backward compatible with old params
- Display is clear and readable

**Commit Message**:
```
feat(deploy): update deployment plan for benchling secrets display

- Display masked ARN when using --benchling-secrets ARN
- Display tenant/client_id when using --benchling-secrets JSON
- Mask sensitive values in all displays
- Maintain backward compatible display for old params
- Add display tests for all scenarios

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 10: Secret Source Information Display

**Objective**: Show user which secret source is being used (ARN or JSON).

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/commands/deploy.test.ts`
- Test cases:
  - Should display info when using ARN
  - Should display info when using JSON
  - Should include masked ARN in info message
  - Should use spinner.info() for display

**GREEN** - Add info display:
- Location: `bin/commands/deploy.ts` (in validation block after parseAndValidateSecrets)
- Add info messages based on format
- Use spinner.info() for non-blocking display
- Include masked ARN or JSON indicator

**REFACTOR**:
- Ensure info messages are clear
- Consistent with other spinner messages
- Proper formatting and colors

**Success Criteria**:
- User sees which format is being used
- ARN is masked in display
- Messages are clear and informative
- Tests verify display logic

**Commit Message**:
```
feat(deploy): display benchling secrets source information

- Show user which secret format is being used (ARN or JSON)
- Display masked ARN for verification
- Use spinner.info() for non-blocking feedback
- Add tests for info display logic

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 11: Integration Testing Suite

**Objective**: Create comprehensive integration tests for end-to-end flows.

**TDD Cycle**:

**RED** - Write failing integration tests:
- Test file: `bin/commands/deploy.integration.test.ts` (create new file)
- Test cases:
  - Deploy with --benchling-secrets ARN (mock AWS calls)
  - Deploy with --benchling-secrets inline JSON
  - Deploy with --benchling-secrets @file.json
  - Deploy with BENCHLING_SECRETS env var
  - Deploy with old params (no warning)
  - Deploy with mixed params (warning shown)
  - Deploy with invalid ARN (error shown)
  - Deploy with invalid JSON (error shown)
  - Deploy with missing file (error shown)

**GREEN** - Implement mocks and test harness:
- Mock AWS SDK calls
- Mock file system for @file tests
- Mock configuration loading
- Capture console output for assertions
- Verify error handling

**REFACTOR**:
- Extract common test utilities
- Improve test readability
- Add test documentation

**Success Criteria**:
- All integration tests pass
- Tests cover all input methods
- Tests verify error scenarios
- Tests verify backward compatibility
- Test coverage > 85% for deploy command

**Commit Message**:
```
test(deploy): add comprehensive integration tests for secrets

- Add integration tests for ARN, JSON, and file inputs
- Test environment variable configuration
- Test backward compatibility with old params
- Test error scenarios and validation
- Mock AWS and file system dependencies

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 12: Configuration Priority Chain Testing

**Objective**: Verify configuration priority works correctly across all sources.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `lib/utils/config.test.ts`
- Test cases:
  - CLI option overrides env var
  - CLI option overrides .env file
  - Env var overrides .env file
  - New param overrides old params
  - Priority chain with @file syntax
  - Priority chain with mixed old/new

**GREEN** - Verify existing implementation:
- Existing code should already implement priority
- Tests should pass if implementation correct
- Fix any bugs found during testing

**REFACTOR**:
- Improve priority logic clarity if needed
- Add comments documenting priority
- Ensure code matches documentation

**Success Criteria**:
- All priority tests pass
- Priority chain documented in code
- Tests cover all source combinations
- Behavior matches design specification

**Commit Message**:
```
test(config): add configuration priority chain tests

- Test CLI > env > .env priority for benchling-secrets
- Test new param priority over old params
- Verify @file syntax works in all sources
- Document configuration priority in tests

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 13: Error Message Formatting and Display

**Objective**: Ensure all error messages are clear, actionable, and well-formatted.

**TDD Cycle**:

**RED** - Write failing tests:
- Test file: `bin/commands/deploy.test.ts`
- Test cases:
  - File not found error includes resolved path
  - JSON parse error includes position
  - ARN validation error includes expected format
  - Field validation errors include suggestions
  - Error formatting matches SecretsValidationError format

**GREEN** - Verify error formatting:
- Errors already formatted by Phase 1 SecretsValidationError
- File errors should include resolved path
- Add format help text after errors
- Verify consistent error styling with chalk

**REFACTOR**:
- Ensure error messages follow consistent style
- Improve error context where needed
- Add helpful suggestions

**Success Criteria**:
- All errors include actionable suggestions
- File errors show resolved paths
- Validation errors use formatForCLI()
- Error display is consistent and clear

**Commit Message**:
```
feat(deploy): enhance error messages for secrets validation

- Add resolved paths to file not found errors
- Display format help after validation errors
- Ensure consistent error formatting with chalk
- Add tests for error message content and format

Part of Phase 2: CLI Parameter Addition (#156)
```

---

### Episode 14: Documentation and Type Updates

**Objective**: Update all JSDoc comments, TypeScript types, and inline documentation.

**TDD Cycle**:

**RED** - Write documentation tests:
- Test file: `docs.test.ts` (if exists) or manual verification
- Verify:
  - All new functions have JSDoc comments
  - All parameters documented
  - Return types documented
  - Examples included where helpful

**GREEN** - Add documentation:
- Add JSDoc to `processBenchlingSecretsInput()`
- Add JSDoc to `maskArn()`
- Update existing function docs if changed
- Add inline comments for complex logic
- Update interface documentation

**REFACTOR**:
- Improve documentation clarity
- Fix typos and grammar
- Ensure consistent style
- Add cross-references

**Success Criteria**:
- All public functions have JSDoc
- TypeScript types are correct
- Inline comments explain complex logic
- Documentation is clear and helpful

**Commit Message**:
```
docs(phase2): add comprehensive documentation and type definitions

- Add JSDoc comments to all new functions
- Document parameters and return types
- Add usage examples in comments
- Update TypeScript type definitions
- Add inline comments for complex logic

Part of Phase 2: CLI Parameter Addition (#156)
```

---

## Episode Summary

| Episode | Objective | Test File | Implementation Files | Est. Time |
| --------- | ----------- | ----------- | --------------------- | ----------- |
| 1 | File input processing | config.test.ts | config.ts | 1 hour |
| 2 | Config interface update | config.test.ts | config.ts | 30 min |
| 3 | Config loading integration | config.test.ts | config.ts | 1 hour |
| 4 | CLI option declaration | cli.test.ts | cli.ts | 30 min |
| 5 | CLI help text | cli.test.ts | cli.ts | 30 min |
| 6 | ARN masking utility | deploy.test.ts | deploy.ts | 1 hour |
| 7 | Secret validation integration | deploy.test.ts | deploy.ts | 1.5 hours |
| 8 | Deprecation warnings | deploy.test.ts | deploy.ts | 1 hour |
| 9 | Deployment plan display | deploy.test.ts | deploy.ts | 1 hour |
| 10 | Secret source info | deploy.test.ts | deploy.ts | 30 min |
| 11 | Integration testing | deploy.integration.test.ts | N/A | 2 hours |
| 12 | Priority chain testing | config.test.ts | N/A | 1 hour |
| 13 | Error message formatting | deploy.test.ts | deploy.ts | 1 hour |
| 14 | Documentation | N/A | All files | 1 hour |

**Total Estimated Time**: 13.5 hours

## Testing Strategy Per Episode

### Unit Testing
- Each episode includes specific unit tests
- Tests written before implementation (RED phase)
- Tests verify behavior, not implementation
- Coverage target: >90% for new code

### Integration Testing
- Episode 11 focuses on end-to-end flows
- Tests verify component interactions
- Mocks used for external dependencies
- Tests verify user-facing behavior

### Manual Testing
After all episodes complete:
- Test with real secrets file
- Test with real AWS credentials
- Test error scenarios manually
- Verify help text display
- Test on different platforms

## Dependencies Between Episodes

```
Episode 1 (File processing) ──→ Episode 3 (Config integration)
                                      ↓
Episode 2 (Interface update) ────────┘
                                      ↓
Episode 4 (CLI option) ──────────→ Episode 7 (Validation)
                                      ↓
Episode 6 (ARN masking) ──────────→ Episode 9 (Display)
                                      ↓
Episode 7 (Validation) ──────────→ Episode 8 (Warnings)
                                      ↓
Episode 5 (Help text)                 │
Episode 10 (Info display)             │
                                      ↓
Episode 11 (Integration tests) ←──────┘
Episode 12 (Priority tests) ←─────────┘
Episode 13 (Error formatting) ←───────┘
                                      ↓
Episode 14 (Documentation) ←──────────┘
```

**Critical Path**: Episodes 1 → 2 → 3 → 7 → 8 → 9 → 11

**Parallel Opportunities**:
- Episodes 5, 6, 10 can be done in parallel with main path
- Episodes 12, 13 can be done after Episode 11

## Commit Strategy

**Per Episode**:
- Commit after each episode completes
- Ensure tests pass before committing
- Use conventional commit format
- Reference issue #156 in all commits

**Example Commit**:
```
feat(config): add file input processor for benchling secrets

- Implement processBenchlingSecretsInput() function
- Support @file.json syntax for secret file input
- Handle ARN and JSON inline passthrough
- Add comprehensive error handling
- Add unit tests with >90% coverage

Part of Phase 2: CLI Parameter Addition (#156)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Quality Gates Per Episode

Before completing each episode:

1. ✅ All tests pass (RED → GREEN complete)
2. ✅ Code refactored for clarity (REFACTOR complete)
3. ✅ Coverage meets target (>90% for new code)
4. ✅ IDE diagnostics resolved (no TypeScript errors)
5. ✅ Lint passes (`make lint`)
6. ✅ Integration with existing code verified
7. ✅ Commit message follows convention

## Rollback Strategy

If episode fails:
1. Review test failures
2. Verify design alignment
3. Consider episode scope reduction
4. If blocked, document issue and skip
5. Can return to skipped episodes later

## Success Metrics

**Overall Phase 2 Success**:
- ✅ All 14 episodes complete
- ✅ All tests pass (unit + integration)
- ✅ Test coverage > 90%
- ✅ No IDE diagnostics
- ✅ Backward compatibility verified
- ✅ All quality gates passed

**Next Step**: Create checklist document (10-phase2-checklist.md)

## References

- **Phase 2 Design**: [08-phase2-design.md](./08-phase2-design.md)
- **Phase 1 Implementation**: `/Users/ernest/GitHub/benchling-webhook/lib/utils/secrets.ts`
- **TDD Best Practices**: https://martinfowler.com/bliki/TestDrivenDevelopment.html
- **Conventional Commits**: https://www.conventionalcommits.org/
