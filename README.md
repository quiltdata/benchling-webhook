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

1. **Catalog Discovery** - Detect and confirm your Quilt catalog DNS
2. **Stack Query** - Extract configuration from your CloudFormation stack
3. **Parameter Collection** - Collect Benchling credentials and package settings
4. **Validation** - Validate all parameters before proceeding
5. **Deployment Mode** - Choose between integrated or standalone deployment:
   - **Integrated Mode**: Updates the existing BenchlingSecret in your Quilt stack (recommended if you have one)
   - **Standalone Mode**: Creates a dedicated secret and optionally deploys a separate webhook stack

#### Deployment Modes

**Integrated Mode** (recommended if your Quilt stack has a BenchlingSecret):
- Uses the existing BenchlingSecret from your Quilt CloudFormation stack
- No separate deployment needed - the webhook URL is available from your Quilt stack outputs
- Cleaner architecture with fewer AWS resources

**Standalone Mode** (for separate deployments):
- Creates a dedicated secret: `quiltdata/benchling-webhook/<profile>/<tenant>`
- Prompts you to deploy a separate webhook stack to AWS
- Useful for testing or isolated deployments

It will list the webhook URL in the completion message or next steps.

NOTE: This version no longer reads your `.env` file.
Instead, it stores your results in the [XDG_CONFIG_HOME](https://wiki.archlinux.org/title/XDG_Base_Directory),
where you can have more than one profile.

#### Integrated Mode: BenchlingIntegration Parameter

When using integrated mode (built-in Quilt stack webhook), the setup wizard will:

1. Check if `BenchlingIntegration` is enabled in your Quilt stack
2. Offer to enable it automatically if disabled
3. Provide a status command to monitor the stack update

**Checking Integration Status:**

```bash
npx @quiltdata/benchling-webhook@latest status --profile myprofile
```

This shows:

- CloudFormation stack status
- BenchlingIntegration parameter state
- Last update timestamp
- Direct link to CloudFormation console

**Enabling BenchlingIntegration:**

If your Quilt stack has `BenchlingIntegration` set to `false`, the setup wizard will detect this and offer to enable it automatically. You can:

- Let the wizard update the parameter (recommended)
- Enable it manually through the AWS CloudFormation console
- Use the `status` command to monitor the update progress

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

### Deploy

If necessary, you can manually deploy (without redoing setup) via:

```bash
npx @quiltdata/benchling-webhook@latest deploy
```

### Status

Check the status of your Quilt stack and BenchlingIntegration parameter:

```bash
npx @quiltdata/benchling-webhook@latest status [--profile <name>]
```

This command displays:
- CloudFormation stack status (CREATE_COMPLETE, UPDATE_IN_PROGRESS, etc.)
- BenchlingIntegration parameter value (true/false)
- Last update timestamp
- Direct console link for manual updates

Useful for monitoring stack updates after enabling BenchlingIntegration.

### Help

For more information, use:

```bash
npx @quiltdata/benchling-webhook@latest --help    # Show all commands
```

## Resources

- [Changelog](./CHANGELOG.md) - Version history
- [Report Issues](https://github.com/quiltdata/benchling-webhook/issues)

## License

Apache-2.0
