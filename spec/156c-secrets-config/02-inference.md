# Configuration Inference Refactoring Specification

**Date:** 2025-11-02
**Status:** Draft
**Related:** [01-gaps.md](01-gaps.md)

---

## Executive Summary

This specification defines how to refactor the configuration inference system to align with the ideal workflow described in [docs/CONFIG.md](../../docs/CONFIG.md). The goal is to make `QUILT_STACK_ARN` a first-class inferred parameter and streamline the deployment flow to match user expectations.

---

## 1. Current State Analysis

### 1.1 What Works

The existing inference system in [lib/utils/stack-inference.ts](../../lib/utils/stack-inference.ts) successfully:

1. ✅ Fetches `config.json` from Quilt catalog
2. ✅ Extracts API Gateway ID from endpoint URL
3. ✅ Searches CloudFormation for the stack by API Gateway resource
4. ✅ Retrieves stack outputs (QUEUE_ARN, QUILT_DATABASE)
5. ✅ Gets AWS account ID and region
6. ✅ Generates environment variables

### 1.2 What's Missing

The critical gap is that the system finds the **stack name** but never exports the **stack ARN**:

**Current output from `inferStackConfig()`:**
```typescript
{
  config: QuiltCatalogConfig;
  stackName: string | null;        // ❌ Not exported to env vars
  stackDetails: StackDetails;
  inferredVars: {
    CDK_DEFAULT_ACCOUNT: string;
    CDK_DEFAULT_REGION: string;
    QUEUE_ARN: string;
    QUILT_DATABASE: string;
    QUILT_CATALOG: string;
    // ❌ Missing: QUILT_STACK_ARN
  }
}
```

### 1.3 Impact

**Users cannot use the automated flow because:**

1. `npx @quiltdata/benchling-webhook deploy` requires `--quilt-stack-arn` flag
2. Inference finds the stack but doesn't provide the ARN
3. Users must manually run AWS CLI commands to get the ARN
4. This defeats the purpose of automated configuration

---

## 2. Design Goals

### 2.1 Principle: Zero Manual Lookups

Users should never have to run AWS CLI commands to find infrastructure identifiers. If the system can infer the Quilt stack, it should export everything needed for deployment.

### 2.2 Principle: Fail-Safe Inference

If stack inference fails or is ambiguous, provide:
- Clear error messages
- Manual override instructions
- Fallback to explicit user input

### 2.3 Principle: Single Source of Truth

The `inferStackConfig()` function should be the canonical source for all infrastructure discovery. All CLI commands and deployment scripts should use it.

---

## 3. Technical Specification

### 3.1 Stack ARN Extraction

**Location:** [lib/utils/stack-inference.ts:92-114](../../lib/utils/stack-inference.ts#L92-L114)

**Current implementation of `getStackDetails()`:**
```typescript
export function getStackDetails(region: string, stackName: string): StackDetails {
    try {
        const outputsResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Outputs" --output json`,
            { encoding: "utf-8" },
        );

        const paramsResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0].Parameters" --output json`,
            { encoding: "utf-8" },
        );

        return {
            outputs: JSON.parse(outputsResult) || [],
            parameters: JSON.parse(paramsResult) || [],
        };
    } catch (error) {
        console.error(`Warning: Could not get stack details: ${(error as Error).message}`);
        return { outputs: [], parameters: [] };
    }
}
```

**Required change:** Extract `StackId` in addition to `Outputs` and `Parameters`:

```typescript
export interface StackDetails {
    stackId?: string;  // ADD THIS
    outputs: Array<{ OutputKey: string; OutputValue: string }>;
    parameters: Array<{ ParameterKey: string; ParameterValue: string }>;
}

