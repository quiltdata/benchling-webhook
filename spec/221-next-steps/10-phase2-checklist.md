# Phase 2 Checklist - Context Detection

**Phase**: 2 of 3
**Issue**: #221
**Status**: In Progress

## Pre-Implementation

- [x] Phase 1 complete and committed
- [x] Design document created (08-phase2-design.md)
- [x] Episodes document created (09-phase2-episodes.md)
- [x] Success criteria defined

## Episode 1: Context Detector

### Tests First (TDD)
- [ ] Create tests/lib/context-detector.test.ts
- [ ] Write repository context detection tests
- [ ] Write npx context detection tests
- [ ] Write helper function tests (findPackageJson)
- [ ] Write helper function tests (checkForSourceFiles)
- [ ] Write helper function tests (extractAvailableScripts)
- [ ] Write edge case tests
- [ ] Write error handling tests
- [ ] Verify tests fail (RED state)

### Implementation
- [ ] Create lib/context-detector.ts
- [ ] Implement findPackageJson() helper
- [ ] Implement checkForSourceFiles() helper
- [ ] Implement extractAvailableScripts() helper
- [ ] Implement readPackageJson() helper
- [ ] Implement detectExecutionContext() main function
- [ ] Add error handling and graceful degradation
- [ ] Add JSDoc documentation
- [ ] Verify tests pass (GREEN state)

### Refactoring
- [ ] Extract constants (PACKAGE_NAME, SOURCE_DIR)
- [ ] Consolidate error handling
- [ ] Optimize file system operations
- [ ] Review and enhance documentation
- [ ] Verify tests still pass

### Quality Checks
- [ ] Run tests: npm test
- [ ] Check coverage: 100% for context-detector.ts
- [ ] Run linter: npm run lint
- [ ] Run type check: npm run type-check
- [ ] Fix any diagnostics

## Episode 2: Enhanced Next Steps Generator

### Tests First (TDD)
- [ ] Update tests/lib/next-steps-generator.test.ts
- [ ] Write repository context tests
- [ ] Write npx context tests
- [ ] Write command formatting tests
- [ ] Write backward compatibility tests
- [ ] Verify new tests fail (RED state)

### Implementation
- [ ] Update lib/next-steps-generator.ts
- [ ] Implement formatCommand() helper
- [ ] Update formatDeployCommand() with context support
- [ ] Update formatTestCommand() with context support
- [ ] Update generateNextSteps() to accept context
- [ ] Ensure backward compatibility (context optional)
- [ ] Add JSDoc documentation
- [ ] Verify tests pass (GREEN state)

### Refactoring
- [ ] Consolidate command formatting logic
- [ ] Extract command templates
- [ ] Optimize conditional logic
- [ ] Review and enhance documentation
- [ ] Verify tests still pass

### Quality Checks
- [ ] Run tests: npm test
- [ ] Check coverage: maintain 95%+ for next-steps-generator.ts
- [ ] Verify Phase 1 tests still pass
- [ ] Run linter: npm run lint
- [ ] Run type check: npm run type-check
- [ ] Fix any diagnostics

## Episode 3: Integration and Verification

### Integration Testing
- [ ] Create integration test scenarios
- [ ] Test repository context end-to-end
- [ ] Test npx context end-to-end
- [ ] Test backward compatibility (no context)
- [ ] Verify all tests pass

### Manual Testing
- [ ] Test in real repository (this project)
- [ ] Simulate npx context (test directory)
- [ ] Verify context detection accuracy
- [ ] Verify command formatting correctness

### Quality Gates
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Coverage: 100% for new code
- [ ] No linting errors
- [ ] No type errors
- [ ] Build succeeds: npm run build

### Documentation
- [ ] JSDoc complete for all public functions
- [ ] Code comments explain complex logic
- [ ] Type definitions accurate
- [ ] Test descriptions clear

## Testing Matrix

