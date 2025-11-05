# Requirements Analysis - Issue #176: test:prod Command

**GitHub Issue**: #176
**Branch**: 176-test-prod
**Version**: 0.6.3
**Date**: 2025-11-03

## Problem Statement

The project currently has a `test:remote` npm script that deploys a development stack and tests it via API Gateway. However, this naming is misleading and doesn't align with production testing needs. Additionally, there's no automated way to verify production deployments after running `deploy:prod`.

## User Stories

### US-1: Production Testing Command
**As a** DevOps engineer
**I want** a `npm run test:prod` command
**So that** I can verify production deployments are working correctly

### US-2: Development Testing Clarity
**As a** developer
**I want** a `npm run test:dev` command that clearly indicates it tests the development stack
**So that** there's no confusion between development and production testing

### US-3: Automated Production Verification
**As a** release manager
**I want** the production deployment to automatically run integration tests
**So that** I know immediately if a production deployment succeeded

### US-4: Test Infrastructure Reusability
**As a** developer
**I want** the test infrastructure to support both dev and prod environments
**So that** I can reuse the same test logic across environments

## Acceptance Criteria

### AC-1: New Test Commands
- [ ] `npm run test:dev` exists and tests the development stack
- [ ] `npm run test:prod` exists and tests the production stack
- [ ] `npm run test:remote` is deprecated or removed (breaking change in 0.7.0)
- [ ] Both commands use the same underlying test infrastructure

### AC-2: Environment Detection
- [ ] Test commands detect the correct endpoint from XDG config or stack outputs
- [ ] Test commands fail gracefully if endpoint is not found
- [ ] Test commands provide clear error messages about which environment they're testing

### AC-3: Production Deployment Integration
- [ ] `npm run deploy:prod` runs `npm run test:prod` after successful deployment
- [ ] Test failures in production deployment cause the overall deployment to fail
- [ ] Deployment logs clearly show when tests are running

### AC-4: Test Infrastructure
- [ ] Tests validate health endpoints (`/health`, `/health/ready`)
- [ ] Tests validate webhook processing with real Benchling credentials
- [ ] Tests validate S3 payload storage
- [ ] Tests provide detailed output about what's being tested

### AC-5: Documentation
- [ ] README.md updated with new test commands
- [ ] CLAUDE.md updated with new test commands
- [ ] Deprecation notice for `test:remote` (if not removed immediately)

### AC-6: Version Bump
- [ ] Version bumped to 0.6.3 using `npm version` command
- [ ] Version bump committed to branch before implementation

## High-Level Implementation Approach

1. **Refactor existing test infrastructure**: Create a reusable test module that can target different environments
2. **Add environment detection**: Read deployment endpoints from XDG config (`~/.config/benchling-webhook/deploy.json`)
3. **Create new npm scripts**: Add `test:dev` and `test:prod` to package.json
4. **Update deployment flow**: Modify `deploy:prod` to run tests after deployment
5. **Update documentation**: Reflect new commands in all documentation

## Success Metrics

- **Test Coverage**: Both dev and prod environments can be tested with a single command
- **Reliability**: Tests accurately detect deployment failures
- **Usability**: Clear command names that indicate what environment is being tested
- **Performance**: Tests complete in under 3 minutes
- **Error Reporting**: Clear, actionable error messages when tests fail

## Open Questions

1. **Q**: Should we remove `test:remote` immediately or deprecate it gradually?
   - **A**: Deprecate in 0.6.3, remove in 0.7.0 (breaking change)

2. **Q**: Should `deploy:prod` fail if tests fail, or just warn?
   - **A**: Should fail - this is critical production verification

3. **Q**: Do we need separate test suites for dev vs prod, or same tests?
   - **A**: Same tests - both environments should behave identically

4. **Q**: How do we handle cases where deploy.json doesn't exist yet?
   - **A**: Gracefully fail with instructions to deploy first

5. **Q**: Should we test against CloudFormation stack outputs or XDG config?
   - **A**: XDG config as primary source (already written by dev-deploy), with fallback to stack outputs

## Dependencies

- Existing Docker test infrastructure in `docker/Makefile`
- XDG configuration system (`~/.config/benchling-webhook/deploy.json`)
- CloudFormation stack outputs (`WebhookEndpoint`)
- AWS Secrets Manager for Benchling credentials

## Constraints

- Must maintain backward compatibility for existing workflows
- Must not break existing CI/CD pipeline
- Must use existing test scripts in `docker/scripts/`
- Should reuse existing test infrastructure rather than creating new tests

## Related Issues

- Initial setup wizard (#112)
- XDG configuration migration (#170)
- Production deployment improvements (#165)
