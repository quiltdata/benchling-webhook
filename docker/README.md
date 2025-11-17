# Benchling-Quilt Integration Service

> **Note**: This is the primary Python application code for the Benchling-Quilt webhook integration. The parent directory contains the AWS CDK infrastructure for deployment.

A webhook-driven automation system that bridges Benchling laboratory entries with Quilt data packages using Python-based workflow orchestration.

## Features

- **Webhook Processing** - Handles Benchling webhook events for entries, canvas interactions, and app lifecycle
- **Python Orchestration** - Native Python workflow with OAuth and execution tracking
- **Package Creation** - Creates structured Quilt packages with metadata and documentation
- **Canvas Integration** - Updates Benchling Canvas with package links and sync information
- **Monitoring** - Comprehensive health checks and execution status endpoints

## Quick Start

### Prerequisites

- Python 3.11+ with [uv](https://docs.astral.sh/uv/)
- Docker and Docker Compose (for deployment)
- Benchling tenant with app installation rights
- AWS account with S3, SQS (for production)

### Setup

```bash
make install               # Install dependencies
make check-env             # Create .env from template (if missing)
# Edit .env with your Benchling/AWS configuration
make test-benchling        # Verify Benchling credentials
make run-local-ngrok       # Launch using ngrok
```

### Configuration

1. Go to `https://TENANT.benchling.com/developer/apps`
2. "Create app" or select app -> "Version History" -> "+ Create a new draft"
3. "From manifest"
4. Drag in benchling/app-manifest.yaml
5. "Create"
6. "Install" [also adds to list of Tenant apps]
7. "Overview" -> "Webhook URL" -> Enter ngrok URL (with https prefix)
8. "Webhook Testing" -> "Send test"
9. "Tenant admin console" -> "Organizations" -> Your Org -> "Apps"
10. "Search for an app" -> enter exact name -> "Add App" [Admin?]

### Development Workflows

**Local development (no AWS needed):**

```bash
make run-local              # Mocked AWS, port 5001
make test-native             # Test webhooks
```

**Docker development (requires AWS):**

```bash
make run                    # Hot-reload, port 5002
make test-dev               # Test webhooks
make logs-dev               # View logs
```

**Production deployment:**

```bash
make build
make run-prod               # Runs on port 5003
make health                 # Check status
```

### Configure Benchling Webhook

1. Create Benchling app: webhook URL = `http://your-host:5001/event`
2. Subscribe to: `v2.entry.created`, `v2.entry.updated.fields`
3. Install app in your workspace

### Webhook Security

The service supports webhook signature verification using the Benchling SDK to ensure webhooks are authentic:

**Setup:**

1. Get your app definition ID from Benchling app settings (format: `appdef_xxxx`)
2. Add to `.env`make t:

   ```bash
   BENCHLING_APP_DEFINITION_ID=appdef_your_id_here
   ENABLE_WEBHOOK_VERIFICATION=true
   ```

**Configuration:**

- `ENABLE_WEBHOOK_VERIFICATION=true` (default) - Verifies all webhook signatures
- `ENABLE_WEBHOOK_VERIFICATION=false` - Disables verification (development only)

**How it works:**

- Uses Benchling SDK's `verify()` helper to validate webhook signatures
- Checks `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers
- Returns 401 if verification fails
- Applied to all webhook endpoints: `/event`, `/lifecycle`, `/canvas`

See [Benchling Webhook Verification Docs](https://docs.benchling.com/docs/webhook-verification) for details.

## Documentation

- **[Complete Guide](../../../meta/docs/enterprise_benchling.md)** - Comprehensive setup, API reference, monitoring, and troubleshooting
- **[SPECIFICATION.md](SPECIFICATION.md)** - Technical architecture, state machine definitions, and data models
- **Makefile** - Run `make help` to see all available development commands

## Development Commands

Run `make help` for full command list. Key commands:

**Setup:**

- `make install` - Install dependencies
- `make check-env` - Verify .env exists (auto-creates from template)
- `make test-benchling` - Verify Benchling OAuth credentials
- `make check-ngrok` - Verify ngrok is configured

**Development:**

- `make run-local` - Local server with mocked AWS (port 5001)
- `make run-local-verbose` - Local with debug logging (port 5001)
- `make run-local-ngrok` - Local server + ngrok tunnel (port 5001)
- `make run` - Docker dev with hot-reload (needs AWS, port 5002)
- `make run-ngrok` - Docker dev + ngrok tunnel (port 5002)

**Testing:**

- `make test-unit` - Run pytest unit tests
- `make test-integration` - Integration tests (needs AWS)
- `make test-native` - Test webhooks with auto-managed local server
- `make test-dev` - Test webhooks against docker dev
- `make test-prod` - Test webhooks against docker prod
- `make test-ecr` - Test ECR image (pulls, runs, tests, cleans up)
- `make lint` - Auto-fix code formatting

**Health & Monitoring:**

- `make health` - Check docker prod health (port 5003)
- `make health-local` - Check local server health (port 5001)
- `make health-dev` - Check docker dev health (port 5002)
- `make logs` - Show docker prod logs
- `make logs-dev` - Show docker dev logs

**Docker & Deployment:**

- `make build` - Build Docker image locally
- `make push-local` - Build and push to ECR (arch-specific tag)
- `make run-ecr` - Pull and run latest ECR image (port 5003)
- `make clean` - Remove containers and images
- `make docker-clean` - Deep clean Docker resources
- `make kill` - Kill processes on configured ports

**Infrastructure:**

- `make ngrok` - Expose server via ngrok (auto-cleanup, configurable PORT/SLEEP)

See [Complete Guide](../../../meta/docs/enterprise_benchling.md) for details.

## API Endpoints

- `GET /health` - Application health status
- `GET /health/ready` - Readiness probe (checks AWS connectivity)
- `POST /event` - Main webhook endpoint
- `GET /executions` - List recent workflow executions
- `GET /executions/{arn}/status` - Get execution status

See the [Complete Guide](../../../meta/docs/enterprise_benchling.md) for complete API documentation.

## Architecture

The service uses Python-based workflow orchestration for all webhook processing, execution tracking, and OAuth handling.

## Troubleshooting

**Test Benchling credentials:**

```bash
make test-benchling

# Test with a specific entry to validate field extraction (display_id, etc.)
BENCHLING_TEST_ENTRY=etr_abc123 make test-benchling

# Or pass entry ID directly to the script
uv run python scripts/test_benchling.py --entry-id etr_abc123
```

The test script will validate that the entry's `display_id` field (e.g., EXP00001234) is properly extracted and not being confused with the entry ID.

**Common authentication errors:**

- `401 UNAUTHORIZED`: Invalid Client ID or Secret
- `404 NOT FOUND`: Wrong tenant name
- `403 FORBIDDEN`: App lacks required permissions

**Service issues:**

- **Readiness probe fails**: Check Benchling credentials and AWS access
- **Webhooks not processing**: Verify webhook URL and app installation
- **Export processing fails**: Check execution logs via `make logs`

See the [Complete Guide](../../../meta/docs/enterprise_benchling.md) for detailed troubleshooting.

## License

[Add your license information here]
