# Current Configuration Mechanisms

This document catalogs every configuration mechanism in the Benchling webhook system today — what stores the data, what reads it, and how values flow from one layer to the next.

---

## Overview: Three Layers, Three Formats

Configuration lives at three distinct layers, each with its own format and lifecycle:

| Layer | Storage | Format | Created by | Read by |
|-------|---------|--------|------------|---------|
| **1. ProfileConfig** | `~/.config/benchling-webhook/{profile}/config.json` | JSON, `ProfileConfig` interface | Setup wizard (`bin/commands/setup-wizard.ts`) | Deploy script, sync-secrets, CDK synth |
| **2. Secrets Manager** | AWS Secrets Manager secret | JSON, `BenchlingSecretData` fields | `sync-secrets.ts` | Python app at runtime |
| **3. Environment variables** | ECS task definition / docker-compose | String key-value pairs | `FargateService` construct (CDK) | Python `Config.__post_init__()` |

The flow is one-directional at deploy time: **ProfileConfig → StackConfig → CloudFormation → ECS env vars → Python Config**. At runtime, only Secrets Manager is queried dynamically.

---

## Layer 1: XDG Profile Configuration (`ProfileConfig`)

### Location

```
~/.config/benchling-webhook/{profile}/config.json
```

Managed by [`XDGConfig`](../../lib/xdg-config.ts) (TypeScript). The Python side has a read-only mirror in [`xdg_config.py`](../../docker/src/xdg_config.py) but it is *not* used at runtime — it only exists for CLI tooling compatibility.

### Schema

Defined as `ProfileConfig` in [`lib/types/config.ts`](../../lib/types/config.ts) (lines 79–134):

```typescript
interface ProfileConfig {
  quilt:        QuiltConfig;      // catalog, database, queueUrl, region, bucketWritePolicyArn…
  benchling:    BenchlingConfig;  // tenant, clientId, clientSecret?, secretArn?, appDefinitionId
  packages:     PackageConfig;    // bucket, prefix, metadataKey, workflow?
  deployment:   DeploymentConfig; // region, account?, ecrRepository?, imageTag?, vpc?
  integratedStack?: boolean;
  logging?:     LoggingConfig;    // level: "DEBUG"|"INFO"|"WARNING"|"ERROR"
  security?:    SecurityConfig;   // webhookAllowList, enableVerification
  _metadata:    ConfigMetadata;   // version, createdAt, updatedAt, source
  _inherits?:   string;           // profile inheritance
}
```

Key points:
- **16+ nested fields**, many optional
- Contains wizard metadata (`_metadata`, `_inherits`) that the CDK stack never reads
- The `packages` sub-object duplicates fields later stored in Secrets Manager (`bucket`, `prefix`, `metadataKey`, `workflow`)
- Written **only** by the setup wizard; operators can hand-edit

### Consumers

1. **`bin/commands/deploy.ts`** — reads ProfileConfig, transforms to StackConfig, synthesizes CDK app
2. **`bin/commands/sync-secrets.ts`** — reads ProfileConfig to build the Secrets Manager payload
3. **`bin/cli.ts`** (setup/destroy commands) — reads ProfileConfig for parameter defaults

---

## Layer 2: AWS Secrets Manager

### What's Stored

A single JSON secret per profile, structured as `BenchlingSecretData` ([`docker/src/secrets_manager.py`](../../docker/src/secrets_manager.py), lines 48–88):

```python
@dataclass
class BenchlingSecretData:
    tenant: str                      # Benchling subdomain
    client_id: str                   # OAuth client ID
    client_secret: str               # OAuth client secret (sensitive)
    app_definition_id: str           # App definition for webhook verification
    pkg_prefix: str                  # Quilt package name prefix
    pkg_key: str                     # Metadata key (e.g. "experiment_id")
    user_bucket: str                 # S3 bucket for Benchling exports
    log_level: str                   # "DEBUG"|"INFO"|"WARNING"|"ERROR"
    enable_webhook_verification: bool
    workflow: str = ""               # Optional Quilt workflow name
    queue_url: str = ""              # Optional (v0.8.0+ uses env var instead)
```

Note: `workflow` is an *optional* field in the secret — this is the *only* existing mechanism for specifying a Quilt workflow, which relates to the "configurable workflows" theme of issue #392.

### How It's Created

