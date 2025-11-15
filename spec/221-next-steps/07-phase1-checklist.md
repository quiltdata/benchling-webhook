# Phase 1 Checklist: Extract Next Steps Logic

**Reference**:
- spec/221-next-steps/05-phase1-design.md
- spec/221-next-steps/06-phase1-episodes.md
**GitHub Issue**: #221

## Pre-Implementation Checklist

- [ ] All I RASP documents reviewed and approved
- [ ] Phase 1 design document reviewed
- [ ] Episodes document reviewed
- [ ] Development environment ready
- [ ] Branch `221-next-steps` checked out
- [ ] All existing tests passing
- [ ] TypeScript compilation successful

## Episode 1: Create Type Definitions

### Tasks

- [ ] Create `lib/types/` directory (if not exists)
- [ ] Create `lib/types/next-steps.ts`
- [ ] Define `ExecutionContext` interface with JSDoc
- [ ] Define `DeploymentResult` interface with JSDoc
- [ ] Define `NextStepsOptions` interface with JSDoc
- [ ] Export all interfaces
- [ ] Verify TypeScript compilation

### Validation

- [ ] File compiles without errors
- [ ] Interfaces properly exported
- [ ] JSDoc comments complete and accurate

### Testing

- [ ] Run `npm run build:typecheck`
- [ ] Verify no type errors

### Commit

- [ ] Stage changes: `git add lib/types/next-steps.ts`
- [ ] Commit: `git commit -m "feat: add type definitions for next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 2: Create Generator Module (Red)

### Tasks

- [ ] Create `tests/lib/` directory (if not exists)
- [ ] Create `tests/lib/next-steps-generator.test.ts`
- [ ] Import (non-existent) `generateNextSteps` function
- [ ] Write test for default profile
- [ ] Assert "Next steps:" in output
- [ ] Assert "npm run deploy" in output
- [ ] Assert "npm run test" in output

### Validation

- [ ] Test file created
- [ ] Test imports proper types
- [ ] Test expectations match current behavior

### Testing

- [ ] Run `npm test` - should fail (module doesn't exist)
- [ ] Verify error is about missing module

### Critical Test Cases

- **TC-RED-1**: Default profile test fails with "Cannot find module"

### Commit

- [ ] Stage changes: `git add tests/lib/next-steps-generator.test.ts`
- [ ] Commit: `git commit -m "test: add failing test for next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 3: Implement Generator Module (Green)

### Tasks

- [ ] Create `lib/next-steps-generator.ts`
- [ ] Import `NextStepsOptions` type
- [ ] Implement `generateNextSteps()` function
- [ ] Handle default profile case
- [ ] Use string array pattern for output
- [ ] Join with newlines
- [ ] Export function

### Validation

- [ ] Module compiles successfully
- [ ] Function signature matches design
- [ ] Default profile test now passes
- [ ] No other functionality implemented yet

### Testing

- [ ] Run `npm test` - default profile test should pass
- [ ] Verify test output matches expectations

### Critical Test Cases

- **TC-GREEN-1**: Default profile test passes
- **TC-GREEN-2**: Function returns string
- **TC-GREEN-3**: Output contains expected commands

### Commit

