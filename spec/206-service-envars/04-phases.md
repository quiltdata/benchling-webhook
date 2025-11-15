# Implementation Phases: Service Environment Variables

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Status**: PHASE BREAKDOWN

## Overview

This document breaks down the implementation into a single cohesive phase. Given the breaking nature of this change and the need for atomic deployment, we will implement all changes together in one PR rather than incremental PRs.

**Rationale for Single Phase**:
- Breaking change requires atomic update
- Configuration and code are tightly coupled
- Partial implementation would leave system in broken state
- Simpler testing and validation as single unit
- Single PR easier to review and revert if needed

## Phase 1: Complete Service Environment Variable Implementation

**Goal**: Replace stack ARN-based runtime resolution with explicit service environment variables

**Type**: Breaking Change - Major Version Bump

**Deliverables**:
1. Updated TypeScript configuration types
2. Enhanced deployment command with service resolution
3. Updated CDK stack with new parameters
4. Updated Fargate service with explicit environment variables
5. Removed ConfigResolver and CloudFormation permissions
6. Updated tests for new configuration approach
7. Migration guide and documentation
8. Version bump to 1.0.0 (or appropriate major version)

### Pre-Requisites

- [ ] Existing Quilt stack with required CloudFormation outputs
- [ ] Access to CloudFormation API for service resolution
- [ ] Profile configuration with `stackArn` specified
- [ ] Working test environment

### Success Criteria

**Functional**:
- [ ] Container starts without CloudFormation API calls
- [ ] All services accessible via environment variables
- [ ] Deployment command resolves services successfully
- [ ] IAM permissions reduced (CloudFormation removed)
- [ ] All tests passing (unit, integration, E2E)

**Non-Functional**:
- [ ] Startup time reduced by ≥20%
- [ ] Test coverage maintained at ≥85%
- [ ] Documentation complete and accurate
- [ ] Zero breaking changes to runtime behavior (same functionality)

### Work Breakdown

#### Task Group 1: Type Definitions and Interfaces

**Files**: `lib/types/config.ts`

**Changes**:
1. Update `QuiltConfig` interface:
   - Make `stackArn` optional (only for deployment-time use)
   - Add documentation for each field
   - Add optional `icebergDatabase` field
2. Add JSDoc comments explaining deployment vs runtime usage
3. No breaking changes to JSON schema (existing fields remain)

**Validation**:
- TypeScript compilation succeeds
- No errors in dependent files
- Schema validation tests pass

**Estimated Effort**: 30 minutes

---

#### Task Group 2: Service Resolution Logic

**Files**:
- `bin/commands/deploy.ts` (enhance)
- `lib/utils/service-resolver.ts` (new)

**Changes**:
1. Create new `service-resolver.ts` module:
   - Extract service resolution from `config-resolver.ts`
   - `resolveQuiltServices(stackArn: string): Promise<ResolvedServices>`
   - Use existing CloudFormation client patterns
   - Handle multiple output key names for compatibility
   - Normalize catalog URL (extract hostname)
   - Validate SQS URL format
   - Support optional Iceberg database

2. Update `deploy.ts`:
   - Call service resolver before CDK deploy
   - Validate all required services resolved
   - Display resolved values in deployment plan
   - Pass values as CloudFormation parameters
   - Handle resolution errors gracefully

**Validation**:
- Service resolution succeeds for test stack
- All required outputs detected
- Optional outputs handled correctly
- Clear error messages for missing outputs
- Unit tests with mocked CloudFormation client

**Estimated Effort**: 2 hours

---

#### Task Group 3: CDK Stack Updates

**Files**:
- `lib/benchling-webhook-stack.ts`
- `lib/fargate-service.ts`

**Changes**:

**benchling-webhook-stack.ts**:
1. Add new CloudFormation parameters:
   - `PackagerQueueUrl` (String, required)
   - `AthenaUserDatabase` (String, required)
   - `QuiltWebHost` (String, required)
   - `IcebergDatabase` (String, optional, default empty)
