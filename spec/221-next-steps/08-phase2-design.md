# Phase 2 Design Document - Context Detection

**Phase**: 2 of 3
**Issue**: #221
**Dependencies**: Phase 1 (Complete)
**References**:
- spec/221-next-steps/03-specifications.md (Context Detection Module)
- spec/221-next-steps/04-phases.md (Phase 2 description)

## Overview

Phase 2 implements context detection to determine whether the CLI is running via npx or within the repository, enabling appropriate command suggestions in next steps messages.

## Problem Statement

Currently, next steps always suggest npm scripts (e.g., `npm run deploy`), which:
- Don't work for users running via `npx @quiltdata/benchling-webhook`
- Show incorrect commands for the execution context
- Create confusion and poor user experience

## Solution: Execution Context Detection

### Core Principle

Detect execution context by examining the runtime environment, specifically:
1. Presence and content of `package.json`
2. Existence of source files (`lib/`, `bin/`)
3. Whether package is installed vs running from source

### Context Types

Two mutually exclusive contexts:

1. **Repository Context** (`isRepository: true`)
   - Running from source within git repository
   - Has `package.json` with name `@quiltdata/benchling-webhook`
   - Has `lib/` directory with source TypeScript files
   - User is developer or contributor
   - Commands: `npm run <script>`

2. **NPX Context** (`isNpx: true`)
   - Running from installed package via npx
   - May have `package.json` but no source files
   - No `lib/` directory or only compiled JavaScript
   - User is end-user installing the tool
   - Commands: `npx @quiltdata/benchling-webhook <command>`

## Architecture

### Module Structure

```
lib/
  context-detector.ts          # Detection logic
  next-steps-generator.ts      # Enhanced with context support
  types/
    next-steps.ts             # ExecutionContext interface (exists)

tests/lib/
  context-detector.test.ts     # Comprehensive tests
  next-steps-generator.test.ts # Enhanced with context tests
```

### Data Flow

```
┌─────────────────────┐
│ CLI Command Entry   │
│ (setup-wizard.ts)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ detectContext()     │
│ (context-detector)  │
└──────────┬──────────┘
           │
           ▼
    ExecutionContext
           │
           ▼
┌─────────────────────┐
│ generateNextSteps() │
│ (next-steps-gen)    │
└──────────┬──────────┘
           │
           ▼
    Formatted Message
```

## API Design

### Context Detector

```typescript
/**
 * Detect execution context
 *
 * Determines whether CLI is running in repository or via npx
 * by examining file system for source files and package.json.
 */
export function detectExecutionContext(): ExecutionContext {
  // Implementation details below
}
```

### Enhanced Next Steps Generator

```typescript
export function generateNextSteps(options: NextStepsOptions): string {
  // options.context is now optional
  // If not provided, use default behavior (backward compatible)
  // If provided, format commands appropriately
}
```

## Implementation Details

### Context Detection Algorithm

```typescript
function detectExecutionContext(): ExecutionContext {
  const context: ExecutionContext = {
    isRepository: false,
    isNpx: false,
    packageName: '@quiltdata/benchling-webhook',
    availableScripts: []
  };

  // 1. Find package.json
  const pkgPath = findPackageJson();
  if (!pkgPath) {
    // No package.json - assume npx
    context.isNpx = true;
    return context;
  }

  // 2. Read package.json
  const pkg = readPackageJson(pkgPath);
  if (pkg.name !== '@quiltdata/benchling-webhook') {
    // Different package - assume npx
    context.isNpx = true;
    return context;
  }

  // 3. Check for source files
  const hasSourceFiles = checkForSourceFiles(pkgPath);
  if (hasSourceFiles) {
    // Has source files - repository context
    context.isRepository = true;
    context.availableScripts = extractAvailableScripts(pkg);
  } else {
    // No source files - npx context
    context.isNpx = true;
  }

  return context;
}
```

### Helper Functions

