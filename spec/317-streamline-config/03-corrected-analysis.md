# Configuration Flows: Corrected Analysis

## What I Got Wrong in 02-config-analysis.md

### FALSE: "Process boundary requires environment variables"

**WRONG:** I claimed deploy.ts spawns `npx cdk deploy` as a subprocess, requiring env vars as IPC.

**RIGHT:** `bin/benchling-webhook.ts` exports `createStack()` as a **TypeScript function**. The deploy script can import and call it directly with TypeScript objects. No process boundary, no IPC, no env vars.

**Evidence:** [bin/benchling-webhook.ts:84](../../bin/benchling-webhook.ts#L84)

```typescript
export function createStack(config: Config): DeploymentResult
```

This is a normal function export. Any TypeScript file can import and call it.

### FALSE: "Stack needs Benchling/Package config fields"

**WRONG:** I claimed stack needs `benchling.tenant`, `benchling.clientId`, `benchling.appDefinitionId`, `packages.bucket`, `packages.prefix`, `packages.metadataKey`.

**RIGHT:** Stack only needs `benchling.secretArn`. All Benchling OAuth fields are stored IN the secret and read by FastAPI at runtime.

**Evidence:** The secret contains the OAuth credentials. The stack just passes the secret ARN to ECS. FastAPI reads from Secrets Manager at runtime.

### FALSE: "No backward compatibility allowed"

**WRONG:** I claimed the public API `createStack(config: Config)` can't change.

**RIGHT:** This is a **closed deployment tool**, not a public library. We can change any interface we want. There are no external consumers.

## Actual Constraints (Not Imaginary Ones)

### REAL Constraint: Secrets Created Before Stack

**TRUE:** The setup wizard creates secrets in AWS Secrets Manager before deployment.

**Flow:**

1. Wizard prompts for Benchling OAuth client ID + secret
2. Wizard calls `bin/commands/sync-secrets.ts`
3. Secret created in Secrets Manager (with OAuth values)
4. Secret ARN written to ProfileConfig (`benchling.secretArn`)
5. Deploy script passes ARN to stack
6. Stack references existing secret by ARN (doesn't read values)
7. At runtime, FastAPI reads OAuth values from secret

**Why:** Stack needs the secret ARN at CDK synthesis time, so the secret must already exist. However, the secret **values** aren't read until FastAPI runtime.

### REAL Constraint: XDG Config Format

**TRUE:** Setup wizard writes ProfileConfig to `~/.config/benchling-webhook/{profile}/config.json`.

**Why:** This is the persistent storage format for wizard-discovered configuration. Changing this would break existing installations.

**Scope:** Only affects wizard reads/writes. Internal code can use different formats.

## Corrected Flow Analysis

### Flow 1: Setup Wizard (Unchanged)

**Entry:** `bin/cli.ts setup` → `bin/commands/setup-wizard.ts`

**What it does:**

- Prompts user for Benchling OAuth credentials
- Discovers Quilt stack outputs via CloudFormation API
- Discovers VPC resources via EC2 API
- Validates Benchling credentials
- **Creates secret in Secrets Manager**
- Writes ProfileConfig to `~/.config/benchling-webhook/{profile}/config.json`

**Key:** This is correct. Wizard owns the XDG config format.

### Flow 2: Deploy Script (CORRECTED)

**Entry:** `bin/cli.ts deploy` → `bin/commands/deploy.ts`

**CURRENT (wrong) implementation:**

1. Read ProfileConfig from XDG
2. Convert to environment variables
3. Spawn `npx cdk deploy` subprocess
4. `bin/benchling-webhook.ts` reads env vars
5. Reconstruct ProfileConfig
6. Pass to stack

**CORRECT implementation should be:**

1. Read ProfileConfig from XDG
2. Import `createStack` from `bin/benchling-webhook.ts`
3. Call `createStack()` with minimal config object
4. No subprocess, no env vars, no reconstruction

**Why current is wrong:** There is NO process boundary. `createStack` is an exported function.

### Flow 3: Direct CDK CLI (Drop This)

**Entry:** `npx cdk deploy` (without deploy script)

**Current:** Reads env vars and reconstructs ProfileConfig.

**Recommendation:** **Remove this entirely.** This is an "escape hatch" that nobody uses and adds complexity. Users should use `bin/cli.ts deploy`.

### Flow 4: Local Testing (Unchanged)

**Entry:** `npm run test:local` → Docker Compose

**What it does:**

- Reads ProfileConfig from XDG
- Passes config to Docker as env vars
- FastAPI reads env vars

**Key:** This never calls the CDK stack. It's independent.

## What the Stack Actually Needs

### Benchling Config

**ONLY:** `secretArn: string`

**NOT:** tenant, clientId, clientSecret, appDefinitionId, testEntryId

**Why:** All OAuth fields are stored IN the secret. FastAPI reads from Secrets Manager at runtime.

### Quilt Config

**ONLY:**

- `catalog: string` - Passed to FastAPI
- `database: string` - Passed to FastAPI
- `queueUrl: string` - Passed to FastAPI
- `region: string` - AWS region
- `writeRoleArn?: string` - IAM role for S3 access (optional)

**NOT:** stackArn (wizard-only), athenaUserPolicy, athenaResultsBucketPolicy

### Package Config

**NONE** - These should be stored in the secret or passed to FastAPI via env vars from the secret.

Currently the stack passes `packages.bucket`, `packages.prefix`, `packages.metadataKey` to FastAPI as env vars. This is probably wrong - they should come from the secret.

### Deployment Config

**ONLY:**

- `region: string` - AWS region for stack
- `imageTag?: string` - Docker image tag
- `vpc?: VpcConfig` - VPC configuration (optional)

**NOT:** account (auto-detected), stackName (determined by CLI), ecrRepository (hardcoded)

### Security Config

**ONLY:**

- `webhookAllowList?: string` - IP filtering for API Gateway resource policy

**NOT:** enableVerification (this should be hardcoded to true)

## Simplified Stack Interface (Proposed)

```typescript
interface StackConfig {
    // Benchling: Just the secret ARN
    benchling: {
        secretArn: string;
    };

    // Quilt: Service endpoints
    quilt: {
        catalog: string;
        database: string;
        queueUrl: string;
        region: string;
        writeRoleArn?: string;
    };

    // Deployment: Infrastructure settings
    deployment: {
        region: string;
        imageTag?: string;
        vpc?: VpcConfig;
    };

    // Security: Optional IP filtering
    security?: {
        webhookAllowList?: string;
    };
}
```

> **Total: 4 sections, ~10 fields (vs current 15+ fields with metadata)**

## Corrected Deploy Flow

```typescript
// bin/commands/deploy.ts
import { createStack } from '../benchling-webhook';
import { XDGConfig } from '../lib/xdg-config';

const xdgConfig = new XDGConfig();
const profileConfig = xdgConfig.readProfile(profile);

// Direct function call - no subprocess, no env vars
const stackConfig: StackConfig = {
    benchling: {
        secretArn: profileConfig.benchling.secretArn,
    },
    quilt: {
        catalog: profileConfig.quilt.catalog,
        database: profileConfig.quilt.database,
        queueUrl: profileConfig.quilt.queueUrl,
        region: profileConfig.quilt.region,
        writeRoleArn: profileConfig.quilt.writeRoleArn,
    },
    deployment: {
        region: profileConfig.deployment.region,
        imageTag: profileConfig.deployment.imageTag,
        vpc: profileConfig.deployment.vpc,
    },
    security: {
        webhookAllowList: profileConfig.security?.webhookAllowList,
    },
};

// Direct function call in same process
const { stack } = createStack(stackConfig);

// Use CDK SDK to deploy
await stack.deploy();
```

No environment variables. No process spawning. Just TypeScript.

## Summary: What Can Change

### CAN change (no external dependencies)

- `createStack()` function signature
- Stack props interface
- Internal config transformations
- Deploy script implementation
- Whether we support direct CDK CLI

### CANNOT change (external dependencies)

- XDG config file format (ProfileConfig) - wizard owns this
- Secret ARN must exist before deployment - stack needs ARN at synthesis time (values don't matter until runtime)
- FastAPI reads OAuth credentials from secret at runtime (not at deploy time)

### SHOULD change (current mistakes)

- Remove env var round-trip in deploy script
- Remove Benchling fields from stack (except secretArn)
- Move package config into secret (or keep in env vars from secret)
- Drop direct CDK CLI support (nobody uses it)
