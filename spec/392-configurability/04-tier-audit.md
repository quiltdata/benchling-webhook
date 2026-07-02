# Configuration Audit: Settings → Tier Mapping

Every configuration parameter across the entire system, where it originates, where it's consumed, and which tier it belongs in under the new three-tier model.

---

## Tier Definitions

| Tier | Storage | Editable by | Changes take effect | Used for |
|------|---------|-------------|-------------------|----------|
| **1 — Benchling App Config** | Benchling App Configuration Items | Benchling admins via UI | Next webhook event (no redeploy) | Routing rules, feature flags, per-project config |
| **2 — AWS Secrets Manager** | AWS Secrets Manager secret | AWS console / `sync-secrets --force` | ECS restart | Sensitive credentials, package config |
| **3 — Env Vars / CDK** | ECS task definition (CDK) | `npm run deploy` | Stack update (redeploy) | Infrastructure endpoints, fixed deployment config |

### Guiding principle

Move settings to the *highest tier that fits their sensitivity and change frequency*:
- Changes frequently? → Tier 1 (no redeploy)
- Sensitive but changes occasionally? → Tier 2 (secret rotation)
- Infrastructure endpoint / rarely changes? → Tier 3 (deploy-time)

---

## Complete Audit

### A. Secrets Manager Secret (`BenchlingSecretData`)

Location: `docker/src/secrets_manager.py` lines 48–88 (Python dataclass)  
Synced from: `bin/commands/sync-secrets.ts` lines 292–308  
Read by: `config.get_benchling_secrets()` at runtime

| Field (secret JSON key) | Mapped from ProfileConfig | Current use | Proposed tier | Rationale |
|-------------------------|--------------------------|-------------|---------------|-----------|
| `tenant` | `benchling.tenant` | Benchling API auth | **2 — Secrets Manager** | Sensitive — tenant URL |
| `client_id` | `benchling.clientId` | OAuth client ID | **2 — Secrets Manager** | Sensitive credential |
| `client_secret` | `benchling.clientSecret` | OAuth client secret | **2 — Secrets Manager** | Sensitive credential |
| `app_definition_id` | `benchling.appDefinitionId` | Webhook HMAC verification | **2 — Secrets Manager** | Security — ties webhook to app |
| `user_bucket` | `packages.bucket` | S3 destination for packages | **2 → 1** (routing) | Should live in Tier 1 routing rules per-project |
| `pkg_prefix` | `packages.prefix` | S3 key prefix | **2 → 1** (routing) | Per-project prefix should be in Tier 1 |
| `pkg_key` | `packages.metadataKey` | Metadata linking key | **2 → 1** (routing) | Per-project metadata key in Tier 1 |
| `workflow` | `packages.workflow` | Quilt workflow name | **2 → 1** (routing) | Workflow selection = routing rule, belongs in Tier 1 |
| `log_level` | `logging.level` | Python log level | **1 — App Config** | Operators change without redeploy |
| `enable_webhook_verification` | `security.enableVerification` | HMAC verification toggle | **2 — Secrets Manager** | Security setting — stays with credentials |
| `queue_url` | *(legacy, unused)* | SQS queue URL | **3 — Env Var** | Already overridden by env var in v0.8.0+ |

### B. Environment Variables (Set by CDK FargateService)

Location: `lib/fargate-service.ts` lines 278–316  
Read by: `docker/src/config.py` and other Python modules

