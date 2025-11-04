# Phase 1 Checklist - Complete test:prod Implementation

**Date**: 2025-11-03
**References**: 06-phase1-design.md, 07-phase1-episodes.md
**GitHub Issue**: #176

## Pre-Implementation Setup

### Environment Validation
- [ ] On branch `176-test-prod`
- [ ] Working directory clean (no uncommitted changes)
- [ ] All tests passing: `npm run test`
- [ ] TypeScript compiling: `npm run build:typecheck`
- [ ] IDE diagnostics clear

### Context Verification
- [ ] Read and understand issue #176 requirements
- [ ] Reviewed all I RASP DECO documents (01-04)
- [ ] Understood design document (06-phase1-design.md)
- [ ] Reviewed episode breakdown (07-phase1-episodes.md)

---

## Episode 1: Version Bump

### Implementation Tasks
- [ ] Run `npm version patch` to bump to 0.6.3
- [ ] Verify package.json shows version 0.6.3
- [ ] Verify package-lock.json updated

### Testing
- [ ] TypeScript compilation: `npm run build:typecheck`
- [ ] Verify version in package.json: `grep '"version": "0.6.3"' package.json`

### Quality Gates
- [ ] No compilation errors
- [ ] No linting errors
- [ ] Git shows clean version bump

### Commit
- [ ] Commit with message: `chore: bump version to 0.6.3 for test:prod feature`
- [ ] Push to remote: `git push origin 176-test-prod`

---

## Episode 2: TypeScript Type Definitions

### Implementation Tasks
- [ ] Open `bin/commands/deploy.ts`
- [ ] Add `DeploymentConfig` interface after imports
- [ ] Add `EnvironmentConfig` interface after DeploymentConfig
- [ ] Verify interfaces match design specification (06-phase1-design.md)

### Code Review Checklist
- [ ] `DeploymentConfig` has `dev?` and `prod?` optional properties
- [ ] `EnvironmentConfig` has all 5 required fields:
  - [ ] `endpoint: string`
  - [ ] `imageTag: string`
  - [ ] `deployedAt: string`
  - [ ] `stackName: string`
  - [ ] `region?: string` (optional)
- [ ] JSDoc comments added for both interfaces

### Testing
- [ ] TypeScript compilation: `npm run build:typecheck`
- [ ] No type errors introduced
- [ ] Linting: `npm run lint`

### Quality Gates
- [ ] TypeScript compiles without errors
- [ ] No linting warnings
- [ ] Interfaces properly documented

### Commit
- [ ] Commit with message: `feat(types): add deployment configuration interfaces`
- [ ] Push to remote

---

## Episode 3: Makefile Refactoring - Rename test-prod

### Implementation Tasks
- [ ] Open `docker/Makefile`
- [ ] Find `test-prod` target (around line 211)
- [ ] Rename target to `test-docker-prod`
- [ ] Update comment above target to clarify "local docker"
- [ ] Find `.PHONY` declaration (around line 19)
- [ ] Update `test-prod` → `test-docker-prod` in .PHONY
- [ ] Find help text (around line 44)
- [ ] Update help text: `test-docker-prod` with description

### Code Review Checklist
- [ ] Target renamed: `test-docker-prod: run-prod health-prod`
- [ ] Comment clarifies this tests local Docker
- [ ] `.PHONY` includes `test-docker-prod`
- [ ] Help text describes "local docker prod container"
- [ ] No other references to old name remain

### Testing
- [ ] Make syntax validation: `make -C docker -n test-docker-prod`
- [ ] Help text displays correctly: `make -C docker help | grep test-docker-prod`
- [ ] Old name no longer works: `make -C docker test-prod 2>&1 | grep "No rule"`

### Quality Gates
- [ ] Make syntax valid
- [ ] Help text clear and accurate
- [ ] No dangling references to old name

### Commit
- [ ] Commit with message: `refactor(docker): rename test-prod to test-docker-prod`
- [ ] Push to remote

---

## Episode 4: Add test-deployed-prod Makefile Target

### Implementation Tasks
- [ ] Open `docker/Makefile`
- [ ] Find `test-deployed-dev` target (around line 240)
- [ ] After `test-deployed-dev`, add blank line
- [ ] Add `test-deployed-prod` target
- [ ] Copy structure from `test-deployed-dev`
- [ ] Change `DEV_ENDPOINT` → `PROD_ENDPOINT`
- [ ] Change `.dev.endpoint` → `.prod.endpoint` in jq command
- [ ] Change error message to reference `deploy:prod`
- [ ] Update `.PHONY` to include `test-deployed-prod`
- [ ] Update help text to include `test-deployed-prod`

