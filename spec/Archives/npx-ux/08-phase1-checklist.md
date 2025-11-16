# Phase 1 Checklist: CLI Infrastructure Pre-factoring

**GitHub Issue**: #182
**Branch**: phase1-cli-infrastructure (off npx-ux)
**Phase**: Phase 1 - CLI Infrastructure Pre-factoring
**Date**: 2025-11-03

## Episode Completion Tracking

### Stream A: Error Handling Foundation

#### Episode 1: Create CLIError Base Class and Hierarchy
- [ ] Create `lib/errors/cli-errors.ts`
- [ ] Create `test/errors/cli-errors.test.ts`
- [ ] Write failing test for error formatting with message only
- [ ] Write failing test for error formatting with suggestion
- [ ] Write failing test for error formatting with details
- [ ] Implement CLIError abstract base class
- [ ] Implement format() method with chalk colors
- [ ] Implement getExitCode() abstract method
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(errors): add CLIError base class and hierarchy`

#### Episode 2: Implement Specific Error Types
- [ ] Write failing tests for ConfigurationError
- [ ] Write failing tests for ValidationError
- [ ] Write failing tests for AWSError with awsErrorCode
- [ ] Write failing tests for DeploymentError
- [ ] Write failing tests for UserCancelledError
- [ ] Write failing tests for NonInteractiveError
- [ ] Implement ConfigurationError class
- [ ] Implement ValidationError class
- [ ] Implement AWSError class with awsErrorCode property
- [ ] Implement DeploymentError class
- [ ] Implement UserCancelledError class with custom formatting
- [ ] Implement NonInteractiveError class
- [ ] Add comprehensive JSDoc for all error types
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(errors): implement specific error types`

#### Episode 3: Create Global Error Handler
- [ ] Create `lib/errors/error-handler.ts`
- [ ] Write failing test for CLIError handling with formatted output
- [ ] Write failing test for unknown error handling
- [ ] Write failing test for DEBUG mode stack trace display
- [ ] Write failing test for wrap() method
- [ ] Implement ErrorHandler.handle() method
- [ ] Implement ErrorHandler.wrap() method
- [ ] Handle CLIError vs unknown errors appropriately
- [ ] Support DEBUG mode for stack traces
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(errors): add global error handler`

### Stream B: CLI Mode Abstraction

#### Episode 4: Define ICommandMode Interface
- [ ] Create `lib/cli/command-mode.ts`
- [ ] Create `lib/cli/types.ts`
- [ ] Create `test/cli/command-mode.test.ts`
- [ ] Write failing test for interface method definitions
- [ ] Write failing test for register() accepting Commander program
- [ ] Write failing test for shouldHandle() returning boolean
- [ ] Write failing test for execute() returning Promise
- [ ] Define ICommandMode interface
- [ ] Define CommandDefinition interface
- [ ] Define CommandOption interface
- [ ] Add comprehensive JSDoc with usage examples
- [ ] All tests compile and pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(cli): define ICommandMode interface`

#### Episode 5: Implement LegacyCommandMode Class Structure
- [ ] Create `lib/cli/legacy-command-mode.ts`
- [ ] Create `test/cli/legacy-command-mode.test.ts`
- [ ] Write failing test for ICommandMode implementation
- [ ] Write failing test for command definitions initialization
- [ ] Write failing test for deploy as default command
- [ ] Implement LegacyCommandMode class implementing ICommandMode
- [ ] Initialize commands Map with all command definitions
- [ ] Define deploy, init, validate, test, manifest commands
- [ ] Use stub action functions temporarily
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(cli): implement LegacyCommandMode structure`

#### Episode 6: Implement Command Routing Logic
- [ ] Write failing tests for shouldHandle() with no arguments
- [ ] Write failing tests for shouldHandle() with explicit commands
- [ ] Write failing tests for shouldHandle() with help flags
- [ ] Write failing tests for shouldHandle() with version flags
- [ ] Write failing tests for shouldHandle() with unknown commands
- [ ] Write failing tests for shouldHandle() with commands and options
- [ ] Write failing tests for execute() showing help with no args
- [ ] Write failing tests for execute() parsing and executing commands
- [ ] Implement shouldHandle() method
- [ ] Implement execute() method
- [ ] Handle no-args case (show help)
- [ ] Handle command execution via Commander
- [ ] Add error handling
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(cli): implement command routing logic`

#### Episode 7: Integrate Command Registration
- [ ] Write failing test for registering all commands
- [ ] Write failing test for registering command options
- [ ] Write failing test for registering command descriptions
- [ ] Write failing test for registering default command
- [ ] Write failing test for command action execution
- [ ] Implement register() method
- [ ] Iterate over command definitions and register with Commander
- [ ] Add options to commands
- [ ] Add help text to commands
- [ ] Wire up action handlers to actual command implementations
- [ ] Extract option registration logic
- [ ] Add proper error handling
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(cli): implement command registration`

### Stream C: Configuration Management

#### Episode 8: Create ConfigurationManager Class Structure
- [ ] Create `lib/config/configuration-manager.ts`
- [ ] Create `test/config/configuration-manager.test.ts`
- [ ] Write failing test for default profile initialization
- [ ] Write failing test for custom profile acceptance
- [ ] Write failing test for XDG config initialization
- [ ] Write failing test for async method definitions
- [ ] Implement ConfigurationManager class
- [ ] Add constructor with profile parameter
- [ ] Initialize XDG config wrapper
- [ ] Add method stubs for all operations
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(config): create ConfigurationManager structure`

