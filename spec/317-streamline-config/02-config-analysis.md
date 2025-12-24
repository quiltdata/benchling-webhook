# Configuration Flows Analysis

## Overview

The benchling-webhook system has **5 distinct configuration flows** that intersect at different points. Understanding these flows is critical before making changes.

## Flow 1: Setup Wizard (Write Configuration)

**Entry:** `bin/cli.ts setup` → `bin/commands/setup-wizard.ts`

**Purpose:** Interactive discovery and storage of all deployment configuration

**Inputs:**

- User prompts (Benchling tenant, OAuth client ID/secret, etc.)
- AWS CloudFormation API (discovers Quilt stack outputs)
- AWS EC2 API (discovers VPC resources)
- Benchling API (validates credentials, discovers app definition)

**Outputs:**

- XDG config file: `~/.config/benchling-webhook/{profile}/config.json` (ProfileConfig)
- AWS Secrets Manager: Benchling OAuth credentials
- Updates config with `benchling.secretArn` after secret creation

**Key:** This is the ONLY flow that writes ProfileConfig. It stores everything discovered/entered.

## Flow 2: Secrets Manager Sync (External to Stack)

**Entry:** `bin/commands/sync-secrets.ts` (also called from setup wizard)

**Purpose:** Create/update AWS Secrets Manager secrets **before stack deployment**

**Inputs:**

- ProfileConfig from XDG config (`benchling.clientId`, `benchling.clientSecret`)
- AWS region from ProfileConfig (`deployment.region`)

**Outputs:**

- Secret in AWS Secrets Manager (name: `benchling-webhook-{profile}` or integrated stack name)
- Secret ARN written back to ProfileConfig (`benchling.secretArn`)

**Key:** Secrets are created **OUTSIDE the stack**. Stack only references existing secrets by ARN.

## Flow 3: Deploy Script (Automated CDK Deployment)

**Entry:** `bin/cli.ts deploy` → `bin/commands/deploy.ts`

**Current Implementation:**

1. Read ProfileConfig from `~/.config/benchling-webhook/{profile}/config.json`
2. Convert ProfileConfig → environment variables (`buildCdkEnv()`)
3. Spawn `npx cdk deploy` with env vars
4. `bin/benchling-webhook.ts` reads env vars
5. Reconstruct ProfileConfig from env vars (lines 88-127)
6. Pass ProfileConfig to `BenchlingWebhookStack` constructor

**Why environment variables?**

- CDK CLI (`npx cdk deploy`) runs `bin/benchling-webhook.ts` as a subprocess
- No direct way to pass TypeScript objects between processes
- Environment variables are the IPC mechanism

**Key:** This is a **process boundary** - deploy.ts cannot directly pass ProfileConfig to the stack.

## Flow 4: Direct CDK CLI (Manual Stack Synthesis)

**Entry:** `npx cdk synth` or `npx cdk deploy` (without deploy script)

**Current Implementation:**

- User sets environment variables manually
- `bin/benchling-webhook.ts` (lines 153-233) reads env vars
- Reconstructs ProfileConfig from env vars
- Creates BenchlingWebhookStack

**Key:** Provides escape hatch for advanced users who want to bypass deploy script.

## Flow 5: Local Testing (Docker/Native)

**Entry:** `npm run test:local` → `make -C docker` → Docker Compose

**Inputs:**

- ProfileConfig from XDG config (`~/.config/benchling-webhook/dev/config.json`)
- Environment variables set by test scripts
- Docker Compose environment

**Consumers:**

- FastAPI application (reads from env vars)
- Test scripts (read from XDG config to set env vars)

**Key:** Tests use a mix of XDG config and environment variables, but **never call the CDK stack**.

## Flow 6: Library API (Programmatic Usage)

**Entry:** Import `{ createStack } from "@quiltdata/benchling-webhook"`

**Current Interface:**

```typescript
createStack(config: Config): DeploymentResult
```

**Inputs:**

- Legacy `Config` object (flat structure, ~30 fields)
- Internally converts to ProfileConfig
- Passes ProfileConfig to stack

**Key:** This is a **PUBLIC API** - changing the signature is a breaking change.

## Critical Constraints

### 1. Process Boundary (Deploy Script → CDK CLI)

**Problem:** deploy.ts runs in Node process A, stack synthesis runs in Node process B

**Current Solution:** Environment variables as IPC

**Cannot change:**

- The fact that there's a process boundary
- That env vars are the communication mechanism
- That bin/benchling-webhook.ts must read from env vars

### 2. Secrets Created Before Stack

**Problem:** Stack needs secret ARN at deployment time

**Current Solution:**

1. Wizard creates secret in Secrets Manager
2. Stores ARN in ProfileConfig
3. Deploy script passes ARN to stack via env vars
4. Stack references existing secret

**Cannot change:**

- Secrets must exist before `cdk deploy` runs
- Stack cannot create its own secrets (chicken-egg problem)

### 3. Multiple Configuration Formats

**Current State:**

- ProfileConfig (XDG files): Full wizard metadata, 15+ nested fields
- Legacy Config (library API): Flat structure, ~30 fields
- Environment variables: String key-value pairs
- Stack props: ProfileConfig (bloated)

**Problem:** Too many transformations, information loss at process boundary

## What Needs Fixing

1. **Stack constructor** should NOT require ProfileConfig (wizard metadata irrelevant)
2. **Environment variable round-trip** is wasteful (ProfileConfig → env vars → ProfileConfig)
3. **Legacy Config** interface should be deprecated/hidden
4. **Library API** needs simpler interface (but can't break existing users)

## What Cannot Change

1. **Process boundary** between deploy script and CDK CLI
2. **Secrets created externally** before stack deployment
3. **Environment variables** as IPC mechanism for CDK CLI
4. **XDG config format** (ProfileConfig) - wizard writes/reads this
5. **Local testing** flow (separate from CDK entirely)
