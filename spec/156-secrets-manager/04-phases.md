# Implementation Phases - Issue #156: Secrets Manager

**GitHub Issue**: #156
**Branch**: 156-secrets-manager
**Date**: 2025-10-30
**Phase**: I RASP - Phases

## Overview

Break down the secrets manager implementation into incremental phases that can be independently reviewed, tested, and merged. Each phase delivers working functionality and moves toward the desired end state defined in specifications.

## Phase Strategy

### Sequencing Rationale

1. **Foundation First**: Establish secret structure and validation before deployment changes
2. **Non-Breaking Changes**: Add new capabilities before deprecating old ones
3. **Incremental Testing**: Each phase independently testable
4. **Risk Mitigation**: High-risk changes (CDK modifications) come after validation is proven
5. **User Value**: Each phase delivers tangible user value

### Pre-Factoring Opportunities

- **Phase 1**: Standardize secret structure (makes later phases easier)
- **Phase 2**: Add validation framework (enables safe parameter addition)
- **Phase 3**: Refactor CDK secret handling (enables ARN reference support)

## Phase 1: Secret Structure Standardization and Validation

### Objective

Establish the canonical secret JSON structure and validation framework without changing deployment behavior.

### Deliverables

1. **Secret Structure Definition**
   - TypeScript interface for Benchling secrets
   - JSON schema for validation
   - Documentation of required vs optional fields

2. **Validation Framework**
   - JSON parsing and validation function
   - ARN format validation function
   - Secret field validation function
   - Error message generation
   - Unit tests for all validation logic

3. **Configuration Module Updates**
   - Add `BenchlingSecrets` interface to config types
   - Add validation functions to config utils
   - Add format detection (ARN vs JSON)
   - Maintain backward compatibility with existing config

### Success Criteria

- ✅ All validation functions have > 90% test coverage
- ✅ Validation errors are actionable and user-friendly
- ✅ Existing configuration loading still works
- ✅ No deployment behavior changes
- ✅ Documentation explains secret format

### Dependencies

- None (pure addition of validation logic)

### Testing Strategy

- Unit tests for each validation function
- Test invalid inputs generate clear errors
- Test valid inputs pass validation
- Test edge cases (empty strings, null, undefined, extra fields)

---

## Phase 2: CLI Parameter Addition

### Objective

Add `--benchling-secrets` CLI option and environment variable support while maintaining full backward compatibility.

### Deliverables

1. **CLI Option Addition**
   - Add `--benchling-secrets <value>` option to deploy command
   - Support file input with `@filename` syntax
   - Add `BENCHLING_SECRETS` environment variable support
   - Integrate with configuration loader

2. **Priority Resolution Logic**
   - Implement configuration source priority
   - Deprecation warning for old parameters when new parameter present
   - Clear conflict resolution (new param wins)

3. **Pre-Deployment Validation**
   - Validate `--benchling-secrets` before deployment
   - If ARN: verify secret exists and is accessible
   - If JSON: validate structure and fields
   - Display masked secret summary for user confirmation

4. **CLI Help and Documentation**
   - Update `--help` text with new option
   - Add examples for all three input methods (inline, file, ARN)
   - Document migration path from old parameters

### Success Criteria

- ✅ CLI accepts all three input formats (JSON inline, JSON file, ARN)
- ✅ Configuration priority works correctly
- ✅ Deprecation warnings display when mixing old/new parameters
- ✅ Validation catches errors before deployment
- ✅ Help text is clear and includes examples
- ✅ Existing workflows unaffected (backward compatible)

### Dependencies

- Phase 1 (validation framework)

### Testing Strategy

- Unit tests for configuration priority logic
- Integration tests for CLI option parsing
- E2E tests for full deployment with new parameter
- Test all input formats (inline JSON, file JSON, ARN)
- Test error scenarios (invalid JSON, missing file, bad ARN)
- Test backward compatibility with old parameters

---

## Phase 3: CDK Secret Handling Refactoring

### Objective

Refactor CDK constructs to support both secret creation and secret reference without changing external behavior yet.

### Deliverables

1. **Fargate Service Secret Abstraction**
   - Extract secret handling into separate method
   - Support two modes: create new secret OR reference existing
   - Remove `unsafePlainText()` usage
   - Add proper secret value handling