export function getStackDetails(region: string, stackName: string): StackDetails {
    try {
        // Single call to get all stack information
        const stackResult = execSync(
            `aws cloudformation describe-stacks --region ${region} --stack-name "${stackName}" --query "Stacks[0]" --output json`,
            { encoding: "utf-8" },
        );

        const stack = JSON.parse(stackResult);

        return {
            stackId: stack.StackId || undefined,
            outputs: stack.Outputs || [],
            parameters: stack.Parameters || [],
        };
    } catch (error) {
        console.error(`Warning: Could not get stack details: ${(error as Error).message}`);
        return { outputs: [], parameters: [] };
    }
}
```

**Benefits:**
- Single AWS API call instead of two (more efficient)
- Gets full stack ARN (StackId field)
- Maintains backward compatibility (outputs/parameters unchanged)

### 3.2 Stack ARN in Inferred Configuration

**Location:** [lib/utils/stack-inference.ts:164-220](../../lib/utils/stack-inference.ts#L164-L220)

**Current implementation of `buildInferredConfig()`:**
```typescript
export function buildInferredConfig(
    config: QuiltCatalogConfig,
    stackName: string | null,
    stackDetails: StackDetails,
    region: string,
    accountId: string | null,
    catalogDomain: string,
): Record<string, string> {
    const vars: Record<string, string> = {};

    // ... existing code ...

    // Additional useful info
    if (stackName) {
        vars["# CloudFormation Stack"] = stackName;
    }
    // ... rest of code ...
}
```

**Required change:** Add `QUILT_STACK_ARN` to inferred vars:

```typescript
export function buildInferredConfig(
    config: QuiltCatalogConfig,
    stackName: string | null,
    stackDetails: StackDetails,
    region: string,
    accountId: string | null,
    catalogDomain: string,
): Record<string, string> {
    const vars: Record<string, string> = {};

    // AWS Configuration
    if (accountId) {
        vars.CDK_DEFAULT_ACCOUNT = accountId;
    }
    vars.CDK_DEFAULT_REGION = region;
    vars.AWS_REGION = region;

    // Quilt Stack ARN - CRITICAL FOR DEPLOYMENT
    if (stackDetails.stackId) {
        vars.QUILT_STACK_ARN = stackDetails.stackId;
    } else if (stackName && accountId) {
        // Fallback: construct partial ARN (missing stack UUID)
        // Format: arn:aws:cloudformation:region:account:stack/name/*
        vars["# QUILT_STACK_ARN"] = "Could not retrieve full stack ARN";
        vars.QUILT_STACK_ARN = `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/*`;
        vars["# Warning"] = "Stack ARN may be incomplete - verify before deployment";
    }

    // ... rest of existing code ...

    // Additional useful info (keep for debugging)
    if (stackName) {
        vars["# CloudFormation Stack Name"] = stackName;
    }
    // ... rest of code ...
}
```

**Rationale:**
- `stackDetails.stackId` contains the full, correct ARN
- Fallback to constructed ARN if `stackId` unavailable
- Clear warning if using constructed ARN
- Both approaches work with CloudFormation APIs (wildcards accepted)

### 3.3 Output Format in get-env.js

**Location:** [bin/get-env.js:42-80](../../bin/get-env.js#L42-L80)

**Required change:** Add `QUILT_STACK_ARN` to the top of inferred section:

```javascript
function formatEnvVars(vars) {
    const lines = [];

    lines.push("# ==============================================================================");
    lines.push("# INFERRED CONFIGURATION");
    lines.push("# ==============================================================================");
    lines.push("# Generated by: bin/get-env.js");
    lines.push("# Date: " + new Date().toISOString());
    lines.push("#");
    lines.push("# ⚠️  IMPORTANT: Review and verify all values before using!");
    lines.push("#    Some values may need manual verification or completion.");
    lines.push("# ==============================================================================");
    lines.push("");

    // Group by category for readability
    const categories = {
        infrastructure: ["QUILT_STACK_ARN"],
        aws: ["CDK_DEFAULT_ACCOUNT", "CDK_DEFAULT_REGION", "AWS_REGION"],
        quilt: ["QUILT_CATALOG", "QUILT_DATABASE", "QUEUE_ARN"],
        comments: [],
    };

    // Infrastructure Parameters (most critical)
    lines.push("# --- Infrastructure Parameters ---");
    for (const key of categories.infrastructure) {
        if (vars[key]) {
            lines.push(`${key}=${vars[key]}`);
        }
    }
    lines.push("");

    // AWS Configuration
    lines.push("# --- AWS Configuration ---");
    for (const key of categories.aws) {
        if (vars[key]) {
            lines.push(`${key}=${vars[key]}`);
        }
    }
    lines.push("");

    // Quilt Configuration
    lines.push("# --- Quilt Configuration ---");
    for (const key of categories.quilt) {
        if (vars[key]) {
            lines.push(`${key}=${vars[key]}`);
        }
    }
    lines.push("");

    // Comments and metadata
    for (const [key, value] of Object.entries(vars)) {
        if (key.startsWith("#") || !Object.values(categories).flat().includes(key)) {
            lines.push(`# ${key}: ${value}`);
        }
    }
    lines.push("");

    // Required manual values
    lines.push("# ==============================================================================");
    lines.push("# REQUIRED VALUES NOT INFERRED - Must be filled manually");
    lines.push("# ==============================================================================");
    lines.push("BENCHLING_TENANT=your-tenant");
    lines.push("BENCHLING_CLIENT_ID=your-client-id");
    lines.push("BENCHLING_CLIENT_SECRET=your-client-secret");
    lines.push("BENCHLING_APP_DEFINITION_ID=appdef_your_id_here");
    lines.push("");
    lines.push("# --- Optional Configuration ---");
    lines.push("# BENCHLING_USER_BUCKET=your-data-bucket  # Override Quilt bucket");
    lines.push("# LOG_LEVEL=INFO");
    lines.push("# ENABLE_WEBHOOK_VERIFICATION=true");
    lines.push("");
    lines.push("# --- Testing Parameters (only for test-integration) ---");
    lines.push("# BENCHLING_TEST_ENTRY=etr_123456789");
    lines.push("");

    return lines.join("\n");
}
```

**Benefits:**
- Structured output with clear categories
- `QUILT_STACK_ARN` prominently placed at top
- Removed obsolete parameters (PREFIX, BENCHLING_APP, BENCHLING_API_KEY)
- Clear distinction between required and optional values

---

## 4. CLI Command Changes

### 4.1 Deploy Command Enhancement

**Location:** [bin/commands/deploy.ts](../../bin/commands/deploy.ts)

**Current behavior:**
```bash
npx @quiltdata/benchling-webhook deploy --quilt-stack-arn "arn:aws:..."
```

**Proposed enhancement:**
```typescript
export async function deployCommand(options: DeployOptions): Promise<void> {
    // Load .env if present
    const envPath = resolve(options.envFile || ".env");
    if (existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }

    // Check if QUILT_STACK_ARN is in environment
    let quiltStackArn = options.quiltStackArn || process.env.QUILT_STACK_ARN;

    // If not provided and QUILT_CATALOG is available, try to infer
    if (!quiltStackArn && process.env.QUILT_CATALOG) {
        const spinner = ora("Inferring Quilt stack ARN from catalog...").start();

        try {
            const result = await inferConfiguration(process.env.QUILT_CATALOG);
            if (result.success && result.inferredVars.QUILT_STACK_ARN) {
                quiltStackArn = result.inferredVars.QUILT_STACK_ARN;
                spinner.succeed(`Inferred Quilt stack: ${quiltStackArn}`);
            } else {
                spinner.fail("Could not infer stack ARN");
            }
        } catch (error) {
            spinner.fail(`Inference failed: ${(error as Error).message}`);
        }
    }

    // Validate required parameter
    if (!quiltStackArn) {
        console.error(chalk.red("Error: QUILT_STACK_ARN is required"));
        console.error();
        console.error("Provide it via:");
        console.error("  1. --quilt-stack-arn flag");
        console.error("  2. QUILT_STACK_ARN in .env");
        console.error("  3. Automatic inference from QUILT_CATALOG");
        console.error();
        console.error("To infer from catalog:");
        console.error(chalk.cyan("  npm run get-env -- https://your-catalog.com --write"));
        process.exit(1);
    }

    // Continue with deployment...
}
```

**Benefits:**
- Automatic inference if `QUILT_CATALOG` is set
- Clear fallback chain: flag → env var → inference
- Helpful error messages with remediation steps

### 4.2 Init Command Enhancement

**Location:** [bin/commands/init.ts:132-166](../../bin/commands/init.ts#L132-L166)

**Current behavior:** Inference happens but results are not fully integrated into output

**Proposed enhancement:**
```typescript
// Attempt inference if requested
let inferredVars: Record<string, string> = {};

