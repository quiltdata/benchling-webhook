# Implementation Phases - Issue #176: test:prod Command

**Date**: 2025-11-03
**References**: 01-requirements.md, 02-analysis.md, 03-specifications.md

## Phase Overview

This implementation is broken down into **one comprehensive phase** that can be completed in a single PR. The changes are tightly coupled and should be deployed together to maintain system consistency.

## Why Single Phase?

**Reasoning**:
1. **Tight Coupling**: Changes to deploy.json, Makefile, and npm scripts must be coordinated
2. **Atomic Feature**: test:prod is a single feature that must work end-to-end
3. **Small Scope**: Total changes affect 3 files (package.json, Makefile, deploy.ts)
4. **No Breaking Changes**: All changes are additive or backward-compatible
5. **Fast Implementation**: Estimated 2-3 hours total work

**Alternative Considered**: Breaking into phases (config, then tests, then deployment) would create intermediate states where test:prod exists but doesn't work, confusing developers.

---

## Phase 1: Complete test:prod Implementation

**Goal**: Add production testing capability with full integration into deployment workflow

**Deliverables**:
1. Updated deploy.json schema with prod environment support
2. Enhanced deploy:prod to store outputs and run tests
3. New test:prod npm script
4. New test:dev npm script (clearer than test:remote)
5. Refactored Docker Makefile to eliminate naming conflicts
6. Updated documentation (README, CLAUDE.md)
7. Version bump to 0.6.3

**Success Criteria**:
- [ ] `npm run test:prod` successfully tests production stack
- [ ] `npm run test:dev` successfully tests development stack
- [ ] `npm run deploy:prod` runs tests automatically after deployment
- [ ] deploy.json includes both dev and prod sections after respective deployments
- [ ] All existing workflows continue to function
- [ ] Documentation reflects new commands

### Dependencies and Sequencing

#### Pre-requisites (Must Complete First)
1. **Version Bump**
   - Run `npm version patch` to bump to 0.6.3
   - Commit version bump before implementation
   - Rationale: Separates version change from feature implementation

2. **Configuration Schema Extension**
   - Update TypeScript interfaces for deploy.json structure
   - Add prod environment type definitions
   - Rationale: Type safety before implementation

#### Core Implementation (Sequential)
3. **Makefile Refactoring**
   - Rename `test-prod` → `test-docker-prod`
   - Add `test-deployed-prod` target (mirror test-deployed-dev)
   - Update help text
   - Rationale: Eliminates naming conflict, enables prod testing

4. **Deployment Command Enhancement**
   - Modify `bin/commands/deploy.ts` to write prod config
   - Query CloudFormation stack outputs
   - Write endpoint to deploy.json under prod key
   - Rationale: Enables endpoint discovery for tests

5. **npm Script Updates**
   - Add `test:prod` → `make -C docker test-deployed-prod`
   - Add `test:dev` → `make -C docker test-deployed-dev`
   - Update `deploy:prod` → `... && npm run test:prod`
   - Mark `test:remote` as deprecated in comments
   - Rationale: User-facing interface for testing

#### Documentation (Final)
6. **Documentation Updates**
   - Update README.md with new test commands
   - Update CLAUDE.md daily workflow section
   - Add deprecation notice for test:remote
   - Update examples
   - Rationale: Ensures discoverability of new features

### Integration Testing Strategy

#### Test Scenarios
1. **New Dev Deployment**
   - Run `npm run deploy:dev`
   - Verify deploy.json has dev section
   - Run `npm run test:dev`
   - Verify tests pass

2. **New Prod Deployment**
   - Run `npm run deploy:prod -- --quilt-stack-arn <arn> --benchling-secret <name> --yes`
   - Verify deploy.json has prod section
   - Verify tests run automatically
   - Verify deployment fails if tests fail

3. **Standalone Test Execution**
   - Run `npm run test:dev` without deployment
   - Verify uses existing deploy.json entry
   - Run `npm run test:prod` without deployment
   - Verify uses existing deploy.json entry

4. **Missing Configuration**
   - Delete deploy.json
   - Run `npm run test:dev`
   - Verify clear error message with instructions
   - Run `npm run test:prod`
   - Verify clear error message with instructions

5. **Backward Compatibility**
   - Run existing workflows (test:local, test:remote)
   - Verify no breakage
   - Verify test:remote still works (for 0.6.x)

### File Change Summary

#### Modified Files
```
package.json                    # Add test:dev, test:prod, update deploy:prod
docker/Makefile                 # Rename test-prod, add test-deployed-prod
bin/commands/deploy.ts          # Add prod config storage and test execution
lib/types/                      # Add DeployConfig interface (if needed)
README.md                       # Document new commands
docker/CLAUDE.md                # Update daily workflow section
```

#### New Files
```
None - all changes are modifications to existing files
```

#### Unchanged Files
```
docker/scripts/test_webhook.py # Already generic, no changes needed
bin/dev-deploy.ts               # Dev workflow already correct
docker/scripts/*.py             # Test infrastructure already correct
lib/benchling-webhook-stack.ts  # Stack outputs already correct
```

### Incremental Implementation Steps (Episodes)

Each episode is a single, testable, committable change:

