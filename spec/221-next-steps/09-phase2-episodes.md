# Phase 2 Episodes - Context Detection

**Phase**: 2 of 3
**Issue**: #221
**Dependencies**: Phase 1 (Complete)

## Episode Structure

Phase 2 follows BDD/TDD approach with three episodes:

1. **Episode 1**: Context Detector - Detection logic and tests
2. **Episode 2**: Enhanced Next Steps - Context-aware command formatting
3. **Episode 3**: Integration - Wire everything together and verify

Each episode follows RED-GREEN-REFACTOR:
- RED: Write failing tests
- GREEN: Implement minimum code to pass
- REFACTOR: Clean up while keeping tests green

## Episode 1: Context Detector

**Goal**: Implement and test execution context detection

**Duration**: ~2 hours

### Episode 1.1: Write Test Cases

Create `tests/lib/context-detector.test.ts`:

```typescript
describe('detectExecutionContext', () => {
  describe('repository context detection', () => {
    it('should detect repository with package.json and source files');
    it('should extract available npm scripts');
    it('should set isRepository to true and isNpx to false');
    it('should find package.json in parent directories');
    it('should validate package name matches');
  });

  describe('npx context detection', () => {
    it('should detect npx when no package.json exists');
    it('should detect npx when package name differs');
    it('should detect npx when lib directory missing');
    it('should detect npx when lib has only .js files');
    it('should set isNpx to true and isRepository to false');
  });

  describe('helper functions', () => {
    describe('findPackageJson', () => {
      it('should find package.json in current directory');
      it('should find package.json in parent directory');
      it('should return null when not found');
      it('should stop at filesystem root');
    });

    describe('checkForSourceFiles', () => {
      it('should return true when .ts files in lib/');
      it('should return false when lib/ missing');
      it('should return false when lib/ has only .js files');
      it('should return false when lib/ is empty');
    });

    describe('extractAvailableScripts', () => {
      it('should extract script names from package.json');
      it('should return empty array when no scripts field');
      it('should return empty array for null package');
    });
  });

  describe('edge cases', () => {
    it('should handle malformed package.json gracefully');
    it('should handle missing package.json name field');
    it('should handle package.json without scripts');
    it('should handle read errors gracefully');
    it('should default to npx on errors');
  });

  describe('real-world scenarios', () => {
    it('should detect this repository as repository context');
    it('should detect installed package as npx context');
  });
});
```

### Episode 1.2: Implement Context Detector

Create `lib/context-detector.ts`:

**Step 1**: Skeleton with types
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionContext } from './types/next-steps';