- **`bin/commands/sync-secrets.ts`** (`buildSecretValue()`, line 292) assembles the JSON from `ProfileConfig` fields:
  - `config.benchling.tenant` → `tenant`
  - `config.benchling.clientId` → `client_id`
  - `config.packages.bucket` → `user_bucket`
  - `config.packages.prefix` → `pkg_prefix`
  - `config.packages.metadataKey` → `pkg_key`
  - `config.packages.workflow` → `workflow` (only if present)
  - `config.logging.level` → `log_level`
  - `config.security.webhookAllowList` → `webhook_allow_list`
  - `config.security.enableVerification` → `enable_webhook_verification`

### How It's Read at Runtime

- **`docker/src/config.py`** — `Config.__post_init__()` stores the secret name from env var `BenchlingSecret`, then `get_benchling_secrets()` fetches from Secrets Manager with a 60-second TTL cache and background refresh
- **`docker/src/secrets_manager.py`** — `fetch_benchling_secret()` does the actual `get_secret_value` call, validating all required fields and parsing boolean/log-level values

### Deployment-time Verification

The deploy script ([`bin/commands/deploy.ts`](../../bin/commands/deploy.ts), line 359) calls `syncSecretsToAWS()` with `force: false` to verify the secret exists without overwriting it. The CDK stack never creates secrets — it only references the ARN via CloudFormation parameter.

### Secret Lifecycle

| Action | When | How |
|--------|------|-----|
| **Created** | During `setup` or `deploy` | `sync-secrets.ts:createSecret()` |
| **Updated** | `deploy --force` or manual `sync-secrets --force` | `sync-secrets.ts:updateSecret()` |
| **Read (runtime)** | Every request (with 60s TTL cache) | `secrets_manager.py:fetch_benchling_secret()` |
| **Rotated** | Update secret → ECS service restart | `restartECSServicesUsingSecret()` detects affected services |

---

## Layer 3: Environment Variables (Runtime Config)

### How They're Set

The CDK `FargateService` construct ([`lib/fargate-service.ts`](../../lib/fargate-service.ts), lines 278–303) builds an environment variable map for the ECS task definition:

```typescript
const environmentVars = {
  AWS_REGION: region,
  AWS_DEFAULT_REGION: region,
  PORT: "8080",

  // Quilt services (resolved at deploy time)
  QUILT_WEB_HOST: props.quiltWebHost,           // from config.quilt.catalog
  ATHENA_USER_DATABASE: props.athenaUserDatabase, // from config.quilt.database
  ATHENA_USER_WORKGROUP: props.athenaUserWorkgroup || "primary",
  PACKAGER_SQS_URL: props.packagerQueueUrl,     // from config.quilt.queueUrl

  // Benchling secret reference
  BenchlingSecret: extractSecretName(props.benchlingSecret),  // secret name, not ARN

  // Security
  ENABLE_WEBHOOK_VERIFICATION: "true",           // hardcoded default

  // Application
  APP_ENV: "production",
  LOG_LEVEL: props.logLevel || "INFO",
};
```

Additional SQS queue URLs are added when the queues exist:
- `PACKAGE_EVENT_QUEUE_URL`
- `PACKAGING_REQUEST_QUEUE_URL`

### How They're Read

In the Python FastAPI app, `Config.__post_init__()` ([`docker/src/config.py`](../../docker/src/config.py), lines 92–156) reads these env vars:

| Env var | Config field | Required | Notes |
|---------|-------------|----------|-------|
| `QUILT_WEB_HOST` | `quilt_catalog` | Yes | Quilt catalog domain |
| `ATHENA_USER_DATABASE` | `quilt_database` | Yes | Glue/Athena database |
| `PACKAGER_SQS_URL` | `queue_url` | Yes | SQS queue for packages |
| `AWS_REGION` | `aws_region` | Yes | AWS region |
| `BenchlingSecret` | `_benchling_secret_name` | Yes | Secrets Manager secret name |
| `LOG_LEVEL` | `log_level` | No | Default: "INFO" |
| `APP_ENV` | `app_env` | No | Default: "production" |
| `ENABLE_WEBHOOK_VERIFICATION` | `enable_webhook_verification` | No | Default: true |
| `ATHENA_USER_WORKGROUP` | `athena_user_workgroup` | No | Default: "primary" |
| `QUILT_WRITE_ROLE_ARN` | `quilt_write_role_arn` | No | Cross-account S3 access |
| `PACKAGE_EVENT_QUEUE_URL` | (used directly) | No | Package event SQS |
| `PACKAGING_REQUEST_QUEUE_URL` | (used directly) | No | Packaging request SQS |

