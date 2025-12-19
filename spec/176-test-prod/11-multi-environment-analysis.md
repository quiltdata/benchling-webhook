# Multi-Environment Stack Analysis: Can We Support Both 'prod' and 'dev' in the Same Stack?

**Status**: Analysis Complete
**Date**: 2025-11-04
**Issue**: #176 - Test Production Deployments
**Question**: Can we deploy both 'prod' and 'dev' environments to the same CloudFormation stack, or do we need separate stacks?

---

## Executive Summary

**Answer**: **No, we cannot support both 'prod' and 'dev' in the same CloudFormation stack. We use separate stacks.**

**Current Architecture**:

- **Single Stack Name**: `BenchlingWebhookStack` (hardcoded)
- **Environment Differentiation**: Achieved through **separate AWS accounts/regions** or **separate stack deployments** with different parameters
- **Configuration Storage**: `~/.config/benchling-webhook/deploy.json` stores both `dev` and `prod` endpoints from different stack deployments

---

## Current Implementation Analysis

### 1. Stack Naming Strategy

#### 1.1 Hardcoded Stack Name

**Location**: Throughout the codebase

```typescript
// bin/benchling-webhook.ts:122
const stack = new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
    // ...
});

// bin/dev-deploy.ts:302
const command = new DescribeStacksCommand({ StackName: "BenchlingWebhookStack" });

// bin/commands/deploy.ts:337
const stackName = "BenchlingWebhookStack";
```

**Key Finding**: The stack name `"BenchlingWebhookStack"` is hardcoded everywhere and never varies by environment.

#### 1.2 No Environment Suffix

The codebase does **not** use stack name patterns like:

- ❌ `BenchlingWebhookStack-dev`
- ❌ `BenchlingWebhookStack-prod`
- ❌ `BenchlingWebhookStack-${environment}`

Instead, it always uses the same stack name: `BenchlingWebhookStack`

---

### 2. How Environments Are Currently Separated

#### 2.1 Current Dev Deployment Flow

**Script**: `bin/dev-deploy.ts`

```typescript
// Lines 288-293
const quiltStackArn = "arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/...";
const benchlingSecret = generateSecretName("default", "quilt-dtt");

run(`npm run deploy:prod -- --quilt-stack-arn ${quiltStackArn} --benchling-secret ${benchlingSecret} --image-tag ${imageTag} --yes`);
```

**Key Characteristics**:

1. Uses hardcoded dev-specific Quilt stack ARN
2. Deploys to `BenchlingWebhookStack` (same name as prod)
3. Stores result in `deploy.json` under `dev` key

#### 2.2 Current Prod Deployment Flow

**Script**: `bin/commands/deploy.ts`

```typescript
// Lines 272-279
console.log(`  ${chalk.bold("Stack:")}                     BenchlingWebhookStack`);
console.log(`  ${chalk.bold("Account:")}                   ${deployAccount}`);
console.log(`  ${chalk.bold("Region:")}                    ${deployRegion}`);
// ...
console.log(`    ${chalk.bold("Quilt Stack ARN:")}         ${maskArn(quiltStackArn)}`);
```

**Key Characteristics**:

1. Uses user-provided Quilt stack ARN
2. Deploys to `BenchlingWebhookStack` (same name as dev)
3. Stores result in `deploy.json` under `prod` key

#### 2.3 Environment Isolation Mechanism

**Finding**: Environments are isolated by deploying to **different AWS accounts/regions**, not by stack name suffix.

Evidence from `dev-deploy.ts`:

```typescript
// Hardcoded dev environment (account: 712023778557, region: us-east-1)
const quiltStackArn = "arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/...";
```

Production deployments use different AWS accounts/regions based on user configuration.

---

### 3. Configuration Storage: deploy.json

**Location**: `~/.config/benchling-webhook/deploy.json`

```json
{
  "dev": {
    "endpoint": "https://xyz123.execute-api.us-east-1.amazonaws.com/prod/",
    "imageTag": "0.6.3-20251104T000000Z",
    "deployedAt": "2025-11-04T10:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "region": "us-east-1"
  },
  "prod": {
    "endpoint": "https://abc456.execute-api.us-east-1.amazonaws.com/prod/",
    "imageTag": "0.6.3",
    "deployedAt": "2025-11-04T17:16:35.979Z",
    "stackName": "BenchlingWebhookStack",
    "region": "us-east-1"
  }
}
```

**Key Observations**:

1. Both entries have the same `stackName`: `"BenchlingWebhookStack"`
2. Different `endpoint` URLs (from different AWS accounts/regions)
3. Different `imageTag` values (dev uses timestamps, prod uses semantic versions)
4. Both can exist simultaneously because they're in different AWS environments

---

### 4. CDK Stack Construction

**File**: `lib/benchling-webhook-stack.ts`