2. **Stack Props Interface Update**
   - Add `benchlingSecretsArn?: string` prop
   - Maintain existing secret props for compatibility
   - Add logic to detect which mode to use

3. **IAM Policy Updates**
   - Ensure task execution role has correct permissions
   - Support both created and referenced secrets
   - Test permission boundaries

4. **CloudFormation Parameter Addition**
   - Add `BenchlingSecretsArn` parameter (optional)
   - Maintain existing behavior when not provided
   - Document parameter usage

### Success Criteria

- ✅ CDK supports both secret creation and reference
- ✅ No more `unsafePlainText()` usage
- ✅ IAM policies grant least-privilege access
- ✅ Existing deployments unaffected
- ✅ CloudFormation parameter accepts ARN
- ✅ Unit tests for both secret modes

### Dependencies

- Phase 2 (CLI parameter available)

### Testing Strategy

- Unit tests for secret handling logic
- CDK synth tests verify CloudFormation template
- Integration tests deploy with ARN reference
- Integration tests deploy with secret creation
- Test IAM permissions for both modes
- Verify no breaking changes to existing stacks

---

## Phase 4: Inline Secrets Support

### Objective

Enable deployment with inline JSON secrets via `--benchling-secrets`, creating AWS Secrets Manager secret during deployment.

### Deliverables

1. **JSON Secret Processing in CLI**
   - Parse JSON from CLI parameter
   - Validate secret structure
   - Create Secrets Manager secret pre-deployment
   - Pass secret ARN to CDK instead of plaintext

2. **Pre-Deployment Secret Creation**
   - Check if secret already exists
   - Create or update secret with JSON content
   - Handle secret naming (use stack-specific name)
   - Return ARN for CDK stack props

3. **Secret Lifecycle Management**
   - Option to update existing secret
   - Option to delete secret on stack deletion
   - Handle secret name conflicts

4. **Security Improvements**
   - Never pass plaintext to CDK
   - Always pass ARN to CDK
   - Mask secrets in all CLI output
   - Audit secret creation in CloudWatch

### Success Criteria

- ✅ Deployment with JSON creates secret in Secrets Manager
- ✅ Secret ARN passed to CDK (no plaintext)
- ✅ Secret accessible by ECS tasks
- ✅ Existing secrets can be updated
- ✅ Secrets masked in logs and output
- ✅ Integration tests validate end-to-end flow

### Dependencies

- Phase 3 (CDK supports ARN reference)

### Testing Strategy

- Integration test: deploy with inline JSON
- Verify secret created in Secrets Manager
- Verify ECS tasks can access secret
- Verify secret values correct in container
- Test secret update on re-deployment
- Test error handling for secret creation failures

---

## Phase 5: Quilt Stack Integration and Auto-Discovery

### Objective

Enable automatic discovery of Benchling secrets from Quilt stack deployments.

### Deliverables

1. **Quilt Stack Research**
   - Document Quilt's secret structure
   - Document Quilt's CloudFormation exports
   - Document discovery mechanism
   - Coordinate with Quilt team if needed

2. **Auto-Discovery Implementation**
   - Query CloudFormation exports for Quilt stack
   - Locate Benchling secret ARN from exports
   - Validate secret accessibility
   - Fallback to manual configuration if not found

3. **Discovery Configuration**
   - Add `--quilt-mode` flag (optional)
   - Auto-detect Quilt stack presence
   - Document Quilt integration setup

4. **Error Handling**
   - Clear errors when Quilt stack not found
   - Clear errors when secret inaccessible
   - Fallback to manual secret configuration

### Success Criteria

- ✅ Auto-discovery works when Quilt stack present
- ✅ Clear fallback when Quilt stack absent
- ✅ Documentation explains Quilt integration
- ✅ Integration tests with mock Quilt stack
- ✅ Error messages guide troubleshooting

### Dependencies

- Phase 3 (CDK supports ARN reference)
- External: Quilt team coordination

### Testing Strategy

- Mock CloudFormation exports for Quilt stack
- Integration test with real Quilt stack (if available)
- Test discovery success and failure cases
- Test fallback to manual configuration
- Test error message clarity

---

## Phase 6: Container Runtime Fallback

### Objective

Enable ECS containers to fallback to environment variables when Secrets Manager is unavailable (for local development support).

### Deliverables

1. **Runtime Secret Resolution**
   - Check Secrets Manager first
   - Fallback to environment variables
   - Clear error when neither available
   - Log secret source for debugging

