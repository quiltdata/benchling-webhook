# Phase 3 Implementation Checklist

**Phase**: 3 of 3
**Reference**:
- spec/221-next-steps/11-phase3-design.md
- spec/221-next-steps/12-phase3-episodes.md
**GitHub Issue**: #221

## Pre-Implementation

- [x] Read and understand Phase 3 design document
- [x] Read and understand Phase 3 episodes document
- [x] Read and understand Phases 1 & 2 implementations
- [x] Review existing codebase structure
- [x] Understand test patterns and infrastructure

## Episode 1: Install Command Foundation

### Design
- [ ] Review install command interface from design doc
- [ ] Understand orchestration flow
- [ ] Plan error handling approach

### Implementation
- [ ] Create `bin/commands/install.ts` file
- [ ] Define `InstallCommandOptions` interface
- [ ] Implement `installCommand()` function skeleton
- [ ] Import and call setup wizard
- [ ] Add basic try-catch error handling
- [ ] Add TypeScript types for all parameters

### Testing
- [ ] Create `test/bin/install.test.ts`
- [ ] Test: Install command can be imported
- [ ] Test: Install command calls setup wizard
- [ ] Test: Errors from setup are propagated
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] Code coverage >85% for new code
- [ ] Manual test: Can call install command programmatically

---

## Episode 2: Setup Wizard Return Value

### Design
- [ ] Review `SetupWizardResult` interface design
- [ ] Plan backward compatibility approach
- [ ] Understand impact on existing code

### Implementation
- [ ] Define `SetupWizardResult` interface in `bin/commands/setup-wizard.ts`
- [ ] Update `setupWizardCommand()` return type to `Promise<SetupWizardResult>`
- [ ] Return success status from setup wizard
- [ ] Return config and profile from setup wizard
- [ ] Update `runInstallWizard()` to return result

### Testing
- [ ] Update existing setup wizard tests for new return type
- [ ] Test: Setup wizard returns success=true on success
- [ ] Test: Setup wizard returns config object
- [ ] Test: Setup wizard returns profile name
- [ ] Test: Setup wizard propagates errors (returns success=false)
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] No breaking changes to existing callers
- [ ] Code coverage maintained

---

## Episode 3: Deployment Confirmation Prompt

### Design
- [ ] Review prompt design and messaging
- [ ] Plan flag handling logic
- [ ] Design validation for conflicting flags

### Implementation
- [ ] Add deployment confirmation prompt using inquirer
- [ ] Parse `--yes` flag in install command
- [ ] Parse `--setup-only` flag in install command
- [ ] Implement flag validation function
- [ ] Add deployment details to prompt message
- [ ] Handle user response (Yes/No)

### Testing
- [ ] Test: Prompt displays when no flags
- [ ] Test: `--yes` flag skips prompt and auto-deploys
- [ ] Test: `--setup-only` flag skips deployment entirely
- [ ] Test: Conflicting flags throw validation error
- [ ] Test: User answering "no" skips deployment
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] Prompt message clear and informative
- [ ] Code coverage >85%
- [ ] Manual test: Prompt appears and works correctly

---

## Episode 4: Deploy Command Integration

### Design
- [ ] Review deploy command interface
- [ ] Plan how to pass profile/stage to deploy
- [ ] Design error handling for deploy failures

### Implementation
- [ ] Import `deployCommand` in install command
- [ ] Build deploy options from setup result
- [ ] Determine stage from profile (dev/prod)
- [ ] Call deploy command with correct options
- [ ] Capture deployment success/failure
- [ ] Handle deploy errors gracefully
- [ ] Show progress messages during deployment

### Testing
- [ ] Test: Deploy command called with correct profile
- [ ] Test: Deploy command called with correct stage
- [ ] Test: Deploy success captured
- [ ] Test: Deploy failure captured and handled
- [ ] Test: Deploy not called if setup fails
- [ ] Test: Deploy not called if user declines
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] Error messages clear and actionable
- [ ] Code coverage >85%
- [ ] Manual test: Deploy runs after setup confirmation

---

## Episode 5: Next Steps with Deployment Context

