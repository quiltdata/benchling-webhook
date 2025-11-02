# Configuration Documentation Gaps & Tensions

**Analysis Date:** 2025-11-02
**Documents Analyzed:** `env.template`, `AGENTS.md`, `docs/CONFIG.md`

---

## Executive Summary

The core tension is between **aspirational automation** (AGENTS.md/CONFIG.md) and **operational reality** (env.template). The docs promise one-command setup, but env.template shows manual multi-step configuration. This creates cognitive dissonance for users who start with env.template and never discover the automated tooling.

The most critical gap is the missing **`QUILT_STACK_ARN`** parameter, which is referenced in multiple places but never actually appears in the configuration template where users would set it.

---

## 1. Configuration Approach Contradiction

**Tension:**

- **AGENTS.md (Section 2.1)** promises one-command bootstrap: `npx @quiltdata/benchling-webhook`
- **CONFIG.md (Section 2.2)** shows same workflow
- **env.template** shows ONLY manual configuration with no mention of auto-inference

**Gap:** env.template doesn't reference or guide users toward the automated `get-env` approach that the other docs promote as "recommended."

**Impact:** Users following env.template miss the entire automated configuration story.

**Recommendation:** Add prominent note at top of env.template referencing `npm run get-env` as the recommended path.

---

## 2. Parameter Classification Mismatch

**env.template** has 3 tiers:

- ALWAYS REQUIRED (7 params)
- POSSIBLY REQUIRED (2 params)
- Optional (5 params)

**CONFIG.md** has 2 tiers:

- Core Parameters (6 params)
- Optional Parameters (3 params)

**Tension:** Different groupings and counts create confusion about what's truly required vs. optional.

**Recommendation:** Standardize on a single classification scheme across all docs. Suggest:

- **Deployment-time Required** (needed for CDK deploy)
- **Runtime Required** (needed for Lambda/Fargate execution)
- **Testing Required** (needed for integration tests)
- **Optional** (overrides and advanced config)

---

## 3. Missing Quilt Stack ARN

**AGENTS.md Section 2.1** says bootstrap will:
> "Retrieve the associated **CloudFormation Stack ARN** from the catalog's metadata."

**env.template:** Has NO field for `QUILT_STACK_ARN` or similar

**CONFIG.md Section 5.1:** Lists `SQSQueueArn` as "Derived from Quilt stack" but doesn't show the source parameter

**Gap:** The critical `QuiltStackARN` parameter (mentioned in env.template notes line 60) is missing from the main parameter list.

**Impact:** Users cannot manually configure the Quilt stack integration even if they wanted to.

**Recommendation:** Add to env.template:

```bash
#
# INFRASTRUCTURE PARAMETERS
#

# CloudFormation Stack ARN for Quilt Stack
# Auto-inferred by 'npm run get-env', or find manually:
# aws cloudformation describe-stacks --query "Stacks[?contains(StackName, 'Quilt')].StackId" --output text
QUILT_STACK_ARN=arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/uuid
```

---

## 4. Secrets Management Workflow Ambiguity

**AGENTS.md Section 4:** Lists "Secrets not found" as failure mode, suggests `npm run secrets:sync`

**CONFIG.md Section 3:** Describes `npm run secrets:sync` command

**env.template:** Has NO mention of secrets management or the sync command

**Gap:** Users following env.template won't know they need to sync secrets to AWS Secrets Manager before deployment.

**Impact:** Deployments will fail with cryptic errors about missing secrets.

**Recommendation:** Add to env.template notes:

```bash
# ==============================================================================
# SECRETS MANAGEMENT
# ==============================================================================
#
# After filling in the values above, run:
#   npm run secrets:sync
#
# This uploads your configuration to AWS Secrets Manager under:
#   benchling-webhook/<environment>/config
#
# The deployed stack reads ALL runtime parameters from Secrets Manager,
# not from environment variables.
```

---

## 5. Runtime vs. Deployment Parameters Confusion

**env.template lines 63-68** state:
> "The deployed stack resolves ALL configuration from just 2 sources:
>
> - QuiltStackARN
> - BenchlingSecret"

But env.template lists **14 parameters** that users must provide.

**Tension:** Users may wonder why they need to provide 14 parameters if the stack only uses 2 at runtime. The distinction between "deployment-time" and "runtime" parameters is unclear.

**Impact:** Users don't understand the parameter lifecycle and may try to reconfigure live stacks by editing .env.

**Recommendation:** Add table to env.template showing parameter lifecycle:

| Parameter | Used at Deploy Time | Used at Runtime | Stored In |
|-----------|---------------------|-----------------|-----------|
| `QUILT_STACK_ARN` | Yes | No | CloudFormation |
| `BENCHLING_TENANT` | No | Yes | Secrets Manager |
| `BENCHLING_CLIENT_ID` | No | Yes | Secrets Manager |
| `BENCHLING_CLIENT_SECRET` | No | Yes | Secrets Manager |
| `BENCHLING_APP_DEFINITION_ID` | No | Yes | Secrets Manager |
| `BENCHLING_USER_BUCKET` | No | Yes | Secrets Manager |
| `QUILT_CATALOG` | No | Yes | Secrets Manager |

---

## 6. Test Entry ID Status

**env.template line 26-27:**

```bash
BENCHLING_TEST_ENTRY=etr_123456789
# Actual entry ID from your tenant, needed to run integration tests
```

Marked as "POSSIBLY REQUIRED" but:

- **AGENTS.md Section 3.3:** Shows integration tests without mentioning this requirement
- **CONFIG.md Section 7.5:** Describes integration tests but doesn't mention `BENCHLING_TEST_ENTRY`