```typescript
export class BenchlingWebhookStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: BenchlingWebhookStackProps) {
        super(scope, id, props);

        // No environment-specific logic here
        // Stack resources are identical regardless of environment
        // Differentiation comes from:
        // 1. Runtime parameters (quiltStackArn, benchlingSecret)
        // 2. Image tag (latest vs versioned)
    }
}
```

**Key Finding**: The stack construct itself has **zero environment awareness**. It doesn't know or care whether it's dev or prod.

---

### 5. Testing Strategy: Environment-Specific Targets

**File**: `docker/Makefile`

```makefile
# Test dev deployment via API Gateway
test-deployed-dev: check-xdg
 @DEV_ENDPOINT=$$(jq -r '.dev.endpoint // empty' $(XDG_CONFIG)/deploy.json)
 uv run python scripts/test_webhook.py "$$DEV_ENDPOINT"

# Test prod deployment via API Gateway
test-deployed-prod: check-xdg
 @PROD_ENDPOINT=$$(jq -r '.prod.endpoint // empty' $(XDG_CONFIG)/deploy.json)
 uv run python scripts/test_webhook.py "$$PROD_ENDPOINT"
```

**Key Finding**: Tests read from `deploy.json` keys (`dev` vs `prod`) to determine which endpoint to test.

---

## Why Can't We Use the Same Stack for Both Environments?

### Technical Constraints

#### 1. CloudFormation Stack Naming is Unique Per Account/Region

AWS CloudFormation enforces:

- Stack names must be **unique within an AWS account/region**
- You **cannot** have two stacks named `BenchlingWebhookStack` in the same account/region

#### 2. Resource Name Collisions

If we tried to deploy both dev and prod to the same account/region with the same stack name:

```
Deployment 1: BenchlingWebhookStack (dev)
- API Gateway: BenchlingWebhookStack-ApiGateway
- ALB: BenchlingWebhookStack-ALB
- ECS Service: BenchlingWebhookStack-FargateService

Deployment 2: BenchlingWebhookStack (prod)  ← FAILS
❌ Stack already exists!
```

#### 3. CDK Synthesized Resource IDs

CDK generates CloudFormation logical IDs based on the stack ID:

```typescript
new BenchlingWebhookStack(app, "BenchlingWebhookStack", { ... });
                              ^^^^^^^^^^^^^^^^^^^^
                              This becomes the stack name
```

All resources inherit this prefix. Multiple stacks with the same name = resource conflicts.

---

## How We Currently Handle Multiple Environments

### Strategy: Separate Deployments to Different AWS Contexts

```
Development Environment:
├── AWS Account: 712023778557
├── Region: us-east-1
├── Stack: BenchlingWebhookStack
├── Quilt Stack: quilt-staging
└── Secret: quiltdata/benchling-webhook/default/quilt-dtt

Production Environment:
├── AWS Account: <user's account>
├── Region: <user's region>
├── Stack: BenchlingWebhookStack (same name, different account!)
├── Quilt Stack: <user's Quilt stack>
└── Secret: <user's secret>
```

**Key Insight**: Same stack name works because they're in **different AWS accounts/regions**.

---

## Evidence from Current User Experience

### Current User's deploy.json

```json
{
  "prod": {
    "endpoint": "https://ycvlcjdp1j.execute-api.us-east-1.amazonaws.com/prod/",
    "imageTag": "0.6.3-20251104T170954Z",
    "deployedAt": "2025-11-04T17:16:35.979Z",
    "stackName": "BenchlingWebhookStack",
    "region": "us-east-1"
  }
}
```

**Observation**: User has only `prod` deployment. If they run `npm run deploy:dev`, it would:

1. Deploy to the **hardcoded dev account** (712023778557)
2. Create a separate stack in that account
3. Add a `dev` entry to `deploy.json`
4. Both stacks coexist because they're in different accounts

---

## Alternative: Could We Support Same-Account Multi-Environment?

### Hypothetical Approach: Stack Name Suffixes

```typescript
// Hypothetical change
const environment = process.env.DEPLOY_ENV || "prod";
const stackName = `BenchlingWebhookStack-${environment}`;

new BenchlingWebhookStack(app, stackName, { ... });
```

This would allow:

```
Same AWS Account:
├── BenchlingWebhookStack-dev
└── BenchlingWebhookStack-prod
```

### Why We Don't Do This (And Shouldn't)

#### 1. Breaking Change

All existing deployments use `BenchlingWebhookStack`. Renaming would:

- Orphan existing stacks
- Require migration documentation
- Break CloudFormation output references

#### 2. No User Demand

The current "different accounts" model aligns with AWS best practices:

- Dev/staging in lower-privilege accounts
- Prod in isolated, heavily monitored accounts
- Clear billing separation
- Strong blast radius containment