| Env var | Source (CDK parameter) | Read by | Current use | Proposed tier | Rationale |
|---------|----------------------|---------|-------------|---------------|-----------|
| `AWS_REGION` | `config.deployment.region` | `config.py`, SDK clients | AWS region for all boto3 calls | **3 — Env Var** | Infrastructure — never changes per deployment |
| `AWS_DEFAULT_REGION` | `config.deployment.region` | boto3 default | AWS region fallback | **3 — Env Var** | Same as above |
| `PORT` | hardcoded `"8080"` | uvicorn/gunicorn | HTTP server port | **3 — Env Var** | Internal container port |
| `QUILT_WEB_HOST` | `CfnParameter QuiltWebHost` → `config.quilt.catalog` | `config.py` | Quilt catalog URL for links | **3 — Env Var** | Infrastructure endpoint |
| `ATHENA_USER_DATABASE` | `CfnParameter AthenaUserDatabase` → `config.quilt.database` | `config.py`, `package_query.py` | Glue/Athena database name | **3 — Env Var** | Infrastructure — Glue DB name |
| `ATHENA_USER_WORKGROUP` | `CfnParameter AthenaUserWorkgroup` | `config.py`, `package_query.py` | Athena workgroup | **3 → 1?** | Could be per-project, but fine as env var |
| `PACKAGER_SQS_URL` | `CfnParameter PackagerQueueUrl` → `config.quilt.queueUrl` | `config.py` | SQS queue for package creation | **3 — Env Var** | Infrastructure — queue URL |
| `BenchlingSecret` | `CfnParameter BenchlingSecretARN` → secret name | `config.py` | Secrets Manager secret name | **3 — Env Var** | Ties task to secret; changes with secret rotation |
| `ENABLE_WEBHOOK_VERIFICATION` | hardcoded `"true"` | `config.py`, `app.py` | HMAC verification | **2 — Secret** | Overrides secret value; keep in sync |
| `APP_ENV` | hardcoded `"production"` | `config.py`, `app.py` | JSON vs console logging | **3 — Env Var** | Deployment mode |
| `LOG_LEVEL` | `CfnParameter LogLevel` | `config.py`, `app.py` | Python log level | **1 — App Config** | Already in secret; should be primary source |
| `PACKAGE_EVENT_QUEUE_URL` | from `packageEventQueue.queueUrl` | `sqs_consumer.py` | Package event SQS queue | **3 — Env Var** | Created by stack, fixed |
| `PACKAGE_EVENT_CONCURRENCY` | hardcoded `"5"` | `sqs_consumer.py` | Concurrent event processing | **1 — App Config** | Tuning parameter |
| `PACKAGE_EVENT_GRACEFUL_TIMEOUT` | hardcoded `"30"` | `sqs_consumer.py` | Shutdown grace period | **3 — Env Var** | Infrastructure — container config |
| `PACKAGING_REQUEST_QUEUE_URL` | from `packagingRequestQueue.queueUrl` | `packaging_consumer.py`, `packaging_publisher.py` | FIFO packaging queue | **3 — Env Var** | Created by stack, fixed |
| `PACKAGING_REQUEST_CONCURRENCY` | hardcoded `"5"` | `packaging_consumer.py` | Concurrent packaging | **1 — App Config** | Tuning parameter |
| `PACKAGING_REQUEST_GRACEFUL_TIMEOUT` | hardcoded `"30"` | `packaging_consumer.py` | Shutdown grace period | **3 — Env Var** | Infrastructure — container config |
| `QUILT_WRITE_ROLE_ARN` | *(from StackConfig)* | `config.py`, `entry_packager.py` | Cross-account IAM role | **3 — Env Var** | Infrastructure — IAM role ARN |

### C. CloudFormation Parameters (CDK Stack)

Location: `lib/benchling-webhook-stack.ts` lines 84–148

| CfnParameter | StackConfig field | Default | Overridable via deploy | Notes |
|-------------|-------------------|---------|----------------------|-------|
| `PackagerQueueUrl` | `quilt.queueUrl` | from config | Yes | Passes SQS URL to Fargate |
| `AthenaUserDatabase` | `quilt.database` | from config | Yes | Glue DB name |
| `QuiltWebHost` | `quilt.catalog` | from config | Yes | Catalog domain |
| `AthenaUserWorkgroup` | *(none — legacy)* | `""` | Yes | Workgroup name |
| `BenchlingSecretARN` | `benchling.secretArn` | from config | Yes | Secret ARN |
| `LogLevel` | *(none — legacy)* | `"INFO"` | Yes | Fallback log level |
| `ImageTag` | `deployment.imageTag` | `"latest"` | Yes | Docker image |
| `PackageBucket` | *(from `packages.bucket`)* | `""` | Yes | Bucket for IAM |
| `QuiltDatabase` | `quilt.database` | from config | Yes | Same as AthenaUserDatabase |