export function detectExecutionContext(): ExecutionContext {
  // TODO: Implement
  return {
    isRepository: false,
    isNpx: true,
    packageName: '@quiltdata/benchling-webhook',
    availableScripts: []
  };
}
```

**Step 2**: Implement findPackageJson
```typescript
function findPackageJson(): string | null {
  // Walk up directory tree
}
```

**Step 3**: Implement checkForSourceFiles
```typescript
function checkForSourceFiles(pkgPath: string): boolean {
  // Check for lib/ with .ts files
}
```

**Step 4**: Implement extractAvailableScripts
```typescript
function extractAvailableScripts(pkg: any): string[] {
  // Extract script names
}
```

**Step 5**: Wire it together
```typescript
export function detectExecutionContext(): ExecutionContext {
  // Use helpers to determine context
}
```

### Episode 1.3: Refactor and Optimize

- Extract constants (PACKAGE_NAME, SOURCE_DIR)
- Add comprehensive error handling
- Add JSDoc documentation
- Verify 100% test coverage

**Deliverables**:
- [ ] tests/lib/context-detector.test.ts (complete)
- [ ] lib/context-detector.ts (complete)
- [ ] All tests passing
- [ ] 100% coverage

**Checkpoint**: Run `npm test` - all context-detector tests green

---

## Episode 2: Enhanced Next Steps Generator

**Goal**: Add context-aware command formatting to next steps

**Duration**: ~2 hours

### Episode 2.1: Write Test Cases

Update `tests/lib/next-steps-generator.test.ts`:

```typescript
describe('context-aware next steps', () => {
  describe('repository context', () => {
    const repoContext: ExecutionContext = {
      isRepository: true,
      isNpx: false,
      packageName: '@quiltdata/benchling-webhook',
      availableScripts: ['deploy', 'deploy:dev', 'deploy:prod', 'test', 'test:dev']
    };

    it('should generate npm run commands for default profile');
    it('should use available script shortcuts');
    it('should generate npm run deploy for default profile');
    it('should generate npm run deploy:dev for dev profile');
    it('should generate npm run deploy -- --profile for custom profile');
  });

  describe('npx context', () => {
    const npxContext: ExecutionContext = {
      isRepository: false,
      isNpx: true,
      packageName: '@quiltdata/benchling-webhook',
      availableScripts: []
    };

    it('should generate npx commands for default profile');
    it('should include package name in commands');
    it('should format profile flags correctly');
    it('should use npx @quiltdata/benchling-webhook deploy');
    it('should include --profile for custom profiles');
  });

  describe('command formatting', () => {
    it('should format deploy commands correctly per context');
    it('should format test commands correctly per context');
    it('should handle custom profile names');
    it('should use script shortcuts when available');
  });

  describe('backward compatibility', () => {
    it('should work without context parameter');
    it('should default to repository-style commands');
    it('should maintain exact output for Phase 1 calls');
    it('should not break existing integration');
  });
});
```

### Episode 2.2: Implement Context-Aware Formatting

Update `lib/next-steps-generator.ts`:

**Step 1**: Add helper for command formatting
```typescript
function formatCommand(
  command: string,
  profile: string,
  context?: ExecutionContext
): string {
  // Format based on context
}
```

**Step 2**: Update formatDeployCommand
```typescript
function formatDeployCommand(
  profile: string,
  context?: ExecutionContext
): string {
  if (!context) {
    // Backward compatible behavior
    return originalFormatDeployCommand(profile);
  }

  if (context.isRepository) {
    // npm run logic
  } else {
    // npx logic
  }
}
```

**Step 3**: Update formatTestCommand
```typescript
function formatTestCommand(
  profile: string,
  context?: ExecutionContext
): string {
  // Similar to deploy command
}
```

**Step 4**: Update generateNextSteps
```typescript
export function generateNextSteps(options: NextStepsOptions): string {
  const { profile = 'default', context } = options;
  const lines: string[] = [];

  lines.push('Next steps:');

  // Use context-aware formatters
  lines.push(`  1. Deploy to AWS: ${formatDeployCommand(profile, context)}`);
  lines.push(`  2. Test integration: ${formatTestCommand(profile, context)}`);

  return lines.join('\n');
}
```

### Episode 2.3: Refactor and Document

- Consolidate command formatting logic
- Add JSDoc for new functions
- Ensure backward compatibility maintained
- Verify all tests pass

**Deliverables**:
- [ ] Updated tests/lib/next-steps-generator.test.ts
- [ ] Updated lib/next-steps-generator.ts
- [ ] All tests passing
- [ ] Backward compatibility verified

**Checkpoint**: Run `npm test` - all next-steps tests green, including Phase 1 tests

---

## Episode 3: Integration and Verification

**Goal**: Integration testing and quality assurance

**Duration**: ~1 hour

### Episode 3.1: Integration Testing

Create integration test scenarios:

```typescript
describe('Phase 2 Integration', () => {
  it('should detect context and generate appropriate next steps');
  it('should work end-to-end for repository context');
  it('should work end-to-end for npx context');
  it('should maintain Phase 1 behavior when context not provided');
});
```

### Episode 3.2: Manual Testing

**Repository Context Test**:
```bash
cd /Users/ernest/GitHub/benchling-webhook
npm test
# Verify context detected as repository
```

**NPX Context Test** (simulated):
```bash
# Create test directory without source files
mkdir -p /tmp/npx-test
cd /tmp/npx-test
# Run detection logic
# Verify context detected as npx
```

### Episode 3.3: Quality Checks

```bash
# Run full test suite
npm test

# Check coverage
npm run test:coverage
# Verify context-detector.ts at 100%
# Verify next-steps-generator.ts coverage maintained

# Lint check
npm run lint

# Type check
npm run type-check

