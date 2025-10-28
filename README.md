# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Quick Install

**Prerequisites:** AWS account, Node.js 18+, Docker, existing Quilt deployment

```bash
# 1. Clone and install
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install

# 2. Configure (auto-infer from Quilt catalog)
npm run get-env -- https://your-catalog.quiltdata.com --write
cp env.inferred .env
# Edit .env to add Benchling credentials

# 3. Deploy
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION  # first time only
npm run deploy

# 4. Configure Benchling app
# - Create app from app-manifest.yaml
# - Set webhook URL from .env.deploy
# - Install and activate

# 5. Verify
source .env.deploy
curl $WEBHOOK_ENDPOINT/health
```

## Usage

1. Create entry in Benchling
2. Insert Canvas → "Quilt Integration"
3. Click "Create" to make package
4. Add files and click "Update package"

## Documentation

- [AGENTS.md](AGENTS.md) - Complete deployment guide, architecture, configuration
- [docker/README.md](docker/README.md) - Development workflows
- [doc/RELEASE.md](doc/RELEASE.md) - Release process

## License

Apache-2.0
