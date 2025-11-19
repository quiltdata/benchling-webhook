<!-- markdownlint-disable MD013 -->
# Production Docker Build Workflow Specification

**Document Type**: Specification (WHAT, not HOW)
**Status**: Draft
**Created**: 2025-11-18
**Purpose**: Define production Docker image tagging and publishing workflow

---

## Problem Statement

Currently, the repository has a CI workflow (`.github/workflows/ci.yaml`) that builds and pushes Docker images to ECR **only when version tags are pushed** (e.g., `v0.7.3`). This workflow uses semantic version tags for the Docker images.

**Gap**: There is no workflow to build and push Docker images tagged with **git commit SHA** for production deployments that need immutable, traceable image references.

**Business Need**: Production deployments in the T4 stack reference Docker images by commit SHA (as seen in `~/GitHub/infra-templates` and `~/GitHub/meta/docs`), not semantic versions. This ensures exact traceability and immutability.

---

## Desired End State

### Goals

1. **SHA-based Tagging**: Docker images are tagged with the full git commit SHA (40 characters)
2. **Latest Tag**: Images are also tagged as `latest` for convenience
3. **Production Account**: Images are pushed to the production ECR account (`712023778557`)
4. **Automated Workflow**: Triggered automatically on pushes to specific branches or manual workflow dispatch
5. **OIDC Authentication**: Uses GitHub OIDC role assumption (already configured in infra-templates)
6. **Platform Consistency**: Builds linux/amd64 images only (production requirement)
7. **Validation**: Validates pushed images to ensure correct architecture
8. **Reuse Existing Tools**: Leverages `docker/scripts/docker.py` and `make push-ci` patterns (where appropriate)

### Workflow Characteristics

**Trigger Conditions**:

- Manual workflow dispatch (for ad-hoc builds)
- Automatic trigger on push to `main` branch (or configurable production branch)
- Automatic trigger on push to release branches (e.g., `release/*`)

**Authentication**:

- Uses OIDC role: `arn:aws:iam::712023778557:role/github/GitHub-benchling-webhook`
- No hardcoded AWS credentials (uses `aws-actions/configure-aws-credentials@v5`)
- Repo condition already configured: `repo:quiltdata/benchling-webhook:*`

**Image Tags Generated**:

- `{git-sha}` (e.g., `5da1cb0a65340dbb3a6bd477bd3060c9c45`) - 40 character full SHA
- `latest` - always points to most recently pushed image

**Image URI Format**:

```images
712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:{git-sha}
712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest
```

---

## Scope

### In Scope

1. **New GitHub Actions Workflow File**: `.github/workflows/prod.yml`
2. **SHA Extraction**: Capture full git commit SHA from GitHub context
3. **Docker Build**: Build linux/amd64 image using existing Dockerfile
4. **Docker Push**: Push to production ECR with SHA and latest tags
5. **Image Validation**: Verify pushed image architecture is linux/amd64
6. **Status Reporting**: Output image URIs and push status
7. **Integration with Existing Tools**: Reuse `docker/scripts/docker.py` capabilities

### Out of Scope

1. Multi-architecture builds (arm64) - not needed for production
2. Semantic version tagging (handled by existing ci.yaml)
3. npm package publishing (handled by existing ci.yaml)
4. GitHub release creation (handled by existing ci.yaml)
5. Deployment to ECS (separate concern)
6. ECR repository creation (repository already exists)
7. Modification of existing ci.yaml workflow

---

## Engineering Constraints

### Must Follow

1. **OIDC Authentication Only**: No AWS access keys in secrets
2. **Production ECR Account**: Must push to `712023778557` (quiltdata prod)
3. **ECR Repository**: Must push to `quiltdata/benchling` (already exists)
4. **Platform Architecture**: Must build `linux/amd64` only (no arm64)
5. **Immutable SHA Tags**: SHA tags are never overwritten (immutable)
6. **Latest Tag**: Latest tag is updated on every successful push
7. **Validation Required**: Must validate image architecture after push
8. **No Public Registry**: ECR repo has public read policy but requires auth for push