### Design
- [ ] Review next steps variations (success/failure/skipped)
- [ ] Plan message format for each scenario
- [ ] Design webhook URL display

### Implementation
- [ ] Update `generateNextSteps()` to handle deployment result
- [ ] Show webhook URL when deployment succeeds
- [ ] Show recovery steps when deployment fails
- [ ] Show manual deploy command when skipped
- [ ] Format messages appropriately for context

### Testing
- [ ] Test: Next steps with successful deployment includes webhook URL
- [ ] Test: Next steps with failed deployment includes error and retry
- [ ] Test: Next steps with skipped deployment includes deploy command
- [ ] Test: Context-aware commands (npx vs npm) still work
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] Messages clear and helpful
- [ ] Code coverage >85%
- [ ] Manual test: Next steps appropriate for each scenario

---

## Episode 6: CLI Default Command Update

### Design
- [ ] Review CLI argument parsing logic
- [ ] Plan backward compatibility preservation
- [ ] Design help text updates

### Implementation
- [ ] Update `bin/cli.ts` default behavior
- [ ] Change default from `setupWizardCommand` to `installCommand`
- [ ] Parse flags for install command (--yes, --setup-only)
- [ ] Preserve explicit `setup` command
- [ ] Update CLI help text and description
- [ ] Update examples in help text

### Testing
- [ ] Test: No arguments runs install command
- [ ] Test: Explicit `setup` command runs setup only
- [ ] Test: Explicit `deploy` command runs deploy only
- [ ] Test: Flags parsed correctly for install
- [ ] Test: Help text displays correctly
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] No breaking changes to existing commands
- [ ] Code coverage >85%
- [ ] Manual test: Default command is install

---

## Episode 7: Setup Wizard Next Steps Suppression

### Design
- [ ] Review when to suppress next steps
- [ ] Plan option naming and interface
- [ ] Design message flow for install vs standalone

### Implementation
- [ ] Add `isPartOfInstall` option to `SetupWizardOptions`
- [ ] Skip "Setup Complete!" message when `isPartOfInstall=true`
- [ ] Skip `generateNextSteps()` call when `isPartOfInstall=true`
- [ ] Update install command to pass `isPartOfInstall=true`
- [ ] Ensure standalone setup still shows messages

### Testing
- [ ] Test: Standalone setup shows "Setup Complete!" and next steps
- [ ] Test: Install-integrated setup suppresses next steps
- [ ] Test: Install-integrated setup still saves config
- [ ] Test: Install-integrated setup returns correct result
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] User experience smooth for both flows
- [ ] Code coverage >85%
- [ ] Manual test: Next steps only shown once

---

## Episode 8: Error Handling and Recovery

### Design
- [ ] Review all error paths
- [ ] Plan error messages for each scenario
- [ ] Design recovery instructions

### Implementation
- [ ] Handle setup failures (exit before deploy)
- [ ] Handle deploy failures (show recovery)
- [ ] Handle user cancellation gracefully
- [ ] Handle network errors
- [ ] Add actionable error messages
- [ ] Show recovery commands on errors
- [ ] Set correct exit codes (0 or 1)

### Testing
- [ ] Test: Setup failure prevents deploy
- [ ] Test: Setup failure shows error message
- [ ] Test: Deploy failure shows recovery steps
- [ ] Test: User cancellation handled gracefully
- [ ] Test: Network errors caught and displayed
- [ ] Test: Exit code 0 on success
- [ ] Test: Exit code 1 on failure
- [ ] Run tests and verify they pass

### Quality
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] All error messages actionable
- [ ] Recovery steps clear
- [ ] Code coverage >85%
- [ ] Manual test: All error paths work correctly

---

## Episode 9: Documentation Updates

### README.md
- [ ] Update Quick Start section
- [ ] Add new default behavior explanation
- [ ] Document `--setup-only` flag
- [ ] Document `--yes` flag
- [ ] Update examples throughout
- [ ] Add Advanced Options section
- [ ] Update command reference
- [ ] Verify all code examples work