2. Remove or deprecate `QuiltStackARN` parameter
3. Update parameter descriptions
4. Pass new parameters to FargateService

**fargate-service.ts**:
1. Update `FargateServiceProps` interface:
   - Add service-specific fields
   - Remove or make optional `stackArn`
2. Update environment variables:
   - Add `PACKAGER_SQS_URL`
   - Add `ATHENA_USER_DATABASE`
   - Add `ICEBERG_DATABASE`
   - Add `QUILT_WEB_HOST`
   - Rename `BenchlingSecret` → `BENCHLING_SECRET_ARN`
   - Remove `QuiltStackARN`
3. Remove CloudFormation IAM permissions (Lines 85-93)
4. Update SQS permissions to use explicit queue ARN
5. Update Glue permissions to use explicit database ARN
6. Update documentation comments

**Validation**:
- CDK synthesis succeeds
- CloudFormation template valid
- IAM policies use explicit ARNs
- No CloudFormation permissions in task role
- All environment variables present in task definition

**Estimated Effort**: 2 hours

---

#### Task Group 4: Remove Deprecated Code

**Files**:
- `lib/utils/config-resolver.ts` (remove)
- Any imports of ConfigResolver

**Changes**:
1. Delete `config-resolver.ts` (440 lines removed)
2. Remove imports in other files
3. Update any references to use new service resolver
4. Keep `parseStackArn()` if used by service resolver

**Validation**:
- All imports resolved
- No dead code references
- TypeScript compilation succeeds
- No runtime errors

**Estimated Effort**: 30 minutes

---

#### Task Group 5: Test Updates

**Files**:
- All test files that reference ConfigResolver
- Integration test configurations
- Local development scripts

**Changes**:

**Unit Tests**:
1. Update tests that mocked ConfigResolver
2. Add tests for service resolver
3. Test deployment command service resolution
4. Test environment variable validation

**Integration Tests**:
1. Update test configurations to use explicit env vars
2. Remove CloudFormation mocking where no longer needed
3. Add service connectivity validation tests
4. Test deployment with various stack configurations

**Local Development**:
1. Update `docker-compose.yml` with new env vars
2. Update `scripts/run_local.py` to use new env vars
3. Update test scripts
4. Add example `.env` file with new variables

**Validation**:
- All unit tests pass (≥85% coverage)
- Integration tests pass
- Local development works
- Docker compose works
- E2E tests pass

**Estimated Effort**: 3 hours

---

#### Task Group 6: Documentation

**Files**:
- `README.md`
- `CHANGELOG.md`
- `spec/206-service-envars/MIGRATION.md` (new)
- `doc/ENVIRONMENT_VARIABLES.md` (new or update)

**Changes**:

**README.md**:
1. Update deployment instructions
2. Update configuration examples
3. Add breaking change notice
4. Update version number

**CHANGELOG.md**:
1. Add entry for v1.0.0 (or appropriate version)
2. Document breaking changes clearly
3. List all removed/deprecated features
4. Provide migration guidance link

**MIGRATION.md**:
1. Explain what changed and why
2. Provide step-by-step migration instructions
3. Include before/after configuration examples
4. Document common errors and solutions
5. Provide rollback procedure

**ENVIRONMENT_VARIABLES.md**:
1. List all container environment variables
2. Document purpose and format of each
3. Indicate required vs optional
4. Provide examples
5. Document validation rules

**Validation**:
- Documentation accurate
- Examples work
- Links valid
- No typos or formatting issues

**Estimated Effort**: 2 hours

---

#### Task Group 7: Version Management

**Files**:
- `package.json`
- `pyproject.toml` (if exists)
- Git tags

**Changes**:
1. Bump version to 1.0.0 (major version bump for breaking change)
2. Update package.json version
3. Update any Python package versions
4. Create git tag after merge
5. Update CHANGELOG with version and date

**Validation**:
- Version numbers consistent
- Git tag created
- npm package version updated

