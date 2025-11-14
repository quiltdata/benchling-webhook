# Phase 1 Design: Extract Next Steps Logic

**Reference**:
- spec/221-next-steps/04-phases.md (Phase 1)
- spec/221-next-steps/03-specifications.md
**GitHub Issue**: #221

## Phase 1 Overview

**Goal**: Refactor existing next steps code into a reusable, testable module

**Scope**: Extract hardcoded next steps logic from `setup-wizard.ts` into dedicated module

**Why**: Establish clean foundation before adding context detection and command chaining features

## Technical Architecture

### Module Structure

```
lib/
  next-steps-generator.ts       # New module
  types/
    next-steps.ts               # Type definitions

bin/commands/
  setup-wizard.ts               # Updated to use new module

tests/
  lib/
    next-steps-generator.test.ts  # Unit tests
```

### Module Design: lib/next-steps-generator.ts

#### Core Function Signature

```typescript
/**
 * Generate next steps message after setup completion
 *
 * @param options - Configuration for next steps generation
 * @returns Formatted next steps message string
 */
export function generateNextSteps(options: NextStepsOptions): string;
```

#### Type Definitions (lib/types/next-steps.ts)

```typescript
/**
 * Execution context for command suggestions
 */
export interface ExecutionContext {
  /** Running in repository (has matching package.json) */
  isRepository: boolean;

  /** Running via npx */
  isNpx: boolean;

  /** Package name for npx commands */
  packageName: string;

  /** Available npm scripts (if repository) */
  availableScripts: string[];
}

/**
 * Deployment result information
 */
export interface DeploymentResult {
  /** Whether deployment succeeded */
  success: boolean;

  /** Webhook URL (if successful) */
  webhookUrl?: string;

  /** Stack ARN */
  stackArn?: string;

  /** AWS region */
  region?: string;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Options for generating next steps
 */
export interface NextStepsOptions {
  /** Profile name */
  profile: string;

  /** Deployment stage (dev, prod) */
  stage?: string;

  /** Execution context (optional in Phase 1, required in Phase 2) */
  context?: ExecutionContext;

  /** Deployment result (optional, for Phase 3) */
  deployment?: DeploymentResult;

  /** Whether deployment was skipped */
  skipDeployment?: boolean;
}
```

### Design Decisions

#### Decision 1: Default Context in Phase 1

**Choice**: Default to repository context if no context provided

**Rationale**:
- Maintains current behavior during refactoring
- Allows Phase 2 to add context detection without breaking changes
- Tests can verify current behavior first

**Implementation**:
```typescript
const context = options.context || {
  isRepository: true,
  isNpx: false,
  packageName: '@quiltdata/benchling-webhook',
  availableScripts: []
};
```

#### Decision 2: Pure Function Design

**Choice**: Generator is pure function with no side effects

**Rationale**:
- Easy to test
- No dependencies on file system or environment
- Can be called multiple times safely
- Predictable output

**Implementation**:
- All inputs via parameters
- All outputs via return value
- No console.log (caller handles output)
- No process.exit

#### Decision 3: String Builder Pattern

**Choice**: Use array of strings joined with newlines

**Rationale**:
- Easy to read and maintain
- Simple to test output
- Flexible for formatting changes

**Implementation**:
```typescript
const lines: string[] = [];
lines.push("Next steps:");
lines.push(`  1. Deploy to AWS: ${deployCommand}`);
// ...
return lines.join('\n');
```

#### Decision 4: Command Format Helpers

**Choice**: Extract command formatting into helper functions

**Rationale**:
- Reusable across different profiles
- Easy to test independently
- Encapsulates context-specific logic

**Implementation**:
```typescript
function formatDeployCommand(profile: string, stage: string, isNpx: boolean): string {
  if (isNpx) {
    return `npx @quiltdata/benchling-webhook deploy --stage ${stage}`;
  }
  // Repository context
  if (profile === 'default') return 'npm run deploy';
  if (profile === 'dev') return 'npm run deploy:dev';
  if (profile === 'prod') return 'npm run deploy:prod';
  return `npm run deploy -- --profile ${profile} --stage ${stage}`;
}
```

### Current Behavior to Preserve

From `setup-wizard.ts:817-836`:

**Default profile**:
```
Next steps:
  1. Deploy to AWS: npm run deploy
  2. Test integration: npm run test
```

**Dev profile**:
```
Next steps:
  1. Deploy to AWS: npm run deploy:dev
  2. Test integration: npm run test:dev
```

**Prod profile**:
```
Next steps:
  1. Deploy to AWS: npm run deploy:prod
  2. Test integration: npm run test:prod
```

**Custom profile**:
```
Next steps:
  1. Deploy to AWS: npm run deploy -- --profile {profile} --stage {profile}
  2. Check logs: npx ts-node scripts/check-logs.ts --profile {profile}
```

