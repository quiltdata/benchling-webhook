# Phase 1 Episodes: Extract Next Steps Logic

**Reference**: spec/221-next-steps/05-phase1-design.md
**GitHub Issue**: #221

## Overview

This document breaks Phase 1 implementation into atomic, testable episodes following TDD (Red → Green → Refactor).

## Episode 1: Create Type Definitions

**Goal**: Define TypeScript interfaces for next steps generation

**Files**:
- `lib/types/next-steps.ts` (new)

**Changes**:
1. Create `lib/types/` directory if not exists
2. Create `next-steps.ts` with interface definitions
3. Export `ExecutionContext` interface
4. Export `DeploymentResult` interface
5. Export `NextStepsOptions` interface

**Test Strategy**: Types are compile-time verified

**Success Criteria**:
- File compiles without errors
- Interfaces exported correctly
- JSDoc comments complete

**Commit Message**: `feat: add type definitions for next steps generator`

---

## Episode 2: Create Generator Module (Red)

**Goal**: Write failing test for basic next steps generation

**Files**:
- `tests/lib/next-steps-generator.test.ts` (new)

**Changes**:
1. Create test file
2. Write test for default profile
3. Import non-existent generator (will fail)
4. Assert expected output format

**Test Case**:
```typescript
describe('generateNextSteps', () => {
  it('should generate next steps for default profile', () => {
    const result = generateNextSteps({ profile: 'default' });
    expect(result).toContain('Next steps:');
    expect(result).toContain('npm run deploy');
    expect(result).toContain('npm run test');
  });
});
```