```typescript
/**
 * Find package.json starting from current directory
 * Walks up directory tree until found or root reached
 */
function findPackageJson(): string | null {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return pkgPath;
    }
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Check if source files exist (lib/ directory with .ts files)
 */
function checkForSourceFiles(pkgPath: string): boolean {
  const pkgDir = path.dirname(pkgPath);
  const libDir = path.join(pkgDir, 'lib');

  // Check for lib directory
  if (!fs.existsSync(libDir)) {
    return false;
  }

  // Check for TypeScript files in lib
  const files = fs.readdirSync(libDir);
  return files.some(f => f.endsWith('.ts'));
}

/**
 * Extract available npm scripts from package.json
 */
function extractAvailableScripts(pkg: any): string[] {
  if (!pkg.scripts) return [];
  return Object.keys(pkg.scripts);
}
```

### Command Formatting

```typescript
/**
 * Format command based on context
 */
function formatCommand(
  command: string,
  context: ExecutionContext,
  profile?: string
): string {
  if (context.isRepository) {
    // Use npm script if available
    const script = findMatchingScript(command, profile, context.availableScripts);
    if (script) {
      return `npm run ${script}`;
    }
    // Fallback to ts-node for custom commands
    return `npx ts-node bin/cli.ts ${command}${profile ? ` --profile ${profile}` : ''}`;
  }

  // NPX context
  return `npx ${context.packageName} ${command}${profile ? ` --profile ${profile}` : ''}`;
}

/**
 * Find matching npm script for command/profile combination
 */
function findMatchingScript(
  command: string,
  profile: string | undefined,
  scripts: string[]
): string | null {
  // Try profile-specific script first
  if (profile) {
    const profileScript = `${command}:${profile}`;
    if (scripts.includes(profileScript)) {
      return profileScript;
    }
  }

  // Try base command
  if (scripts.includes(command)) {
    return command;
  }

  return null;
}
```

## Edge Cases

### Edge Case 1: Monorepo

**Scenario**: CLI installed in monorepo with multiple packages

**Detection**: Check package.json name matches exactly

**Behavior**: If name matches and has source files → repository, else → npx

### Edge Case 2: Global Installation

**Scenario**: User runs `npm install -g @quiltdata/benchling-webhook`

**Detection**: No local package.json or source files

**Behavior**: Treated as npx context

### Edge Case 3: Symlinked Development

**Scenario**: Developer uses `npm link` for testing

**Detection**: package.json exists and has source files

**Behavior**: Repository context (correct for development)

### Edge Case 4: Docker Container

**Scenario**: Running in container with mounted source

**Detection**: package.json and source files present

**Behavior**: Repository context if source files exist, npx otherwise

### Edge Case 5: Missing package.json

**Scenario**: Running from unexpected location

**Detection**: No package.json found

**Behavior**: Default to npx context (safer fallback)

## Testing Strategy

### Unit Tests (context-detector.test.ts)

```typescript
describe('detectExecutionContext', () => {
  describe('repository context', () => {
    it('should detect repository with source files');
    it('should extract available scripts');
    it('should handle package.json in parent directory');
  });

  describe('npx context', () => {
    it('should detect npx when no package.json');
    it('should detect npx when no source files');
    it('should detect npx when different package name');
  });

  describe('edge cases', () => {
    it('should handle missing package.json');
    it('should handle malformed package.json');
    it('should handle missing scripts field');
    it('should handle empty lib directory');
  });
});
```

### Integration Tests (next-steps-generator.test.ts)

```typescript
describe('context-aware next steps', () => {
  describe('repository context', () => {
    it('should generate npm run commands');
    it('should use available scripts');
    it('should fallback to ts-node for unavailable scripts');
  });

  describe('npx context', () => {
    it('should generate npx commands');
    it('should include package name');
    it('should format profile flags correctly');
  });

  describe('backward compatibility', () => {
    it('should work without context parameter');
    it('should default to current behavior');
  });
});
```

## Backward Compatibility

### Phase 1 Compatibility

- `generateNextSteps()` continues to work with just `{ profile }`
- Optional `context` parameter doesn't break existing calls
- Default behavior unchanged when context not provided

### Migration Path

