# Benchling Webhook - Agent Guide

## Policy

- Always allow: `npm install`, `npm test`, `npm run setup`, git operations, `gh` commands
- Always fix IDE diagnostics after edits
- Docker images ALWAYS pull from centralized ECR: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest`

## Critical: Use Project npm Scripts

**Version bumps:** Use `npm run version -- minor|patch|major`, NOT `npm version`. The project script syncs `package.json`, `pyproject.toml`, `app-manifest.yaml`, and `uv.lock` in one commit.

**General rule:** Always check `npm run` before assuming a built-in npm command. The project script is always preferred.

## Testing: When to Run What

```bash
npm test                     # PRE-COMMIT (always)
npm run test:integration     # BEFORE MERGING PR
npm run test:local           # AFTER DOCKER CHANGES
npm run test:local:prod      # AFTER DOCKER PROD CHANGES
npm run test:dev             # AFTER CI BUILDS IMAGE (needs git tag first)
```

## Tagging: Dev vs Release Builds

Both commands run `version:verify` (clean git check) and the full `npm test` suite before creating and pushing a git tag, which triggers a CI Docker build.

```bash
npm run version:tag:dev      # DEV BUILDS — pre-release tag `v<version>-<timestamp>`
npm run version:tag          # RELEASE BUILDS — production tag `v<version>`
```

- **`version:tag:dev`** — use for iterative/dev builds. Appends a timestamp so the tag is always unique; you can re-tag the same version repeatedly. Produces a pre-release (dev) build. This is the CI build trigger to use while testing changes (e.g. before `npm run test:dev`).
- **`version:tag`** — use for official releases only. Creates `v<version>` (no timestamp), so the version must be bumped first (`npm run version -- patch|minor|major`) or the tag will already exist. Triggers the production release build (GitHub release + NPM publish).

### Automatic releases on merge

CI (`.github/workflows/ci.yaml`, job `autotag`) runs on every push to `main`. If the push changed `package.json`'s `version` to a plain `x.y.z` and tag `v<version>` does not exist yet, it creates and pushes that tag, then builds the Docker image, creates the GitHub release, and publishes to npm `latest` **in the same run** (tags pushed with `GITHUB_TOKEN` don't trigger new workflow runs). So the normal release flow is: bump with `npm run version -- patch|minor|major` in your PR, merge it, done.

Manual `npm run version:tag` still works. Whichever path creates `v<version>` first wins; the other sees the existing tag and skips, so a version is never published twice. Merges that don't change the version don't release.

## Gotchas

- `npm run test:dev`, `test:prod`, `make test-ecr` all require CI to have built the Docker image first
- Integrated mode (`integratedStack: true`) blocks `deploy` — the Quilt stack handles deployment
- The prefix (`pkg_prefix`) is a runtime secret — never bake it into CloudFormation/IaC
- Pass args to npm scripts with `--`: `npm run deploy:prod -- --profile sales --yes`