if (options.infer !== false) {
    console.log();
    const spinner = ora("Inferring additional configuration from catalog...").start();

    const inferenceResult = await inferConfiguration(answers.catalog);

    if (inferenceResult.success) {
        inferredVars = inferenceResult.inferredVars;
        spinner.succeed("Successfully inferred additional configuration");

        // Add infrastructure configuration FIRST
        if (inferredVars.QUILT_STACK_ARN) {
            envLines.push("# Infrastructure Configuration (inferred)");
            envLines.push(`QUILT_STACK_ARN=${inferredVars.QUILT_STACK_ARN}`);
            envLines.push("");
        }

        // AWS configuration
        if (inferredVars.CDK_DEFAULT_ACCOUNT) {
            envLines.push("# AWS Configuration (inferred)");
            envLines.push(`CDK_DEFAULT_ACCOUNT=${inferredVars.CDK_DEFAULT_ACCOUNT}`);
            envLines.push(`CDK_DEFAULT_REGION=${inferredVars.CDK_DEFAULT_REGION}`);
            envLines.push("");
        }

        // SQS configuration
        if (inferredVars.QUEUE_ARN) {
            envLines.push("# SQS Configuration (inferred)");
            envLines.push(`QUEUE_ARN=${inferredVars.QUEUE_ARN}`);
            envLines.push("");
        }

        // Database configuration
        if (inferredVars.QUILT_DATABASE) {
            envLines.push("# Quilt Database (inferred)");
            envLines.push(`QUILT_DATABASE=${inferredVars.QUILT_DATABASE}`);
            envLines.push("");
        }
    } else {
        spinner.warn(`Could not infer additional configuration: ${inferenceResult.error}`);

        // Provide manual instructions
        console.log();
        console.log(chalk.yellow("Manual configuration required:"));
        console.log("  Run the following to find your Quilt stack ARN:");
        console.log(chalk.cyan("  npm run get-env -- https://" + answers.catalog));
    }
}
```

---

## 5. Documentation Updates

### 5.1 env.template Changes

**Location:** [env.template](../../env.template)

**Priority 1 Changes:**

```bash
# ==============================================================================
# AUTOMATED vs. MANUAL SETUP
# ==============================================================================
#
# RECOMMENDED: Use automated inference to populate this file
#   npm run get-env -- https://your-quilt-catalog.com --write
#   cp env.inferred .env
#   # Edit .env to add your Benchling credentials below
#
# ALTERNATIVE: Manual configuration
#   cp env.template .env
#   # Fill in ALL values below
#
# For help: npm run cli -- --help
# ==============================================================================

