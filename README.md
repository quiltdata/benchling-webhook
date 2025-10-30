# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Prerequisites

- `npx` from Node.js 18+ ([download](https://nodejs.org))
- [AWS credentials](https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-files.html) configured
- Existing [Quilt deployment](https://www.quilt.bio/install)

## Setup

### 1. Create Benchling App

```bash
npx @quiltdata/benchling-webhook manifest
```

Follow the displayed instructions to [upload the manifest](https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest) to Benchling and get your App Definition ID.

### 2. Deploy to AWS

```bash
npx @quiltdata/benchling-webhook
```

The interactive wizard will auto-detect or request configuration information, deploy to AWS, and test the webhook automatically.

### 3. Install in Benchling

After deployment, you'll receive a webhook URL. Set it in your Benchling app settings and [install the app](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app) in your tenant.

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

For all available commands, run:

```bash
npx @quiltdata/benchling-webhook --help
```

## Development

For local development and contributing:

```bash
git clone https://github.com/quiltdata/benchling-webhook.git
cd benchling-webhook
npm install

# Test CLI locally (note the -- separator for passing args)
npm run cli -- --help
npm run cli -- deploy

npm test    # Run tests
npm run build    # Build package
```

## License

Apache-2.0
