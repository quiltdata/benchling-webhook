# Configuration Architecture Cleanup - Implementation TODO

**Related**: [01-spec.md](./01-spec.md), [#176](https://github.com/quiltdata/benchling-webhook/issues/176)
**Target**: v0.7.0 (BREAKING CHANGE)

---

## Phase 1: Type System & Core Data Structures

**Goal**: Define new types and schemas (NO legacy code removal yet)

### Parallel Group 1A: Type Definitions

- [ ] Define `ProfileConfig` interface in [lib/types/config.ts](lib/types/config.ts)
  - [ ] `QuiltConfig`, `BenchlingConfig`, `PackageConfig` interfaces
  - [ ] `DeploymentConfig`, `LoggingConfig`, `SecurityConfig` interfaces
  - [ ] `ConfigMetadata` interface with inheritance support
- [ ] Define `DeploymentHistory` and `DeploymentRecord` interfaces
- [ ] Add JSON schema for `ProfileConfig` validation
- [ ] Add JSDoc documentation for all new types

### Parallel Group 1B: Test Fixtures

- [ ] Create test fixtures for new `config.json` format
- [ ] Create test fixtures for new `deployments.json` format
- [ ] Create test fixtures for profile inheritance scenarios
- [ ] Create test fixtures for migration edge cases

### Checkpoint: Lint + Commit

```bash
npm run lint
git add lib/types/config.ts
git commit -m "feat(types): add v0.7.0 ProfileConfig and DeploymentHistory types"
```

---

## Phase 2: XDGConfig Refactoring (Hard Shift)

**Goal**: Complete rewrite of XDGConfig with NO legacy support

### Serial Tasks (dependent)

- [ ] **Task 2.1**: Backup current `XDGConfig` as `XDGConfigLegacy`
  - [ ] Copy [lib/xdg-config.ts](lib/xdg-config.ts) to `lib/xdg-config-legacy.ts`
  - [ ] Export both classes temporarily for parallel testing

- [ ] **Task 2.2**: Rewrite `XDGConfig` class
  - [ ] Remove `ConfigType` enum completely
  - [ ] Implement `readProfile(profile: string): ProfileConfig`
  - [ ] Implement `writeProfile(profile: string, config: ProfileConfig): void`
  - [ ] Implement `deleteProfile(profile: string): void`
  - [ ] Implement `listProfiles(): string[]`
  - [ ] Implement `profileExists(profile: string): boolean`

- [ ] **Task 2.3**: Add deployment tracking methods
  - [ ] Implement `getDeployments(profile: string): DeploymentHistory`
  - [ ] Implement `recordDeployment(profile: string, deployment: DeploymentRecord): void`
  - [ ] Implement `getActiveDeployment(profile: string, stage: string): DeploymentRecord | null`

- [ ] **Task 2.4**: Add profile inheritance
  - [ ] Implement `readProfileWithInheritance(profile: string, baseProfile?: string): ProfileConfig`
  - [ ] Implement deep merge logic for nested configs
  - [ ] Add circular inheritance detection

- [ ] **Task 2.5**: Add validation and error messages
  - [ ] Implement `validateProfile(config: ProfileConfig): ValidationResult`
  - [ ] Add helpful error messages for missing profiles
  - [ ] Add detection and messaging for legacy v0.6.x configs

- [ ] **Task 2.6**: Update file paths
  - [ ] Change from `profiles/{name}/default.json` to `{name}/config.json`
  - [ ] Implement `{name}/deployments.json` read/write
  - [ ] Remove ALL references to `deploy.json`, `config/default.json`, etc.

### Checkpoint: Lint + Commit

```bash
npm run lint
npm run build:typecheck
git add lib/xdg-config.ts lib/xdg-config-legacy.ts
git commit -m "feat(config): rewrite XDGConfig for v0.7.0 (BREAKING)"
```

---

## Phase 3: Install Wizard Modularization

**Goal**: Split wizard into focused modules, remove bloat

### Parallel Group 3A: Extract Modules

- [ ] Create [scripts/config/wizard.ts](scripts/config/wizard.ts) (prompts only)
  - [ ] Extract interactive prompt logic from install-wizard.ts
  - [ ] Support profile inheritance prompts
  - [ ] ~200 lines max
- [ ] Create [scripts/config/validator.ts](scripts/config/validator.ts) (validation only)
  - [ ] Extract Benchling tenant validation
  - [ ] Extract OAuth credential validation
  - [ ] Extract S3 bucket validation
  - [ ] ~150 lines max
- [ ] Review [scripts/infer-quilt-config.ts](scripts/infer-quilt-config.ts) (keep as-is)

### Serial Tasks (dependent on 3A)

- [ ] **Task 3.2**: Rewrite main wizard orchestration
  - [ ] Update [scripts/install-wizard.ts](scripts/install-wizard.ts) to use new modules
  - [ ] Use new `XDGConfig` API (no manual fallback logic)
  - [ ] Remove AWS account verification (move to deploy command)
  - [ ] Remove secrets sync prompt (make it explicit flag)
  - [ ] Support `--inherit-from` flag for profile creation
  - [ ] Target: ~100 lines orchestration only

### Checkpoint: Lint + Commit

```bash
npm run lint
npm run build:typecheck
git add scripts/config/ scripts/install-wizard.ts
git commit -m "refactor(wizard): modularize install wizard for v0.7.0"
```

---

## Phase 4: CLI & Deploy Command Updates

**Goal**: Update all CLI commands to use new XDGConfig API

### Parallel Group 4A: Update Commands

- [ ] Update [bin/commands/deploy.ts](bin/commands/deploy.ts)
  - [ ] Use `XDGConfig.readProfile()` API
  - [ ] Use `XDGConfig.recordDeployment()` API
  - [ ] Support `--profile` and `--stage` independently
  - [ ] Remove `deploy.json` references
- [ ] Update [bin/dev-deploy.ts](bin/dev-deploy.ts)
  - [ ] Use new deployment tracking format
  - [ ] Update auto-deploy timestamp logic
- [ ] Update [bin/check-logs.ts](bin/check-logs.ts)
  - [ ] Read from `deployments.json` instead of `deploy.json`
  - [ ] Support profile-specific lookup
- [ ] Update [bin/cli.ts](bin/cli.ts)
  - [ ] Add new `setup-profile` command
  - [ ] Update help text for v0.7.0 changes

### Parallel Group 4B: Update Test Scripts

- [ ] Update test helpers in [**tests**/](lib/__tests__/)
  - [ ] Update deployment lookup logic
  - [ ] Support new config structure in mocks
- [ ] Update [package.json](package.json) test scripts
  - [ ] Update `test:dev` to use new deployment tracking
  - [ ] Update `test:prod` to use new deployment tracking

### Checkpoint: Lint + Commit

```bash
npm run lint
npm run build:typecheck
git add bin/ __tests__/ package.json
git commit -m "feat(cli): update commands for v0.7.0 config architecture"
```

---

## Phase 5: CDK Stack Updates

**Goal**: Update CDK constructs to use new config format

### Parallel Group 5A: Update Stack Files

- [ ] Update [lib/benchling-webhook-stack.ts](lib/benchling-webhook-stack.ts)
  - [ ] Use new `ProfileConfig` interface
  - [ ] Remove legacy config type handling
- [ ] Update [lib/fargate-service.ts](lib/fargate-service.ts)
  - [ ] Use new config structure
- [ ] Update [lib/alb-api-gateway.ts](lib/alb-api-gateway.ts)
  - [ ] Use new config structure
- [ ] Update [bin/cdk.ts](bin/cdk.ts) (if exists)
  - [ ] Use new XDGConfig API

### Checkpoint: Lint + Commit

```bash
npm run lint
npm run build:typecheck
git add lib/*.ts bin/cdk.ts
git commit -m "refactor(cdk): update stacks for v0.7.0 config format"
```

---

## Phase 6: Testing

**Goal**: Comprehensive test coverage for new architecture

### Parallel Group 6A: Unit Tests

- [ ] Write tests for new `XDGConfig` API
  - [ ] Test `readProfile()` / `writeProfile()`
  - [ ] Test profile inheritance logic
  - [ ] Test deployment tracking
  - [ ] Test legacy config detection
- [ ] Write tests for profile inheritance
  - [ ] Test simple inheritance (`_inherits: "default"`)
  - [ ] Test deep merge behavior
  - [ ] Test circular inheritance detection
- [ ] Write tests for deployment tracking
  - [ ] Test `recordDeployment()`
  - [ ] Test `getActiveDeployment()`
  - [ ] Test deployment history management

### Parallel Group 6B: Integration Tests

- [ ] Test fresh install workflow (no legacy files)
- [ ] Test multi-profile setup workflow
- [ ] Test deploy with new config format
- [ ] Test profile inheritance in real deployment

### Checkpoint: Lint + Commit

```bash
npm run test
git add __tests__/
git commit -m "test: add comprehensive tests for v0.7.0 config architecture"
```

---

## Phase 7: Documentation

**Goal**: Update all documentation for v0.7.0 breaking changes

### Parallel Group 7A: Core Documentation

- [ ] Update [README.md](README.md)
  - [ ] Document new directory structure
  - [ ] Update quick start guide
  - [ ] Add migration warning for v0.6.x users
- [ ] Update [CLAUDE.md](CLAUDE.md)
  - [ ] Document new XDG configuration model
  - [ ] Update configuration flow section
  - [ ] Update setup commands section

### Parallel Group 7B: Release Documentation

- [ ] Update [CHANGELOG.md](CHANGELOG.md)
  - [ ] Document all user-facing changes concisely
  - [ ] Add v0.7.0 entry with migration notes
- [ ] Update PR description (for a squash commit)

### Checkpoint: Lint + Commit

```bash
npm run lint
git add README.md CLAUDE.md MIGRATION.md CHANGELOG.md
git commit -m "docs: update for v0.7.0 breaking changes"
```

---

## Phase 8: Final Validation & Cleanup

**Goal**: Remove legacy code, final testing, release prep

### Serial Tasks (must be sequential)

- [ ] **Task 8.1**: Remove ALL legacy code
  - [ ] Delete `lib/xdg-config-legacy.ts`
  - [ ] Remove any remaining `deploy.json` references
  - [ ] Remove old `ConfigType` enum references
  - [ ] Search codebase for "default.json" and update/remove

- [ ] **Task 8.2**: Manual testing
  - [ ] Fresh install on clean machine (no XDG config)
  - [ ] Multi-environment setup workflow
  - [ ] Deploy to dev stage with dev profile
  - [ ] Deploy to prod stage with default profile
  - [ ] Verify deployment tracking in `deployments.json`
  - [ ] Test profile inheritance scenarios

### Checkpoint: Final Commit

```bash
npm run test
npm run test:local
git add -A
git commit -m "chore: remove legacy code, bump to v0.7.0 (BREAKING)"
npm run version:tag
```

---

## Release Checklist

- [ ] All tests pass (`npm run test`)
- [ ] Local integration tests pass (`npm run test:local`)
- [ ] Documentation is complete and accurate
- [ ] Migration guide is clear and tested
- [ ] CHANGELOG.md documents all breaking changes
- [ ] PR description/title consistent
- [ ] CI/CD pipeline configured for v0.7.0
- [ ] npm publish dry-run successful

---

## Parallel Execution Strategy

### Can Run in Parallel

- **Phase 1**: Groups 1A and 1B can run simultaneously
- **Phase 3**: Group 3A (all three module extractions) can run simultaneously
- **Phase 4**: Groups 4A and 4B can run simultaneously
- **Phase 5**: Group 5A (all stack updates) can run simultaneously
- **Phase 6**: Groups 6A and 6B can run simultaneously
- **Phase 7**: Groups 7A and 7B can run simultaneously

### Must Run Sequentially

- **Phase 2**: All tasks must run in order (2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6)
- **Phase 3**: Task 3.2 depends on Group 3A completion
- **Phase 8**: All tasks must run in order

### Suggested Workflow

1. Complete Phase 1 (types + fixtures)
2. Complete Phase 2 (XDGConfig rewrite) - **BLOCKING**
3. Complete Phases 3-7 with maximum parallelism
4. Complete Phase 8 (cleanup + release) - **BLOCKING**

---

## Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 | 2 days | None |
| Phase 2 | 3 days | Phase 1 complete |
| Phase 3 | 2 days | Phase 2 complete |
| Phase 4 | 2 days | Phase 2 complete |
| Phase 5 | 1 day | Phase 2 complete |
| Phase 6 | 3 days | Phases 2-5 complete |
| Phase 7 | 2 days | None (can start anytime) |
| Phase 8 | 2 days | All phases complete |

**Total**: ~15-17 days (2-3 weeks with parallelism)