**Estimated Effort**: 15 minutes

---

### Dependencies Between Tasks

```
Task 1 (Types) ──┬→ Task 2 (Service Resolver) ──┬→ Task 3 (CDK Updates)
                 │                                │
                 └→ Task 4 (Remove Old Code) ────┘
                                                  ↓
                              Task 5 (Tests) ←───┘
                                     ↓
                              Task 6 (Docs)
                                     ↓
                              Task 7 (Version)
```

**Critical Path**: Types → Service Resolver → CDK Updates → Tests → Documentation

### Phase Timeline

**Total Estimated Effort**: ~10 hours

**Breakdown**:
- Design and setup: 1 hour
- Implementation: 6.5 hours
- Testing and validation: 2 hours
- Documentation: 2 hours
- Review and iteration: 1 hour (buffer)

**Recommended Schedule**:
- Day 1 (4 hours): Tasks 1-3 (types, resolver, CDK)
- Day 2 (4 hours): Tasks 4-5 (cleanup, tests)
- Day 3 (2 hours): Tasks 6-7 (docs, version)

### Testing Strategy

#### Unit Testing

**Coverage Target**: ≥85%

**Focus Areas**:
1. Service resolver logic
   - CloudFormation output parsing
   - URL normalization
   - Error handling
   - Optional field handling

2. Environment variable validation
   - Required vs optional
   - Format validation
   - Clear error messages

3. CDK construct creation
   - Parameter passing
   - Environment variable mapping
   - IAM policy generation

**Tools**:
- Jest for TypeScript
- pytest for Python (if applicable)
- AWS SDK mocks

#### Integration Testing

**Scenarios**:
1. **Happy Path**: Full deployment with all services
2. **Missing Optional**: Deploy without Iceberg database
3. **Error Cases**: Missing required outputs, invalid formats
4. **Service Connectivity**: Verify container can reach all services
5. **IAM Validation**: Confirm CloudFormation permissions removed

**Environments**:
- Local Docker Compose
- AWS dev environment
- CI/CD pipeline

#### End-to-End Testing

**Scenarios**:
1. **Fresh Deployment**: Deploy from scratch
2. **Update Deployment**: Update existing stack
3. **Rollback**: Revert to previous version
4. **Multi-Profile**: Deploy dev and prod profiles
5. **Full Workflow**: Create Benchling entry → Package created

**Validation**:
- Health checks pass
- Webhooks process correctly
- Packages created successfully
- Logs show no errors
- Performance metrics acceptable

### Risk Mitigation

#### Risk 1: Service Resolution Failure

**Probability**: Medium
**Impact**: High

**Mitigation**:
- Comprehensive error handling in service resolver
- Clear error messages with remediation steps
- Pre-flight validation in deployment command
- Fallback to manual configuration

**Detection**:
- Deployment command fails before CDK deploy
- Clear error message indicates missing output
- User can manually verify stack outputs

**Recovery**:
- Fix Quilt stack outputs
- Update profile configuration
- Re-run deployment

---

#### Risk 2: Missing CloudFormation Outputs

**Probability**: Low
**Impact**: High

**Mitigation**:
- Document required Quilt stack version
- Validate outputs before deployment
- Support multiple output key names
- Provide clear upgrade path

**Detection**:
- Service resolver returns error
- Lists available outputs
- Suggests required outputs

**Recovery**:
- Upgrade Quilt stack
- Add missing outputs manually
- Contact Quilt support

---

#### Risk 3: IAM Permission Issues

**Probability**: Low
**Impact**: Medium

**Mitigation**:
- Explicit resource ARNs in policies
- Test with least-privilege IAM role
- Document required permissions
- IAM policy validation

**Detection**:
- Container fails to access service
- CloudWatch logs show AccessDenied
- Health check fails

**Recovery**:
- Update IAM policies
- Redeploy with corrected permissions
- Validate using IAM Policy Simulator

---

#### Risk 4: Breaking Change Impact