### Code Review Checklist
- [ ] Target signature: `test-deployed-prod: check-xdg`
- [ ] First echo: `"🧪 Testing deployed prod stack..."`
- [ ] jq reads: `.prod.endpoint // empty`
- [ ] Error message mentions: `npm run deploy:prod`
- [ ] Test command uses: `uv run python scripts/test_webhook.py "$$PROD_ENDPOINT"`
- [ ] `.PHONY` includes `test-deployed-prod`
- [ ] Help text includes both dev and prod targets

### Testing
- [ ] Make syntax validation: `make -C docker -n test-deployed-prod || true`
- [ ] Expect error: "No prod endpoint found" (before deployment)
- [ ] Error message helpful: references `deploy:prod`
- [ ] Help displays: `make -C docker help | grep test-deployed-prod`

### Quality Gates
- [ ] Make syntax valid
- [ ] Error message actionable
- [ ] Mirrors dev pattern exactly
- [ ] Help text accurate

### Commit
- [ ] Commit with message: `feat(docker): add test-deployed-prod Makefile target`
- [ ] Push to remote

---

## Episode 5: Add Helper Function to deploy.ts

### Implementation Tasks
- [ ] Open `bin/commands/deploy.ts`
- [ ] Add imports at top (if not present):
  - [ ] `import { homedir } from "os";`
  - [ ] `import { join } from "path";`
  - [ ] `import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";`
- [ ] Before `deployCommand` function, add `storeDeploymentConfig` helper
- [ ] Implement atomic write pattern:
  - [ ] Read existing deploy.json
  - [ ] Update environment section
  - [ ] Write to temp file
  - [ ] Atomic rename (platform-specific)
- [ ] Add console logging for confirmation

### Code Review Checklist
- [ ] Function signature: `storeDeploymentConfig(environment: 'dev' | 'prod', config: EnvironmentConfig): void`
- [ ] Reads existing deploy.json if exists
- [ ] Merges with new config (preserves other environments)
- [ ] Creates config directory if missing: `mkdirSync(configDir, { recursive: true })`
- [ ] Writes to temp file first: `${deployJsonPath}.tmp`
- [ ] Platform-specific rename:
  - [ ] Windows: backup + rename
  - [ ] Unix: atomic rename
- [ ] Logs success with emoji: `✅ Stored deployment config`
- [ ] Logs environment and endpoint

### Testing
- [ ] TypeScript compilation: `npm run build:typecheck`
- [ ] No type errors
- [ ] Linting: `npm run lint`
- [ ] Manual verification: function signature correct

### Quality Gates
- [ ] Function compiles
- [ ] Atomic write pattern implemented
- [ ] Cross-platform compatible
- [ ] Proper error handling

### Commit
- [ ] Commit with message: `feat(deploy): add helper for storing deployment config`
- [ ] Push to remote

---

## Episode 6: Integrate Config Storage and Testing in deploy.ts

### Implementation Tasks
- [ ] Open `bin/commands/deploy.ts`
- [ ] Add imports:
  - [ ] `import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";`
  - [ ] `import { execSync } from "child_process";`
- [ ] Find `deployCommand` function
- [ ] Locate section after successful CDK deployment
- [ ] Add post-deployment logic block:
  - [ ] Query CloudFormation for stack outputs
  - [ ] Extract WebhookEndpoint output
  - [ ] Call `storeDeploymentConfig('prod', ...)`
  - [ ] Execute `npm run test:prod`
  - [ ] Handle test failures (exit 1)
- [ ] Add try-catch for error handling
- [ ] Add helpful logging at each step

### Code Review Checklist
- [ ] CloudFormation query uses correct region
- [ ] Stack name: `"BenchlingWebhookStack"`
- [ ] Finds output: `OutputKey === "WebhookEndpoint"`
- [ ] Stores prod config with all fields:
  - [ ] endpoint
  - [ ] imageTag (from options or "latest")
  - [ ] deployedAt (ISO 8601)
  - [ ] stackName
  - [ ] region