2. **Environment Variable Support**
   - Support individual env vars (backward compatible)
   - Support `BENCHLING_SECRETS` JSON env var
   - Validate structure at runtime
   - Initialize Benchling client with resolved secrets

3. **Health Check Enhancement**
   - Add `/health/secrets` endpoint
   - Return secret source and status
   - Redact secret values
   - Include last retrieval time

4. **Error Handling**
   - Clear errors when no secrets found
   - Suggest remediation steps
   - Log secret resolution attempts
   - Fail fast on startup if secrets invalid

### Success Criteria

- ✅ Container starts with Secrets Manager
- ✅ Container starts with environment variables
- ✅ Container fails fast with clear error if no secrets
- ✅ Health endpoint reports secret status
- ✅ Existing behavior unaffected
- ✅ Unit and integration tests for all paths

### Dependencies

- Phase 4 (inline secrets deployed to Secrets Manager)

### Testing Strategy

- Unit tests for secret resolution logic
- Integration test: container with Secrets Manager
- Integration test: container with env vars
- Integration test: container with neither (error)
- Test health endpoint responses
- Test error messages

---

## Phase 7: Documentation and Migration Guide

### Objective

Provide comprehensive documentation for the new secrets management approach and migration from old parameters.

### Deliverables

1. **User Documentation**
   - Secrets configuration overview
   - Deployment scenario guides (Standalone, Quilt, Local)
   - Secret format reference
   - CLI examples for all scenarios
   - Troubleshooting guide

2. **Migration Guide**
   - Step-by-step migration from old parameters
   - How to extract current secrets
   - How to format for new parameter
   - How to update existing stacks
   - Rollback procedures

3. **Developer Documentation**
   - Architecture decision records (ADR)
   - Secret flow diagrams
   - Testing strategies
   - Security best practices

4. **Changelog and Release Notes**
   - Document all changes
   - Breaking changes (none in 0.6.x)
   - Deprecation warnings
   - Migration timeline

### Success Criteria

- ✅ Documentation covers all deployment scenarios
- ✅ Migration guide enables self-service
- ✅ Examples are copy-paste ready
- ✅ Troubleshooting guide addresses common issues
- ✅ ADRs explain design decisions

### Dependencies

- All previous phases complete

### Testing Strategy

- Documentation review by team
- Follow migration guide on test stack
- Verify examples work as written
- User testing feedback

---

## Phase 8: Deprecation and Cleanup

### Objective

Mark old parameters as deprecated, schedule removal, and prepare for v1.0 release.

### Deliverables

1. **Deprecation Warnings**
   - Add warnings when old parameters used
   - Display migration guide link
   - Log deprecation events

2. **Deprecation Timeline**
   - v0.6.x: New parameter available, old parameters deprecated
   - v0.7.x-v0.9.x: Deprecation warnings continue
   - v1.0.x: Old parameters removed

3. **Breaking Change Documentation**
   - Document removal in v1.0 changelog
   - Provide migration deadline
   - Offer support for migrations

4. **Code Cleanup**
   - Remove old parameter handling code (v1.0)
   - Simplify configuration logic
   - Update tests to remove old parameter tests

### Success Criteria

- ✅ Clear deprecation warnings in v0.6.x
- ✅ Timeline communicated to users
- ✅ Migration guide available
- ✅ Code cleanup planned for v1.0

### Dependencies

- All previous phases complete
- User feedback on migration guide

### Testing Strategy

- Verify deprecation warnings display
- Test that old parameters still work (v0.6.x)
- Test that old parameters removed (v1.0.x)
- Verify breaking change documentation

---

## Integration Testing Strategy

### Cross-Phase Integration Tests

After each phase completes, run integration test suite:

1. **Backward Compatibility Test**
   - Deploy with old parameters
   - Verify functionality unchanged
   - Check for deprecation warnings (when applicable)

2. **New Feature Test**
   - Deploy with new parameter
   - Verify new functionality works
   - Check logs and outputs

3. **Migration Test**
   - Deploy with old parameters
   - Update to new parameter
   - Verify seamless transition

4. **All Scenarios Test**
   - Test standalone with JSON
   - Test standalone with ARN
   - Test Quilt auto-discovery
   - Test error scenarios

### End-to-End Validation

Before merging to main:

