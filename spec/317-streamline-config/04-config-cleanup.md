# Configuration Cleanup: Action Plan

## Critical Use Cases (MUST PRESERVE)

These 5 workflows define the system architecture and MUST continue to work:

### 1. Setup Wizard - Read/Write ALL Configuration
**Entry:** `bin/cli.ts setup` → `bin/commands/setup-wizard.ts`

Writes ALL discoverable/entered information to `~/.config/benchling-webhook/{profile}/config.json` (ProfileConfig):
- Benchling OAuth credentials (tenant, clientId, appDefinitionId)
- Quilt stack outputs (catalog, database, queueUrl, region)
- VPC configuration discovered via EC2 API
- Deployment settings (region, account, imageTag)
- Package settings (bucket, prefix, metadataKey)
- Security settings (enableVerification, webhookAllowList)

### 2. Secrets Manager - Store Dynamic Configuration
**Entry:** `bin/commands/sync-secrets.ts`

Creates/updates AWS Secrets Manager secrets **before stack deployment**:
- Reads ProfileConfig from XDG
- Stores Benchling OAuth credentials (clientId, clientSecret)
- Writes secret ARN back to ProfileConfig (`benchling.secretArn`)
- Stack only references existing secrets by ARN (doesn't read values)

### 3. Test Scripts - Launch Containers Locally
**Entry:** `npm run test:local` → Docker Compose

Runs FastAPI locally without CDK:
- Reads ProfileConfig from XDG
- Passes config to Docker as env vars
- FastAPI reads env vars
- **Never calls the CDK stack**

### 4. Deploy Script - Automatically Build CDK Stack
**Entry:** `bin/cli.ts deploy` → `bin/commands/deploy.ts`

Automates CDK deployment:
- Reads ProfileConfig from XDG
- Transforms to StackConfig (minimal interface)
- **Calls `createStack()` directly (library API)**
- Records deployment to `deployments.json`

### 5. Library API - Call Stack Manually
**Entry:** Import `{ createStack } from "@quiltdata/benchling-webhook"`

Programmatic CDK stack creation:
```typescript
createStack(config: StackConfig): DeploymentResult
```
- Direct TypeScript function call
- No subprocess, no IPC complexity
- Used by deploy script (#4)

---

## Root Cause

**deploy.ts spawns `npx cdk deploy` subprocess instead of calling `createStack()` directly.**

This forces the absurd flow:

- ProfileConfig → env vars → ProfileConfig reconstruction → Stack
- Stack receives bloated ProfileConfig with wizard metadata
- Testing requires mocking irrelevant fields

**Fix: Call `createStack()` directly. No subprocess. No env vars.**

## Changes Required

### 1. Create Minimal Stack Interface

**New file:** `lib/types/stack-config.ts`

Interface with only fields the stack actually uses:

- `benchling.secretArn` (string)
- `quilt.catalog`, `quilt.database`, `quilt.queueUrl`, `quilt.region` (all strings)
- `quilt.writeRoleArn` (optional string)
- `deployment.region`, `deployment.imageTag`, `deployment.vpc` (optional VpcConfig)
- `security.webhookAllowList` (optional string)

Total: ~10 fields vs current 15+ fields

### 2. Update Stack Constructors

**Files:** `lib/benchling-webhook-stack.ts`, `lib/fargate-service.ts`, `lib/rest-api-gateway.ts`

Change `config: ProfileConfig` → `config: StackConfig`

### 3. Fix Deploy Script

**File:** `bin/commands/deploy.ts`

Current (wrong):

- Converts ProfileConfig to env vars
- Spawns `npx cdk deploy` subprocess

Correct:

- Import `createStack()` function
- Call directly with StackConfig
- No subprocess, no env vars

### 4. Simplify benchling-webhook.ts

**File:** `bin/benchling-webhook.ts`

- Remove ProfileConfig reconstruction (lines 88-127)
- Build StackConfig directly from legacy Config
- Remove direct CDK CLI support (lines 153-233)

### 5. Remove Unused Fields from Stack

**Files:** `lib/benchling-webhook-stack.ts`, `lib/fargate-service.ts`

Remove these from stack props:

- `benchling.tenant`, `benchling.clientId`, `benchling.appDefinitionId` (read from secret at runtime)
- `packages.bucket`, `packages.prefix`, `packages.metadataKey` (move to secret or keep in env vars)
- `logging.level` (hardcode or pass via secret)
- `security.enableVerification` (hardcode to true)

## Key Decisions

### Decision 1: Benchling Fields Location

**Options:**

- A. Keep in secret (OAuth fields already there, add app metadata)
- B. Pass via environment variables from secret

**Recommendation:** A - Store in secret, FastAPI reads at startup

### Decision 2: Package Config Location

**Options:**

- A. Store in secret
- B. Keep as environment variables (current)
- C. Hardcode defaults

**Recommendation:** B - Keep as env vars (simplest, no secret changes needed)

### Decision 3: Deploy Script Approach

**Options:**

- A. Call `createStack()` directly
- B. Keep subprocess + env vars

**Recommendation:** A - Direct function call (no IPC complexity)

### Decision 4: Direct CDK CLI Support

**Options:**

- A. Keep for advanced users
- B. Remove entirely

**Recommendation:** B - Remove (unused escape hatch adds complexity)

## Task Checklist

- [ ] Create `lib/types/stack-config.ts` with minimal interface
- [ ] Update `lib/benchling-webhook-stack.ts` to use StackConfig
- [ ] Update `lib/fargate-service.ts` to use StackConfig
- [ ] Update `lib/rest-api-gateway.ts` to use StackConfig
- [ ] Refactor `bin/benchling-webhook.ts` createStack() function
- [ ] Remove direct CDK CLI code (lines 153-233) from `bin/benchling-webhook.ts`
- [ ] Update `bin/commands/deploy.ts` to call createStack() directly
- [ ] Remove buildCdkEnv() function from deploy.ts
- [ ] Update tests to mock StackConfig instead of ProfileConfig
- [ ] Verify XDG config (ProfileConfig) unchanged
- [ ] Run full test suite

## Appendix: Required Use Cases

These 5 workflows MUST continue to work:

### 1. Setup Wizard (Read/Write Configuration)

**Entry:** `bin/cli.ts setup` → `bin/commands/setup-wizard.ts`

- Prompts user for Benchling OAuth credentials
- Discovers Quilt stack outputs via CloudFormation API
- Discovers VPC resources via EC2 API
- Validates Benchling credentials
- **Creates secret in Secrets Manager**
- Writes ALL discoverable/entered information to `~/.config/benchling-webhook/{profile}/config.json` (ProfileConfig)

### 2. Secrets Manager (Store Dynamic Configuration)

**Entry:** `bin/commands/sync-secrets.ts`

- Reads ProfileConfig from XDG
- Creates/updates AWS Secrets Manager secrets **before stack deployment**
- Stores Benchling OAuth credentials (clientId, clientSecret)
- Secret ARN written back to ProfileConfig (`benchling.secretArn`)
- Stack only references existing secrets by ARN (doesn't read values)

### 3. Test Scripts (Launch Containers Locally)

**Entry:** `npm run test:local` → Docker Compose

- Reads ProfileConfig from XDG
- Passes config to Docker as env vars
- FastAPI reads env vars
- **Never calls the CDK stack**

### 4. Deploy Script (Automatically Build CDK Stack)

**Entry:** `bin/cli.ts deploy` → `bin/commands/deploy.ts`

**Current:** Spawns `npx cdk deploy` subprocess with env vars
**After refactor:** Import and call `createStack()` directly with StackConfig

- Reads ProfileConfig from XDG
- Transforms to StackConfig
- Deploys stack to AWS
- Records deployment to `deployments.json`

### 5. Library API (Call Stack Manually)

**Entry:** Import `{ createStack } from "@quiltdata/benchling-webhook"`

**Current interface:**
```typescript
createStack(config: Config): DeploymentResult
```

**After refactor:**
```typescript
createStack(config: StackConfig): DeploymentResult
```

- Programmatic usage for advanced users
- No subprocess, direct TypeScript function call
