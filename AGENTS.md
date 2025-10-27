# Repository Guidelines

## Project Structure & Module Organization

- `bin/` contains the CDK entry point and helper scripts; start from `bin/benchling-webhook.ts` when adding new stacks or app wiring.
- `lib/` holds the CDK constructs for the Fargate-based architecture:
  - `lib/benchling-webhook-stack.ts` - Main CDK stack definition orchestrating all components
  - `lib/fargate-service.ts` - ECS Fargate service running the Flask webhook processor in Docker
  - `lib/alb-api-gateway.ts` - API Gateway with HTTP integration to Application Load Balancer
  - `lib/ecr-repository.ts` - ECR repository construct for Docker image management
  - `lib/types.ts` - Shared TypeScript type definitions
- `lib/templates/` stores JSON templates and `lib/README.md` expands on the architecture (note: may reference older Step Functions architecture).
- `test/` includes Jest specs (`*.test.ts`) and sample Benchling payloads used as fixtures; prefer adding new fixtures beside related tests.
- The actual webhook processing logic runs in a Flask application deployed as a Docker container (external to this CDK project).

## Current Architecture (Fargate + ALB)

The project uses AWS Fargate with Application Load Balancer for webhook processing:

1. **API Gateway** (`lib/alb-api-gateway.ts`) - REST API with HTTP proxy integration
   - Receives webhook POST requests from Benchling
   - Performs optional IP allowlist filtering via resource policy
   - Forwards all requests to the Application Load Balancer

2. **Application Load Balancer** - Routes HTTP traffic to Fargate tasks
   - Performs health checks on `/health` and `/health/ready` endpoints
   - Load balances across multiple Fargate tasks

3. **ECS Fargate Service** (`lib/fargate-service.ts`) - Runs Docker containers
   - Deploys a Flask application that processes webhook events
   - Stores Benchling credentials in AWS Secrets Manager
   - Has access to S3 bucket and SQS queue for data storage and notifications
   - Configured with environment variables for Benchling tenant, catalog, etc.

4. **ECR Repository** (`lib/ecr-repository.ts`) - Stores Docker images
   - Versioned container images with lifecycle policies
   - Public read access for easier distribution

**Request Flow:**
Benchling → API Gateway → ALB → Fargate (Flask app) → S3 + SQS

**Note:** An older Step Functions-based architecture may still be referenced in some files (like `lib/README.md`) but is no longer in use.

## Build, Test, and Development Commands

- `npm install` sets up dependencies; run after cloning or updating lockfiles.
- `npm run lint` applies the ESLint ruleset (TypeScript + Node); use before committing to catch style regressions.
- `npm run test` executes the Jest suite; include its output in pull requests when relevant.
- `npm run clean` clears generated JS and `cdk.out`; use when switching branches to avoid stale artifacts.
- `npm run deploy` runs tests then deploys via `bin/deploy.sh`; outputs are saved to `.env.deploy`.
- `npm run docker-logs` retrieves CloudWatch logs from API Gateway and ECS containers for debugging.
- `npm run docker-build`, `npm run docker-push` manage Docker image builds and ECR uploads.

## Coding Style & Naming Conventions

- TypeScript code uses 4-space indentation, double quotes, trailing commas, and required semicolons per `eslint.config.js`.
- Avoid `any` in production code; tests may use it where helpful. Always spell out explicit return types on exported functions.
- CDK constructs should be organized in separate files under `lib/` for maintainability.
- Keep infrastructure code (CDK) separate from application code (Flask app runs in container).

## Testing Guidelines

- Write focused Jest tests in `test/` mirroring the module under test (e.g., `alb-api-gateway.test.ts`).
- Reuse payload fixtures in `test-events/*.json` to simulate webhook flows; document new fixtures inline.
- Tests focus on CDK infrastructure and API Gateway configuration; the Flask application has its own test suite.
- Run `npm run test` before requesting review; add `--watch` locally when iterating.
- Use `npm run docker-logs` after deployment to verify webhook processing in CloudWatch logs.

## Commit & Pull Request Guidelines

- Follow the existing Conventional Commit style (`type(scope): summary`), as seen in recent `chore(deps)` and `fix(deps)` commits; capitalize only when necessary.
- Keep commits focused on one logical change and update `package-lock.json` when dependencies shift.
- Pull requests should include: a concise summary, testing notes (`npm run test` output or reasoning), any deployment considerations, and linked issues or tickets.
- Add screenshots or CLI output when touching user-visible behavior or infrastructure diagrams.

## Security & Configuration Tips

- Store AWS and Benchling secrets only in local `.env`; never commit credentials or generated artifacts from deployments.
- Verify environment variables match the values expected by `README.md` before running CDK commands to avoid provisioning into the wrong account.
- Benchling credentials are stored in AWS Secrets Manager (created by `lib/fargate-service.ts`) and injected into Fargate containers at runtime.
- Use `WEBHOOK_ALLOW_LIST` to restrict webhook sources to Benchling's public IP ranges for defense-in-depth security.

### Required Environment Variables

The following must be set in `.env` for both CDK deployment and runtime (validated in `bin/benchling-webhook.ts`):

- `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION` - AWS deployment target
- `BENCHLING_CLIENT_ID`, `BENCHLING_CLIENT_SECRET`, `BENCHLING_TENANT` - Benchling OAuth credentials
- `BUCKET_NAME`, `S3_BUCKET_NAME` - S3 bucket for packages (CDK parameter and Python app)
- `QUEUE_NAME`, `SQS_QUEUE_URL` - SQS queue name and full URL
- `QUILT_CATALOG`, `QUILT_DATABASE` - Quilt catalog URL and Athena database name
- `BENCHLING_APP_DEFINITION_ID` - Required when `ENABLE_WEBHOOK_VERIFICATION=true` (default)

### Optional Environment Variables

Defaults are provided; override as needed:

- `WEBHOOK_ALLOW_LIST` - Comma-separated IPs (empty = allow all)
- `CREATE_ECR_REPOSITORY` - Create new ECR repo (default: false)
- `ECR_REPOSITORY_NAME` - ECR repo name (default: "quiltdata/benchling")
- `STAGE` - Environment stage (default: "prod")
- `PREFIX` - Package prefix (default: "benchling")
- `FLASK_ENV`, `LOG_LEVEL`, `PORT` - Flask app configuration
- `ENABLE_WEBHOOK_VERIFICATION` - Verify webhook signatures (default: "true")
- `BENCHLING_API_KEY` - For MCP server integration
- `AWS_PROFILE` - AWS profile for local development

## Debugging & Troubleshooting

- **Check deployment outputs**: After deployment, view `.env.deploy` for webhook endpoint URL and other stack outputs.
- **View logs**: Use `npm run docker-logs` to fetch recent CloudWatch logs from both API Gateway and ECS containers.
- **API Gateway logs**: Located at `/aws/apigateway/benchling-webhook` - shows request routing and integration details.
- **ECS container logs**: Located at `/ecs/benchling-webhook` - shows Flask application output and webhook processing.
- **Health checks**: The Flask app exposes `/health` (general health) and `/health/ready` (readiness probe) endpoints.
- **Common issues**:
  - 404 errors: The Flask app doesn't have a handler for the requested path
  - 500 errors at API Gateway: Check if the ALB is healthy and Fargate tasks are running
  - No logs in ECS: Webhook may not be reaching the Fargate app; check API Gateway execution logs
