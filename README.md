# quilt-benchling-webhook

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Installation

### Prerequisites

- Node.js >= 18.0.0
- AWS CLI configured with credentials
- Docker

### Setup

```bash
# Install
npm install

# Configure
cp env.template .env
# Edit .env with your AWS account, Benchling credentials, and S3/SQS settings

# Bootstrap CDK (first time only)
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
```

### Configuration

Edit `.env` with your settings:

**Required:**

- `CDK_DEFAULT_ACCOUNT` - Your AWS account ID
- `CDK_DEFAULT_REGION` - AWS region (e.g., us-west-2)
- `BUCKET_NAME` - S3 bucket in same region (must be connected to Quilt)
- `QUEUE_NAME` - PackagerQueue name from your Quilt stack
- `BENCHLING_TENANT` - Your Benchling tenant (e.g., myorg from myorg.benchling.com)
- `BENCHLING_CLIENT_ID` - From Benchling app settings
- `BENCHLING_CLIENT_SECRET` - From Benchling app settings

**Optional:**

- `WEBHOOK_ALLOW_LIST` - Comma-separated IPs for additional security
- `PREFIX` - S3 key prefix (default: benchling)
- `QUILT_CATALOG` - Quilt catalog URL

## Deploy

```bash
source .env
npm run deploy
```

Outputs are saved to `.env.deploy` including the webhook URL you'll need for Benchling configuration.

## Benchling App Setup

After deployment, configure your Benchling app:

1. In Benchling: Profile → Developer Console → Apps → Create app → From manifest
2. Upload [app-manifest.yaml](./app-manifest.yaml)
3. Create Client Secret → Copy to `.env` as `BENCHLING_CLIENT_ID` and `BENCHLING_CLIENT_SECRET`
4. Overview → Webhook URL → Paste URL from `.env.deploy`
5. Version History → Install → Activate
6. Tenant Admin console → Organizations → Apps → Add app → Set role to Admin

## Using the Integration

1. Create a Benchling entry
2. Insert → Canvas → Select "Quilt Integration"
3. Click "Create" to generate a Quilt package
4. Add attachments and click "Update package" to version

## Testing & Monitoring

```bash
# Test health
source .env.deploy
curl $WEBHOOK_ENDPOINT/health

# View logs
aws logs tail /ecs/benchling-webhook --follow

# Run tests
npm test
```

## Development

For detailed development workflows, see [docker/README.md](docker/README.md).

Common commands:

- `npm run build` - Build TypeScript
- `npm run watch` - Watch mode
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run docker-build` - Build Docker image
- `npm run docker-push` - Push to ECR
- `npm run release` - Create production release

## Architecture

- **API Gateway** → **Application Load Balancer** → **ECS Fargate** (auto-scaling 2-10 tasks)
- Webhook events → S3 storage + SQS → Quilt packaging
- Benchling credentials in Secrets Manager
- CloudWatch logs and metrics

## Documentation

- [Complete Development Guide](docker/README.md) - Local development, testing, webhook verification
- [Release Process](doc/RELEASE.md) - Creating releases and CI/CD
- [Release Notes](RELEASE_NOTES.md) - Version history

## License

Apache-2.0