#
# INFRASTRUCTURE PARAMETERS (Required for Deployment)
#

# CloudFormation Stack ARN for Quilt Stack
# Auto-inferred by 'npm run get-env', or find manually:
#   aws cloudformation describe-stacks \
#     --query "Stacks[?contains(StackName, 'Quilt')].StackId" \
#     --output text
QUILT_STACK_ARN=arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/uuid

# Quilt catalog domain (without https://)
QUILT_CATALOG=quilt-stack.your-company.com

#
# BENCHLING CREDENTIALS (Required for Runtime)
#

# Tenant: Use XXX if you login at XXX.benchling.com
BENCHLING_TENANT=your-tenant

# OAuth credentials from your Benchling app
BENCHLING_CLIENT_ID=your-client-id
BENCHLING_CLIENT_SECRET=your-client-secret

# App definition ID from Benchling app manifest
BENCHLING_APP_DEFINITION_ID=appdef_your_id_here

# S3 bucket for storing Benchling exports (YOUR data bucket)
BENCHLING_USER_BUCKET=your-data-bucket # (without s3:// prefix)

#
# OPTIONAL PARAMETERS
#

# Application Configuration
BENCHLING_LOG_LEVEL=INFO
BENCHLING_ENABLE_WEBHOOK_VERIFICATION=true
BENCHLING_WEBHOOK_ALLOW_LIST=

# Package Configuration
BENCHLING_PKG_PREFIX=benchling
BENCHLING_PKG_KEY=experiment_id

#
# TESTING PARAMETERS (Only required for 'make -C docker test-integration')
#

# Actual entry ID from your Benchling tenant
# BENCHLING_TEST_ENTRY=etr_123456789

#
# ADVANCED PARAMETERS (Experts only)
#

# Override Docker image tag (defaults to package.json version)
# IMAGE_TAG=custom-build-123