**Probability**: High (by design)
**Impact**: High

**Mitigation**:
- Clear version bump (major version)
- Comprehensive migration guide
- Breaking change announcement
- Detailed documentation

**Detection**:
- Existing deployments fail to update
- Users report configuration issues
- Support requests increase

**Recovery**:
- Provide migration assistance
- Update documentation
- Offer rollback procedure
- Consider hotfix if needed

---

#### Risk 5: Test Coverage Gaps

**Probability**: Medium
**Impact**: Medium

**Mitigation**:
- Comprehensive test plan
- Code review focus on tests
- Coverage reporting
- Manual testing checklist

**Detection**:
- Coverage reports show gaps
- Production bugs discovered
- Edge cases not handled

**Recovery**:
- Add missing tests
- Fix discovered bugs
- Update test plan
- Document known issues

### Rollback Procedure

If deployment fails or issues are discovered:

1. **Immediate Rollback**:
   - Revert to previous git commit
   - Redeploy old version
   - Restore old configuration

2. **CloudFormation Rollback**:
   - Use CloudFormation automatic rollback
   - Or manually rollback stack update
   - Verify old configuration restored

3. **Data Integrity**:
   - No data loss expected (configuration change only)
   - Verify packages still accessible
   - Check SQS queue for pending messages

4. **Communication**:
   - Notify users of rollback
   - Document issues encountered
   - Plan remediation

### Quality Gates

Before marking phase complete:

**Code Quality**:
- [ ] All linting passes (`make lint`)
- [ ] No TypeScript errors
- [ ] No Python errors (if applicable)
- [ ] Code review approved

**Testing**:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] E2E tests pass
- [ ] Coverage ≥85%
- [ ] Manual testing complete

**Documentation**:
- [ ] README updated
- [ ] CHANGELOG updated
- [ ] Migration guide complete
- [ ] Environment variables documented

**Security**:
- [ ] IAM permissions reviewed
- [ ] No CloudFormation permissions in task role
- [ ] Secrets handled correctly
- [ ] No sensitive data in logs

**Performance**:
- [ ] Startup time measured
- [ ] Performance regression tests pass
- [ ] No new bottlenecks introduced

**Deployment**:
- [ ] Dev deployment successful
- [ ] Prod deployment successful (or staged)
- [ ] Health checks pass
- [ ] Monitoring shows no issues

### Post-Phase Activities

After phase completion:

1. **Monitoring**:
   - Watch CloudWatch metrics for anomalies
   - Monitor error rates
   - Track deployment success rate
   - Review user feedback

2. **Documentation**:
   - Update any missed documentation
   - Add FAQ based on questions
   - Update troubleshooting guide
   - Create video tutorial (optional)

3. **Communication**:
   - Announce breaking change
   - Provide migration deadline (if any)
   - Offer migration support
   - Gather feedback

4. **Follow-up**:
   - Address any issues discovered
   - Update documentation based on feedback
   - Consider follow-up improvements
   - Plan next features

### Phase Dependencies

**Blocking Dependencies**: None (all within this repository)

**External Dependencies**:
- Quilt stack must have required CloudFormation outputs
- AWS services must be accessible
- Profile configuration must include `stackArn`

**Soft Dependencies**:
- Recommended Quilt stack version: [specify after analysis]
- AWS CDK version: 2.222.0+ (current)
- Node.js version: 18+ (current)

## Summary

This single-phase implementation provides a clean break from the old architecture while maintaining all existing functionality. The atomic nature of the change simplifies testing, deployment, and rollback procedures.

**Key Benefits**:
- ✅ Reduced complexity (one PR to review)
- ✅ Atomic update (no partial state)
- ✅ Simplified testing (test everything together)
- ✅ Clear cut-over (no migration period)
- ✅ Easy rollback (single commit to revert)

**Next Steps**:
1. Create detailed design document
2. Create episodes breakdown
3. Create implementation checklist
4. Begin implementation