All stay **Tier 3** — these are infrastructure-level parameters controlling what the CDK stack provisions.

### D. ProfileConfig (XDG Config File ~ `config.json`)

Location: `lib/types/config.ts` interface `ProfileConfig`  
Written by: Setup wizard (`bin/commands/setup-wizard.ts`)  
Read by: `deploy.ts`, `sync-secrets.ts`

| Section | Field | Used by | Proposed tier | Notes |
|---------|-------|---------|---------------|-------|
| `quilt` | `stackArn` | deploy.ts — resolves service endpoints | **3** (profile field) | Deploy-time only |
| `quilt` | `catalog` | CDK → env var → runtime | **3 → env var** | Infrastructure endpoint |
| `quilt` | `database` | CDK → env var → runtime | **3 → env var** | Infrastructure |
| `quilt` | `queueUrl` | CDK → env var → runtime | **3 → env var** | Infrastructure |
| `quilt` | `region` | CDK → env var → runtime | **3 → env var** | Infrastructure |
| `quilt` | `bucketWritePolicyArn` | CDK — IAM policy | **3** (profile field) | Deploy-time IAM |
| `quilt` | `athenaUserPolicyArn` | CDK — IAM policy | **3** (profile field) | Deploy-time IAM |
| `benchling` | `tenant` | `sync-secrets` → secret | **2 → secret** | Sensitive |
| `benchling` | `clientId` | `sync-secrets` → secret | **2 → secret** | Sensitive |
| `benchling` | `clientSecret` | `sync-secrets` → secret | **2 → secret** | Sensitive |
| `benchling` | `secretArn` | CDK → env var → runtime | **3** (profile field) | Reference to Tier 2 |
| `benchling` | `appDefinitionId` | `sync-secrets` → secret | **2 → secret** | Security |
| `packages` | `bucket` | CDK (IAM) + `sync-secrets` → secret | **2 → secret** IAM part stays **3**, routing moves to **1** | Dual-use: IAM + routing |
| `packages` | `prefix` | `sync-secrets` → secret → runtime | **1 → routing** | Per-project config |
| `packages` | `metadataKey` | `sync-secrets` → secret → runtime | **1 → routing** | Per-project config |
| `packages` | `workflow` | `sync-secrets` → secret → runtime | **1 → routing** | Per-project config |
| `deployment` | `region` | CDK stack env | **3** (profile field) | Infrastructure |
| `deployment` | `account` | CDK stack env | **3** (profile field) | Infrastructure |
| `deployment` | `imageTag` | CDK → env var | **3** (profile field) | Deploy-time |
| `deployment` | `stackName` | CDK stack name | **3** (profile field) | Deploy-time |
| `deployment` | `vpc.*` | CDK VPC construct | **3** (profile field) | Infrastructure |
| `logging` | `level` | `sync-secrets` → secret → runtime | **1 → app config** | Operators tune log level |
| `security` | `webhookAllowList` | CDK — API Gateway policy | **3** (profile field) | Infrastructure — IP filtering |
| `security` | `enableVerification` | `sync-secrets` → secret | **2 → secret** | Security toggle |
| `_metadata` | *(all)* | Wizard tracking only | — (metadata) | Not a config setting |
| `integratedStack` | flag | deploy.ts — mode check | **3** (profile field) | Deployment mode |

### E. Runtime Config Fields (Python `Config` dataclass)

Location: `docker/src/config.py` lines 40–65