### Context Detection Tests
- [ ] Repository with package.json and lib/*.ts → isRepository: true
- [ ] NPX with no package.json → isNpx: true
- [ ] NPX with different package name → isNpx: true
- [ ] NPX with no lib/ directory → isNpx: true
- [ ] NPX with only lib/*.js files → isNpx: true
- [ ] Handle malformed package.json → default to npx
- [ ] Handle file system errors → default to npx

### Command Formatting Tests
- [ ] Repository + default profile → npm run deploy
- [ ] Repository + dev profile → npm run deploy:dev
- [ ] Repository + prod profile → npm run deploy:prod
- [ ] Repository + custom profile → npm run deploy -- --profile custom
- [ ] NPX + default profile → npx @quiltdata/benchling-webhook deploy
- [ ] NPX + dev profile → npx @quiltdata/benchling-webhook deploy --profile dev
- [ ] NPX + prod profile → npx @quiltdata/benchling-webhook deploy --profile prod
- [ ] NPX + custom profile → npx @quiltdata/benchling-webhook deploy --profile custom

### Backward Compatibility Tests
- [ ] No context + default profile → npm run deploy (unchanged)
- [ ] No context + dev profile → npm run deploy:dev (unchanged)
- [ ] No context + prod profile → npm run deploy:prod (unchanged)
- [ ] No context + custom profile → original behavior (unchanged)

### Edge Cases Tests
- [ ] Empty profile string
- [ ] Profile with special characters
- [ ] Profile with hyphens
- [ ] Profile with underscores
- [ ] Undefined stage
- [ ] Undefined context (backward compat)

## Coverage Requirements

| Module                     | Target  | Actual | Status |
|---------------------------|---------|--------|--------|
| lib/context-detector.ts   | 100%    | ---    | [ ]    |
| lib/next-steps-generator.ts| 95%+   | ---    | [ ]    |
| Overall Phase 2           | 100%    | ---    | [ ]    |

## Performance Benchmarks

| Operation                      | Target  | Actual | Status |
|-------------------------------|---------|--------|--------|
| detectExecutionContext()      | <10ms   | ---    | [ ]    |
| generateNextSteps()           | <5ms    | ---    | [ ]    |
| Full Phase 2 overhead         | <15ms   | ---    | [ ]    |

## Files Created/Modified

### New Files
- [ ] lib/context-detector.ts
- [ ] tests/lib/context-detector.test.ts
- [ ] spec/221-next-steps/08-phase2-design.md
- [ ] spec/221-next-steps/09-phase2-episodes.md
- [ ] spec/221-next-steps/10-phase2-checklist.md (this file)

### Modified Files
- [ ] lib/next-steps-generator.ts (enhanced with context support)
- [ ] tests/lib/next-steps-generator.test.ts (added context tests)

### Unchanged Files (verify)
- [ ] lib/types/next-steps.ts (already has ExecutionContext)
- [ ] bin/commands/setup-wizard.ts (Phase 3 will modify)

## Quality Assurance

### Code Quality
- [ ] No TODO comments remaining
- [ ] No console.log statements (except in error handling)
- [ ] No commented-out code
- [ ] Consistent code style
- [ ] Meaningful variable names
- [ ] Pure functions where possible

### Test Quality
- [ ] Each test has clear description
- [ ] Tests are independent
- [ ] Tests are deterministic
- [ ] No flaky tests
- [ ] Mocks used appropriately
- [ ] Test data is realistic

### Documentation Quality
- [ ] JSDoc follows standard format
- [ ] All parameters documented
- [ ] Return types documented
- [ ] Examples provided
- [ ] Edge cases noted

## Pre-Commit Checklist

- [ ] All tests passing
- [ ] Coverage requirements met
- [ ] No linting errors
- [ ] No type errors
- [ ] Build succeeds
- [ ] IDE diagnostics clean
- [ ] Git status clean (no untracked files)

## Commit Message

```
feat(context): Implement Phase 2 context detection (#221)

Phase 2 of 3: Add execution context detection to determine whether
CLI is running in repository or via npx, enabling appropriate command
suggestions in next steps.

Changes:
- Add context-detector.ts with detectExecutionContext()
- Enhance next-steps-generator.ts with context-aware formatting
- Add comprehensive tests for both modules
- Maintain backward compatibility (context optional)
- 100% test coverage for new code

The context detector checks for:
- package.json with matching name
- Source TypeScript files in lib/
- Available npm scripts

Next steps messages now format commands appropriately:
- Repository: npm run <script>
- NPX: npx @quiltdata/benchling-webhook <command>

Phase 3 will integrate context detection into setup wizard and
implement command chaining workflow.

Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Ready for Phase 3

- [ ] All Phase 2 items complete
- [ ] Phase 2 committed to git
- [ ] Context detection verified working
- [ ] Next steps formatting verified
- [ ] Backward compatibility confirmed
- [ ] Documentation complete
- [ ] Team notified (if applicable)

## Notes

### Implementation Notes
- Context detection runs once per CLI invocation
- Defaults to npx context on any errors (safer)
- Backward compatible - context parameter optional
- Performance impact negligible (<10ms)

### Testing Notes
- Mock file system for deterministic tests
- Test matrix covers all context × profile combinations
- Real-world testing in repository context
- NPX context simulated with test directory

### Integration Notes
- Phase 3 will call detectExecutionContext() in setup wizard
- Phase 3 will pass context to generateNextSteps()
- Phase 3 will integrate with command chaining
- No changes needed to existing CLI commands

## Success Indicators

When Phase 2 is complete:
1. Context detector reliably identifies execution environment
2. Next steps show correct commands for context
3. All Phase 1 functionality preserved
4. 100% test coverage achieved
5. Zero breaking changes
6. Ready for Phase 3 integration

## Rollback Plan

If issues found:
1. Revert Phase 2 commits
2. Keep Phase 1 (working)
3. Review design and testing
4. Re-implement with fixes

Phase 1 remains functional without Phase 2.