### Tool Integration Requirements

**Reuse `docker/scripts/docker.py`**:

- The `docker.py` script already supports:
  - ECR registry auto-detection via STS (`_get_registry()`)
  - ECR login handling (`_ecr_login()`)
  - Architecture validation (`_validate_image_architecture()`)
  - Build with platform specification (`build()`)
  - Push to registry (`push()`)
  - Tag management (`tag()`)

**Extend for SHA Tagging**:

- Current `docker.py` generates tags via `generate_tags()` which uses version strings
- For SHA tagging, workflow should pass SHA as version parameter
- Use `--no-arch-suffix` flag (SHA tags don't need architecture suffix)
- Use `--no-latest` flag conditionally (skip latest on pre-release branches)

**Makefile Integration**:

- Current `make push-ci` already:
  - Sets `DOCKER_IMAGE_NAME=quiltdata/benchling`
  - Exports environment for `docker.py`
  - Runs `uv run python scripts/docker.py push`
  - Uses `--no-arch-suffix` flag

**Workflow Should**:

- Set `VERSION` environment variable to git SHA
- Call `make push-ci VERSION=${{ github.sha }}`
- Let existing tooling handle ECR auth, build, push, validation

---

## Success Criteria

### Functional Requirements

1. **Workflow Execution**:
   - Workflow runs successfully on main branch push
   - Workflow runs successfully on manual dispatch
   - Workflow fails gracefully with clear error messages

2. **Image Availability**:
   - Docker image is available in ECR after successful workflow
   - Image is tagged with full 40-character git SHA
   - Image is tagged as `latest`
   - Image is linux/amd64 architecture (verified)

3. **Authentication**:
   - Workflow assumes OIDC role successfully
   - No AWS credential secrets required in repository settings
   - ECR push succeeds with OIDC credentials

4. **Validation**:
   - Workflow validates pushed image architecture
   - Workflow fails if architecture is not linux/amd64
   - Workflow outputs image URIs for downstream use

### Non-Functional Requirements

1. **Performance**:
   - Build and push completes within 10 minutes
   - Leverages Docker layer caching where possible

2. **Observability**:
   - Workflow logs clearly show each step
   - Image URIs are output as workflow outputs
   - Failures include diagnostic information

3. **Maintainability**:
   - Workflow follows existing patterns from ci.yaml
   - Reuses existing scripts and Makefile targets
   - Minimal duplication of logic

---

## Reference Information

### Existing Infrastructure

**ECR Repository** (from `~/GitHub/infra-templates/ecr-repos.yaml`):

```yaml
Benchling:
  name: "quiltdata/benchling"
  # Public read policy applied
  # Located in account 712023778557, region us-east-1
```

**OIDC Role** (from `~/GitHub/infra-templates/github-actions-prod.yml`):

```yaml
BenchlingWebhookRole:
  RoleName: GitHub-benchling-webhook
  Condition: repo:quiltdata/benchling-webhook:*
  Permissions:
    - ecr:GetAuthorizationToken
    - ecr:PutImage
    - ecr:InitiateLayerUpload
    - ecr:UploadLayerPart
    - ecr:CompleteLayerUpload
```

### Existing Patterns

**Current ci.yaml Workflow** (relevant sections):

```yaml
- uses: aws-actions/configure-aws-credentials@v5
  with:
    role-to-assume: arn:aws:iam::712023778557:role/github/GitHub-benchling-webhook
    aws-region: us-east-1

- uses: docker/setup-buildx-action@v3
  with:
    platforms: linux/amd64

- run: make push-ci VERSION=${{ steps.version.outputs.VERSION }}
  env:
    DOCKER_DEFAULT_PLATFORM: linux/amd64
    AWS_REGION: us-east-1
```

**Current Makefile Target** (`docker/make.deploy`):

```makefile
push-ci:
 DOCKER_IMAGE_NAME=$(DOCKER_IMAGE_BASE) \
 uv run python scripts/docker.py push --version $(VERSION) --no-arch-suffix
```

### Similar Implementations

**Enterprise Registry Workflow** (`~/GitHub/enterprise/.github/workflows/registry-test-and-build.yml`):

- Uses git SHA as image tag
- Pushes to multiple ECR accounts
- Validates architecture after push
- Uses OIDC role assumption

---

## Dependencies

### External Dependencies

1. **AWS Infrastructure**:
   - ECR repository `quiltdata/benchling` exists in account `712023778557`
   - OIDC role `GitHub-benchling-webhook` exists and is configured
   - Role trust policy allows this repository

2. **GitHub Actions**:
   - `aws-actions/configure-aws-credentials@v5` available
   - `docker/setup-buildx-action@v3` available
   - GitHub OIDC provider configured for quiltdata org

### Internal Dependencies

1. **Existing Tools**:
   - `docker/scripts/docker.py` script functional
   - `docker/Makefile` and `docker/make.deploy` functional
   - `uv` package manager available in workflow
   - Docker buildx available

2. **Existing Workflows**:
   - Does not conflict with ci.yaml (different triggers)
   - Can coexist with ci.yaml (different tagging strategies)

---

## Relationship to Existing Workflows

### ci.yaml (Version-Based)

- **Trigger**: Tag push (e.g., `v0.7.3`)
- **Tags**: Semantic versions (`v0.7.3`, `latest`)
- **Purpose**: Release builds tied to npm package versions
- **npm**: Publishes to npm registry
- **GitHub**: Creates GitHub releases

### prod.yml (SHA-Based) - **THIS SPEC**

- **Trigger**: Branch push (main, release/*) or manual
- **Tags**: Git SHA (`5da1cb0a...`, `latest`)
- **Purpose**: Production deployment builds with immutable references
- **npm**: No npm publishing
- **GitHub**: No release creation

### Complementary Nature

- Version builds (ci.yaml) are for releases and npm distribution
- SHA builds (prod.yml) are for production deployments and traceability
- Both can exist in ECR simultaneously with different tags
- Latest tag preference: SHA builds (more frequent, more recent)

---

## Open Questions

1. **Branch Restriction**: Should prod.yml only run on `main` branch, or also `release/*` branches?
   - **Recommendation**: Start with `main` only, expand if needed

2. **Latest Tag Strategy**: Should latest tag only be applied on `main` branch pushes?
   - **Recommendation**: Yes, reserve `latest` for main branch only

3. **Manual Dispatch Options**: What parameters should manual workflow dispatch accept?
   - **Recommendation**: None initially, use branch/SHA from dispatch context

4. **Validation Failure Behavior**: Should workflow fail if validation detects wrong architecture?
   - **Recommendation**: Yes, fail fast on validation errors

5. **Duplicate SHA Handling**: What if SHA tag already exists in ECR?
   - **Recommendation**: ECR allows push with same tag (overwrites), but this shouldn't happen with immutable SHAs

---

## Success Metrics

1. **Automation**: 100% of main branch pushes result in ECR image with SHA tag
2. **Reliability**: >95% workflow success rate (excluding external service failures)
3. **Traceability**: Every ECR image can be traced back to exact git commit
4. **Speed**: Average workflow duration <8 minutes
5. **Adoption**: Production deployments reference SHA-tagged images within 30 days

---

## Related Documentation

- **Current CI Workflow**: `.github/workflows/ci.yaml`
- **Docker Scripts**: `docker/scripts/docker.py`
- **Makefile**: `docker/make.deploy`
- **Infrastructure Templates**: `~/GitHub/infra-templates/github-actions-prod.yml`
- **Enterprise Patterns**: `~/GitHub/enterprise/.github/workflows/registry-test-and-build.yml`
- **T4 Documentation**: `~/GitHub/meta/docs/deployment_t4_template_benchling.md`