| Config field | Env var | Also set from secret? | Proposed tier | Notes |
|-------------|---------|----------------------|---------------|-------|
| `app_env` | `APP_ENV` | No | **3 — Env Var** | Deployment mode |
| `log_level` | `LOG_LEVEL` | Yes (secret overrides) | **1 — App Config** | Primary: secret; override: env var |
| `aws_region` | `AWS_REGION` | No | **3 — Env Var** | Infrastructure |
| `s3_bucket_name` | *(none)* | Yes (`user_bucket`) | **1 → routing** | Should come from Tier 1 |
| `s3_prefix` | *(none)* | Yes (`pkg_prefix`) | **1 → routing** | Should come from Tier 1 |
| `package_key` | *(none)* | Yes (`pkg_key`) | **1 → routing** | Should come from Tier 1 |
| `quilt_catalog` | `QUILT_WEB_HOST` | No | **3 — Env Var** | Infrastructure |
| `quilt_database` | `ATHENA_USER_DATABASE` | No | **3 — Env Var** | Infrastructure |
| `queue_url` | `PACKAGER_SQS_URL` | No | **3 — Env Var** | Infrastructure |
| `athena_user_workgroup` | `ATHENA_USER_WORKGROUP` | No | **3 — Env Var** | Infrastructure |
| `enable_webhook_verification` | `ENABLE_WEBHOOK_VERIFICATION` | Yes (secret) | **2 — Secret** | Security toggle |
| `pkg_prefix` | *(none)* | Yes (`pkg_prefix`) | **1 → routing** | Same as s3_prefix |
| `workflow` | *(none)* | Yes (`workflow`) | **1 → routing** | Per-project workflow |
| `quilt_write_role_arn` | `QUILT_WRITE_ROLE_ARN` | No | **3 — Env Var** | IAM role ARN |

---

## Summary: What Moves Where

| Setting | Currently lives in | Moves to | Reason |
|---------|------------------|----------|--------|
| `packages.bucket` → routing | Secret → config.py | **Tier 1** (per-project) | Bucket per project, operators change without redeploy |
| `packages.prefix` | Secret → config.py | **Tier 1** (per-project) | Prefix per project |
| `packages.metadataKey` | Secret → config.py | **Tier 1** (per-project) | Per-project linking key |
| `packages.workflow` | Secret → config.py | **Tier 1** (per-project) | Per-project workflow |
| `logging.level` | Secret → config.py | **Tier 1** (app config) | Tuning — no redeploy needed |
| `PACKAGE_EVENT_CONCURRENCY` | Hardcoded in env vars | **Tier 1** (app config) | Tuning parameter |
| `PACKAGING_REQUEST_CONCURRENCY` | Hardcoded in env vars | **Tier 1** (app config) | Tuning parameter |
| Everything else | Env vars / Secret | **Stay where they are** | Infrastructure or sensitive |

### Remaining in ProfileConfig only (never reach runtime)

These are deploy-time or wizard-only fields that don't need to move:

- `quilt.stackArn` — deploy-time resolution only
- `quilt.bucketWritePolicyArn` — CDK IAM attachment, deploy-time
- `quilt.athenaUserPolicyArn` — CDK IAM attachment, deploy-time
- `deployment.*` — infrastructure topology (region, account, VPC, image tag)
- `security.webhookAllowList` — API Gateway resource policy, deploy-time
- `_metadata` — provenance tracking
- `integratedStack` — deployment mode flag

---

## Migration Path

### Phase 1: Tier 1 read-side (no config writes yet)

1. The Python app already has a `benchling` SDK client at runtime
2. Add a method to fetch App Configuration Items at startup: `benchling.apps.list_app_configuration_items(app_id=...)`
3. Parse routing rules from items with `path[0] == "routing"` or `path[0] == "projects"`
4. Fall back to current secret-based values for any missing rules
5. No changes to deploy flow or secret sync

### Phase 2: Tier 1 write-side (populate config items)

1. Add an option to the setup wizard or a CLI command to seed App Configuration Items
2. Alternatively, seed via a one-time migration from existing secret values
3. Document how Benchling admins edit items in the Benchling UI

### Phase 3: Make Tier 1 authoritative

1. Change the runtime to read routing values from Tier 1 first, secret as fallback
2. Eventually stop syncing routing fields (`user_bucket`, `pkg_prefix`, `pkg_key`, `workflow`) to Secrets Manager
3. Keep `tenant`, `client_id`, `client_secret`, `app_definition_id` in Secrets Manager permanently