### CHANGELOG.md
- [ ] Add entry for version 0.8.0 (or appropriate)
- [ ] Document behavior change
- [ ] List new flags
- [ ] Note backward compatibility
- [ ] Add migration notes

### CLI Help Text
- [ ] Update main program description
- [ ] Update default command help
- [ ] Add setup-only flag documentation
- [ ] Add yes flag documentation
- [ ] Update examples in help
- [ ] Verify help text accuracy

### Other Documentation
- [ ] Review and update any other docs
- [ ] Check for conflicting information
- [ ] Verify links are valid

---

## Episode 10: Integration Testing

### Test Suite Creation
- [ ] Create `test/integration/install-flow.test.ts`
- [ ] Set up test fixtures and mocks
- [ ] Configure test environment

### Integration Tests
- [ ] Test: Complete install flow (setup → deploy)
- [ ] Test: Setup-only flow (--setup-only flag)
- [ ] Test: Auto-deploy flow (--yes flag)
- [ ] Test: User declines deployment
- [ ] Test: Setup failure prevents deploy
- [ ] Test: Deploy failure after setup
- [ ] Test: All flag combinations
- [ ] Test: Backward compatibility (explicit commands)

### Manual Testing
- [ ] Fresh install via npx (interactive)
- [ ] Fresh install via npx --yes (non-interactive)
- [ ] Setup-only via npx --setup-only
- [ ] Explicit setup command
- [ ] Explicit deploy command
- [ ] Repository context (npm scripts)
- [ ] Error scenarios (setup fail, deploy fail)
- [ ] User cancellation (Ctrl+C)

### Quality
- [ ] All integration tests pass
- [ ] All unit tests still pass
- [ ] Manual testing checklist complete
- [ ] No regressions found

---

## Final Quality Assurance

### Code Quality
- [ ] Run full test suite: `npm run test`
- [ ] Run type checking: `npm run build:typecheck`
- [ ] Run linting: `npm run lint`
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Code coverage >85%

### Functionality
- [ ] Default command is install
- [ ] Install chains setup → deploy
- [ ] User confirmation works
- [ ] `--yes` flag auto-deploys
- [ ] `--setup-only` flag skips deploy
- [ ] All existing commands work
- [ ] Next steps include deployment context
- [ ] Error handling works for all paths

### Documentation
- [ ] README.md accurate
- [ ] CHANGELOG.md updated
- [ ] Help text correct
- [ ] Examples all work
- [ ] No conflicting information

### Backward Compatibility
- [ ] Explicit `setup` command works
- [ ] Explicit `deploy` command works
- [ ] All npm scripts work
- [ ] No breaking changes to API
- [ ] Existing workflows unaffected

---

## Commit and Review

### Pre-Commit
- [ ] Review all changed files
- [ ] Verify no debug code left
- [ ] Check for commented-out code
- [ ] Verify no TODOs left unresolved
- [ ] Run `make lint` one final time
- [ ] Run `make test` one final time

### Commit
- [ ] Stage all changes
- [ ] Create commit with descriptive message
- [ ] Include reference to issue #221
- [ ] Include co-author attribution

### Post-Commit
- [ ] Verify commit succeeded
- [ ] Check git status clean
- [ ] Review commit diff one more time

---

## Success Criteria Verification

### Must Have
- [x] All spec documents created (design, episodes, checklist)
- [ ] Default command is 'install'
- [ ] Install chains setup → deploy with confirmation
- [ ] All tests passing (unit + integration)
- [ ] Zero breaking changes to existing commands
- [ ] Documentation updated (README, CHANGELOG, help)
- [ ] IDE diagnostics clean (no TS errors, no lint warnings)

### Should Have
- [ ] Test coverage >85%
- [ ] Error messages actionable
- [ ] Clear user feedback at each step
- [ ] Recovery steps shown on failures

### Nice to Have
- [ ] Performance unchanged
- [ ] User experience smooth
- [ ] Code well-documented

---

## Summary

Use this checklist to track progress through Phase 3 implementation. Check off items as completed. If any item cannot be completed, document why and adjust plan accordingly.

**Current Status**: Ready to begin implementation

**Next Step**: Episode 1 - Install Command Foundation