### Dual-Source Configuration

The runtime `Config` class uses a **hybrid** approach:

1. **AWS/Quilt configuration** comes from environment variables (set by CDK at deploy time)
2. **Package/Benchling configuration** comes from Secrets Manager (fetched on-demand at runtime with 60s TTL cache)

This means changes to `pkg_prefix`, `pkg_key`, `user_bucket`, `workflow`, `log_level`, or `enable_webhook_verification` can be made by updating the Secrets Manager secret without redeploying the stack (the ECS service must be restarted to pick up the change via `restartECSServicesUsingSecret()`).

---

## Layer 4: CDK Stack Configuration (`StackConfig`)

The `StackConfig` interface ([`lib/types/stack-config.ts`](../../lib/types/stack-config.ts)) is the **minimal subset** of `ProfileConfig` that the CDK stack actually needs:

```typescript
interface StackConfig {
  benchling: { secretArn: string };
  quilt: {
    catalog: string;
    database: string;
    queueUrl: string;
    region: string;
    bucketWritePolicyArn?: string;
    athenaUserPolicyArn?: string;
  };
  deployment: {
    region: string;
    imageTag?: string;
    vpc?: VpcConfig;
    stackName?: string;
  };
  security?: {
    webhookAllowList?: string;
  };
}
```

Transformation happens in `profileToStackConfig()` ([`lib/utils/config-transform.ts`](../../lib/utils/config-transform.ts)), called from `deploy.ts` line 768.

The stack itself creates **CloudFormation parameters** with StackConfig values as defaults (see `benchling-webhook-stack.ts` lines 84–148). This allows CloudFormation `--parameters` overrides at deploy time — those override values are what actually reach the container at runtime.

### CDK Parameter → Env Var Flow

```
StackConfig → CfnParameter (default) → deploy.ts --parameters override
    → FargateService environmentVars → ECS task definition
    → Python Config.__post_init__()
```

At runtime there are **no CloudFormation API calls**. All service endpoints are resolved at deploy time and baked into environment variables.

---

## Layer 5: Local Development Configuration

### docker-compose.yml

The [`docker/docker-compose.yml`](../../docker/docker-compose.yml) mirrors the production env var set but sources values from the shell environment (via `${VAR}` interpolation):

```yaml
environment:
  - APP_ENV=production
  - LOG_LEVEL=${LOG_LEVEL:-INFO}
  - AWS_REGION=${AWS_REGION:-us-east-2}
  - QUILT_WEB_HOST=${QUILT_WEB_HOST}
  - ATHENA_USER_DATABASE=${ATHENA_USER_DATABASE}
  - PACKAGER_SQS_URL=${PACKAGER_SQS_URL}
  - BenchlingSecret=${BenchlingSecret}
  - ENABLE_WEBHOOK_VERIFICATION=${ENABLE_WEBHOOK_VERIFICATION:-true}
```

The `app-dev` service (profile: `dev`) defaults to `LOG_LEVEL=DEBUG` and `ENABLE_WEBHOOK_VERIFICATION=false`.

The test harness (`npm run test:local`) sets these env vars from the local XDG config.

### XDG CLI Tools (Python)

The Python `xdg_config.py` module provides read-only access to XDG config files but is **not used at runtime** — it exists for CLI utilities `xdg_cli.py` and tests.

---

## Configuration Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     Setup Wizard                             │
│  bin/commands/setup-wizard.ts                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Discover Quilt stack (CloudFormation)             │   │
│  │ 2. Prompt for Benchling credentials                  │   │
│  │ 3. Validate against Benchling API                    │   │
│  │ 4. Discover VPC resources (EC2)                      │   │
│  │ 5. Store ProfileConfig → ~/.config/.../{profile}/   │   │
│  │ 6. Sync secret → AWS Secrets Manager                  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ ProfileConfig (XDG JSON file)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Deploy Script                            │
│  bin/commands/deploy.ts                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Read ProfileConfig from XDG                        │   │
│  │ 2. Verify/manage Secrets Manager secret               │   │
│  │ 3. Transform ProfileConfig → StackConfig              │   │
│  │ 4. Call createStack() (CDK synth, no subprocess)      │   │
│  │ 5. npx cdk deploy with --parameters                    │   │
│  │ 6. Record deployment in XDG deployments.json          │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ CloudFormation Stack
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     CDK Stack (synth time)                    │
│  bin/benchling-webhook.ts → lib/benchling-webhook-stack.ts   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ StackConfig → CfnParameters → FargateService         │   │
│  │ → Environment variables → ECS task definition         │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ ECS container environment
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Python Runtime                           │
│  docker/src/config.py                                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Config.__post_init__():                                │   │
│  │   • Read env vars (QUILT_WEB_HOST, etc.)              │   │
│  │   • Store secret name from BenchlingSecret env var    │   │
│  │   • Initialize Secrets Manager client                 │   │
│  │                                                        │   │
│  │ get_benchling_secrets():                               │   │
│  │   • Fetch from Secrets Manager (60s TTL cache)        │   │
│  │   • Return tenant, client_id, user_bucket, etc.       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Constraints for Issue #392