- [ ] Stage changes: `git add lib/next-steps-generator.ts`
- [ ] Commit: `git commit -m "feat: implement basic next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 4: Add Dev Profile Support

### 4a: Red Phase

#### Tasks

- [ ] Add test case for dev profile
- [ ] Assert "npm run deploy:dev" in output
- [ ] Assert "npm run test:dev" in output

#### Testing

- [ ] Run `npm test` - dev profile test should fail

#### Critical Test Cases

- **TC-RED-2**: Dev profile test fails
- **TC-RED-3**: Default profile test still passes

### 4b: Green Phase

#### Tasks

- [ ] Add `else if (profile === 'dev')` branch
- [ ] Add deploy:dev command
- [ ] Add test:dev command

#### Testing

- [ ] Run `npm test` - dev profile test should pass
- [ ] Verify default profile still works

#### Critical Test Cases

- **TC-GREEN-4**: Dev profile test passes
- **TC-GREEN-5**: Default profile test still passes

### 4c: Refactor Phase (Optional)

#### Tasks

- [ ] Assess if refactoring needed (may defer to Episode 6)
- [ ] If yes: extract helper function
- [ ] If yes: update tests to verify behavior

#### Testing

- [ ] Run `npm test` - all tests still pass
- [ ] Run `npm run lint` - no linting errors

### Commit

- [ ] Stage changes: `git add lib/next-steps-generator.ts tests/lib/next-steps-generator.test.ts`
- [ ] Commit: `git commit -m "feat: add dev profile support to next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 5: Add Prod Profile Support

### 5a: Red Phase

#### Tasks

- [ ] Add test case for prod profile
- [ ] Assert "npm run deploy:prod" in output
- [ ] Assert "npm run test:prod" in output

#### Testing

- [ ] Run `npm test` - prod profile test should fail

#### Critical Test Cases

- **TC-RED-4**: Prod profile test fails
- **TC-RED-5**: Previous tests still pass

### 5b: Green Phase

#### Tasks

- [ ] Add `else if (profile === 'prod')` branch
- [ ] Add deploy:prod command
- [ ] Add test:prod command

#### Testing

- [ ] Run `npm test` - all profile tests pass

#### Critical Test Cases

- **TC-GREEN-6**: Prod profile test passes
- **TC-GREEN-7**: All previous tests still pass

### Commit

- [ ] Stage changes: `git add lib/next-steps-generator.ts tests/lib/next-steps-generator.test.ts`
- [ ] Commit: `git commit -m "feat: add prod profile support to next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 6: Add Custom Profile Support

### 6a: Red Phase

#### Tasks

- [ ] Add test case for custom profile (e.g., 'staging')
- [ ] Assert "npm run deploy -- --profile staging" in output
- [ ] Assert "npx ts-node scripts/check-logs.ts --profile staging" in output

#### Testing

- [ ] Run `npm test` - custom profile test should fail

#### Critical Test Cases

- **TC-RED-6**: Custom profile test fails
- **TC-RED-7**: All standard profile tests pass

### 6b: Green Phase

#### Tasks

- [ ] Add `else` branch for custom profiles
- [ ] Add deploy command with --profile flag
- [ ] Add check-logs command with --profile flag

#### Testing

- [ ] Run `npm test` - custom profile test passes

#### Critical Test Cases

- **TC-GREEN-8**: Custom profile test passes
- **TC-GREEN-9**: All previous tests still pass

### 6c: Refactor Phase

#### Tasks

- [ ] Create `formatDeployCommand()` helper function
- [ ] Create `formatTestCommand()` helper function
- [ ] Refactor main function to use helpers
- [ ] Update all branches to use helpers
- [ ] Verify DRY principle applied

#### Testing

- [ ] Run `npm test` - all tests still pass
- [ ] Run `npm run lint` - check code quality

#### Critical Test Cases

- **TC-REFACTOR-1**: All profile tests still pass after refactoring
- **TC-REFACTOR-2**: Helper functions work correctly

### Commit

- [ ] Stage changes: `git add lib/next-steps-generator.ts tests/lib/next-steps-generator.test.ts`
- [ ] Commit: `git commit -m "refactor: extract command formatting helpers"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 7: Add Output Format Tests

### 7a: Red Phase

#### Tasks

- [ ] Add test for "Next steps:" header
- [ ] Add test for numbered steps
- [ ] Add test for consistent indentation
- [ ] Add test for line structure

#### Testing

- [ ] Run `npm test` - format tests may fail if inconsistent

#### Critical Test Cases