**Success Criteria**:
- Test file created
- Test fails (module doesn't exist)
- Test expectations match current behavior

**Commit Message**: `test: add failing test for next steps generator`

---

## Episode 3: Implement Generator Module (Green)

**Goal**: Create generator module to make tests pass

**Files**:
- `lib/next-steps-generator.ts` (new)

**Changes**:
1. Create module file
2. Implement `generateNextSteps()` function
3. Handle default profile case
4. Return formatted string

**Implementation**:
```typescript
export function generateNextSteps(options: NextStepsOptions): string {
  const { profile } = options;
  const lines: string[] = [];

  lines.push('Next steps:');

  if (profile === 'default') {
    lines.push('  1. Deploy to AWS: npm run deploy');
    lines.push('  2. Test integration: npm run test');
  }

  return lines.join('\n');
}
```

**Success Criteria**:
- Module compiles
- Test passes for default profile
- No other behavior yet

**Commit Message**: `feat: implement basic next steps generator`

---

## Episode 4: Add Dev Profile Support (Red → Green → Refactor)

**Goal**: Support dev profile with dedicated npm script

### 4a: Red - Write failing test

**Test Case**:
```typescript
it('should generate next steps for dev profile', () => {
  const result = generateNextSteps({ profile: 'dev' });
  expect(result).toContain('npm run deploy:dev');
  expect(result).toContain('npm run test:dev');
});
```

### 4b: Green - Make test pass

**Changes to `lib/next-steps-generator.ts`**:
```typescript
if (profile === 'default') {
  lines.push('  1. Deploy to AWS: npm run deploy');
  lines.push('  2. Test integration: npm run test');
} else if (profile === 'dev') {
  lines.push('  1. Deploy to AWS: npm run deploy:dev');
  lines.push('  2. Test integration: npm run test:dev');
}
```

### 4c: Refactor - Extract helper (if needed)

Consider extracting command formatting, but may wait until more profiles added.

**Success Criteria**:
- Test for dev profile passes
- Default profile still works

**Commit Message**: `feat: add dev profile support to next steps generator`

---

## Episode 5: Add Prod Profile Support (Red → Green)

**Goal**: Support prod profile

### 5a: Red - Write failing test

**Test Case**:
```typescript
it('should generate next steps for prod profile', () => {
  const result = generateNextSteps({ profile: 'prod' });
  expect(result).toContain('npm run deploy:prod');
  expect(result).toContain('npm run test:prod');
});
```

### 5b: Green - Make test pass

**Changes**:
```typescript
else if (profile === 'prod') {
  lines.push('  1. Deploy to AWS: npm run deploy:prod');
  lines.push('  2. Test integration: npm run test:prod');
}
```

**Success Criteria**:
- Test for prod profile passes
- All previous tests still pass

**Commit Message**: `feat: add prod profile support to next steps generator`

---

## Episode 6: Add Custom Profile Support (Red → Green → Refactor)

**Goal**: Support arbitrary custom profiles

### 6a: Red - Write failing test

**Test Case**:
```typescript
it('should generate next steps for custom profile', () => {
  const result = generateNextSteps({ profile: 'staging' });
  expect(result).toContain('npm run deploy -- --profile staging');
  expect(result).toContain('npx ts-node scripts/check-logs.ts --profile staging');
});
```

### 6b: Green - Make test pass

**Changes**:
```typescript
else {
  // Custom profile
  lines.push(`  1. Deploy to AWS: npm run deploy -- --profile ${profile} --stage ${profile}`);
  lines.push(`  2. Check logs: npx ts-node scripts/check-logs.ts --profile ${profile}`);
}
```

### 6c: Refactor - Extract command formatters

**Create helper functions**:
```typescript
function formatDeployCommand(profile: string): string {
  if (profile === 'default') return 'npm run deploy';
  if (profile === 'dev') return 'npm run deploy:dev';
  if (profile === 'prod') return 'npm run deploy:prod';
  return `npm run deploy -- --profile ${profile} --stage ${profile}`;
}

function formatTestCommand(profile: string): string {
  if (profile === 'default') return 'npm run test';
  if (profile === 'dev') return 'npm run test:dev';
  if (profile === 'prod') return 'npm run test:prod';
  return `npx ts-node scripts/check-logs.ts --profile ${profile}`;
}
```

**Update main function**:
```typescript
const deployCmd = formatDeployCommand(profile);
const testCmd = formatTestCommand(profile);

lines.push(`  1. Deploy to AWS: ${deployCmd}`);
lines.push(`  2. ${profile === 'default' || profile === 'dev' || profile === 'prod' ? 'Test integration' : 'Check logs'}: ${testCmd}`);
```

**Success Criteria**:
- All tests pass
- Code more maintainable
- DRY principle applied

**Commit Message**: `refactor: extract command formatting helpers`

---

## Episode 7: Add Output Format Tests (Red → Green)

**Goal**: Verify output structure consistency

### 7a: Red - Write format tests

**Test Cases**:
```typescript
describe('output format', () => {
  it('should start with "Next steps:"', () => {
    const result = generateNextSteps({ profile: 'default' });
    expect(result).toMatch(/^Next steps:/);
  });

  it('should have numbered steps', () => {
    const result = generateNextSteps({ profile: 'default' });
    expect(result).toMatch(/1\. Deploy to AWS:/);
    expect(result).toMatch(/2\. Test/);
  });

  it('should use consistent indentation', () => {
    const result = generateNextSteps({ profile: 'default' });
    const lines = result.split('\n');
    const stepLines = lines.filter(l => l.match(/^\s+\d\./));
    stepLines.forEach(line => {
      expect(line).toMatch(/^  \d\./); // Two spaces
    });
  });
});
```

### 7b: Green - Ensure tests pass

If tests fail, adjust formatting to match expected structure.

**Success Criteria**:
- Format tests pass
- Output consistent across profiles

**Commit Message**: `test: add output format validation tests`

---

## Episode 8: Add Edge Case Tests (Red → Green)

**Goal**: Handle edge cases gracefully

### 8a: Red - Write edge case tests

**Test Cases**:
```typescript
describe('edge cases', () => {
  it('should handle empty string profile', () => {
    const result = generateNextSteps({ profile: '' });
    expect(result).toBeTruthy();
    expect(result).toContain('Next steps:');
  });

  it('should handle profile with special characters', () => {
    const result = generateNextSteps({ profile: 'test-env-2' });
    expect(result).toContain('--profile test-env-2');
  });

  it('should handle undefined stage', () => {
    const result = generateNextSteps({ profile: 'default', stage: undefined });
    expect(result).toBeTruthy();
  });
});
```

### 8b: Green - Handle edge cases

Add validation/defaults as needed:
```typescript
export function generateNextSteps(options: NextStepsOptions): string {
  const { profile = 'default' } = options;
  // ... rest of implementation
}
```

**Success Criteria**:
- Edge case tests pass
- No crashes on unusual input
- Graceful degradation

**Commit Message**: `feat: add edge case handling to next steps generator`

---

## Episode 9: Integrate with setup-wizard.ts (Red → Green)

**Goal**: Replace hardcoded logic with generator module

### 9a: Red - Add integration test

**Test Case** (in setup-wizard.test.ts or integration test):
```typescript
describe('setup-wizard integration', () => {
  it('should use next steps generator', () => {
    // Mock console.log
    const spy = jest.spyOn(console, 'log');

    // Run relevant part of setup wizard
    // (or full wizard with mocked inquirer)

    // Verify generator called
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Next steps:'));
  });
});
```

### 9b: Green - Update setup-wizard.ts

**Changes to `bin/commands/setup-wizard.ts`**:

1. Import generator:
```typescript
import { generateNextSteps } from '../../lib/next-steps-generator';
```

2. Replace lines 817-836:
```typescript
// OLD CODE (remove):
// console.log("Next steps:");
// if (profile === "default") {
//     console.log("  1. Deploy to AWS: npm run deploy");
//     ...
// }

// NEW CODE:
const nextSteps = generateNextSteps({
    profile,
    stage: profile === 'prod' ? 'prod' : 'dev',
});
console.log(nextSteps);
```

**Success Criteria**:
- setup-wizard.ts uses generator
- Next steps output unchanged
- All tests pass

**Commit Message**: `refactor: integrate next steps generator into setup wizard`

---

## Episode 10: Verify Backward Compatibility

**Goal**: Ensure no behavior changes

**Manual Testing**:
1. Run `npm run setup` (or `ts-node bin/cli.ts`)
2. Complete wizard with default profile
3. Verify next steps match previous output
4. Repeat for dev, prod, and custom profiles

**Automated Testing**:
```typescript
describe('backward compatibility', () => {
  it('should produce same output as before for default profile', () => {
    const result = generateNextSteps({ profile: 'default' });

    // Expected output (from old implementation)
    const expected = [
      'Next steps:',
      '  1. Deploy to AWS: npm run deploy',
      '  2. Test integration: npm run test'
    ].join('\n');

    expect(result).toBe(expected);
  });

  // Similar tests for dev, prod, custom
});
```

**Success Criteria**:
- Manual testing confirms identical output
- Automated tests verify exact string match
- No user-visible changes

**Commit Message**: `test: verify backward compatibility of next steps output`

---

## Episode 11: Documentation and Cleanup

**Goal**: Complete module documentation and clean up

**Changes**:
1. Add JSDoc to all exported functions
2. Add inline comments for complex logic
3. Update any relevant README sections
4. Remove any debug code

**JSDoc Example**:
```typescript
/**
 * Generate next steps message after setup completion
 *
 * Produces context-appropriate command suggestions based on the
 * deployment profile. In Phase 1, assumes repository context.
 *
 * @param options - Configuration for next steps generation
 * @param options.profile - Deployment profile name (default, dev, prod, or custom)
 * @param options.stage - Deployment stage (optional)
 * @param options.context - Execution context (optional, for future use)
 * @returns Formatted next steps message with commands
 *
 * @example
 * ```typescript
 * const steps = generateNextSteps({ profile: 'default' });
 * console.log(steps);
 * // Output:
 * // Next steps:
 * //   1. Deploy to AWS: npm run deploy
 * //   2. Test integration: npm run test
 * ```
 */
export function generateNextSteps(options: NextStepsOptions): string;
```

**Success Criteria**:
- All functions documented
- Examples provided
- Code clean and readable

**Commit Message**: `docs: add documentation to next steps generator`

---

## Summary of Episodes

| Episode | Type | Description | Commit |
| --------- | ------ | ------------- | -------- |
| 1 | Feat | Create type definitions | `feat: add type definitions for next steps generator` |
| 2 | Test | Write failing test | `test: add failing test for next steps generator` |
| 3 | Feat | Basic implementation | `feat: implement basic next steps generator` |
| 4 | Feat | Dev profile support | `feat: add dev profile support to next steps generator` |
| 5 | Feat | Prod profile support | `feat: add prod profile support to next steps generator` |
| 6 | Refactor | Custom profiles + helpers | `refactor: extract command formatting helpers` |
| 7 | Test | Format validation | `test: add output format validation tests` |
| 8 | Feat | Edge case handling | `feat: add edge case handling to next steps generator` |
| 9 | Refactor | Setup wizard integration | `refactor: integrate next steps generator into setup wizard` |
| 10 | Test | Backward compatibility | `test: verify backward compatibility of next steps output` |
| 11 | Docs | Documentation | `docs: add documentation to next steps generator` |

## Testing Workflow Per Episode

For each episode:
1. **Red**: Write failing test (if applicable)
2. **Green**: Implement minimum code to pass
3. **Refactor**: Improve code quality
4. **Verify**: Run `npm test`
5. **Lint**: Run `npm run lint`
6. **Commit**: Commit with conventional commit message

## Phase 1 Complete Criteria

- [ ] All episodes completed
- [ ] All tests passing
- [ ] 100% code coverage for generator
- [ ] Integration with setup-wizard verified
- [ ] Manual testing completed
- [ ] Documentation complete
- [ ] Lint checks pass
- [ ] TypeScript compiles without errors
- [ ] Ready for Phase 2

**Next**: Phase 2 will add context detection and update generator to support npx commands.