#### Episode 9: Implement Configuration Loading Methods
- [ ] Write failing test for exists() returning true when config exists
- [ ] Write failing test for exists() returning false when config missing
- [ ] Write failing test for loadUser() loading user configuration
- [ ] Write failing test for loadUser() throwing ConfigurationError on failure
- [ ] Write failing test for loadDerived() loading derived config
- [ ] Write failing test for loadDeploy() loading deployment config
- [ ] Implement exists() method
- [ ] Implement loadUser() with validation
- [ ] Implement loadDerived() without validation
- [ ] Implement loadDeploy() without validation
- [ ] Wrap errors in ConfigurationError
- [ ] Add proper null checks
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(config): implement configuration loading`

#### Episode 10: Implement Configuration Saving Methods
- [ ] Write failing test for saveUser() saving user configuration
- [ ] Write failing test for saveUser() throwing ConfigurationError on failure
- [ ] Write failing test for saveDeploy() saving deployment configuration
- [ ] Implement saveUser() with validation and backup
- [ ] Implement saveDeploy() without validation
- [ ] Wrap errors in ConfigurationError
- [ ] Ensure proper options passed to XDG config
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(config): implement configuration saving`

#### Episode 11: Implement Configuration Merging
- [ ] Write failing test for load() merging all configurations
- [ ] Write failing test for load() prioritizing deploy > derived > user
- [ ] Write failing test for load() handling missing configurations gracefully
- [ ] Write failing test for getPaths() returning XDG paths
- [ ] Implement load() method
- [ ] Call loadUser(), loadDerived(), loadDeploy()
- [ ] Implement merge() private method
- [ ] Ensure proper priority: deploy > derived > user
- [ ] Implement getPaths() method
- [ ] Handle undefined/null values
- [ ] Add JSDoc documentation
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `feat(config): implement configuration merging`

### Integration Episodes

#### Episode 12: Refactor CLI Entry Point
- [ ] Create `test/cli/cli-integration.test.ts`
- [ ] Write failing test for showing help when no arguments
- [ ] Write failing test for routing to legacy mode for explicit commands
- [ ] Write failing test for error handling with ErrorHandler
- [ ] Backup current `bin/cli.ts` (git will track)
- [ ] Import LegacyCommandMode and ErrorHandler
- [ ] Create main() function
- [ ] Extract args from process.argv
- [ ] Instantiate LegacyCommandMode
- [ ] Check shouldHandle() and route accordingly
- [ ] Wrap with ErrorHandler
- [ ] Remove old command registration code
- [ ] Add JSDoc comments
- [ ] Verify shebang line preserved
- [ ] All tests pass (including existing CLI tests)
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `refactor(cli): migrate entry point to LegacyCommandMode`

#### Episode 13: Add Comprehensive Documentation
- [ ] Add JSDoc for ICommandMode interface
- [ ] Add JSDoc for CommandDefinition and CommandOption interfaces
- [ ] Add JSDoc for LegacyCommandMode class
- [ ] Add JSDoc for LegacyCommandMode public methods
- [ ] Add JSDoc for ConfigurationManager class
- [ ] Add JSDoc for ConfigurationManager public methods
- [ ] Add JSDoc for CLIError class hierarchy
- [ ] Add JSDoc for ErrorHandler class
- [ ] Include usage examples where appropriate
- [ ] Add @throws tags for error methods
- [ ] Add cross-references between related components
- [ ] All tests pass
- [ ] Run `npm run test` - passes
- [ ] Run `npm run lint` - passes
- [ ] Commit: `docs(cli): add comprehensive JSDoc documentation`

## Final Validation

### Pre-Merge Checklist

#### Test Coverage
- [ ] Run `npm run test` - all tests pass
- [ ] Check test coverage > 85% on new code
- [ ] Verify no test modifications to existing tests

#### Code Quality
- [ ] Run `npm run lint` - no linting errors
- [ ] Run `npm run build:typecheck` - no TypeScript errors
- [ ] Fix all IDE diagnostics

#### Backward Compatibility
- [ ] Run `npm run test:local` - integration tests pass (if applicable)
- [ ] All existing CLI tests still pass

#### Manual Testing
- [ ] `npx benchling-webhook` shows help
- [ ] `npx benchling-webhook --help` shows help
- [ ] `npx benchling-webhook --version` shows version
- [ ] `npx benchling-webhook deploy --help` shows deploy help
- [ ] All existing commands still work identically

#### Documentation
- [ ] All JSDoc comments complete
- [ ] README unchanged (no user-facing changes)
- [ ] Phase 1 design document matches implementation
- [ ] Update PR description with summary

## Success Criteria

- [ ] Zero user-facing changes - all existing functionality works identically
- [ ] All 13 episodes completed and committed
- [ ] All new code has comprehensive tests (85%+ coverage)
- [ ] All existing tests pass without modification
- [ ] Linting passes with no errors
- [ ] TypeScript compiles without errors
- [ ] JSDoc documentation complete on all public interfaces
- [ ] Clean git history with descriptive commits
- [ ] PR ready for review

## Notes

- This is a pre-factoring phase: we wrap existing code, we don't change behavior
- TDD cycle strictly followed: Red → Green → Refactor
- Each episode is atomic and independently committable
- All changes maintain working state throughout
