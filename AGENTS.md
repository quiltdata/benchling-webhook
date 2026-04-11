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

CI build trigger: `npm run version:tag:dev`

## Gotchas

- `npm run test:dev`, `test:prod`, `make test-ecr` all require CI to have built the Docker image first
- Integrated mode (`integratedStack: true`) blocks `deploy` — the Quilt stack handles deployment
- The prefix (`pkg_prefix`) is a runtime secret — never bake it into CloudFormation/IaC
- Pass args to npm scripts with `--`: `npm run deploy:prod -- --profile sales --yes`