# VPC Configuration (defaults to default VPC)
# VPC_ID=vpc-abc123
# SUBNET_IDS=subnet-abc123,subnet-def456

# ==============================================================================
# DEPLOYMENT WORKFLOW
# ==============================================================================
#
# After filling in the values above:
#
# 1. Sync secrets to AWS Secrets Manager
#    npm run create-secret
#
# 2. Deploy the stack
#    npm run deploy
#
# 3. Configure your Benchling app with the webhook URL from .env.deploy
#
# The deployed stack resolves runtime configuration from:
#   - QUILT_STACK_ARN → Gets Quilt resources (SQS, S3, Athena) from CloudFormation
#   - BenchlingSecret → Gets all Benchling credentials from AWS Secrets Manager
#
# ==============================================================================
```

### 5.2 docs/CONFIG.md Updates

**Location:** [docs/CONFIG.md](../../docs/CONFIG.md)

**Section 2.2 - Update to reflect actual implementation:**

```markdown
### 2.2 Bootstrapping

The simplest way to start is by running:

```bash
npm run get-env -- https://your-quilt-catalog.com --write
```

This command will:

1. **Fetch catalog configuration** from `config.json`
2. **Search CloudFormation** for the associated Quilt stack
3. **Extract stack ARN and outputs** (SQS queue, database, etc.)
4. **Write `env.inferred`** with all discovered values
5. **Prompt you** to fill in Benchling credentials manually

Then complete the setup:

```bash
cp env.inferred .env
# Edit .env to add BENCHLING_* credentials
npm run create-secret  # Upload to AWS Secrets Manager
npm run deploy         # Deploy the stack
```

**Alternative: Interactive Setup**

```bash
npx @quiltdata/benchling-webhook init --infer
```

This provides a guided setup with automatic inference.
```

**Section 6.2 - Add QUILT_STACK_ARN:**

```markdown
### 6.2 Inferred Automatically

| Variable | Source | Used For |
|----------|--------|----------|
| `QUILT_STACK_ARN` | CloudFormation stack discovery | CDK deployment (lookup) |
| `QUILT_CATALOG` | Quilt3 config or catalog URL | Runtime (data source) |
| `QUEUE_ARN` | Quilt stack outputs | Runtime (package queue) |
| `QUILT_DATABASE` | Quilt stack outputs | Runtime (Athena queries) |
| `CDK_DEFAULT_ACCOUNT` | AWS STS | CDK deployment |
| `CDK_DEFAULT_REGION` | Catalog config.json | CDK deployment |
```

### 5.3 AGENTS.md Updates

**Location:** [AGENTS.md](../../AGENTS.md)

**Section 2.1 - Clarify the actual workflow:**

```markdown
### 2.1 One-Command Bootstrap

Developers can bootstrap configuration by running:

```bash
npm run get-env -- https://your-quilt-catalog.com --write
```

This command:

1. Detects the Quilt CloudFormation stack from the catalog's API Gateway endpoint
2. Retrieves the **full stack ARN** for deployment linking
3. Extracts SQS queue ARN, Athena database, and AWS account/region
4. Writes `env.inferred` with all discovered infrastructure parameters

Then complete setup:

```bash
cp env.inferred .env
# Fill in BENCHLING_* credentials manually
npm run create-secret  # Sync to AWS Secrets Manager
npm run deploy         # Deploy webhook stack
```

