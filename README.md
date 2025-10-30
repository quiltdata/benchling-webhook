# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Installation

**Prerequisites:**

- Node.js 18+ ([download here](https://nodejs.org))
- AWS credentials configured (verifies account access automatically)
- Existing Quilt deployment

Run this command in your terminal:

```bash
npx @quiltdata/benchling-webhook
```

The interactive wizard will guide you through setup, deployment, and testing.

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

## Advanced

```bash
npx @quiltdata/benchling-webhook --help    # See all options
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

## Documentation

- [AGENTS.md](AGENTS.md) - Complete deployment guide, architecture, configuration
- [docker/README.md](docker/README.md) - Development workflows
- [doc/RELEASE.md](doc/RELEASE.md) - Release process

## License

Apache-2.0