### 1. Secrets Manager is the *only* dynamic config

At runtime, the only configuration value that changes without redeploy is the Secrets Manager secret. Everything else (env vars) is baked into the ECS task definition at deploy time. If we want "configurable workflows" that operators can change without redeploying, the workflow configuration must live in the Secrets Manager secret or be fetched from another source at runtime.

### 2. ProfileConfig is the single source of truth at deploy time

The XDG config file drives the entire deploy pipeline. Any new configurability that affects infrastructure (e.g., multiple S3 buckets that need IAM permissions) must be represented in `ProfileConfig` (and by extension `StackConfig`) so the CDK stack can provision the right resources.

### 3. Package configuration is bifurcated

- `packages.bucket` — appears in `ProfileConfig` (used by deploy for IAM) and also in `secrets_manager.py` as `user_bucket` (used at runtime for writes)
- `packages.prefix` — in `ProfileConfig` and in Secrets Manager as `pkg_prefix`
- `packages.metadataKey` — in `ProfileConfig` and in Secrets Manager as `pkg_key`
- `packages.workflow` — only in Secrets Manager (not in `ProfileConfig`/`StackConfig`)

This duplication means changes must be coordinated. The `workflow` field especially is invisible to the CDK layer.

### 4. Local dev reproduces the env var contract

`docker-compose.yml` sources env vars from the shell, which means local development reproduces the exact same env var contract that production ECS tasks see. Any new env var for configurability must be added to both `fargate-service.ts` and `docker-compose.yml`.

---

## Related Files

| File | Role |
|------|------|
| [`lib/types/config.ts`](../../lib/types/config.ts) | `ProfileConfig` interface + JSON Schema |
| [`lib/types/stack-config.ts`](../../lib/types/stack-config.ts) | `StackConfig` interface (minimal CDK input) |
| [`lib/utils/config-transform.ts`](../../lib/utils/config-transform.ts) | `ProfileConfig → StackConfig` transformation |
| [`lib/xdg-config.ts`](../../lib/xdg-config.ts) | XDG filesystem read/write (TypeScript) |
| [`lib/xdg-base.ts`](../../lib/xdg-base.ts) | Abstract XDG storage primitives |
| [`lib/benchling-webhook-stack.ts`](../../lib/benchling-webhook-stack.ts) | CDK stack — creates CfnParameters from StackConfig |
| [`lib/fargate-service.ts`](../../lib/fargate-service.ts) | ECS task definition — builds env vars from stack props |
| [`bin/commands/deploy.ts`](../../bin/commands/deploy.ts) | Deploy orchestrator — reads ProfileConfig, calls createStack |
| [`bin/commands/sync-secrets.ts`](../../bin/commands/sync-secrets.ts) | Secrets Manager sync — builds payload from ProfileConfig |
| [`bin/benchling-webhook.ts`](../../bin/benchling-webhook.ts) | `createStack()` library entry point |
| [`docker/src/config.py`](../../docker/src/config.py) | Python runtime Config — reads env vars, fetches secrets |
| [`docker/src/config_provider.py`](../../docker/src/config_provider.py) | Request-scoped config provider with on-demand secret fetch |
| [`docker/src/secrets_manager.py`](../../docker/src/secrets_manager.py) | Secrets Manager client — `BenchlingSecretData` + fetch |
| [`docker/src/config_schema.py`](../../docker/src/config_schema.py) | Pydantic models for config validation |
| [`docker/src/xdg_config.py`](../../docker/src/xdg_config.py) | Python XDG reader (read-only, not used at runtime) |
| [`docker/docker-compose.yml`](../../docker/docker-compose.yml) | Local dev — mirrors production env var contract |
