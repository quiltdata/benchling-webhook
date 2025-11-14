# Phase 3 Episodes - Command Chaining Implementation

**Phase**: 3 of 3
**Reference**: spec/221-next-steps/11-phase3-design.md
**GitHub Issue**: #221

## Overview

This document breaks down Phase 3 implementation into discrete, testable episodes. Each episode delivers working functionality that can be independently verified.

## Episode Breakdown

### Episode 1: Install Command Foundation

**Goal**: Create install command skeleton with basic orchestration

**Duration**: 1-1.5 hours

**Tasks**:
1. Create `bin/commands/install.ts` file
2. Define `InstallCommandOptions` interface
3. Implement basic `installCommand()` function
4. Call setup wizard from install command
5. Add basic error handling

**Deliverables**:
- `bin/commands/install.ts` (basic skeleton)
- Setup wizard called successfully
- Error propagation working

**Test Requirements**:
- Install command can be imported
- Install command calls setup wizard
- Errors from setup are caught and re-thrown

**Acceptance Criteria**:
```bash
# Should work
npx ts-node -e "import('./bin/commands/install').then(m => m.installCommand({}))"
```

---

### Episode 2: Setup Wizard Return Value

**Goal**: Make setup wizard return structured result

**Duration**: 1-1.5 hours

**Tasks**:
1. Define `SetupWizardResult` interface
2. Update `setupWizardCommand()` signature to return result
3. Capture profile and config in return value
4. Update tests to handle new return value
5. Ensure backward compatibility for direct calls

**Deliverables**:
- `SetupWizardResult` interface defined
- Setup wizard returns structured data
- Existing tests updated
- Type checking passes

**Test Requirements**:
- Setup wizard returns success/failure status
- Setup wizard returns config and profile
- Existing setup command still works

**Acceptance Criteria**:
```typescript
const result = await setupWizardCommand({ profile: 'test' });
expect(result.success).toBe(true);
expect(result.config).toBeDefined();
expect(result.profile).toBe('test');
```

---

### Episode 3: Deployment Confirmation Prompt

**Goal**: Add user prompt for deployment after setup

**Duration**: 1-1.5 hours

**Tasks**:
1. Create confirmation prompt using inquirer
2. Handle `--yes` flag to skip prompt
3. Handle `--setup-only` flag to skip deployment
4. Add flag validation (mutually exclusive)
5. Show deployment details in prompt

**Deliverables**:
- Confirmation prompt implemented
- Flag handling working
- Validation for conflicting flags

**Test Requirements**:
- User prompt displays correct info
- `--yes` flag skips prompt
- `--setup-only` flag skips deployment
- Error thrown for `--yes --setup-only`

**Acceptance Criteria**:
```typescript
// Interactive: prompt shown
await installCommand({ profile: 'test' });

// Non-interactive: auto-deploy
await installCommand({ profile: 'test', yes: true });

// Setup only: no deploy
await installCommand({ profile: 'test', setupOnly: true });

// Validation: error
expect(() => installCommand({ yes: true, setupOnly: true }))
    .rejects.toThrow("Cannot use both");
```

---

### Episode 4: Deploy Command Integration

**Goal**: Call deploy command from install command

**Duration**: 1.5-2 hours

**Tasks**:
1. Import deploy command in install
2. Build deploy options from setup result
3. Call deploy command with correct profile/stage
4. Capture deployment result
5. Handle deploy errors gracefully

**Deliverables**:
- Deploy command called after confirmation
- Profile and stage passed correctly
- Deployment outputs captured
- Error handling for deploy failures

**Test Requirements**:
- Deploy called with correct options
- Deploy errors caught and handled
- Setup success but deploy failure handled
- Outputs captured for next steps

**Acceptance Criteria**:
```typescript
const result = await installCommand({
    profile: 'test',
    yes: true,
});

// Deploy was called
expect(mockDeployCommand).toHaveBeenCalledWith({
    profile: 'test',
    stage: 'dev',
});

// Errors handled
mockDeployCommand.mockRejectedValue(new Error('Deploy failed'));
await expect(installCommand({ yes: true }))
    .rejects.toThrow('Deploy failed');
```

---

### Episode 5: Next Steps with Deployment Context

**Goal**: Update next steps to include deployment results

**Duration**: 1-1.5 hours