1. Deploy fresh stack with new parameters
2. Update existing stack from old to new
3. Test Quilt integration (if possible)
4. Verify all documentation examples work
5. Run full test suite
6. Performance testing (secret retrieval latency)

---

## Risk Mitigation Per Phase

### Phase 1 Risks

- **Risk**: Validation logic has bugs
- **Mitigation**: Comprehensive unit tests, edge case testing

### Phase 2 Risks

- **Risk**: Configuration priority conflicts
- **Mitigation**: Clear precedence rules, integration tests

### Phase 3 Risks

- **Risk**: CDK changes break existing deployments
- **Mitigation**: Feature flags, backward compatibility tests, gradual rollout

### Phase 4 Risks

- **Risk**: Secret creation failures during deployment
- **Mitigation**: Idempotent secret creation, clear error handling, rollback support

### Phase 5 Risks

- **Risk**: Quilt integration assumptions incorrect
- **Mitigation**: Early coordination with Quilt team, fallback mechanisms

### Phase 6 Risks

- **Risk**: Runtime fallback causes production issues
- **Mitigation**: Thorough testing, clear logging, fail-fast design

### Phase 7 Risks

- **Risk**: Documentation incomplete or unclear
- **Mitigation**: User testing, feedback loop, iteration

### Phase 8 Risks

- **Risk**: Breaking changes cause user pain
- **Mitigation**: Long deprecation period, clear communication, migration support

---

## Dependencies and Sequencing

```
Phase 1 (Validation)
    ↓
Phase 2 (CLI Parameter) ← must complete before Phase 3
    ↓
Phase 3 (CDK Refactoring) ← blocks Phases 4 and 5
    ↓
    ├─→ Phase 4 (Inline Secrets) ← blocks Phase 6
    └─→ Phase 5 (Quilt Discovery) ← independent of Phase 4
        ↓
Phase 6 (Runtime Fallback) ← depends on Phase 4
    ↓
Phase 7 (Documentation) ← depends on all functional phases
    ↓
Phase 8 (Deprecation) ← depends on Phase 7 and user feedback
```

### Parallel Opportunities

- **Phase 4 and 5**: Can be developed in parallel after Phase 3
- **Phase 7**: Can begin documentation while Phase 6 is in progress

---

## Success Metrics by Phase

| Phase | Metric | Target |
|-------|--------|--------|
| 1 | Test coverage for validation | > 90% |
| 2 | Backward compatibility maintained | 100% |
| 3 | CDK synth changes | < 50 lines |
| 4 | Secret creation success rate | > 99% |
| 5 | Quilt auto-discovery success | > 95% when stack present |
| 6 | Container startup time increase | < 200ms |
| 7 | Documentation completeness | All scenarios covered |
| 8 | User migration success rate | > 95% |

---

## Rollout Strategy

### Development Environment

- Test each phase in dev environment
- Verify backward compatibility
- Performance testing

### Staging Environment

- Deploy all phases to staging
- Integration testing
- Load testing
- Security testing

### Production Rollout

1. **v0.6.0**: Phases 1-3 (foundation, no user-visible changes)
2. **v0.6.1**: Phase 4 (inline secrets support)
3. **v0.6.2**: Phase 5 (Quilt integration)
4. **v0.6.3**: Phase 6 (runtime fallback)
5. **v0.6.4**: Phase 7 (documentation)
6. **v0.7.0-v0.9.x**: Deprecation period
7. **v1.0.0**: Phase 8 (cleanup)

---

## Phase Completion Checklist Template

For each phase:

- [ ] Design document created
- [ ] Episodes defined
- [ ] Implementation checklist created
- [ ] Code implemented following episodes
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
- [ ] Documentation updated
- [ ] Code review completed
- [ ] PR merged to feature branch
- [ ] Phase-specific success metrics achieved

---

## Summary

This 8-phase implementation plan delivers incremental value while maintaining backward compatibility. Each phase is independently testable and delivers working functionality. The phased approach mitigates risk through gradual rollout and allows for course correction based on user feedback.

**Total Estimated Phases**: 8
**Parallel Opportunities**: 2 (Phases 4 & 5)
**Critical Path**: Phases 1 → 2 → 3 → 4 → 6 → 7 → 8
**Estimated Timeline**: 6-8 weeks for full implementation

Ready to proceed with detailed design for Phase 1.