```typescript
// Phase 1 (works)
generateNextSteps({ profile: 'default' });

// Phase 2 (works)
const context = detectExecutionContext();
generateNextSteps({ profile: 'default', context });

// Both produce correct output
```

## Performance Considerations

### File System Access

- `findPackageJson()`: O(depth) directory traversal
- `checkForSourceFiles()`: Single directory read
- `readPackageJson()`: Single file read

**Total overhead**: <10ms on typical systems

### Caching

Not needed for Phase 2:
- Detection runs once per CLI invocation
- Results not reused across commands
- Overhead negligible compared to AWS operations

## Security Considerations

### File System Safety

- Only reads files, never writes
- No arbitrary path access
- No symlink following vulnerabilities
- Validates package.json structure before parsing

### Input Validation

```typescript
function readPackageJson(pkgPath: string): any {
  try {
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    // Validate structure
    if (typeof pkg !== 'object' || pkg === null) {
      return {};
    }

    return pkg;
  } catch {
    return {};
  }
}
```

## Error Handling

### Graceful Degradation

```typescript
function detectExecutionContext(): ExecutionContext {
  try {
    // Detection logic
  } catch (error) {
    // Log error for debugging
    console.warn('Context detection failed, defaulting to npx:', error);

    // Safe fallback
    return {
      isRepository: false,
      isNpx: true,
      packageName: '@quiltdata/benchling-webhook',
      availableScripts: []
    };
  }
}
```

## Documentation Updates

### Code Documentation

- JSDoc comments for all public functions
- Examples in function headers
- Type annotations for all parameters

### User Documentation

Not required for Phase 2:
- Behavior transparent to users
- No user-facing API changes
- README updates in Phase 3

## Success Criteria

### Functional

- [ ] Correctly detects repository context with source files
- [ ] Correctly detects npx context without source files
- [ ] Handles all edge cases gracefully
- [ ] Backward compatible with Phase 1

### Quality

- [ ] 100% test coverage for context-detector.ts
- [ ] All edge cases tested
- [ ] Zero behavior changes when context not provided
- [ ] No performance regression

### Integration

- [ ] next-steps-generator accepts optional context
- [ ] Commands formatted appropriately per context
- [ ] All existing tests still pass

## Risks and Mitigations

### Risk 1: False Detection

**Impact**: Wrong commands shown to user

**Likelihood**: Low (comprehensive testing)

**Mitigation**:
- Extensive test matrix
- Safe fallback to npx context
- Manual testing in both contexts

### Risk 2: Performance Impact

**Impact**: Slow CLI startup

**Likelihood**: Very low (minimal file I/O)

**Mitigation**:
- Benchmark context detection
- Target <10ms overhead
- Optimize if needed

### Risk 3: Breaking Changes

**Impact**: Existing code fails

**Likelihood**: Very low (optional parameter)

**Mitigation**:
- Optional context parameter
- Default behavior unchanged
- Comprehensive backward compatibility tests

## Implementation Checklist

- [ ] Create lib/context-detector.ts
- [ ] Implement detectExecutionContext()
- [ ] Implement helper functions
- [ ] Create tests/lib/context-detector.test.ts
- [ ] Write comprehensive tests
- [ ] Update lib/next-steps-generator.ts
- [ ] Add context-aware command formatting
- [ ] Update tests/lib/next-steps-generator.test.ts
- [ ] Add context-aware tests
- [ ] Run all tests
- [ ] Fix linting issues
- [ ] Verify 100% coverage
- [ ] Manual testing in repository
- [ ] Manual testing via npx (if possible)

## Future Enhancements (Out of Scope)

- Cache context detection results
- Support for Yarn/pnpm commands
- Auto-detection of preferred package manager
- Custom command templates

## Summary

Phase 2 delivers context detection that enables correct command suggestions for both repository developers and npx users. The implementation is:

- **Simple**: Single-purpose modules with clear responsibilities
- **Testable**: 100% coverage with comprehensive edge case handling
- **Safe**: Graceful degradation and backward compatibility
- **Fast**: Minimal overhead (<10ms)

This foundation enables Phase 3 to provide accurate next steps in the command chaining workflow.