- [ ] Test execution: `execSync("npm run test:prod", { stdio: "inherit" })`
- [ ] Test failure causes deployment to exit 1
- [ ] Warnings if endpoint retrieval fails (don't fail deployment)
- [ ] Clear logging at each step

### Testing
- [ ] TypeScript compilation: `npm run build:typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] No runtime errors (will test in integration)

### Quality Gates
- [ ] TypeScript compiles
- [ ] Proper error handling
- [ ] Test failures propagate correctly
- [ ] Logging is clear and helpful

### Commit
- [ ] Commit with message: `feat(deploy): store prod endpoint and run tests after deployment`
- [ ] Push to remote

---

## Episode 7: Add npm Scripts for test:dev and test:prod

### Implementation Tasks
- [ ] Open `package.json`
- [ ] Find `"scripts"` section
- [ ] Add after existing test scripts:
  - [ ] `"test:dev": "make -C docker test-deployed-dev",`
  - [ ] `"test:prod": "make -C docker test-deployed-prod",`
- [ ] Update `test:remote` to use `test:dev`:
  - [ ] `"test:remote": "npm run test:dev",`
- [ ] Verify JSON syntax (trailing commas correct)

### Code Review Checklist
- [ ] `test:dev` delegates to `make -C docker test-deployed-dev`
- [ ] `test:prod` delegates to `make -C docker test-deployed-prod`
- [ ] `test:remote` now calls `npm run test:dev`
- [ ] No JSON syntax errors
- [ ] Scripts in logical order

### Testing
- [ ] JSON validation: `npm run build:typecheck`
- [ ] Script exists: `npm run test:dev -- --help 2>&1 || true`
- [ ] Script exists: `npm run test:prod -- --help 2>&1 || true`
- [ ] Expect Make errors (no endpoint yet) - that's OK

### Quality Gates
- [ ] package.json valid JSON
- [ ] Scripts properly defined
- [ ] Delegation correct

### Commit
- [ ] Commit with message: `feat(scripts): add test:dev and test:prod commands`
- [ ] Push to remote

---

## Episode 8: Update README.md Documentation

### Implementation Tasks
- [ ] Open `README.md`
- [ ] Find "Available Test Commands" or "Testing Strategy" section
- [ ] Add "Remote Deployment Testing" subsection
- [ ] Document:
  - [ ] `npm run test:dev` command
  - [ ] `npm run test:prod` command
  - [ ] Deprecation notice for `test:remote`
  - [ ] What tests validate
  - [ ] Prerequisites
- [ ] Find "Production Release" section
- [ ] Update "Step 2: Deploy to production"
- [ ] Add notes about automatic testing
- [ ] Note that deployment fails if tests fail

### Code Review Checklist
- [ ] New section titled "Remote Deployment Testing"
- [ ] All three commands documented (test:dev, test:prod, test:remote)
- [ ] Deprecation notice clear: "will be removed in 0.7.0"
- [ ] Prerequisites listed (stack deployed, deploy.json exists)
- [ ] Production deployment section updated
- [ ] Automatic testing behavior documented
- [ ] Failure behavior documented
- [ ] Examples use correct syntax

### Testing
- [ ] Markdown renders correctly (preview)
- [ ] Links work (if any)
- [ ] Code blocks properly formatted
- [ ] No spelling errors

### Quality Gates
- [ ] Documentation accurate
- [ ] Examples correct
- [ ] Clear and concise
- [ ] Deprecation notice prominent

### Commit
- [ ] Commit with message: `docs: document test:dev and test:prod commands`
- [ ] Push to remote

---

## Episode 9: Update CLAUDE.md Documentation

### Implementation Tasks
- [ ] Open `docker/CLAUDE.md` (or root CLAUDE.md if that exists)
- [ ] Find "Daily development" section
- [ ] Add `npm run test:dev` to daily workflow
- [ ] Find "Before creating PR" section
- [ ] Add `npm run test:dev` as optional step
- [ ] Find or create "Available Test Commands" section
- [ ] Document all remote test commands
- [ ] Add deprecation notice for test:remote

### Code Review Checklist
- [ ] Daily workflow includes `test:dev`
- [ ] PR workflow includes optional `test:dev`
- [ ] All remote test commands documented
- [ ] Deprecation notice consistent with README
- [ ] Formatting matches existing style

### Testing
- [ ] Markdown renders correctly
- [ ] Consistent with README.md
- [ ] No spelling errors

### Quality Gates
- [ ] Documentation accurate
- [ ] Workflow guidance helpful
- [ ] Consistent with project conventions

### Commit
- [ ] Commit with message: `docs: update CLAUDE.md with new test commands`
- [ ] Push to remote

---

## Episode 10: Integration Testing and Validation

### Implementation Tasks
- [ ] Run full test suite: `npm test`
- [ ] Run TypeScript compilation: `npm run build:typecheck`
- [ ] Run linting: `npm run lint`
- [ ] Verify Make targets exist:
  - [ ] `make -C docker help | grep test-deployed-dev`
  - [ ] `make -C docker help | grep test-deployed-prod`
  - [ ] `make -C docker help | grep test-docker-prod`
- [ ] Verify npm scripts exist:
  - [ ] `npm run test:dev -- --help 2>&1 || true`
  - [ ] `npm run test:prod -- --help 2>&1 || true`
- [ ] Test error messages:
  - [ ] `make -C docker test-deployed-prod 2>&1 | grep "deploy:prod"`
- [ ] Review documentation:
  - [ ] README.md examples accurate
  - [ ] CLAUDE.md workflow correct
- [ ] Manual testing (if dev stack available):
  - [ ] `npm run test:dev` (if deployed)
  - [ ] Verify error message if not deployed

### Acceptance Criteria Validation
From 01-requirements.md:

#### AC-1: New Test Commands
- [ ] `npm run test:dev` exists
- [ ] `npm run test:prod` exists
- [ ] `npm run test:remote` updated (backward compatible)
- [ ] Both use same test infrastructure (test_webhook.py)

#### AC-2: Environment Detection
- [ ] Commands read from deploy.json correctly
- [ ] Graceful failure if endpoint missing
- [ ] Clear error messages show environment

#### AC-3: Production Deployment Integration
- [ ] deploy:prod stores config in deploy.json
- [ ] deploy:prod runs test:prod automatically
- [ ] Test failures cause deployment to fail
- [ ] Logs clearly show test phase

#### AC-4: Test Infrastructure
- [ ] Tests validate health endpoints
- [ ] Tests validate webhook processing
- [ ] Tests validate S3 storage (via existing tests)
- [ ] Detailed output provided

#### AC-5: Documentation
- [ ] README.md updated
- [ ] CLAUDE.md updated
- [ ] Deprecation notice for test:remote

#### AC-6: Version Bump
- [ ] Version is 0.6.3
- [ ] Version bump committed first

### Quality Gates Validation
From 03-specifications.md:

#### QG-1: Test Coverage
- [ ] All webhook endpoints tested (event, canvas, lifecycle)
- [ ] All health endpoints tested
- [ ] Minimum 10 test cases executed

#### QG-2: Performance
- [ ] Health checks complete quickly
- [ ] Full test suite under 3 minutes
- [ ] No hangs or unexpected timeouts

#### QG-3: Error Reporting
- [ ] Missing config shows exact file path
- [ ] Network errors distinguishable
- [ ] Error messages actionable

#### QG-4: Deployment Validation
- [ ] Production deployment fails if tests fail
- [ ] No bad infrastructure state
- [ ] Logs clearly show test phase

#### QG-5: Documentation
- [ ] All commands documented
- [ ] Daily workflow includes new commands
- [ ] Deprecation timeline clear

### Regression Testing
- [ ] Existing test:local still works
- [ ] Existing test:remote still works (via test:dev)
- [ ] Existing deploy:dev still works
- [ ] No CI/CD breakage (verify GitHub Actions if possible)

### Final Checks
- [ ] All episode commits pushed
- [ ] All IDE diagnostics cleared
- [ ] Git log shows clear commit history
- [ ] Branch ready for PR

### Commit
- [ ] Commit with message: `test: validate test:prod implementation`
- [ ] Push to remote

---

## Post-Implementation Validation

### Documentation Review
- [ ] README.md examples tested manually
- [ ] CLAUDE.md workflow makes sense
- [ ] All links work
- [ ] No spelling/grammar errors

### Code Review
- [ ] All TypeScript compiles without errors
- [ ] All linting passes
- [ ] No console.log debugging left in code
- [ ] Proper error handling throughout
- [ ] Comments clear and helpful

### Test Coverage
- [ ] All acceptance criteria met
- [ ] All quality gates passed
- [ ] No regressions introduced
- [ ] Manual testing completed

### Git Hygiene
- [ ] Commits follow conventional commit format
- [ ] Commit messages descriptive
- [ ] No "WIP" or "fix" commits
- [ ] Clean linear history

### PR Preparation
- [ ] All checklist items completed
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Ready for human review

---

## Success Criteria

### Phase Complete When:
- ✅ All 10 episodes completed
- ✅ All checklist items checked
- ✅ All acceptance criteria met
- ✅ All quality gates passed
- ✅ All tests passing
- ✅ Documentation complete
- ✅ No regressions
- ✅ Ready for PR

### Definition of Done:
- Code implements design specification exactly
- Tests validate all requirements
- Documentation reflects implementation
- No technical debt introduced
- Backward compatibility maintained
- Ready for production deployment

---

## Troubleshooting

### If TypeScript Won't Compile:
1. Check for missing imports
2. Verify interface definitions match usage
3. Run `npm run build:typecheck` for detailed errors
4. Fix one error at a time

### If Make Targets Don't Work:
1. Verify .PHONY includes all targets
2. Check for tab characters (not spaces)
3. Run `make -C docker -n <target>` for dry-run
4. Check XDG config exists: `ls ~/.config/benchling-webhook/`

### If Tests Fail:
1. Verify endpoint exists in deploy.json
2. Check network connectivity
3. Verify AWS credentials configured
4. Review test output for specific error

### If Documentation Unclear:
1. Get clarification before proceeding
2. Update this checklist with insights
3. Commit documentation improvements

---

## Notes for Orchestrator

- Follow BDD/TDD: Write tests BEFORE implementation (where applicable)
- Commit after EACH episode
- Push commits frequently
- Fix IDE diagnostics immediately
- Run `npm test` after significant changes
- Don't skip validation steps
- Ask for clarification if requirements unclear
- Update checklist if deviations needed