- **TC-FORMAT-1**: Header test passes or needs adjustment
- **TC-FORMAT-2**: Numbering test passes or needs adjustment
- **TC-FORMAT-3**: Indentation test passes or needs adjustment

### 7b: Green Phase

#### Tasks

- [ ] Adjust formatting if tests fail
- [ ] Ensure consistent indentation (2 spaces)
- [ ] Ensure consistent numbering (1., 2., etc.)
- [ ] Ensure proper line breaks

#### Testing

- [ ] Run `npm test` - all format tests pass

#### Critical Test Cases

- **TC-GREEN-10**: All format tests pass
- **TC-GREEN-11**: All profile tests still pass

### Commit

- [ ] Stage changes: `git add tests/lib/next-steps-generator.test.ts lib/next-steps-generator.ts`
- [ ] Commit: `git commit -m "test: add output format validation tests"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 8: Add Edge Case Tests

### 8a: Red Phase

#### Tasks

- [ ] Add test for empty string profile
- [ ] Add test for profile with special characters
- [ ] Add test for undefined stage
- [ ] Add test for null/undefined profile

#### Testing

- [ ] Run `npm test` - edge case tests may fail

#### Critical Test Cases

- **TC-EDGE-1**: Empty profile handled gracefully
- **TC-EDGE-2**: Special characters handled correctly
- **TC-EDGE-3**: Undefined values handled safely

### 8b: Green Phase

#### Tasks

- [ ] Add default value for profile (`= 'default'`)
- [ ] Add validation for profile (if needed)
- [ ] Handle special characters properly
- [ ] Ensure no crashes on unusual input

#### Testing

- [ ] Run `npm test` - all edge case tests pass

#### Critical Test Cases

- **TC-GREEN-12**: All edge case tests pass
- **TC-GREEN-13**: No crashes on invalid input
- **TC-GREEN-14**: All previous tests still pass

### Commit

- [ ] Stage changes: `git add lib/next-steps-generator.ts tests/lib/next-steps-generator.test.ts`
- [ ] Commit: `git commit -m "feat: add edge case handling to next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 9: Integrate with setup-wizard.ts

### 9a: Red Phase (Integration Test)

#### Tasks

- [ ] Create or update setup-wizard integration test
- [ ] Mock console.log
- [ ] Verify next steps generator called
- [ ] Verify output contains expected format

#### Testing

- [ ] Run `npm test` - integration test may fail initially

### 9b: Green Phase

#### Tasks

- [ ] Open `bin/commands/setup-wizard.ts`
- [ ] Import `generateNextSteps` from `../../lib/next-steps-generator`
- [ ] Locate lines 817-836 (current next steps logic)
- [ ] Replace with call to `generateNextSteps()`
- [ ] Pass profile and stage parameters
- [ ] Remove old hardcoded logic

#### Code Changes

```typescript
// Replace lines 817-836 with:
const nextSteps = generateNextSteps({
    profile,
    stage: profile === 'prod' ? 'prod' : 'dev',
});
console.log(nextSteps);
```

#### Testing

- [ ] Run `npm test` - all tests pass
- [ ] Run `npm run build:typecheck` - no type errors

#### Critical Test Cases

- **TC-INTEGRATION-1**: setup-wizard compiles
- **TC-INTEGRATION-2**: Next steps displayed correctly
- **TC-INTEGRATION-3**: All profile types work

### Commit

