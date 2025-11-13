# Phases Document - Issue #221: Next Steps

**Reference**:
- spec/221-next-steps/01-requirements.md
- spec/221-next-steps/02-analysis.md
- spec/221-next-steps/03-specifications.md
**GitHub Issue**: #221

## Overview

This document breaks down the implementation into three sequential phases, each delivering working, testable functionality that can be independently reviewed and merged.

## Phase Breakdown Strategy

### Pre-factoring Principle

Following the "make the change easy, then make the easy change" principle:

1. **Phase 1**: Extract and modularize existing next steps logic (refactoring)
2. **Phase 2**: Add context detection and dynamic next steps (new feature)
3. **Phase 3**: Implement command chaining workflow (integration)

This approach:
- Makes each phase smaller and more focused
- Allows Phase 2 and 3 to build on clean foundations
- Reduces risk by establishing patterns before adding complexity
- Enables early feedback on architecture decisions

## Phase 1: Extract Next Steps Logic

**Goal**: Refactor existing next steps code into reusable, testable module

**Why First**: Clean up current implementation before adding features, establish testing patterns

### Deliverables

1. **lib/next-steps-generator.ts**: New module with next steps generation logic
2. **Tests**: Unit tests for next steps generator
3. **Integration**: Update setup-wizard.ts to use new module
4. **Validation**: Existing behavior unchanged, all tests pass

### Success Criteria

- [ ] Next steps logic extracted from setup-wizard.ts
- [ ] Function signature supports future context parameter
- [ ] 100% test coverage for next steps generation
- [ ] All existing next steps messages work identically
- [ ] No behavior changes visible to users

### Dependencies

- None (refactoring existing code)

### Risks

- **Low risk**: Pure refactoring, should not change behavior
- **Mitigation**: Comprehensive tests before and after refactoring

### Testing Strategy

1. Capture current next steps outputs for all profiles
2. Create unit tests matching current behavior
3. Refactor code
4. Verify outputs unchanged
5. Add additional test cases

## Phase 2: Context Detection and Dynamic Next Steps

**Goal**: Detect execution context and generate context-appropriate next steps

**Why Second**: Builds on clean Phase 1 foundation, enables correct messaging

### Deliverables

1. **lib/context-detector.ts**: Execution context detection module
2. **Enhanced next-steps-generator.ts**: Context-aware message generation
3. **Tests**: Comprehensive unit tests for both modules
4. **Integration**: Update setup-wizard.ts to use context detection
5. **Documentation**: Update README.md with correct examples

### Success Criteria

- [ ] Context detector correctly identifies npx vs repository execution
- [ ] Next steps messages match execution context
- [ ] Repository developers see npm script suggestions
- [ ] NPX users see npx command suggestions
- [ ] Custom profiles show appropriate commands
- [ ] 100% test coverage for new code
- [ ] README.md examples updated

### Dependencies

- **Phase 1**: Requires extracted next steps generator

### Risks

- **Medium risk**: Context detection may have edge cases
- **Mitigation**: Extensive testing of detection logic, fallback to safe defaults

### Testing Strategy

1. Mock file system for context detection tests
2. Test matrix of context × profile × stage combinations
3. Integration tests with real setup wizard flow
4. Manual testing via npx and npm scripts

### Sequencing Within Phase

1. Implement context detector with tests
2. Enhance next steps generator with context support
3. Integrate into setup wizard
4. Update documentation

## Phase 3: Command Chaining Workflow

**Goal**: Implement setup → deploy chaining with user confirmation

**Why Third**: Most complex change, requires Phases 1-2 foundation

### Deliverables

1. **Enhanced bin/cli.ts**: Orchestration logic for chained workflow
2. **Command chaining**: Setup wizard calls deploy on confirmation
3. **Deployment next steps**: Post-deployment messages
4. **CLI flags**: `--setup-only` flag support
5. **Tests**: Integration tests for chained workflow
6. **Documentation**: Update README.md and CHANGELOG.md

### Success Criteria

- [ ] Default CLI behavior runs setup → deploy chain
- [ ] User prompted for deployment confirmation
- [ ] `--setup-only` flag skips deployment
- [ ] `--yes` flag auto-deploys without prompt
- [ ] Setup errors prevent deployment
- [ ] Deployment success/failure handled gracefully
- [ ] Deployment outputs displayed
- [ ] Next steps include deployment results
- [ ] Backward compatibility maintained
- [ ] All integration tests pass

### Dependencies

- **Phase 1**: Clean next steps generator
- **Phase 2**: Context-aware next steps

### Risks

- **High risk**: Complex workflow with multiple error paths
- **Mitigation**: Comprehensive error handling, clear user feedback, extensive testing

### Testing Strategy

1. Unit tests for orchestration logic
2. Integration tests for full workflow
3. Error injection tests (setup fails, deploy fails, network errors)
4. Non-interactive mode tests
5. Manual testing of all user paths

### Sequencing Within Phase

