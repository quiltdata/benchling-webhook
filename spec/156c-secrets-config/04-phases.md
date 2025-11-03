# Phase Implementation Plan: Configuration System Refactoring

**Specification**: `spec/156c-secrets-config/03-specifications.md`
**Analysis**: `spec/156c-secrets-config/02-analysis.md`
**Status**: Planning
**Last Updated**: 2025-11-02

---

## Overview

This document breaks down the configuration system refactoring into incremental phases that can be sequentially reviewed, tested, and merged. Each phase delivers working functionality while maintaining backward compatibility with existing `.env`-based workflows.

### Key Principles

1. **Incremental Delivery**: Each phase is independently testable and deployable
2. **Backward Compatibility**: Maintain `.env` support until Phase 4
3. **Pre-factoring**: Simplify code before major changes
4. **Fail-Fast Validation**: Each phase includes comprehensive testing
5. **Clear Boundaries**: Phases build on previous work without blocking parallel development

---

## Phase 0: Pre-factoring (Foundation)

**Goal**: Simplify codebase to make configuration refactoring easier

**Duration**: 1-2 days
**PR Count**: 2-3 small PRs

### Deliverables

#### 0.1: Extract Configuration Reading Logic
- **File**: `lib/config-reader.ts` (new)
- **Changes**:
  - Create `ConfigReader` class that reads from environment variables
  - Centralizes all `process.env.VARIABLE_NAME` access
  - Add TypeScript interfaces for configuration structure
  - Include validation helpers (required fields, format checks)
- **Testing**: Unit tests for config reading with mocked env vars
- **Success Criteria**: All CDK stacks use `ConfigReader` instead of direct `process.env`

#### 0.2: Consolidate Makefile Variables
- **File**: `Makefile`
- **Changes**:
  - Extract common variables to top of file
  - Standardize variable naming (PREFIX convention)
  - Document all Makefile targets with help text
  - Add `.PHONY` declarations for all targets
- **Testing**: Run all Makefile targets in clean environment
- **Success Criteria**: `make help` shows complete target documentation

#### 0.3: Python Configuration Module
- **File**: `docker/app/config.py` (refactor)
- **Changes**:
  - Create `BenchlingConfig` dataclass for all settings
  - Add validation methods (tenant format, bucket accessibility)
  - Centralize environment variable reading
  - Add configuration dump for debugging
- **Testing**: Unit tests for config validation with mock env
- **Success Criteria**: All Python code uses `BenchlingConfig` singleton

### Dependencies
- None (pure refactoring)

### Risk Mitigation
- Each sub-phase is a small, focused PR
- Extensive unit tests prevent regression
- No changes to external interfaces

---

## Phase 1: XDG Configuration Infrastructure

**Goal**: Implement XDG-compliant configuration storage with `.env` fallback

**Duration**: 3-4 days
**PR Count**: 3-4 PRs

### Deliverables

#### 1.1: XDG Configuration Library (TypeScript)
- **Files**:
  - `lib/xdg-config.ts` (new)
  - `lib/types/config.ts` (new)
- **Changes**:
  - Implement `XDGConfig` class with read/write methods
  - JSON schema validation for `default.json`
  - Path resolution (`~/.config/benchling-webhook/`)
  - Atomic writes (temp file + rename)
  - Migration helpers (read from multiple sources)
- **Testing**:
  - Unit tests with temporary XDG directories
  - Schema validation tests
  - Concurrent write safety tests
- **Success Criteria**:
  - Can read/write valid configuration
  - Invalid JSON triggers clear error
  - Concurrent operations don't corrupt file

#### 1.2: Configuration Priority System
- **File**: `lib/config-resolver.ts` (new)
- **Changes**:
  - Implement priority chain: XDG → `.env` → defaults
  - Merge logic with explicit precedence rules
  - Warning system for deprecated `.env` usage
  - Configuration source tracking (debug info)
- **Testing**:
  - Tests for each priority level
  - Merge behavior verification
  - Deprecation warning validation
- **Success Criteria**:
  - `.env` still works (with warning)
  - XDG overrides `.env` when present
  - Clear error when both missing

