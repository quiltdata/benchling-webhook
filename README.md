# Benchling Webhook Integration for Quilt

Connects Benchling lab notebook entries to Quilt data packages via webhooks.

## Prerequisites

- Node.js 18+ with `npx` ([download](https://nodejs.org))
- [AWS credentials](https://docs.aws.amazon.com/cli/v1/userguide/cli-configure-files.html) configured
- Existing [Quilt deployment](https://www.quilt.bio/install)
- Benchling tenant (need Admin permissions to install a Benchling app)

## Quick Start

### 1. Install the Benchling app

First create a manifest:

```bash
npx @quiltdata/benchling-webhook@latest manifest
```

Then follow the instructions to [create](https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest) and [install](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app) the app.

This will give you an App Definition ID and Client ID,
which --- along with the Client Secret must generate -- you will need later.

### 2. Run the setup wizard

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will:

1. Detect your Quilt stack from AWS CloudFormation
2. Collect and validate your Benchling credentials
3. Sync secrets to AWS Secrets Manager
4. Deploy to AWS

It will list the outputs, including the webhook URL.

NOTE: This version no longer reads your `.env` file.
Instead, it stores your results in the [XDG_CONFIG_HOME](https://wiki.archlinux.org/title/XDG_Base_Directory),
where you can have more than one profile.

### 3. Configure Webhook URL

After deployment, add the webhook URL to your [Benchling app settings](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app).

### 4. Usage

In Benchling:

1. Create entry →
2. Insert Canvas →
3. Select "Quilt Package" →
4. Click "Create"

This will generate an App Canvas with a dedicated Quilt package for this notebook, as well as additional links and buttons.

## Other Commands

If necessary, you can manually deploy (without redoing setup) via:

```bash
npx @quiltdata/benchling-webhook@latest deploy
```

For more information, use:

```bash
npx @quiltdata/benchling-webhook@latest --help    # Show all commands
```

## Resources

- [Changelog](./CHANGELOG.md) - Version history
- [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)

## License

Apache-2.0
