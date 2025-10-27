# Repository Guidelines

## Architecture

**Request Flow:** Benchling → API Gateway → ALB → Fargate (Flask app) → S3 + SQS

- **Infrastructure (CDK)**: `bin/` and `lib/` contain TypeScript CDK code for AWS deployment
  - `lib/benchling-webhook-stack.ts` - Main stack orchestrating all components
  - `lib/fargate-service.ts` - ECS Fargate service running Flask in Docker
  - `lib/alb-api-gateway.ts` - API Gateway with HTTP integration to ALB
  - `lib/ecr-repository.ts` - Docker image repository
- **Application (Python)**: `docker/` contains Flask webhook processor
  - See [docker/README.md](docker/README.md) for application development

## Coding Style

- **TypeScript**: 4-space indent, double quotes, trailing commas, required semicolons
- **Types**: Avoid `any` in production; explicit return types on exports
- **Organization**: Separate CDK constructs in `lib/`; application code in `docker/`

## Commands

**Development:**
- `npm run build` - Compile TypeScript
- `npm run test` - Run Jest tests
- `npm run lint` - Apply ESLint

**Deployment:**
- `npm run deploy` - Test + deploy (outputs to `.env.deploy`)
- `npm run docker-build` / `docker-push` - Build and push images
- `npm run docker-logs` - Fetch CloudWatch logs

**Python App:**
- See [docker/README.md](docker/README.md) or run `make help` in docker/ directory

## Environment Variables

**Required** (set in `.env`):
- `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION` - AWS deployment target
- `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`, `BENCHLING_TENANT` - Auth
- `BUCKET_NAME`, `QUEUE_NAME` - S3 and SQS
- `QUILT_CATALOG`, `QUILT_DATABASE` - Quilt configuration

**Optional:**
- `WEBHOOK_ALLOW_LIST` - IP allowlist for Benchling webhooks
- `ENABLE_WEBHOOK_VERIFICATION` - Verify signatures (default: true)
- `ECR_REPOSITORY_NAME` - Custom ECR repo name

See [doc/PARAMETERS.md](doc/PARAMETERS.md) for complete reference.

## Commits & PRs

- Use Conventional Commits: `type(scope): summary`
- Keep commits focused; update `package-lock.json` when needed
- Include test results and deployment considerations in PRs

## Debugging

- **Deployment**: Check `.env.deploy` for outputs
- **Logs**: `npm run docker-logs` or CloudWatch at `/ecs/benchling-webhook`
- **Health**: `/health` (general) and `/health/ready` (readiness probe)