**Gap:** Unclear when this parameter is actually required.

**Recommendation:** Move to "TESTING PARAMETERS" section with explicit usage:

```bash
#
# TESTING PARAMETERS (only required for test-integration)
#

# Actual entry ID from your Benchling tenant
# Required for: make -C docker test-integration
# Not required for: deployment or local testing
BENCHLING_TEST_ENTRY=etr_123456789
```

---

## 7. Image Tag Management

**CONFIG.md Section 4.2:** States version comes from `package.json` OR `IMAGE_TAG` env var

**env.template:** Has NO `IMAGE_TAG` parameter

**AGENTS.md:** Doesn't mention image tagging at all

**Gap:** Advanced users wanting to override image tags have no guidance in env.template.

**Recommendation:** Add to "ADVANCED PARAMETERS" section:

```bash
#
# ADVANCED PARAMETERS (overrides for experts)
#

# Override Docker image tag (defaults to package.json version)
# IMAGE_TAG=custom-build-123

# Override ECS task resources
# ECS_CPU=512
# ECS_MEMORY=1024
```

---

## 8. VPC/Networking Parameters

**CONFIG.md Section 5.1:** Lists `VpcId` and `SubnetIds` as "Configurable" core parameters

**env.template:** Has ZERO networking parameters

**Gap:** Users with specific VPC requirements won't find guidance in env.template.

**Impact:** Users in restricted networking environments cannot deploy without code diving.

**Recommendation:** Add to "ADVANCED PARAMETERS" section:

```bash
# VPC Configuration (defaults to default VPC if not specified)
# VPC_ID=vpc-abc123
# SUBNET_IDS=subnet-abc123,subnet-def456
```

---

## 9. Bootstrap Command Inconsistency

**env.template lines 56-61** show Quick Start as:

```bash
1. Copy this file to .env
2. Fill in BENCHLING_* variables
3. Create secret: npm run config
4. Fill in QuiltStackARN
5. Deploy: npm run deploy
```

**AGENTS.md Section 2.1** shows:

```bash
npx @quiltdata/benchling-webhook
```

**CONFIG.md Section 2.2** shows both approaches but calls auto-inference "simplest"

**Tension:** env.template promotes manual workflow while docs promote automation.

**Impact:** Users get conflicting guidance on the "right way" to set up.

**Recommendation:** Rewrite env.template Quick Start to show BOTH paths:

```bash
# ==============================================================================
# QUICK START
# ==============================================================================
#
# Option A (RECOMMENDED): Automated Setup
#   npm run get-env -- https://your-quilt-catalog.com --write
#   cp env.inferred .env
#   # Edit .env to add Benchling credentials
#   npm run secrets:sync
#   npm run deploy
#
# Option B: Manual Setup
#   cp env.template .env
#   # Edit .env with all values below
#   npm run secrets:sync
#   npm run deploy
```

---

## 10. Parameter Naming Inconsistency

| env.template | CONFIG.md | Actual CDK Usage |
|--------------|-----------|------------------|
| `BENCHLING_USER_BUCKET` | `S3Bucket` | ? |
| `QUILT_CATALOG` | `QuiltCatalogUrl` | ? |
| Missing | `SQSQueueArn` | ? |

**Gap:** No clear mapping between environment variable names and CloudFormation parameter names.

**Impact:** Users reading stack outputs or CloudFormation console see different names than .env file.

**Recommendation:** Add mapping table to CONFIG.md:

| Environment Variable | CloudFormation Parameter | Description |
|---------------------|--------------------------|-------------|
| `QUILT_STACK_ARN` | `QuiltStackARN` | Source stack for Quilt resources |
| `BENCHLING_USER_BUCKET` | `S3Bucket` | S3 bucket for exports |
| `QUILT_CATALOG` | `QuiltCatalogUrl` | Quilt catalog endpoint |
| (derived from stack) | `SQSQueueArn` | Queue for package creation |

---

## Priority Recommendations

### Priority 1: Align env.template with Automation Story

- [ ] Add prominent note at top referencing `npm run get-env` as recommended path
- [ ] Add `QUILT_STACK_ARN` to ALWAYS REQUIRED section
- [ ] Add reference to `npm run secrets:sync` in notes

### Priority 2: Clarify Parameter Lifecycle

- [ ] Add table showing: "Parameter" | "Used at Deployment" | "Used at Runtime" | "Source"
- [ ] Explicitly distinguish between what goes in .env vs. what goes in AWS Secrets Manager

### Priority 3: Standardize Parameter Naming

- [ ] Create canonical mapping between env vars and CloudFormation parameters
- [ ] Document both names consistently across all files

### Priority 4: Unify Testing Requirements

- [ ] Clarify when `BENCHLING_TEST_ENTRY` is required (answer: only for `test-integration`)
- [ ] Add all test-related env vars to optional section with clear usage notes

### Priority 5: Add Advanced Configuration Section

- [ ] Document `IMAGE_TAG`, `VpcId`, `SubnetIds` as advanced overrides
- [ ] Show how to pass these to CDK deployment

---

## Conclusion

The documentation set has a **documentation drift problem**: the aspirational workflow described in AGENTS.md and CONFIG.md doesn't match the operational template in env.template. This creates three distinct user experiences:

1. **Users who read docs first:** Expect one-command automation, may get confused by env.template's manual approach
2. **Users who start with env.template:** Miss entire automation story, do everything manually
3. **Users who read all three:** Notice inconsistencies and lose confidence

**Recommendation:** Treat env.template as the **single source of truth** for parameter documentation, and have AGENTS.md/CONFIG.md reference it rather than duplicate information. This inverts the current model where env.template is a "dumb template" and docs are "smart guides."