**Tasks**:
1. Pass deployment result to `generateNextSteps()`
2. Show webhook URL if deployment succeeded
3. Show recovery steps if deployment failed
4. Show manual deploy command if skipped
5. Update next steps generator tests

**Deliverables**:
- Next steps include deployment context
- Different messages for success/failure/skipped
- Webhook URL displayed on success
- Recovery commands shown on failure

**Test Requirements**:
- Next steps with successful deployment
- Next steps with failed deployment
- Next steps with skipped deployment
- Webhook URL included when available

**Acceptance Criteria**:
```typescript
// Success
const steps = generateNextSteps({
    profile: 'test',
    deployment: {
        success: true,
        webhookUrl: 'https://example.com/webhook',
    },
});
expect(steps).toContain('https://example.com/webhook');
expect(steps).toContain('Configure webhook URL');

// Failure
const steps = generateNextSteps({
    profile: 'test',
    deployment: {
        success: false,
        error: 'Deployment failed',
    },
});
expect(steps).toContain('Retry deployment');
expect(steps).toContain('deploy --profile test');
```

---

### Episode 6: CLI Default Command Update

**Goal**: Make CLI default to install command

**Duration**: 1 hour

**Tasks**:
1. Update `bin/cli.ts` default behavior
2. Call `installCommand()` instead of `setupWizardCommand()`
3. Preserve explicit `setup` command
4. Parse flags for install command
5. Update CLI help text

**Deliverables**:
- CLI defaults to install command
- Explicit commands still work
- Flags parsed correctly
- Help text updated

**Test Requirements**:
- Default command is install
- `setup` command still works
- All flags work with install
- Help displays correct info

**Acceptance Criteria**:
```bash
# Default: runs install
npx @quiltdata/benchling-webhook

# Explicit: runs setup only
npx @quiltdata/benchling-webhook setup

# Explicit: runs deploy only
npx @quiltdata/benchling-webhook deploy

# Flags work
npx @quiltdata/benchling-webhook --setup-only
npx @quiltdata/benchling-webhook --yes
```

---

### Episode 7: Setup Wizard Next Steps Suppression

**Goal**: Suppress next steps when setup is part of install

**Duration**: 0.5-1 hour

**Tasks**:
1. Add `isPartOfInstall` option to setup wizard
2. Skip "Setup Complete!" message if true
3. Skip `generateNextSteps()` call if true
4. Update setup wizard tests

**Deliverables**:
- Setup wizard accepts `isPartOfInstall` option
- Next steps suppressed when part of install
- Messages still shown for standalone setup

**Test Requirements**:
- Standalone setup shows next steps
- Install-integrated setup hides next steps
- "Setup Complete!" only shown standalone

**Acceptance Criteria**:
```typescript
// Standalone: shows next steps
await setupWizardCommand({ profile: 'test' });
// Output includes "Setup Complete!" and next steps

// Part of install: suppresses next steps
await setupWizardCommand({
    profile: 'test',
    isPartOfInstall: true,
});
// Output does NOT include next steps
```

---

### Episode 8: Error Handling and Recovery

**Goal**: Comprehensive error handling for all failure paths

**Duration**: 1.5-2 hours

**Tasks**:
1. Handle setup failures (exit before deploy)
2. Handle deploy failures (show recovery)
3. Handle user cancellation (Ctrl+C)
4. Handle network errors
5. Show actionable error messages
6. Add error tests for all paths

**Deliverables**:
- All error paths handled
- Clear error messages
- Recovery steps shown
- Graceful exits

**Test Requirements**:
- Setup failure prevents deploy
- Deploy failure shows recovery
- User cancellation handled
- Network errors caught
- Exit codes correct (0 or 1)

**Acceptance Criteria**:
```typescript
// Setup fails
mockSetupWizard.mockRejectedValue(new Error('Setup failed'));
await expect(installCommand()).rejects.toThrow('Setup failed');
expect(mockDeployCommand).not.toHaveBeenCalled();

// Deploy fails
mockDeployCommand.mockRejectedValue(new Error('Deploy failed'));
await installCommand({ yes: true });
// Should show recovery steps

// User cancels
mockInquirer.mockResolvedValue({ shouldDeploy: false });
await installCommand();
// Should show next steps with deploy command
```

---

### Episode 9: Documentation Updates

**Goal**: Update all documentation for new default behavior

**Duration**: 1-1.5 hours

**Tasks**:
1. Update README.md Quick Start
2. Add CHANGELOG.md entry
3. Update CLI help text
4. Add migration notes
5. Update examples throughout