#### Episode 1: Version Bump
- **Task**: Bump version to 0.6.3
- **Test**: Verify package.json shows 0.6.3
- **Commit**: `chore: bump version to 0.6.3 for test:prod feature`

#### Episode 2: TypeScript Type Definitions
- **Task**: Add/update DeployConfig interface for prod environment
- **Test**: TypeScript compilation succeeds
- **Commit**: `feat(types): add prod environment to DeployConfig interface`

#### Episode 3: Makefile Refactoring
- **Task**: Rename test-prod → test-docker-prod, add test-deployed-prod
- **Test**: Run `make -C docker deploy-help`, verify new targets appear
- **Commit**: `refactor(docker): rename test-prod to test-docker-prod, add test-deployed-prod`

#### Episode 4: Deployment Command Enhancement
- **Task**: Modify deploy.ts to write prod config after deployment
- **Test**: Mock deployment, verify deploy.json written correctly
- **Commit**: `feat(deploy): store prod endpoint in deploy.json after deployment`

#### Episode 5: npm Script Updates
- **Task**: Add test:dev, test:prod, update deploy:prod to include test:prod
- **Test**: Verify scripts exist in package.json, dry-run to check syntax
- **Commit**: `feat(scripts): add test:dev and test:prod commands`

#### Episode 6: Deploy:prod Test Integration
- **Task**: Update deploy:prod to run test:prod after successful deployment
- **Test**: Verify script chains correctly (can test with echo commands)
- **Commit**: `feat(deploy): run test:prod after production deployment`

#### Episode 7: Documentation Updates
- **Task**: Update README.md and CLAUDE.md with new commands
- **Test**: Verify markdown renders correctly
- **Commit**: `docs: document test:dev and test:prod commands`

#### Episode 8: Integration Testing
- **Task**: Run full deployment workflow, verify all tests pass
- **Test**: Execute test scenarios from integration testing strategy
- **Commit**: `test: verify test:prod integration workflow`

### Rollback Plan

If implementation fails or introduces critical bugs:

1. **Revert Git Commits**: All changes in single branch, easy to revert
2. **No Data Migration**: deploy.json schema is backward compatible
3. **No Infrastructure Changes**: Only changes deployment process, not infrastructure
4. **Quick Recovery**: Can delete prod section from deploy.json if needed

### "Pre-factoring" Opportunities

**Opportunity 1: Extract Config Writing**
- Current: deploy.ts and dev-deploy.ts both write deploy.json
- Pre-factor: Create shared utility function `writeDeploymentConfig(env, config)`
- Benefit: DRY principle, single source of truth for config writing
- Timing: Could do in this phase or defer to future refactor

**Decision**: Defer to future refactor. Current scope is small enough that duplication is acceptable.

### Post-Implementation Validation

After Phase 1 completes:

1. **Verify All Acceptance Criteria Met** (from 01-requirements.md)
   - [ ] All new commands exist and work
   - [ ] Documentation updated
   - [ ] Tests run automatically in deploy:prod
   - [ ] Error messages are clear

2. **Verify All Quality Gates Passed** (from 03-specifications.md)
   - [ ] Test coverage adequate
   - [ ] Performance within limits
   - [ ] Error reporting clear
   - [ ] Deployment validation works

3. **Regression Testing**
   - [ ] Existing test:local still works
   - [ ] Existing test:remote still works
   - [ ] Existing deploy:dev still works
   - [ ] CI/CD pipeline not broken

4. **Manual Testing**
   - [ ] Real dev deployment + test:dev
   - [ ] Real prod deployment + test:prod
   - [ ] Test failures properly propagate
   - [ ] Error messages are helpful

### Risk Assessment

#### Low Risk Items
- Adding npm scripts (non-breaking)
- Adding Makefile targets (non-breaking)
- Extending deploy.json schema (backward compatible)
- Documentation updates (zero risk)

#### Medium Risk Items
- Renaming Makefile target (could break developer muscle memory)
  - Mitigation: Keep old name as deprecated alias for 0.6.x
- Modifying deploy:prod (could slow deployment)
  - Mitigation: Tests run after infrastructure deployed, can be disabled via flag if needed

#### High Risk Items
- None identified

### Timeline Estimate

Based on episode breakdown:

- **Episode 1-2**: 15 minutes (version bump, types)
- **Episode 3**: 30 minutes (Makefile refactoring)
- **Episode 4**: 45 minutes (deploy.ts enhancement)
- **Episode 5-6**: 30 minutes (npm scripts)
- **Episode 7**: 30 minutes (documentation)
- **Episode 8**: 45 minutes (integration testing)

**Total**: ~3 hours for complete implementation and testing

### Success Indicators

Phase 1 is complete when:
- ✅ All episodes committed and pushed
- ✅ All tests pass (unit + integration)
- ✅ Manual validation completed
- ✅ Documentation updated
- ✅ PR ready for review
- ✅ Version 0.6.3 tagged

---

## Summary

**Single Phase Approach**: Implement entire feature in one coordinated effort
**Rationale**: Small scope, tightly coupled changes, no breaking changes
**Timeline**: 3 hours estimated
**Risk Level**: Low - all changes are additive or backward-compatible
**Validation**: Comprehensive integration testing before PR merge