- [ ] Stage changes: `git add bin/commands/setup-wizard.ts`
- [ ] Commit: `git commit -m "refactor: integrate next steps generator into setup wizard"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 10: Verify Backward Compatibility

### Tasks

- [ ] Create backward compatibility test suite
- [ ] Test exact string match for default profile
- [ ] Test exact string match for dev profile
- [ ] Test exact string match for prod profile
- [ ] Test exact string match for custom profile

### Manual Testing

- [ ] Run `npm run setup` (or `ts-node bin/cli.ts`)
- [ ] Choose default profile
- [ ] Verify next steps output matches previous version
- [ ] Run with dev profile
- [ ] Verify next steps output matches previous version
- [ ] Run with prod profile
- [ ] Verify next steps output matches previous version
- [ ] Run with custom profile (e.g., 'staging')
- [ ] Verify next steps output matches previous version

### Automated Testing

- [ ] Run `npm test` - all backward compatibility tests pass
- [ ] Verify exact string matches in tests

### Critical Test Cases

- **TC-COMPAT-1**: Default profile output exact match
- **TC-COMPAT-2**: Dev profile output exact match
- **TC-COMPAT-3**: Prod profile output exact match
- **TC-COMPAT-4**: Custom profile output exact match

### Commit

- [ ] Stage changes: `git add tests/lib/next-steps-generator.test.ts`
- [ ] Commit: `git commit -m "test: verify backward compatibility of next steps output"`
- [ ] Push: `git push origin 221-next-steps`

---

## Episode 11: Documentation and Cleanup

### Tasks

- [ ] Add JSDoc to `generateNextSteps()` function
- [ ] Add JSDoc to `formatDeployCommand()` helper
- [ ] Add JSDoc to `formatTestCommand()` helper
- [ ] Add inline comments for complex logic
- [ ] Add usage examples in JSDoc
- [ ] Remove any debug code
- [ ] Remove any commented-out code
- [ ] Verify consistent code style

### Documentation Updates

- [ ] Verify README.md still accurate (no changes needed in Phase 1)
- [ ] Add internal documentation comment at top of module

### Testing

- [ ] Run `npm run lint` - no linting errors
- [ ] Run `npm run build:typecheck` - no type errors
- [ ] Run `npm test` - all tests pass

### Commit

- [ ] Stage changes: `git add lib/next-steps-generator.ts`
- [ ] Commit: `git commit -m "docs: add documentation to next steps generator"`
- [ ] Push: `git push origin 221-next-steps`

---

## Post-Implementation Checklist

### Code Quality

- [ ] All TypeScript files compile without errors
- [ ] All tests passing (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] No console warnings or errors
- [ ] Code follows existing patterns

### Test Coverage

- [ ] Run `npm run test -- --coverage`
- [ ] Verify next-steps-generator.ts has 100% coverage
- [ ] Verify all branches covered
- [ ] Verify all edge cases tested

### Integration Verification

- [ ] setup-wizard.ts successfully uses generator
- [ ] All profile types work correctly
- [ ] Output format consistent
- [ ] No regressions in other commands

### Manual Testing

- [ ] Test with `npm run setup`
- [ ] Test with `ts-node bin/cli.ts`
- [ ] Test with different profiles
- [ ] Verify output matches expectations

### Documentation

- [ ] All functions have JSDoc
- [ ] Examples provided
- [ ] Comments explain complex logic
- [ ] Type definitions documented

### Git Hygiene

- [ ] All episodes committed separately
- [ ] Commit messages follow conventional commits
- [ ] Branch up to date with main
- [ ] No merge conflicts

## Phase 1 Completion Criteria

### Must Have (Blocking)

- [ ] All 11 episodes completed
- [ ] All tests passing
- [ ] 100% coverage for next-steps-generator.ts
- [ ] setup-wizard.ts integration working
- [ ] Backward compatibility verified
- [ ] No behavior changes visible to users

### Should Have (Important)

- [ ] All JSDoc complete
- [ ] Lint checks passing
- [ ] Code review completed
- [ ] Manual testing documented

### Nice to Have (Optional)

- [ ] Additional edge cases covered
- [ ] Performance benchmarks
- [ ] Integration with CI/CD verified

## Issues and Blockers

### Encountered Issues

_Document any issues encountered during implementation:_

- [ ] Issue 1: [Description]
  - Resolution: [How it was resolved]
- [ ] Issue 2: [Description]
  - Resolution: [How it was resolved]

### Open Questions

_Document any questions that arose:_

- [ ] Question 1: [Question]
  - Answer: [Resolution]

## Review Checklist

### Code Review

- [ ] Code reviewed by peer
- [ ] Design patterns appropriate
- [ ] Error handling adequate
- [ ] Type safety maintained
- [ ] No security concerns

### Testing Review

- [ ] Test coverage adequate
- [ ] Test cases comprehensive
- [ ] Edge cases covered
- [ ] Integration tests included

### Documentation Review

- [ ] JSDoc complete and accurate
- [ ] Examples helpful
- [ ] Comments clear
- [ ] README still accurate

## Sign-Off

### Developer

- [ ] All tasks completed
- [ ] All tests passing
- [ ] Ready for review

### Reviewer

- [ ] Code reviewed
- [ ] Tests verified
- [ ] Documentation adequate
- [ ] Approved for merge

## Next Steps

After Phase 1 completion:

1. **Merge to main**: Create PR, get approval, merge
2. **Phase 2 prep**: Review Phase 2 design document
3. **Phase 2 start**: Begin context detection implementation

**Phase 2 Preview**: Will add context detection logic and update generator to produce npx commands for npx users while maintaining repository context for developers.

---

## BDD Test Cases Summary

### Critical Test Cases

| ID | Description | Status |
|----|-------------|--------|
| TC-RED-1 | Default profile test fails initially | [ ] |
| TC-GREEN-1 | Default profile test passes | [ ] |
| TC-GREEN-2 | Function returns string | [ ] |
| TC-GREEN-3 | Output contains expected commands | [ ] |
| TC-RED-2 | Dev profile test fails initially | [ ] |
| TC-RED-3 | Default profile still passes | [ ] |
| TC-GREEN-4 | Dev profile test passes | [ ] |
| TC-GREEN-5 | Default profile still passes | [ ] |
| TC-RED-4 | Prod profile test fails initially | [ ] |
| TC-RED-5 | Previous tests still pass | [ ] |
| TC-GREEN-6 | Prod profile test passes | [ ] |
| TC-GREEN-7 | All previous tests pass | [ ] |
| TC-RED-6 | Custom profile test fails initially | [ ] |
| TC-RED-7 | Standard profile tests pass | [ ] |
| TC-GREEN-8 | Custom profile test passes | [ ] |
| TC-GREEN-9 | All previous tests pass | [ ] |
| TC-REFACTOR-1 | All tests pass after refactoring | [ ] |
| TC-REFACTOR-2 | Helper functions work | [ ] |
| TC-FORMAT-1 | Header test passes | [ ] |
| TC-FORMAT-2 | Numbering test passes | [ ] |
| TC-FORMAT-3 | Indentation test passes | [ ] |
| TC-GREEN-10 | All format tests pass | [ ] |
| TC-GREEN-11 | All profile tests pass | [ ] |
| TC-EDGE-1 | Empty profile handled | [ ] |
| TC-EDGE-2 | Special characters handled | [ ] |
| TC-EDGE-3 | Undefined values handled | [ ] |
| TC-GREEN-12 | All edge case tests pass | [ ] |
| TC-GREEN-13 | No crashes on invalid input | [ ] |
| TC-GREEN-14 | All previous tests pass | [ ] |
| TC-INTEGRATION-1 | setup-wizard compiles | [ ] |
| TC-INTEGRATION-2 | Next steps displayed | [ ] |
| TC-INTEGRATION-3 | All profile types work | [ ] |
| TC-COMPAT-1 | Default profile exact match | [ ] |
| TC-COMPAT-2 | Dev profile exact match | [ ] |
| TC-COMPAT-3 | Prod profile exact match | [ ] |
| TC-COMPAT-4 | Custom profile exact match | [ ] |

---

**Total Tasks**: 150+
**Estimated Time**: 4-6 hours
**Complexity**: Low-Medium (Refactoring with tests)
