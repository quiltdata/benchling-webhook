# Benchling Webhook Integration for Quilt

The Benchling Webhook creates a seamless connection between [Benchling](https://www.benchling.com)'s Electronic Lab Notebook (ELN) and [Quilt](https://www.quilt.bio)'s Scientific Data Managements System (SDMS) for Amazon S3.
It not only allows you to view Benchling metadata and attachments inside Quilt packages, but also enables users to browse Quilt package descriptions from inside Benchling notebookes.

The webhook works through a [Benchling App](https://docs.benchling.com/docs/getting-started-benchling-apps) that must be installed in your Organization by a Benchling Administrator and configured to call your stack's unique webhook (see Installation, below).

## Availability

It is available in the Quilt Platform (1.65 or later) or as a standalone CDK stack via the `@quiltdata/benchling-webhook` [npm package](https://www.npmjs.com/package/@quiltdata/benchling-webhook).

## Functionality

### Auto-Packaging

![Packaged Notebook](imgs/benchling-package.png)

When scientists create notebook entries in Benchling, this webhook automatically:

- **Creates a dedicated Quilt package** for each notebook entry
- **Synchronizes metadata** from Benchling (experiment IDs, authors, etc.) into that package
- **Copies attachments** from that notebook into Amazon S3 as part of the package.
- **Enables orgnizational data discovery** by making contents available in ElasticSearch, and metadata available in Amazon Athena.

### Package Linking

![experiment_id](imgs/benchling-link.png)

In addition, Quilt users can 'tag' additional packages by setting the `experiment_id` (or a custom metadta key) to the display ID of a Benchling notebook, e.g., `EXP00001234`.

From inside the Quilt Catalog:

1. Navigate to the package of interest
2. Click 'Revise Package'
3. Go the metadata editor in the bottom left
4. In the bottom row, enter `experiment_id` as key and the display ID as the value.
5. Set the commit message and click 'Save'

### Benchling App Canvas

![App Canvas - Home](imgs/benchling-canvas.png)

The webhook includes a Benchling App Canvas, which allows Benchling users to view, browse, and sync the associated Quilt packages.

- Clicking the package name opens it in the Quilt Catalog
- The `sync` button will open the package or file in [QuiltSync](https://www.quilt.bio/quiltsync), if you have it installed.
- The `Update` button refreshes the package, as Benchling only notifies Quilt of changes when the metadata fields are modified.

The canvas also allows you to browse package contents:

![App Canvas - Browse](imgs/benchling-browse.png)

and view package metadata:

![App Canvas - Metadata](imgs/benchling-browse.png)

#### Inserting a Canvas

If the App Canvas is not already part of your standard notebook template, Benchling users can add it themselves:

1. Create a notebook entry
2. Select "Insert" → "Canvas"
3. Choose "Quilt Package"
4. After it is inserted, click the "Create" button

![App Canvas - Insert](imgs/benchling-insert.png)

## Architecture

AWS CDK application with simple, reliable webhook processing:

```text
Benchling Webhook
        |
        | HTTPS POST
        v
REST API Gateway v1 + Resource Policy
        | (optional IP filtering)
        v
VPC Link
        |
        v
Network Load Balancer
        | (internal)
        v
ECS Fargate (Gunicorn + FastAPI)
        |
        | Multi-worker ASGI server
        | HMAC signature verification
        | Process webhook payload
        |
        +---> NAT Gateway ---> Internet (Benchling API, ECR)
        |
        v
S3 + SQS → Quilt Package
```

### Components

- **REST API Gateway v1** - Public HTTPS endpoint with CloudWatch logging and resource policies
- **Resource Policy** - Free IP allowlisting (applied when `webhookAllowList` configured)
- **VPC Link** - Private connection between API Gateway and VPC
- **Network Load Balancer** - Internal load balancer with health checks
- **ECS Fargate** - Gunicorn + FastAPI application (4 workers, auto-scales 2-10 tasks) with HMAC verification
- **NAT Gateway** - Enables ECS tasks to access external services (Benchling API, ECR, Secrets Manager)
- **S3** - Payload and package storage
- **SQS** - Quilt package creation queue
- **Secrets Manager** - Benchling OAuth credentials
- **CloudWatch** - Centralized logging and monitoring

### Cost Analysis

**Monthly Fixed Costs (us-east-1):**

- REST API v1: $0.00
- Resource Policy: $0.00 (free)
- VPC Link: $0.00
- Network Load Balancer: $16.20
- ECS Fargate (2 tasks): $14.50
- NAT Gateway: $32.40
- **Total: $63.10/month**

**Variable Costs:** ~$3.50 per million requests

### Security Features

**Single Authentication Layer:**

- **FastAPI HMAC Verification** - All webhook requests verified against Benchling secret
- Signatures computed over raw request body
- Invalid signatures return 403 Forbidden

**Optional Network Filtering:**

- **Resource Policy IP Filtering** - Free alternative to AWS WAF ($7/month saved)
- Blocks unknown IPs at API Gateway edge
- Health endpoints always exempt from IP filtering
- IP filtering does NOT replace authentication (it's defense-in-depth)

**Infrastructure Security:**

- Private network (ECS in private subnets, no public IPs)
- VPC Link encrypted connection between API Gateway and NLB
- TLS 1.2+ encryption on all API Gateway endpoints
- CloudWatch audit trail for HMAC verification and resource policy decisions
- Least-privilege IAM roles

## Installation

### 1. Installing the Benchling App

This requires a Benchling admin to use `npx` from [NodeJS](https://nodejs.org) version 18 or later.

#### 1.1 Generate a manifest

```bash
npx @quiltdata/benchling-webhook@latest manifest
```

This will generate an `app-manifest.yaml` file in your local folder

#### 1.2 Upload the manifest to Benchling

- Follow Benchling's [create](https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest) and [install](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app) instructions.
- Save the **App Definition ID**, **Client ID**, and **Client Secret** for the next step.

### 2. Configuring the Benchling App

Your command-line environment must have AWS credentials for the account containing your Quilt stack.
All you need to do is use `npx` to run the package:

```bash
npx @quiltdata/benchling-webhook@latest
```

The wizard will guide you through:

1. **Catalog discovery** - Detect your Quilt catalog configuration
2. **Stack validation** - Extract settings from your CloudFormation stack
3. **Credential collection** - Enter Benchling app credentials
4. **Deployment mode selection**:
   - **Integrated**: Uses your Quilt stack's built-in webhook, if any
   - **Standalone**: Deploys a separate webhook stack for testing

**Note**: Configuration is stored in `~/.config/benchling-webhook/` using the [XDG Base Directory](https://wiki.archlinux.org/title/XDG_Base_Directory) standard, supporting multiple profiles.

### 3. Configure Webhook URL

Add the webhook URL (displayed after setup) to your [Benchling app settings](https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app).

**Important**: The endpoint URL format is `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/webhook` (includes stage prefix like `/prod/webhook` or `/dev/webhook`).

### 4. Test Integration

In Benchling:

1. Create a notebook entry
2. Insert Canvas → Select "Quilt Package"
3. Click "Create"

A Quilt package will be automatically created and linked to your notebook entry.
If you run into problems, contact [Quilt Support](support@quilt.bio)

## Multi-Stack Deployments (v0.9.8+)

Starting with version 0.9.8, you can deploy **multiple webhook stacks** in the same AWS account/region. This is useful for:

- **Multi-tenant deployments** - Separate stacks for each customer
- **Environment isolation** - Dev, staging, prod in same account
- **A/B testing** - Parallel stacks with different configurations

### Profile-Based Stack Names

Each profile automatically gets its own CloudFormation stack:

```bash
# Default profile uses legacy name (backwards compatible)
npx @quiltdata/benchling-webhook@latest deploy --profile default
# Creates: BenchlingWebhookStack

# Other profiles get unique names
npx @quiltdata/benchling-webhook@latest deploy --profile sales
# Creates: BenchlingWebhookStack-sales

npx @quiltdata/benchling-webhook@latest deploy --profile customer-acme
# Creates: BenchlingWebhookStack-customer-acme
```

### Custom Stack Names

You can also specify a custom stack name in your profile configuration:

```json
{
  "deployment": {
    "stackName": "MyCustomWebhookStack",
    ...
  }
}
```

### Managing Multiple Stacks

All commands support the `--profile` flag:

```bash
# Deploy a specific profile
npx @quiltdata/benchling-webhook@latest deploy --profile sales

# Check status
npx @quiltdata/benchling-webhook@latest status --profile sales

# View logs
npx @quiltdata/benchling-webhook@latest logs --profile sales

# Destroy stack
npx @quiltdata/benchling-webhook@latest destroy --profile sales
```

### Migration from Single Stack

Existing "default" profile deployments continue to use `BenchlingWebhookStack` with no changes required. New profiles automatically get unique stack names.

## Monitoring

### CloudWatch Logs

- `/aws/apigateway/benchling-webhook-rest` - API Gateway access logs
- `/ecs/benchling-webhook` - ECS container logs (includes HMAC verification)

**Note**: Resource Policy filtering happens at the API Gateway edge and is visible in access logs (403 responses for blocked IPs).

### View Logs

```bash
# Via AWS CLI
aws logs tail /aws/apigateway/benchling-webhook-rest --follow
aws logs tail /ecs/benchling-webhook --follow

# Via NPX (all logs combined)
npx @quiltdata/benchling-webhook@latest logs --profile default
```

## Additional Commands

```bash
# Deploy without re-running setup
npx @quiltdata/benchling-webhook@latest deploy [--profile <name>]

# Check CloudFormation stack status
npx @quiltdata/benchling-webhook@latest status [--profile <name>]

# View CloudWatch logs
npx @quiltdata/benchling-webhook@latest logs [--profile <name>]

# Destroy stack
npx @quiltdata/benchling-webhook@latest destroy [--profile <name>]

# Show all available commands
npx @quiltdata/benchling-webhook@latest --help
```

## Upgrading

### From v1.0.0 (HTTP API v2 + Lambda Authorizer)

Version 0.8.9+ uses REST API v1 + Resource Policy architecture instead of HTTP API v2. This is a **breaking change that requires stack recreation**.

**Why the change?** REST API v1 + Resource Policy saves $5.10/month by eliminating AWS WAF costs while maintaining the same security model.

**Quick migration:**

```bash
# 1. Backup configuration
cp ~/.config/benchling-webhook/{profile}/config.json ~/backup-config.json

# 2. Destroy old stack
npx cdk destroy --profile {profile} --context stage={stage}

# 3. Deploy new stack
npm run deploy:{stage} -- --profile {profile} --yes

# 4. Update webhook URL in Benchling (now includes stage prefix: /prod/webhook)

# 5. Test
npm run test:{stage} -- --profile {profile}
```

See [MIGRATION.md](./MIGRATION.md) for detailed upgrade instructions.

## License

Apache-2.0