**Deliverables**:
- README.md updated
- CHANGELOG.md has new entry
- Help text accurate
- Migration guide included

**Test Requirements**:
- All code examples work
- Links valid
- No conflicting information

**Acceptance Criteria**:
```bash
# Examples in README work
npx @quiltdata/benchling-webhook
npx @quiltdata/benchling-webhook --setup-only
npx @quiltdata/benchling-webhook --yes

# Help text correct
npx @quiltdata/benchling-webhook --help
# Shows: Run without arguments for interactive setup + deploy
```

---

### Episode 10: Integration Testing

**Goal**: End-to-end testing of complete workflow

**Duration**: 1.5-2 hours

**Tasks**:
1. Create integration test suite
2. Test complete install flow (setup → deploy)
3. Test all flag combinations
4. Test error scenarios
5. Test backward compatibility
6. Manual testing checklist

**Deliverables**:
- Integration test suite
- All scenarios tested
- Manual testing passed
- Edge cases covered

**Test Requirements**:
- Full workflow tested
- All flags tested
- Errors tested
- Backward compat verified

**Acceptance Criteria**:
```typescript
describe('Install Command Integration', () => {
    it('should run complete install flow', async () => {
        await installCommand({ yes: true, profile: 'test' });

        expect(mockSetup).toHaveBeenCalled();
        expect(mockDeploy).toHaveBeenCalled();
        expect(mockNextSteps).toHaveBeenCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    success: true,
                }),
            })
        );
    });

    it('should handle all error paths', async () => {
        // Test all error scenarios
    });

    it('should maintain backward compatibility', async () => {
        // Test explicit commands still work
    });
});
```

---

## Episode Dependencies

```
Episode 1: Install Command Foundation
    ↓
Episode 2: Setup Wizard Return Value
    ↓
Episode 3: Deployment Confirmation Prompt
    ↓
Episode 4: Deploy Command Integration
    ↓ ↘
Episode 5: Next Steps Context     Episode 7: Next Steps Suppression
    ↓                                     ↓
Episode 6: CLI Default Update ←──────────┘
    ↓
Episode 8: Error Handling
    ↓
Episode 9: Documentation
    ↓
Episode 10: Integration Testing
```

## Testing Strategy Per Episode

### Unit Testing
- Write tests BEFORE implementation
- One test file per new module
- Mock external dependencies
- Test all branches

### Integration Testing
- Test episode integration points
- Verify data flows correctly
- Test error propagation

### Manual Testing
- Run actual CLI commands
- Verify user experience
- Test in both contexts (npx and repository)

## Quality Gates Per Episode

Each episode must pass:
- [ ] TypeScript compiles with no errors
- [ ] ESLint passes with no warnings
- [ ] Unit tests pass with >85% coverage
- [ ] Integration tests pass
- [ ] Manual testing successful
- [ ] No regressions in existing features

## Rollback Points

After each episode, code should be in a stable state that could be committed if needed. This allows for incremental progress and easier debugging.

## Time Estimates

| Episode | Estimated Time | Cumulative |
|---------|---------------|------------|
| 1. Install Foundation | 1-1.5h | 1-1.5h |
| 2. Setup Return Value | 1-1.5h | 2-3h |
| 3. Confirmation Prompt | 1-1.5h | 3-4.5h |
| 4. Deploy Integration | 1.5-2h | 4.5-6.5h |
| 5. Next Steps Context | 1-1.5h | 5.5-8h |
| 6. CLI Default Update | 1h | 6.5-9h |
| 7. Next Steps Suppression | 0.5-1h | 7-10h |
| 8. Error Handling | 1.5-2h | 8.5-12h |
| 9. Documentation | 1-1.5h | 9.5-13.5h |
| 10. Integration Testing | 1.5-2h | 11-15.5h |

**Total Estimate**: 11-15.5 hours

## Success Metrics

### Per Episode
- All tests pass
- Code compiles
- No lint errors
- Feature works as designed

### Overall Phase 3
- All 10 episodes complete
- Integration tests pass
- Manual testing checklist complete
- Documentation accurate
- Zero breaking changes

## Summary

Phase 3 implementation is broken into 10 discrete episodes, each delivering testable functionality. The episodes follow a logical dependency chain, building from foundation to complete integration. Each episode has clear acceptance criteria and quality gates, ensuring incremental progress toward the final goal.
