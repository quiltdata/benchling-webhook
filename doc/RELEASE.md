# Release Process

This document describes how to create releases for the benchling-webhook project.

## Overview

The project uses an automated CI/CD pipeline that:

1. Runs tests on all pushes and pull requests
2. Builds and pushes Docker images when tags are created
3. Creates GitHub releases with auto-generated release notes
4. Publishes to NPM and GitHub Packages

## Quick Start

### Create a Development Release (for testing)

```bash
npm run version:dev
# This creates version 0.4.8-dev.0 (or bumps existing dev version)
# Then push the tag:
git push origin v0.4.8-dev.0
```

### Create a Production Release

```bash
# For patch releases (0.4.7 -> 0.4.8)
npm run version:patch

# For minor releases (0.4.7 -> 0.5.0)
npm run version:minor

# For major releases (0.4.7 -> 1.0.0)
npm run version:major

# Then push the tag:
git push origin v0.4.8
```

## Detailed Workflow

### 1. Prepare Your Release

Before creating a release:

1. **Ensure all changes are committed and pushed**

   ```bash
   git status  # Should show "nothing to commit, working tree clean"
   ```

2. **Update CHANGELOG.md** (optional but recommended)

   ```markdown
   ## [0.4.8] - 2025-10-27

   ### Added
   - New feature description

   ### Changed
   - Updated component behavior

   ### Fixed
   - Bug fix description
   ```

3. **Ensure you're on the main branch**

   ```bash
   git checkout main
   git pull origin main
   ```

### 2. Create a Release

#### Development Releases (for testing)

Development releases are marked as "pre-release" in GitHub and are NOT published to NPM.

```bash
# Create a new dev release
npm run version:dev

# Or bump an existing dev release
npm run version:dev-bump
```

This will:

- Update `package.json` with the new version
- Commit the version change
- Create a git tag (e.g., `v0.4.8-dev.0`)
- Show instructions for pushing the tag

#### Production Releases

```bash
# Choose the appropriate bump type:
npm run version:patch  # For bug fixes (0.4.7 -> 0.4.8)
npm run version:minor  # For new features (0.4.7 -> 0.5.0)
npm run version:major  # For breaking changes (0.4.7 -> 1.0.0)
```

### 3. Push the Tag

After creating the tag, push it to trigger the CI/CD pipeline:

```bash
git push origin v0.4.8  # Replace with your actual tag
```

### 4. Monitor the Release

1. **Watch the GitHub Actions workflow**: <https://github.com/quiltdata/benchling-webhook/actions>
2. **Check the workflow progress**:
   - Test job runs first (Python + Node.js tests)
   - Docker job runs after tests pass (builds and pushes image)
   - Release job creates GitHub release and publishes packages

3. **Verify the release**:
   - GitHub Release: <https://github.com/quiltdata/benchling-webhook/releases>
   - Docker Image in ECR: `{account-id}.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:{version}`
   - NPM Package: <https://www.npmjs.com/package/quilt-benchling-webhook>
   - GitHub Package: <https://github.com/quiltdata/benchling-webhook/pkgs/npm/quilt-benchling-webhook>

## CI/CD Pipeline Details

### Workflow Triggers

The CI workflow (`.github/workflows/ci.yaml`) is triggered by:

- **Push to main**: Runs tests only
- **Pull requests**: Runs tests only
- **Tags matching `v*.*.*`**: Runs tests, builds Docker, creates release
- **Tags matching `v*.*.*-dev.*`**: Same as above, but marks as pre-release

### Jobs

1. **test** (always runs)
   - Sets up Node.js 22 and Python 3.12
   - Installs dependencies
   - Runs Python tests (pytest)
   - Runs Node.js tests (jest)
   - Builds the package

2. **docker** (only on tags, after test passes)
   - Builds Docker image using `make push-ci`
   - Pushes to ECR with version tag and `latest` tag
   - Outputs image URI for release notes

3. **release** (only on tags, after docker completes)
   - Generates release notes from CHANGELOG.md
   - Creates GitHub release (pre-release for dev tags)
   - Publishes to NPM (production releases only)
   - Publishes to GitHub Packages

## Version Management Script

The `bin/version.js` script handles version bumping and tagging:

```bash
# View current version and help
npm run release

# Bump versions
npm run version:major      # 0.4.7 -> 1.0.0
npm run version:minor      # 0.4.7 -> 0.5.0
npm run version:patch      # 0.4.7 -> 0.4.8
npm run version:dev        # 0.4.7 -> 0.4.8-dev.0 or 0.4.8-dev.0 -> 0.4.8-dev.1
npm run version:dev-bump   # 0.4.8-dev.0 -> 0.4.8-dev.1

# Update version without creating tag
node bin/version.js patch --no-tag
```