### Integration with setup-wizard.ts

#### Before (current):
```typescript
// Lines 817-836 in setup-wizard.ts
console.log("Next steps:");
if (profile === "default") {
    console.log("  1. Deploy to AWS: npm run deploy");
    console.log("  2. Test integration: npm run test\n");
} else if (profile === "dev") {
    // ... etc
}
```

#### After (Phase 1):
```typescript
import { generateNextSteps } from '../../lib/next-steps-generator';

// ... after config saved
const nextSteps = generateNextSteps({
    profile,
    stage: profile === 'prod' ? 'prod' : 'dev',
});
console.log(nextSteps);
```

## Testing Strategy

### Unit Tests Structure

```typescript
describe('generateNextSteps', () => {
  describe('default profile', () => {
    it('should show npm run deploy for default profile');
    it('should show npm run test for testing');
  });

  describe('dev profile', () => {
    it('should show npm run deploy:dev');
    it('should show npm run test:dev');
  });

  describe('prod profile', () => {
    it('should show npm run deploy:prod');
    it('should show npm run test:prod');
  });

  describe('custom profile', () => {
    it('should show deploy command with profile flag');
    it('should show npx ts-node for log checking');
  });
});
```

### Test Cases

#### TC1: Default Profile
```typescript
const result = generateNextSteps({ profile: 'default' });
expect(result).toContain('npm run deploy');
expect(result).toContain('npm run test');
expect(result).not.toContain('--profile');
```

#### TC2: Dev Profile
```typescript
const result = generateNextSteps({ profile: 'dev' });
expect(result).toContain('npm run deploy:dev');
expect(result).toContain('npm run test:dev');
```

#### TC3: Prod Profile
```typescript
const result = generateNextSteps({ profile: 'prod' });
expect(result).toContain('npm run deploy:prod');
expect(result).toContain('npm run test:prod');
```

#### TC4: Custom Profile
```typescript
const result = generateNextSteps({ profile: 'staging' });
expect(result).toContain('npm run deploy -- --profile staging');
expect(result).toContain('npx ts-node scripts/check-logs.ts --profile staging');
```

#### TC5: Empty Output Structure
```typescript
const result = generateNextSteps({ profile: 'default' });
expect(result).toMatch(/Next steps:/);
expect(result).toMatch(/1\. Deploy to AWS:/);
expect(result).toMatch(/2\. Test/);
```

### Integration Test

```typescript
describe('setup-wizard integration', () => {
  it('should display next steps after setup', async () => {
    // Mock inquirer responses
    // Run setup wizard
    // Capture console output
    // Verify next steps displayed
  });
});
```

## Implementation Steps

### Step 1: Create Type Definitions
- Create `lib/types/next-steps.ts`
- Define `ExecutionContext` interface
- Define `DeploymentResult` interface
- Define `NextStepsOptions` interface
- Export all types

### Step 2: Create Generator Module
- Create `lib/next-steps-generator.ts`
- Implement `generateNextSteps()` function
- Add helper functions for command formatting
- Add JSDoc documentation
- Handle all profile cases

### Step 3: Write Unit Tests
- Create `tests/lib/next-steps-generator.test.ts`
- Test all profile types
- Test output format
- Test edge cases (empty profile, etc.)
- Achieve 100% coverage

### Step 4: Update setup-wizard.ts
- Import `generateNextSteps`
- Replace hardcoded next steps logic
- Pass profile and stage
- Verify output unchanged

### Step 5: Verify Integration
- Run full test suite
- Manual test with different profiles
- Verify next steps match current behavior
- Check TypeScript compilation

## Quality Checklist

- [ ] Type definitions created
- [ ] Generator module implemented
- [ ] Unit tests written and passing
- [ ] 100% test coverage achieved
- [ ] setup-wizard.ts updated
- [ ] Integration tested
- [ ] All existing tests pass
- [ ] TypeScript compiles without errors
- [ ] Lint checks pass
- [ ] Documentation complete

## Rollback Plan

If issues arise:
1. Revert changes to `setup-wizard.ts`
2. Remove new files: `lib/next-steps-generator.ts`, `lib/types/next-steps.ts`
3. Remove test file: `tests/lib/next-steps-generator.test.ts`
4. Restore original behavior

**Risk**: Very low - pure refactoring with test coverage

## Success Criteria

- [ ] Next steps logic extracted into separate module
- [ ] All profile types handled correctly
- [ ] Output matches current behavior exactly
- [ ] 100% test coverage for generator
- [ ] Zero behavior changes visible to users
- [ ] All tests pass
- [ ] Code review approved

## Next Steps (After Phase 1)

Phase 2 will:
- Add context detection logic
- Update `generateNextSteps()` to use context
- Generate npx commands for npx users
- Update tests for context-aware behavior

This Phase 1 design creates the foundation for Phase 2's context-aware features without changing current behavior.