#### 1.3: Python XDG Configuration
- **File**: `docker/app/xdg_config.py` (new)
- **Changes**:
  - Python equivalent of TypeScript XDG reader
  - Read-only access (Python doesn't write config)
  - Fallback to environment variables
  - Validation and error reporting
- **Testing**:
  - Unit tests with mock XDG directory
  - Environment variable fallback tests
  - Error handling for malformed JSON
- **Success Criteria**:
  - Python app reads from XDG when available
  - Graceful fallback to environment variables
  - Clear error messages for configuration issues

#### 1.4: Integration Testing Framework
- **Files**:
  - `test/integration/config-system.test.ts` (new)
  - `docker/tests/integration/test_config.py` (new)
- **Changes**:
  - End-to-end tests for configuration flow
  - Test both XDG and `.env` paths
  - Validate TypeScript ↔ Python consistency
  - Test configuration migration scenarios
- **Testing**: Self-testing (meta!)
- **Success Criteria**:
  - All configuration paths tested
  - TypeScript and Python use same values
  - Migration from `.env` to XDG validated

### Dependencies
- Phase 0 (pre-factoring)

### Risk Mitigation
- XDG implementation separate from business logic
- Extensive testing before integration
- `.env` fallback maintains existing workflows
- Deprecation warnings prepare users for transition

---

## Phase 2: Interactive Installation Script

**Goal**: Create user-friendly `make install` with auto-inference and validation

**Duration**: 4-5 days
**PR Count**: 4-5 PRs

### Deliverables

#### 2.1: Quilt Catalog Auto-Inference
- **File**: `scripts/infer-quilt-config.ts` (refactor of existing)
- **Changes**:
  - Read from `~/.quilt3/config.yml`
  - Extract catalog URL, bucket, and region
  - Validate Quilt configuration completeness
  - Support multiple named catalogs
  - Add interactive catalog selection
- **Testing**:
  - Mock Quilt config files
  - Test missing/invalid config handling
  - Multi-catalog selection logic
- **Success Criteria**:
  - Auto-detects 90% of Quilt installations
  - Clear prompts when manual input needed
  - Validates bucket accessibility

#### 2.2: Interactive Prompt System
- **File**: `scripts/install-wizard.ts` (new)
- **Changes**:
  - Use `inquirer` for interactive prompts
  - Implement prompt flow:
    1. Detect Quilt catalog (auto-infer or prompt)
    2. Request Benchling tenant
    3. Request OAuth credentials
    4. Request app definition ID
    5. Optional: test entry ID
  - Add validation at each step
  - Support non-interactive mode (`--no-interactive`)
  - Store responses in XDG config
- **Testing**:
  - Unit tests with mocked prompts
  - Test all validation rules
  - Non-interactive mode tests
- **Success Criteria**:
  - User completes installation without documentation
  - Invalid inputs caught immediately
  - Non-interactive mode works for CI

#### 2.3: Credential Validation
- **File**: `scripts/validate-credentials.ts` (new)
- **Changes**:
  - Benchling tenant accessibility check
  - OAuth token exchange test
  - S3 bucket read/write verification
  - Quilt package API availability test
  - Report validation results with diagnostics
- **Testing**:
  - Mock AWS and Benchling APIs
  - Test failure scenarios
  - Validate error messages
- **Success Criteria**:
  - Detects 95% of configuration errors
  - Provides actionable error messages
  - Completes in <30 seconds

#### 2.4: AWS Secrets Manager Sync
- **File**: `scripts/sync-secrets.ts` (refactor of existing)
- **Changes**:
  - Read from XDG config
  - Create or update AWS secret
  - Generate consistent secret names
  - Store secret ARN back to XDG config
  - Handle AWS authentication errors
  - Support secret rotation
- **Testing**:
  - Mock AWS Secrets Manager API
  - Test create vs update paths
  - Error handling for AWS failures
- **Success Criteria**:
  - Secrets created on first run
  - Updates don't break existing deployments
  - ARN stored in XDG config

#### 2.5: Makefile Installation Target
- **File**: `Makefile`
- **Changes**:
  - Implement `make install` target:
    ```makefile
    install: install-deps install-config validate-config sync-secrets
    ```
  - Add dependency installation (npm, pip)
  - Call installation wizard
  - Run credential validation
  - Sync to AWS Secrets Manager
  - Generate deployment-ready config
  - Print summary and next steps
- **Testing**:
  - Run in clean environment
  - Test error recovery
  - Validate all outputs
- **Success Criteria**:
  - One command completes full setup
  - Clear error messages on failure
  - Idempotent (safe to re-run)

### Dependencies
- Phase 1 (XDG infrastructure)

### Risk Mitigation
- Interactive prompts skippable for CI
- Validation prevents invalid deployments
- Detailed error messages for troubleshooting
- Dry-run mode for testing

---

## Phase 3: Testing Infrastructure

**Goal**: Implement multi-tier testing with proper secret handling

**Duration**: 3-4 days
**PR Count**: 3-4 PRs

### Deliverables

#### 3.1: Local Test Environment
- **File**: `Makefile` + `docker/Makefile`
- **Changes**:
  - `make test` - Unit tests (no external deps)
  - `make test-local` - Integration with local Docker
  - Pull secrets from AWS for local testing
  - Mock Benchling webhooks for testing
  - Validate S3/SQS interactions locally
- **Testing**: Meta-tests for test infrastructure
- **Success Criteria**:
  - Tests run without `.env` file
  - Secrets pulled from AWS automatically
  - Clear error when secrets unavailable

#### 3.2: Remote Test Environment
- **Files**:
  - `.github/workflows/test-remote.yml` (new)
  - `scripts/test-remote.ts` (new)
- **Changes**:
  - Deploy to isolated dev stack
  - Run integration tests against deployed stack
  - Test API Gateway → ALB → Fargate flow
  - Validate secrets, IAM, networking
  - Clean up dev stack after tests
- **Testing**: CI pipeline validation
- **Success Criteria**:
  - Tests run in isolated environment
  - No pollution of production stack
  - Complete teardown on success/failure

#### 3.3: Test Data Management
- **File**: `test/fixtures/` (new directory)
- **Changes**:
  - Sample Benchling webhook payloads
  - Mock Benchling API responses
  - Test S3 bucket contents
  - Reusable test fixtures
- **Testing**: Validate fixture completeness
- **Success Criteria**:
  - All webhook types covered
  - Tests reproducible across environments
  - Fixtures version-controlled

#### 3.4: Continuous Integration Pipeline
- **File**: `.github/workflows/ci.yml` (refactor)
- **Changes**:
  - Job 1: Lint and typecheck
  - Job 2: Unit tests (TS + Python)
  - Job 3: Local integration tests
  - Job 4: Remote integration tests (on main)
  - Job 5: Release promotion (on tag)
  - Use XDG config for all stages
  - Cache dependencies properly
- **Testing**: Test the CI pipeline itself
- **Success Criteria**:
  - All tests run on every PR
  - Remote tests only on main branch
  - Clear failure diagnostics

### Dependencies
- Phase 2 (installation system)

### Risk Mitigation
- Test isolation prevents side effects
- Fixtures ensure reproducibility
- CI pipeline validates before merge
- Dev stack isolation protects production

---

## Phase 4: Migration and Cleanup

**Goal**: Complete transition to XDG, deprecate `.env`, update documentation

**Duration**: 2-3 days
**PR Count**: 2-3 PRs

### Deliverables

#### 4.1: Migration Guide
- **File**: `docs/MIGRATION.md` (new)
- **Changes**:
  - Step-by-step migration instructions
  - `.env` to XDG conversion tool
  - Troubleshooting common issues
  - Rollback procedures
- **Testing**: Follow guide in clean environment
- **Success Criteria**:
  - Users can self-service migration
  - Less than 5% of users need support

#### 4.2: Documentation Updates
- **Files**:
  - `README.md`
  - `CLAUDE.md`
  - `docs/PARAMETERS.md`
  - `docker/README.md`
- **Changes**:
  - Update all references to configuration
  - Replace `.env` examples with `make install`
  - Add XDG configuration documentation
  - Update architecture diagrams
  - Revise troubleshooting guides
- **Testing**: Technical review by team
- **Success Criteria**:
  - No references to `.env` in quick start
  - Configuration section complete
  - Troubleshooting covers XDG issues

#### 4.3: Deprecation Warnings
- **Files**: All config readers
- **Changes**:
  - Emit warnings when `.env` detected
  - Suggest running `make install`
  - Add deprecation timeline (remove in v2.0)
  - Log migration status to CloudWatch
- **Testing**: Verify warnings appear correctly
- **Success Criteria**:
  - Clear, actionable warnings
  - No breakage of existing workflows
  - Migration adoption tracked

#### 4.4: Template Cleanup
- **Files**:
  - Remove `env.template`
  - Remove `get-env.ts` script
  - Archive `.env` documentation
  - Update `.gitignore`
- **Changes**:
  - Archive old templates to `docs/legacy/`
  - Update `.gitignore` to ignore `.env`
  - Add migration note to archived files
- **Testing**: Verify no broken references
- **Success Criteria**:
  - Clean repository structure
  - Legacy files preserved for reference
  - No accidental `.env` commits

### Dependencies
- Phase 3 (testing infrastructure)

### Risk Mitigation
- Deprecation warnings prepare users
- Migration guide reduces support burden
- Legacy documentation preserved
- Gradual removal timeline

---

## Phase 5: Observability and Self-Healing

**Goal**: Add diagnostics, health checks, and automatic recovery

**Duration**: 3-4 days
**PR Count**: 2-3 PRs

### Deliverables

#### 5.1: Configuration Health Checks
- **File**: `scripts/health-check.ts` (new)
- **Changes**:
  - Validate XDG config schema
  - Check AWS secret accessibility
  - Verify Benchling credentials freshness
  - Test S3 bucket permissions
  - Check Quilt API availability
  - Add `make health` target
- **Testing**: Mock various failure modes
- **Success Criteria**:
  - Detects 95% of configuration issues
  - Suggests fixes for common problems
  - Runs in <10 seconds

#### 5.2: Automatic Secret Rotation
- **File**: `scripts/rotate-secrets.ts` (new)
- **Changes**:
  - Detect expiring OAuth tokens
  - Trigger re-authentication flow
  - Update AWS Secrets Manager
  - Notify CloudWatch on rotation
  - Add `make rotate-secrets` target
- **Testing**: Mock token expiration
- **Success Criteria**:
  - Automatic rotation without downtime
  - Notifications on rotation events
  - Rollback on rotation failure

#### 5.3: Diagnostic Logging
- **Files**: All config readers
- **Changes**:
  - Add structured logging for config operations
  - Log configuration source (XDG vs env)
  - Track secret access patterns
  - Add CloudWatch custom metrics
  - Include configuration in error reports
- **Testing**: Validate log output format
- **Success Criteria**:
  - All config operations logged
  - Easy troubleshooting from logs
  - Metrics dashboard created

### Dependencies
- Phase 4 (migration complete)

### Risk Mitigation
- Health checks catch issues early
- Automatic rotation prevents downtime
- Detailed logging aids debugging
- Metrics enable proactive monitoring

---

## Integration Testing Strategy

### Cross-Phase Testing

Each phase includes:
1. **Unit Tests**: Isolated component testing
2. **Integration Tests**: Component interaction testing
3. **System Tests**: End-to-end workflow validation

### Test Matrix

| Phase | Unit | Integration | System | Manual |
|-------|------|-------------|--------|--------|
| 0 | ✓ | ✓ | - | Smoke test |
| 1 | ✓ | ✓ | ✓ | Config round-trip |
| 2 | ✓ | ✓ | ✓ | Installation flow |
| 3 | ✓ | ✓ | ✓ | Full deployment |
| 4 | - | ✓ | ✓ | Migration path |
| 5 | ✓ | ✓ | ✓ | Health monitoring |

### Validation Gates

**Before Phase Completion:**
1. All automated tests pass
2. Manual testing checklist complete
3. Documentation updated
4. Code review approved
5. Deployment to dev stack successful

**Before Production Release:**
1. All phases completed
2. Integration tests pass across all phases
3. Performance benchmarks met
4. Security review completed
5. Rollback procedure tested

---

## Rollback Procedures

### Phase-Specific Rollbacks

Each phase includes:
- Git revert procedures
- Configuration restoration steps
- Data migration reversals
- Communication templates

### Example: Phase 1 Rollback

If XDG infrastructure fails:
1. Revert git commits for Phase 1
2. Restore `.env` reading in all files
3. Remove XDG config directory
4. Notify team of rollback
5. Document failure cause
6. Plan remediation

---

## Success Metrics

### Technical Metrics
- Installation success rate > 95%
- Configuration errors detected pre-deployment > 90%
- Test coverage > 80%
- Zero production incidents during migration
- Deployment time unchanged or improved

### User Experience Metrics
- Time to first successful deployment < 15 minutes
- Support tickets related to configuration < 5 per month
- User satisfaction score > 4.5/5
- Documentation clarity score > 4/5

### Operational Metrics
- Secret rotation automated 100%
- Health check false positive rate < 2%
- Mean time to detection (MTTD) < 5 minutes
- Mean time to resolution (MTTR) < 30 minutes

---

## Timeline and Resources

### Estimated Timeline
- **Total Duration**: 15-20 working days
- **Phase 0**: Days 1-2
- **Phase 1**: Days 3-6
- **Phase 2**: Days 7-11
- **Phase 3**: Days 12-15
- **Phase 4**: Days 16-18
- **Phase 5**: Days 19-20

### Resource Requirements
- 1 Senior Engineer (full-time)
- 1 DevOps Engineer (50% time for AWS/CDK)
- 1 QA Engineer (25% time for testing strategy)
- Technical Writer (10% time for documentation)

### Critical Path
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

**Parallelization Opportunities:**
- Phase 1.4 can start during Phase 1.3
- Phase 2 documentation can be drafted during Phase 1
- Phase 3 test fixtures can be created during Phase 2
- Phase 4 migration guide can be drafted during Phase 3

---

## Appendix: Phase Dependencies Graph

```
Phase 0 (Pre-factoring)
    ↓
Phase 1 (XDG Infrastructure)
    ↓
Phase 2 (Installation)
    ↓
Phase 3 (Testing)
    ↓
Phase 4 (Migration)
    ↓
Phase 5 (Observability)
```

**Legend:**
- ↓ = Hard dependency (must complete before next phase)
- Each phase is independently releasable
- Backward compatibility maintained until Phase 4

---

## Document Control

**Version**: 1.0
**Author**: Project Manager Agent
**Reviewers**: TBD
**Approval**: TBD
**Next Review**: After Phase 0 completion