If inference fails, the script provides:
- Explicit diagnostics (e.g., "Cannot find stack by API Gateway ID")
- Manual lookup commands
- Fallback to manual configuration via `env.template`
```

**Update Section 4 failure modes:**

| Failure | Cause | Mitigation |
|----------|--------|-------------|
| Stack ARN not inferred | API Gateway lookup failed | Provide manual ARN via `--quilt-stack-arn` flag or `QUILT_STACK_ARN` env var |
| Ambiguous stack match | Multiple stacks with same resources | Prompt user to select from list, or use explicit ARN |
| AWS auth error | Invalid credentials | Check AWS_PROFILE and region, run `aws sts get-caller-identity` |

---

## 6. Testing Strategy

### 6.1 Unit Tests

**New test file:** `test/utils-stack-inference.test.ts`

```typescript
describe("Stack ARN Inference", () => {
    it("should extract StackId from getStackDetails()", () => {
        const details = getStackDetails("us-east-1", "QuiltStack");
        expect(details.stackId).toMatch(/^arn:aws:cloudformation:/);
    });

    it("should include QUILT_STACK_ARN in buildInferredConfig()", () => {
        const config = buildInferredConfig(
            mockCatalogConfig,
            "QuiltStack",
            { stackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/uuid", outputs: [], parameters: [] },
            "us-east-1",
            "123456789012",
            "https://catalog.example.com"
        );

        expect(config.QUILT_STACK_ARN).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/uuid");
    });

    it("should construct fallback ARN if stackId unavailable", () => {
        const config = buildInferredConfig(
            mockCatalogConfig,
            "QuiltStack",
            { outputs: [], parameters: [] },
            "us-east-1",
            "123456789012",
            "https://catalog.example.com"
        );

        expect(config.QUILT_STACK_ARN).toBe("arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/*");
        expect(config["# Warning"]).toContain("incomplete");
    });
});
```

### 6.2 Integration Tests

**Test:** `npm run get-env` against real Quilt catalog

```bash
# Use nightly.quilttest.com as test target
npm run get-env -- https://nightly.quilttest.com --write

# Verify env.inferred contains:
# - QUILT_STACK_ARN with full ARN format
# - QUEUE_ARN from stack outputs
# - QUILT_DATABASE from stack outputs
```

### 6.3 End-to-End Tests

**Test:** Full deployment flow with inferred configuration

```bash
npm run get-env -- https://nightly.quilttest.com --write
cp env.inferred .env
# Add test Benchling credentials
npm run create-secret
npm run deploy

# Verify deployment succeeds
# Verify .env.deploy contains WEBHOOK_ENDPOINT
```

---

## 7. Implementation Plan

### Phase 1: Core Inference (High Priority)

- [ ] **Task 1.1:** Update `StackDetails` interface to include `stackId`
- [ ] **Task 1.2:** Modify `getStackDetails()` to retrieve `StackId`
- [ ] **Task 1.3:** Add `QUILT_STACK_ARN` to `buildInferredConfig()`
- [ ] **Task 1.4:** Update `formatEnvVars()` in `get-env.js` with structured output
- [ ] **Task 1.5:** Write unit tests for new functionality
- [ ] **Task 1.6:** Test against real Quilt catalogs (nightly, production)

**Estimated effort:** 4-6 hours
**Risk:** Low (backward compatible changes)

### Phase 2: CLI Enhancements (Medium Priority)

- [ ] **Task 2.1:** Add automatic inference to `deploy` command
- [ ] **Task 2.2:** Improve error messages with fallback instructions
- [ ] **Task 2.3:** Update `init` command to prioritize `QUILT_STACK_ARN`
- [ ] **Task 2.4:** Add integration tests for CLI commands
- [ ] **Task 2.5:** Update CLI help text and examples

**Estimated effort:** 3-4 hours
**Risk:** Low (additive changes)

### Phase 3: Documentation Alignment (High Priority)

- [ ] **Task 3.1:** Update `env.template` with new structure
- [ ] **Task 3.2:** Update `docs/CONFIG.md` with accurate workflow
- [ ] **Task 3.3:** Update `AGENTS.md` with actual implementation details
- [ ] **Task 3.4:** Add troubleshooting guide for inference failures
- [ ] **Task 3.5:** Create migration guide for existing users

**Estimated effort:** 3-4 hours
**Risk:** None (documentation only)

### Phase 4: Advanced Features (Low Priority)

- [ ] **Task 4.1:** Add stack selection UI for ambiguous matches
- [ ] **Task 4.2:** Cache inference results to avoid repeated AWS calls
- [ ] **Task 4.3:** Add `--verify` flag to validate inferred configuration
- [ ] **Task 4.4:** Support multi-catalog inference for complex setups

**Estimated effort:** 6-8 hours
**Risk:** Medium (requires UX design)

---

## 8. Success Criteria

### 8.1 Functional Requirements

- ✅ `npm run get-env` produces `env.inferred` with valid `QUILT_STACK_ARN`
- ✅ `npm run deploy` works without explicit `--quilt-stack-arn` flag if `QUILT_STACK_ARN` in `.env`
- ✅ Stack ARN inference works for all Quilt stack versions (v4.0+)
- ✅ Clear error messages when inference fails
- ✅ Fallback to manual configuration always available

### 8.2 Non-Functional Requirements

- ✅ Backward compatibility: existing `.env` files continue to work
- ✅ Performance: inference completes in <5 seconds
- ✅ Documentation: all three docs (env.template, CONFIG.md, AGENTS.md) are consistent
- ✅ Testing: 80%+ code coverage for inference logic

### 8.3 User Experience Requirements

- ✅ New users can deploy in <10 minutes
- ✅ Zero manual AWS CLI commands required for happy path
- ✅ Inference failures are self-explanatory and recoverable
- ✅ Advanced users can override all inferred values

---

## 9. Migration Guide

### 9.1 For Existing Users

If you have an existing `.env` file without `QUILT_STACK_ARN`:

**Option A: Run inference to populate**
```bash
npm run get-env -- https://your-catalog.com --output=env.inferred
# Compare and merge:
diff .env env.inferred
# Copy QUILT_STACK_ARN line to your .env
```

**Option B: Manual lookup**
```bash
# Find your Quilt stack name from catalog config
curl https://your-catalog.com/config.json | jq '.apiGatewayEndpoint'

# Get stack ARN
aws cloudformation describe-stacks \
  --query "Stacks[?contains(StackName, 'Quilt')].StackId" \
  --output text

# Add to .env:
echo "QUILT_STACK_ARN=arn:aws:cloudformation:..." >> .env
```

### 9.2 Breaking Changes

**None.** All changes are backward compatible:
- Existing `.env` files continue to work
- CLI flags take precedence over inference
- Manual `QUILT_STACK_ARN` always respected

---

## 10. Future Enhancements

### 10.1 Quilt3 Config Integration

Read catalog URL from `~/.quilt3/config.yml` if not provided:

```typescript
function getQuiltCatalogFromConfig(): string | null {
    const configPath = path.join(os.homedir(), ".quilt3", "config.yml");
    if (!existsSync(configPath)) return null;

    const config = yaml.load(readFileSync(configPath, "utf-8"));
    return config?.navigator_url || null;
}
```

### 10.2 Interactive Stack Selection

If multiple Quilt stacks found:

```bash
Found 2 Quilt stacks in us-east-1:
  1. QuiltStack-Production (arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack-Production/uuid1)
  2. QuiltStack-Staging (arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack-Staging/uuid2)

Which stack do you want to use? [1]
```

### 10.3 Caching Layer

Cache inference results to avoid repeated AWS API calls:

```typescript
// ~/.cache/benchling-webhook/inference-cache.json
{
  "https://catalog.example.com": {
    "timestamp": "2025-11-02T10:00:00Z",
    "ttl": 3600,
    "inferredVars": { ... }
  }
}
```

---

## 11. Appendix: ARN Format Reference

### CloudFormation Stack ARN Format

```
arn:aws:cloudformation:{region}:{account}:stack/{stack-name}/{uuid}
```

**Example:**
```
arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/abcd1234-5678-90ef-ghij-klmnopqrstuv
```

**Wildcard Support:**

CloudFormation APIs accept wildcards in stack names:
```
arn:aws:cloudformation:us-east-1:123456789012:stack/QuiltStack/*
```

This is useful as a fallback when the full UUID is unavailable, though the full ARN is always preferred.

### Stack ID vs. Stack Name

- **Stack Name:** Human-readable identifier (e.g., `QuiltStack`)
- **Stack ID:** Full ARN with unique UUID (e.g., `arn:aws:cloudformation:...`)
- **Stack ARN:** Synonym for Stack ID

The `describe-stacks` API returns `StackId` which is the canonical identifier.

---

## 12. References

- [AWS CloudFormation DescribeStacks API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStacks.html)
- [Quilt Catalog config.json Schema](https://github.com/quiltdata/quilt/blob/master/docs/catalog-config.md)
- [01-gaps.md](01-gaps.md) - Gap analysis that motivated this spec
- [docs/CONFIG.md](../../docs/CONFIG.md) - Ideal state workflow
- [lib/utils/stack-inference.ts](../../lib/utils/stack-inference.ts) - Current implementation
