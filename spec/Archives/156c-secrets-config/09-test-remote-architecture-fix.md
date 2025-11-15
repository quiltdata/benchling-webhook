# Test Remote Architecture Fix

## Issue Number

Related to #156 (secrets configuration) - CI/CD testing workflow

## Problem Statement

The `npm run test:remote` command is **fundamentally broken** because it's testing the wrong image:

### Current (Broken) Flow

```bash
npm run test:remote
  → npm run release:dev     # Builds & deploys dev stack with CI
  → make -C docker test-ecr # Tests LOCAL ARM image from ECR
```

**Root Cause**: `test-ecr` pulls an image tagged as `latest` from ECR, which may be:

1. An old image from a previous build
2. A different architecture (ARM vs x86)
3. Not the image that was just built by `release:dev`

### Expected (Correct) Flow

```bash
npm run test:remote
  → npm run release:dev     # Builds & deploys dev stack
  → Test the ACTUAL deployed dev stack via API Gateway endpoint
```

## Architecture Principles

### 1. Test What You Deploy

- **Local tests** (`test:local`) → Test local Docker image
- **Remote tests** (`test:remote`) → Test deployed cloud infrastructure
- **ECR tests** (`test-ecr`) → Test specific ECR image tag

### 2. Clear Separation of Concerns

- `release:dev` → CI builds image, tags it, pushes to ECR, deploys dev stack
- `test:remote` → Integration tests against the deployed dev stack endpoint
- `test-ecr` → Verification tests for a specific ECR image

### 3. No Ambiguity in Image Selection

- Never test "latest" tag when you just built a specific version
- Always test the exact artifact (image + stack) that was just deployed

## Specification

### Current Scripts (Broken)

```json
{
  "release:dev": "npm run test && node bin/release.js dev",
  "test:remote": "npm run release:dev && make -C docker test-ecr"
}
```

### Proposed Scripts (Fixed)

```json
{
  "release:dev": "npm run test && node bin/release.js dev && make -C docker push-ci-dev",
  "test:remote": "npm run release:dev && make -C docker test-deployed-dev"
}
```

### New Makefile Targets Required

```makefile
# Push dev image to ECR with 'dev' tag (not 'latest')
push-ci-dev:
 @echo "Building and pushing dev image to ECR..."
 @./scripts/docker-build-push.sh dev

# Test the deployed dev stack via its API Gateway endpoint
test-deployed-dev: check-xdg
 @echo "Testing deployed dev stack..."
 @DEV_ENDPOINT=$$(jq -r '.dev.endpoint' ~/.config/benchling-webhook/deploy.json); \
 if [ -z "$$DEV_ENDPOINT" ] || [ "$$DEV_ENDPOINT" = "null" ]; then \
  echo "❌ No dev endpoint found in deploy.json"; \
  exit 1; \
 fi; \
 echo "Testing endpoint: $$DEV_ENDPOINT"; \
 uv run python scripts/test_webhook.py "$$DEV_ENDPOINT"

# Test specific ECR image by tag (explicit, not 'latest')
test-ecr-tag: check-xdg
 @if [ -z "$(TAG)" ]; then \
  echo "❌ Usage: make test-ecr-tag TAG=v0.5.4"; \
  exit 1; \
 fi
 @echo "Testing ECR image with tag: $(TAG)"
 @$(MAKE) run-ecr-tag TAG=$(TAG)
 @sleep 5
 @echo "Waiting for container to be healthy..."
 @for i in 1 2 3 4 5 6 7 8 9 10; do \
  if curl -s http://localhost:$(PORT_DOCKER_PROD)/health >/dev/null 2>&1; then \
   echo "✅ Container is healthy"; \
   break; \
  fi; \
  echo "Waiting for health check ($$i/10)..."; \
  sleep 3; \
 done
 @uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD) || \
  (docker stop benchling-ecr-test; docker rm benchling-ecr-test; exit 1)
 @docker stop benchling-ecr-test
 @docker rm benchling-ecr-test
```

## Implementation Plan

### Phase 1: Immediate Fix (Critical)

1. **Update `test:remote`** to test deployed endpoint, not local ECR image
2. **Update `release:dev`** to push image with `dev` tag
3. **Create `test-deployed-dev` Makefile target**
4. **Store deployment endpoints** in `deploy.json` during release

### Phase 2: Enhanced ECR Testing (Optional)

1. Create `test-ecr-tag` target for explicit tag testing
2. Deprecate `test-ecr` (ambiguous "latest" testing)
3. Add tag validation in CI pipeline

### Phase 3: Documentation (Required)

1. Update CLAUDE.md to clarify test workflows
2. Document when to use each test command
3. Add troubleshooting guide for failed remote tests

## Expected Behavior After Fix

### Development Workflow

```bash
# 1. Unit tests (fast, local)
npm run test

# 2. Local integration (Docker + Benchling)
npm run test:local

# 3. Remote integration (full stack deployment)
npm run test:remote
  → Deploys dev stack with unique image tag
  → Tests via API Gateway endpoint
  → Validates full cloud infrastructure
```

### What Gets Tested Where

| Test Command | What's Tested | Image Source | Network Path |
|--------------|---------------|--------------|--------------|
| `npm run test` | Unit tests | N/A | N/A |
| `npm run test:local` | Local Docker | Local build | localhost:5001 |
| `npm run test:remote` | Deployed dev stack | ECR (dev tag) | API Gateway → ALB → Fargate |
| `make test-ecr-tag TAG=v0.5.4` | Specific ECR image | ECR (explicit tag) | localhost:5003 |

## Success Criteria

- [ ] `npm run test:remote` passes consistently
- [ ] Tests validate the exact image that was just deployed
- [ ] No confusion about which image is being tested
- [ ] CI pipeline can reliably test dev stack before production promotion
- [ ] Developers understand when to use each test command

## Related Files

- [package.json](../../package.json) - npm scripts
- [docker/Makefile](../../docker/Makefile) - test targets
- [bin/release.js](../../bin/release.js) - deployment orchestration
- [scripts/docker-build-push.sh](../../scripts/docker-build-push.sh) - image building
- [CLAUDE.md](../../CLAUDE.md) - developer documentation

## References

- Issue #156: Centralize XDG configuration management
- Commit 878b399: Add BENCHLING_TEST_MODE for local tests
- Original problem: `test:remote` failing due to wrong image being tested
