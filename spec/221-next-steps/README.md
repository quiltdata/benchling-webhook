# Issue #221: Next Steps - Implementation Specification

**GitHub Issue**: #221
**Branch**: 221-next-steps
**Status**: Ready for Implementation

## Overview

This specification addresses two user experience issues in the CLI:

1. **Incorrect next steps**: After setup, the CLI shows `npm run deploy` instead of context-appropriate commands
2. **Missing command chaining**: Users must manually run deploy after setup, instead of automatic chaining

## Document Structure

### I RASP Phase (Analysis)

1. **[01-requirements.md](./01-requirements.md)** - User stories and acceptance criteria
2. **[02-analysis.md](./02-analysis.md)** - Current code analysis and gap assessment
3. **[03-specifications.md](./03-specifications.md)** - Desired end state and architectural goals
4. **[04-phases.md](./04-phases.md)** - Three-phase implementation breakdown

### DECO Phase (Implementation)

#### Phase 1: Extract Next Steps Logic (Refactoring)

- **[05-phase1-design.md](./05-phase1-design.md)** - Module design and architecture
- **[06-phase1-episodes.md](./06-phase1-episodes.md)** - 11 atomic change episodes
- **[07-phase1-checklist.md](./07-phase1-checklist.md)** - Detailed implementation checklist

#### Phase 2: Context Detection (TBD)

- Design, episodes, and checklist to be created after Phase 1 completion

#### Phase 3: Command Chaining (TBD)

- Design, episodes, and checklist to be created after Phase 2 completion

## Implementation Strategy

### Phase 1: Extract Next Steps Logic (Current)
**Goal**: Refactor existing next steps code into reusable, testable module
**Duration**: 4-6 hours
**Risk**: Low (pure refactoring)

### Phase 2: Context Detection
**Goal**: Detect execution context and generate appropriate commands
**Duration**: 6-8 hours
**Risk**: Medium (context detection edge cases)

### Phase 3: Command Chaining
**Goal**: Implement setup → deploy workflow with user confirmation
**Duration**: 8-10 hours
**Risk**: Medium-High (complex workflow with error handling)

## Key Deliverables

1. **lib/next-steps-generator.ts** - Dynamic next steps generation module
2. **lib/context-detector.ts** - Execution context detection module
3. **Enhanced CLI** - Command chaining with user confirmation
4. **Tests** - Comprehensive test coverage (100% for new code)
5. **Documentation** - Updated README and help text

## Success Metrics

- Context detection: 100% accuracy
- Next steps correctness: 100% match execution context
- Backward compatibility: Zero breaking changes
- Test coverage: >85% overall, 100% for new modules
- User satisfaction: >90% successfully deploy via default flow

## Quick Navigation

- **Start here**: [01-requirements.md](./01-requirements.md)
- **Current state**: [02-analysis.md](./02-analysis.md)
- **End state**: [03-specifications.md](./03-specifications.md)
- **Implementation plan**: [04-phases.md](./04-phases.md)
- **Phase 1 guide**: [07-phase1-checklist.md](./07-phase1-checklist.md)

## Related Files

### Files to be Created
- `lib/types/next-steps.ts`
- `lib/next-steps-generator.ts`
- `lib/context-detector.ts` (Phase 2)
- `tests/lib/next-steps-generator.test.ts`
- `tests/lib/context-detector.test.ts` (Phase 2)

### Files to be Modified
- `bin/commands/setup-wizard.ts` (lines 817-836)
- `bin/cli.ts` (default behavior, Phase 3)
- `README.md` (Quick Start section)
- `CHANGELOG.md` (release notes)

## Development Workflow

1. **Review I RASP documents** (01-04)
2. **Review Phase 1 design** (05)
3. **Follow episode sequence** (06)
4. **Check off tasks** (07)
5. **Test continuously** (`npm test`, `npm run lint`)
6. **Commit each episode**
7. **Push regularly**

## Testing Strategy

- **Unit tests**: 100% coverage for new modules
- **Integration tests**: setup-wizard with all profiles
- **Manual tests**: npx and npm script execution
- **Regression tests**: All existing tests must pass
- **BDD approach**: Write failing tests first

## Quality Gates

Each phase must meet:
- [ ] All tests passing
- [ ] Lint checks clean
- [ ] Type checks clean
- [ ] Code review approved
- [ ] Documentation complete
- [ ] Manual testing verified

## Contact & Support

- **GitHub Issue**: https://github.com/quiltdata/benchling-webhook/issues/221
- **Branch**: 221-next-steps
- **Workflow**: I RASP DECO (see spec/WORKFLOW.md)

---

**Last Updated**: 2025-11-12
**Status**: Phase 1 ready for implementation