# Build check
npm run build
```

### Episode 3.4: Documentation Review

- [ ] JSDoc comments complete
- [ ] Type definitions accurate
- [ ] Code comments explain complex logic
- [ ] Test descriptions clear

**Deliverables**:
- [ ] Integration tests passing
- [ ] Manual testing complete
- [ ] 100% coverage for new code
- [ ] All quality checks passing

**Checkpoint**: Full test suite green, ready for commit

---

## Episode Summary

### Episode 1 Outcomes
- Context detector implemented and tested
- 100% coverage for detection logic
- All edge cases handled

### Episode 2 Outcomes
- Next steps generator enhanced with context support
- Backward compatibility maintained
- Command formatting works for both contexts

### Episode 3 Outcomes
- Integration verified
- Quality gates passed
- Ready for Phase 3

## Testing Matrix

| Context      | Profile   | Expected Command Pattern                    | Test Status |
| -------------- | ----------- | --------------------------------------------- | ------------- |
| Repository   | default   | `npm run deploy`                            | [ ]         |
| Repository   | dev       | `npm run deploy:dev`                        | [ ]         |
| Repository   | prod      | `npm run deploy:prod`                       | [ ]         |
| Repository   | custom    | `npm run deploy -- --profile custom`        | [ ]         |
| NPX          | default   | `npx @quiltdata/benchling-webhook deploy`   | [ ]         |
| NPX          | dev       | `npx @quiltdata/benchling-webhook deploy --profile dev` | [ ] |
| NPX          | prod      | `npx @quiltdata/benchling-webhook deploy --profile prod` | [ ] |
| NPX          | custom    | `npx @quiltdata/benchling-webhook deploy --profile custom` | [ ] |
| None         | default   | `npm run deploy` (backward compat)          | [ ]         |
| None         | dev       | `npm run deploy:dev` (backward compat)      | [ ]         |

## Error Scenarios

| Scenario                     | Expected Behavior                  | Test Status |
| ------------------------------ | ----------------------------------- | ------------- |
| No package.json              | Default to npx context            | [ ]         |
| Malformed package.json       | Default to npx context            | [ ]         |
| Wrong package name           | Default to npx context            | [ ]         |
| No lib/ directory            | Default to npx context            | [ ]         |
| Empty lib/ directory         | Default to npx context            | [ ]         |
| Read permission error        | Default to npx context            | [ ]         |

## Coverage Goals

| Module                  | Target | Actual | Status |
| ------------------------ | -------- | -------- | -------- |
| context-detector.ts    | 100%   | ---    | [ ]    |
| next-steps-generator.ts| 95%+   | ---    | [ ]    |
| Overall Phase 2 code   | 100%   | ---    | [ ]    |

## Performance Benchmarks

| Operation                    | Target   | Actual | Status |
| ----------------------------- | ---------- | -------- | -------- |
| detectExecutionContext()    | <10ms    | ---    | [ ]    |
| generateNextSteps()         | <5ms     | ---    | [ ]    |
| Full Phase 2 overhead       | <15ms    | ---    | [ ]    |

## Success Criteria Checklist

### Functional
- [ ] Context detection works in repository
- [ ] Context detection works for npx
- [ ] Next steps format correctly per context
- [ ] Backward compatibility maintained
- [ ] All profiles work correctly

### Quality
- [ ] 100% test coverage achieved
- [ ] All tests passing
- [ ] No linting errors
- [ ] No type errors
- [ ] Build succeeds

### Integration
- [ ] Works with setup-wizard.ts
- [ ] Phase 1 tests still pass
- [ ] No regressions detected
- [ ] Manual testing successful

## Risk Mitigation Status

| Risk                    | Mitigation                      | Status |
| ------------------------ | -------------------------------- | -------- |
| False detection        | Comprehensive test matrix      | [ ]    |
| Breaking changes       | Backward compatibility tests   | [ ]    |
| Performance impact     | Benchmarking                   | [ ]    |
| Edge case failures     | Extensive edge case testing    | [ ]    |

## Ready for Phase 3 Checklist

- [ ] All Phase 2 tests passing
- [ ] Coverage goals met
- [ ] No linting/type errors
- [ ] Integration verified
- [ ] Documentation complete
- [ ] Phase 2 committed to git
- [ ] Ready to implement command chaining

## Notes for Phase 3

Context detection is now available. Phase 3 will:
1. Use `detectExecutionContext()` in setup wizard
2. Pass context to `generateNextSteps()`
3. Display context-appropriate commands
4. Implement command chaining

The foundation is solid and ready for integration.
