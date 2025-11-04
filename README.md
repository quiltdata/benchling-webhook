# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Prerequisites

- Node.js 18+ with `npx` ([download](https://nodejs.org))
- [AWS credentials](https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-files.html) configured
- Existing [Quilt deployment](https://www.quilt.bio/install)
- Benchling tenant with OAuth app configured

## Quick Start

Run the guided setup wizard:

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will:

1. Detect your Quilt stack from AWS CloudFormation
2. Collect and validate your Benchling credentials
3. Sync secrets to AWS Secrets Manager
4. Deploy to AWS

After deployment, install the webhook URL in your [Benchling app settings](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app).

## Usage

In Benchling: Create entry → Insert Canvas → "Quilt Integration" → Create/Update package

## Additional Commands

```bash
npx @quiltdata/benchling-webhook@latest --help    # Show all commands
npx @quiltdata/benchling-webhook@latest deploy    # Deploy only
npx @quiltdata/benchling-webhook@latest test      # Test integration
npx @quiltdata/benchling-webhook@latest manifest  # Generate app manifest
```

## Resources

- [Changelog](./CHANGELOG.md) - Version history
- [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)

## License

Apache-2.0