## Docker Images

Docker images are automatically built and pushed to ECR with:

- Version tag: `quiltdata/benchling:0.4.8`
- Latest tag: `quiltdata/benchling:latest`

To pull and run:

```bash
docker pull {account-id}.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:0.4.8
docker run -p 5000:5000 --env-file .env {account-id}.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:0.4.8
```

## Troubleshooting

### Tag already exists

```bash
# Delete local tag
git tag -d v0.4.8

# Delete remote tag (if pushed)
git push origin :refs/tags/v0.4.8
```

### Workflow failed

1. Check the GitHub Actions logs
2. Common issues:
   - Tests failing: Fix tests and create a new tag
   - Docker build failing: Check `docker/` directory and Makefile
   - AWS credentials: Verify secrets are configured
   - ECR repository doesn't exist: Run `make -C docker docker-ecr-create`

### Need to re-release

1. Delete the tag (locally and remotely)
2. Delete the GitHub release
3. Create a new tag with the same or different version

## Manual NPM Publishing

In cases where you need to manually publish to NPM (e.g., CI/CD is unavailable, emergency hotfix, or testing), you can use the publish script:

### Prerequisites

1. **NPM Access Token**: You need an NPM access token with publish permissions
   - Visit: <https://www.npmjs.com/settings/[your-username]/tokens>
   - Click "Generate New Token"
   - Choose "Automation" (for CI/CD) or "Publish" (for manual use)
   - Copy the token (it starts with `npm_`)

### Usage

```bash
# Check current package status on npm (no auth needed)
npm run publish -- --check

# Publish as dev/prerelease (default)
NPM_TOKEN=npm_xxxxx npm run publish

# Test the publish process (dry-run)
NPM_TOKEN=npm_xxxxx npm run publish -- --dry-run

# Publish as production (latest tag)
NPM_TOKEN=npm_xxxxx npm run publish -- --prod

# Test production publish
NPM_TOKEN=npm_xxxxx npm run publish -- --prod --dry-run

# View help
npm run publish -- --help
```

### Publishing Modes

- **Dev (default)**: Publishes with `dev` tag (prerelease)
  - Install with: `npm install @quiltdata/benchling-webhook@dev`
  - Use for: Testing, development, pre-release versions
- **Production**: Publishes with `latest` tag (use `--prod` flag)
  - Install with: `npm install @quiltdata/benchling-webhook`
  - Use for: Stable releases only

### How It Works

The script:
1. Validates your NPM token (not needed for `--check`)
2. Checks for uncommitted changes (with confirmation prompt)
3. Creates a temporary `.npmrc` file with your token
4. Runs `npm publish --access public --tag <dev|latest>`
5. Cleans up the temporary `.npmrc` file
6. Restores any existing `.npmrc` backup

### Security Notes

- The script creates `.npmrc` with restricted permissions (0600)
- Your token is never committed to git (`.npmrc` is in `.gitignore`)
- The temporary `.npmrc` is automatically cleaned up, even on errors
- Always use `--dry-run` first to test before publishing
- Use `--check` to view package status without authentication

## NPM Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run release` | Show current version and help |
| `npm run version:major` | Bump major version (breaking changes) |
| `npm run version:minor` | Bump minor version (new features) |
| `npm run version:patch` | Bump patch version (bug fixes) |
| `npm run version:dev` | Create or bump dev version |
| `npm run version:dev-bump` | Bump dev counter only |
| `npm run docker-push` | Build and push Docker image locally |
| `npm run docker-check` | Validate Docker images in registry |
| `npm run publish` | Publish to NPM (dev by default, use --prod for production) |
| `npm run publish -- --check` | Check package status on npm registry |

## Best Practices

1. **Always test before releasing**: Run `npm test` and manual testing
2. **Use dev releases for testing**: Test the CI/CD pipeline with dev tags first
3. **Update CHANGELOG.md**: Document changes before releasing
4. **Follow semantic versioning**:
   - Major: Breaking changes
   - Minor: New features (backward compatible)
   - Patch: Bug fixes (backward compatible)
5. **Review the release**: Check GitHub release notes and test the published packages
6. **Coordinate with team**: Communicate releases in team channels

## Migration Notes

The previous release process using `bin/create-release.sh` and separate `release.yaml` workflow has been replaced with this integrated CI/CD pipeline. Key changes:

- **Single workflow**: All release steps are now in `.github/workflows/ci.yaml`
- **Automated**: No manual Docker builds or release note creation needed
- **Tag-based**: Simply push a tag to trigger the release
- **Pre-release support**: Dev tags are automatically marked as pre-releases
- **Integrated testing**: Docker images are only built after tests pass
