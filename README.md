# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Quick Install

**Prerequisites:** AWS account, existing Quilt deployment

```bash
# 1. Interactive setup (recommended)
npx @quiltdata/benchling-webhook init

# 2. Deploy
npx @quiltdata/benchling-webhook deploy

# 3. Test the webhook
npx @quiltdata/benchling-webhook test
```

## Alternative: Manual Configuration

If you prefer to configure via `.env` file:

```bash
# 1. Create .env file
cat > .env << EOF
QUILT_CATALOG=quilt-catalog.yourcompany.com
QUILT_USER_BUCKET=your-data-bucket
BENCHLING_TENANT=your-tenant
BENCHLING_APP_CLIENT_ID=your-client-id
BENCHLING_APP_CLIENT_SECRET=your-client-secret
BENCHLING_WEBHOOK_SECRET=your-webhook-secret
BENCHLING_WEBHOOK_ID=your-webhook-id
EOF

# 2. Bootstrap CDK (first time only)
npx @quiltdata/benchling-webhook deploy --bootstrap-check

# 3. Deploy
npx @quiltdata/benchling-webhook deploy --yes
```

## Usage

1. Create entry in Benchling
2. Insert Canvas → "Quilt Integration"
3. Click "Create" to make package
4. Add files and click "Update package"

## CLI Commands

```bash
# Show help
npx @quiltdata/benchling-webhook --help

# Interactive configuration
npx @quiltdata/benchling-webhook init

# Validate configuration without deploying
npx @quiltdata/benchling-webhook validate

# Deploy with options
npx @quiltdata/benchling-webhook deploy --yes
npx @quiltdata/benchling-webhook deploy --catalog your-catalog.com --bucket your-bucket

# Test the deployed webhook
npx @quiltdata/benchling-webhook test
npx @quiltdata/benchling-webhook test --url https://your-webhook-url.com
```

## Development

For local development and contributing:

```bash
# Clone and install
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install

# Test CLI locally
npm run cli -- --help
npm run cli deploy

# Run tests
npm test
```

## Documentation

- [AGENTS.md](AGENTS.md) - Complete deployment guide, architecture, configuration
- [docker/README.md](docker/README.md) - Development workflows
- [doc/RELEASE.md](doc/RELEASE.md) - Release process

## License

Apache-2.0