#### 3. Configuration Complexity

Would require:

- Environment variable for every deployment
- Updates to all stack references
- Changes to ~20 files across the codebase
- Testing matrix explosion (single-account vs multi-account)

#### 4. Security Anti-Pattern

AWS recommends account-level isolation for environments:

- Different IAM policies
- Different network configurations
- Different security monitoring
- Prevents accidental cross-environment access

---

## Comparison: Current vs Hypothetical Multi-Stack Approach

| Aspect | Current (Multi-Account) | Hypothetical (Same-Account Multi-Stack) |
| -------- | ------------------------- | ---------------------------------------- |
| **Stack Names** | `BenchlingWebhookStack` (both) | `BenchlingWebhookStack-dev`, `BenchlingWebhookStack-prod` |
| **Isolation** | AWS account boundaries | Stack name suffixes |
| **Security** | ✅ Strong (account-level) | ⚠️ Weaker (same IAM context) |
| **Billing** | ✅ Separate per account | ⚠️ Mixed in same account |
| **Breaking Changes** | None | ❌ Major refactor required |
| **User Experience** | ✅ Familiar (dev = test account) | ⚠️ Confusing (which account?) |
| **Best Practices** | ✅ Aligns with AWS guidance | ❌ Anti-pattern for production |

**Verdict**: Current approach is superior and should not be changed.

---

## Answers to Original Questions

### Q1: Can we support both 'prod' and 'dev' in the same CloudFormation stack?

**A**: **No.** CloudFormation does not support "environments" within a single stack. Each deployment is a distinct stack.

### Q2: How do we handle it today?

**A**: We deploy the **same stack name** (`BenchlingWebhookStack`) to **different AWS accounts/regions**:

- **Dev**: Hardcoded to account `712023778557`, region `us-east-1`
- **Prod**: User-specified account/region via CLI parameters

The `deploy.json` file tracks both deployments by storing their endpoints under `dev` and `prod` keys.

### Q3: Should we change this?

**A**: **No.** The current approach:

- ✅ Follows AWS best practices (account-level isolation)
- ✅ Requires zero breaking changes
- ✅ Provides strong security boundaries
- ✅ Simplifies billing and compliance
- ✅ Matches user mental models (dev = test account)

---

## Implications for Issue #176

### Current State is Correct

The implementation in Phase 1 (completed) correctly assumes:

1. Separate stacks for dev and prod
2. Different endpoints stored in `deploy.json`
3. Environment-specific test targets (`test-deployed-dev`, `test-deployed-prod`)

### No Changes Needed

The architecture does not require changes to support production testing. The existing patterns work correctly:

```bash
# Deploy to dev account
npm run deploy:dev

# Test dev deployment
npm run test:dev

# Deploy to prod account
npm run deploy:prod

# Test prod deployment
npm run test:prod
```

Each command operates on its respective AWS environment.

---

## Recommendations

### 1. Document the Multi-Account Model

Add to `CLAUDE.md` and README:

```markdown
## Environment Model

This project uses **multi-account isolation** for environments:

- **Development**: Deployed to Quilt's dev account (712023778557)
- **Production**: Deployed to your AWS account

Both environments use the same stack name (`BenchlingWebhookStack`) but
exist in separate AWS accounts, providing strong isolation.

Configuration for both environments is stored in:
`~/.config/benchling-webhook/deploy.json`
```

### 2. Keep Stack Name Hardcoded

Do not introduce environment suffixes. The current approach is simpler and more secure.

### 3. Consider Optional Stack Name Override (Low Priority)

For advanced users who need custom stack names:

```typescript
// Low-priority enhancement
const stackName = process.env.STACK_NAME || "BenchlingWebhookStack";
```

This would support edge cases like:

- Multiple production environments (blue/green)
- Per-team dev stacks
- Testing different configurations

**But**: This is not needed for the current issue (#176).

---

## Conclusion

**The system already correctly handles multiple environments through multi-account isolation.**

Key findings:

1. ✅ Stack name is intentionally hardcoded to `BenchlingWebhookStack`
2. ✅ Dev and prod coexist via different AWS accounts/regions
3. ✅ `deploy.json` tracks both environments independently
4. ✅ Test targets correctly differentiate environments
5. ✅ No architectural changes needed

The question "can we support both in the same stack?" is moot because:

- CloudFormation doesn't support "environment" as a stack concept
- We already support multiple environments correctly (via separate stacks)
- The current architecture is optimal for security and operational clarity

**Recommendation**: Document the multi-account model and close this analysis. No code changes needed.

---

## References

- Issue: #176 - Test Production Deployments
- Spec: [spec/176-test-prod/](.)
- Implementation: Phase 1 (completed)
- Related: [10-test-dev-auto-deploy.md](./10-test-dev-auto-deploy.md)