1. Add deployment confirmation prompt to setup wizard
2. Implement command chaining logic
3. Add `--setup-only` flag support
4. Handle deployment results in next steps
5. Add comprehensive error handling
6. Update documentation

## Integration Testing Strategy

### Cross-Phase Integration

After Phase 3, validate complete workflow:

1. **Fresh install via npx**:
   - Run `npx @quiltdata/benchling-webhook`
   - Verify setup → deploy chain works
   - Verify next steps show npx commands

2. **Repository developer workflow**:
   - Run `npm run setup`
   - Verify setup → deploy chain works
   - Verify next steps show npm scripts

3. **Standalone commands**:
   - Verify `deploy` works independently
   - Verify `init` still works as alias
   - Verify all other commands unchanged

4. **Error scenarios**:
   - Setup fails → no deploy attempted
   - Deploy fails → clear error message
   - User cancels → graceful exit

5. **Flag combinations**:
   - `--setup-only` → no deployment
   - `--yes` → auto deployment
   - `--profile custom` → correct context

## Dependencies Between Phases

```
Phase 1: Extract Next Steps
  ↓
Phase 2: Context Detection (depends on Phase 1)
  ↓
Phase 3: Command Chaining (depends on Phase 1 & 2)
```

**Rationale**: Each phase builds on the previous, ensuring:
- Clean foundation before adding complexity
- Testable components before integration
- Early feedback on architecture

## Quality Gates Per Phase

### Phase 1 Gates

- [ ] All existing tests pass
- [ ] New unit tests have 100% coverage
- [ ] No behavior changes in next steps output
- [ ] Code review approved
- [ ] Lint and type checks pass

### Phase 2 Gates

- [ ] Context detection tests pass
- [ ] Next steps match execution context
- [ ] Integration tests pass
- [ ] README.md updated
- [ ] Code review approved
- [ ] Lint and type checks pass

### Phase 3 Gates

- [ ] Command chaining works end-to-end
- [ ] All error paths tested
- [ ] Integration tests pass
- [ ] README.md accurately reflects behavior
- [ ] CHANGELOG.md updated
- [ ] Code review approved
- [ ] Lint and type checks pass
- [ ] Manual testing completed

## Rollback Strategy

### Phase 1 Rollback
- **Easy**: Revert commits, restore original setup-wizard.ts
- **Impact**: None (pure refactoring)

### Phase 2 Rollback
- **Moderate**: Keep Phase 1, revert Phase 2 commits
- **Impact**: Back to repository-centric next steps (current state)

### Phase 3 Rollback
- **Complex**: Keep Phases 1-2, revert Phase 3 commits
- **Impact**: No command chaining, but correct next steps preserved

## Timeline Estimates

### Phase 1: Extract Next Steps Logic
- **Estimation**: 4-6 hours
- **Breakdown**:
  - Create module: 1h
  - Write tests: 2h
  - Integrate: 1h
  - Review/fixes: 1-2h

### Phase 2: Context Detection and Dynamic Next Steps
- **Estimation**: 6-8 hours
- **Breakdown**:
  - Context detector: 2h
  - Enhance next steps: 2h
  - Tests: 2h
  - Documentation: 1h
  - Review/fixes: 1-2h

### Phase 3: Command Chaining Workflow
- **Estimation**: 8-10 hours
- **Breakdown**:
  - Orchestration logic: 2h
  - Prompts and flags: 2h
  - Error handling: 2h
  - Tests: 2h
  - Documentation: 1h
  - Review/fixes: 1-2h

**Total**: 18-24 hours across 3 phases

## Risk Mitigation

### Mitigation 1: Context Detection Accuracy
- **Strategy**: Test matrix covering all scenarios
- **Validation**: Manual testing in multiple environments
- **Fallback**: Safe defaults if detection uncertain

### Mitigation 2: Backward Compatibility
- **Strategy**: Run full test suite after each phase
- **Validation**: Test all existing npm scripts
- **Fallback**: Feature flags if needed

### Mitigation 3: User Confusion
- **Strategy**: Clear progress messages
- **Validation**: User testing feedback
- **Fallback**: Comprehensive help text

## Success Metrics

### Phase 1 Success
- All tests pass
- No regression in functionality
- Code coverage maintained

### Phase 2 Success
- Next steps accuracy: 100% for tested contexts
- Zero issues reported about wrong commands
- README.md feedback positive

### Phase 3 Success
- >90% of users successfully deploy via default flow
- Zero breaking changes reported
- Deployment success rate unchanged

## Summary

This three-phase approach:

1. **Phase 1** establishes clean, testable foundation
2. **Phase 2** delivers correct next steps based on context
3. **Phase 3** completes the vision with command chaining

Each phase:
- Delivers working, testable functionality
- Can be independently reviewed and merged
- Reduces risk through incremental changes
- Maintains backward compatibility

The sequential dependency structure ensures each phase builds on solid foundations, while the pre-factoring in Phase 1 makes subsequent phases easier to implement.
