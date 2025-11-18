# Phase 1 Design: Service Environment Variables Implementation

**Issue**: #206 - Service envars

**Branch**: `206-service-envars`

**Date**: 2025-11-06

**Phase**: 1 of 1

**Status**: TECHNICAL DESIGN

## Design Overview

This document provides the detailed technical design for implementing explicit service environment variables, replacing the current stack ARN-based runtime configuration resolution.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Deployment Time                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Profile Config          Deployment Command                      │
│  (~/.config/...)    ──►  (deploy.ts)                            │
│  ┌──────────────┐        │                                       │
│  │ stackArn     │        ├─► resolveQuiltServices()             │
│  │ catalog      │        │   ┌─────────────────────────────┐   │
│  │ database     │        │   │ Query CloudFormation        │   │
│  │ queueUrl     │        │   │ Extract outputs:            │   │
│  └──────────────┘        │   │  - PackagerQueueUrl         │   │
│                          │   │  - UserAthenaDatabaseName   │   │
│                          │   │  - Catalog/CatalogDomain    │   │
│                          │   │  - IcebergDatabase (opt)    │   │
│                          │   └─────────────────────────────┘   │
│                          │                                       │
│                          ├─► Validate Services                  │
│                          ├─► Display Deployment Plan            │
│                          └─► CDK Deploy                          │
│                                │                                 │
│                                ▼                                 │
│                          CloudFormation                          │
│                          Parameters:                             │
│                            - PackagerQueueUrl                    │
│                            - AthenaUserDatabase                  │
│                            - QuiltWebHost                        │
│                            - IcebergDatabase                     │
│                            - BenchlingSecretArn                  │
│                                │                                 │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ Runtime (Container)                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ECS Task Definition     Container Startup                       │
│  Environment Variables   Validation                              │
│  ┌──────────────────┐   ┌─────────────────────────────┐        │
│  │ PACKAGER_SQS_URL │──►│ Check required vars present │        │
│  │ ATHENA_USER_DB   │   │ Validate formats            │        │
│  │ QUILT_WEB_HOST   │   │ Load configuration          │        │
│  │ ICEBERG_DB (opt) │   │ Start Flask application     │        │
│  │ AWS_REGION       │   └─────────────────────────────┘        │
│  │ LOG_LEVEL        │                │                          │
│  │ ...              │                ▼                          │
│  └──────────────────┘          Application Ready                │
│                                 (NO AWS API calls)               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Designs

### Component 1: Service Resolver Module

**Purpose**: Resolve Quilt service endpoints from CloudFormation stack outputs at deployment time

**Location**: `lib/utils/service-resolver.ts` (new file)

#### Interfaces

```typescript
/**
 * Resolved service endpoints from Quilt CloudFormation stack
 */
export interface ResolvedServices {
  /** SQS queue URL for Quilt packager */
  packagerQueueUrl: string;

  /** Athena database name for user data */
  athenaUserDatabase: string;

  /** Quilt catalog hostname (without protocol) */
  quiltWebHost: string;

  /** (Optional) Iceberg database name */
  icebergDatabase?: string;

  /** (Optional) Package bucket name if not in profile */
  packageBucket?: string;
}

/**
 * Options for service resolution
 */
export interface ServiceResolverOptions {
  /** CloudFormation stack ARN */
  stackArn: string;

  /** AWS region (parsed from ARN if not provided) */
  region?: string;

  /** (Optional) Mock CloudFormation client for testing */
  mockCloudFormation?: CloudFormationClient;
}
```

#### Functions

```typescript
/**
 * Parse CloudFormation stack ARN
 * Reuse from config-resolver.ts or inline here
 */
export function parseStackArn(arn: string): ParsedStackArn

/**
 * Extract and normalize catalog URL from various output formats
 */
function normalizeCatalogUrl(
  outputs: Record<string, string>
): string

/**
 * Validate SQS queue URL format
 */
function validateQueueUrl(url: string): boolean

/**
 * Main service resolution function
 */
export async function resolveQuiltServices(
  options: ServiceResolverOptions
): Promise<ResolvedServices>
```

#### Implementation Details

**resolveQuiltServices() Algorithm**:

1. Parse stack ARN to extract region
2. Create CloudFormation client (or use mock)
3. Query stack outputs via DescribeStacks
4. Extract required outputs with fallback logic:
   - Queue URL: `PackagerQueueUrl` OR `QueueUrl`
   - Database: `UserAthenaDatabaseName` OR `AthenaUserDatabase`
   - Catalog: `Catalog` OR `CatalogDomain` OR extract from `ApiGatewayEndpoint`
   - Iceberg: `IcebergDatabase` (optional)
   - Bucket: `UserBucket` OR `BucketName` (optional)
5. Validate required outputs present
6. Normalize catalog URL (remove protocol, trailing slash)
7. Validate queue URL format
8. Return resolved services

**Error Handling**:
- Throw descriptive errors for missing required outputs
- List available outputs in error message
- Provide suggestions for common issues
- Use existing `ConfigResolverError` pattern

**Catalog URL Normalization**:
```typescript
function normalizeCatalogUrl(outputs: Record<string, string>): string {
  // Priority order: Catalog > CatalogDomain > ApiGatewayEndpoint
  let url = outputs.Catalog || outputs.CatalogDomain;

  if (!url && outputs.ApiGatewayEndpoint) {
    // Extract hostname from API Gateway URL
    try {
      const parsed = new URL(outputs.ApiGatewayEndpoint);
      url = parsed.hostname;
    } catch {
      throw new Error("Invalid ApiGatewayEndpoint format");
    }
  }

  if (!url) {
    throw new Error("Could not determine catalog URL");
  }

  // Remove protocol and trailing slash
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
```

---

### Component 2: Enhanced Deployment Command

**Purpose**: Orchestrate service resolution and pass to CDK

**Location**: `bin/commands/deploy.ts` (enhance existing)

#### Changes

**New Imports**:
```typescript
import { resolveQuiltServices, type ResolvedServices } from "../../lib/utils/service-resolver";
```

**Enhanced deploy() Function**:

```typescript
async function deploy(
  stackArn: string,
  benchlingSecret: string,
  config: ProfileConfig,
  options: DeployOptions
): Promise<void> {
  // ... existing validation ...

  // NEW: Resolve services from Quilt stack
  spinner.start("Resolving Quilt services from CloudFormation...");
  let services: ResolvedServices;
  try {
    services = await resolveQuiltServices({
      stackArn,
      region: deployRegion
    });
    spinner.succeed("Services resolved successfully");
  } catch (error) {
    spinner.fail("Failed to resolve services");
    console.error(chalk.red((error as Error).message));
    // Provide helpful suggestions
    console.log(chalk.yellow("\nTroubleshooting:"));
    console.log("  1. Verify Quilt stack is deployed and accessible");
    console.log("  2. Check required CloudFormation outputs exist");
    console.log("  3. Ensure AWS credentials have CloudFormation:DescribeStacks permission");
    process.exit(1);
  }

  // Display resolved services in deployment plan
  console.log(chalk.bold("  Resolved Services:"));
  console.log(`    ${chalk.bold("Packager Queue:")}      ${services.packagerQueueUrl}`);
  console.log(`    ${chalk.bold("Athena Database:")}     ${services.athenaUserDatabase}`);
  console.log(`    ${chalk.bold("Quilt Catalog:")}       ${services.quiltWebHost}`);
  if (services.icebergDatabase) {
    console.log(`    ${chalk.bold("Iceberg Database:")}   ${services.icebergDatabase}`);
  }
  console.log();

  // ... existing confirmation ...

  // Build CloudFormation parameters with resolved services
  const parameters = [
    // NEW: Service parameters
    `PackagerQueueUrl=${services.packagerQueueUrl}`,
    `AthenaUserDatabase=${services.athenaUserDatabase}`,
    `QuiltWebHost=${services.quiltWebHost}`,
    `IcebergDatabase=${services.icebergDatabase || ""}`,

    // Existing parameters
    `BenchlingSecretArn=${benchlingSecret}`,
    `PackageBucket=${config.packages.bucket}`,
    `ImageTag=${options.imageTag}`,
    `LogLevel=${config.logging?.level || "INFO"}`,
  ];

  // ... rest of deployment ...
}
```

---

### Component 3: Updated CDK Stack

**Purpose**: Accept service parameters and create environment variables

**Location**: `lib/benchling-webhook-stack.ts`

#### Changes

**New CloudFormation Parameters**:

```typescript
// NEW: Service-specific parameters
const packagerQueueUrlParam = new cdk.CfnParameter(this, "PackagerQueueUrl", {
  type: "String",
  description: "SQS queue URL for Quilt packager",
  // No default - must be provided by deployment command
});

const athenaUserDatabaseParam = new cdk.CfnParameter(this, "AthenaUserDatabase", {
  type: "String",
  description: "Athena database name for user data",
  // No default - must be provided by deployment command
});

const quiltWebHostParam = new cdk.CfnParameter(this, "QuiltWebHost", {
  type: "String",
  description: "Quilt catalog hostname (without protocol)",
  // No default - must be provided by deployment command
});

const icebergDatabaseParam = new cdk.CfnParameter(this, "IcebergDatabase", {
  type: "String",
  description: "Iceberg database name (optional, empty string if not available)",
  default: "",
});

// UPDATED: Rename for clarity
const benchlingSecretParam = new cdk.CfnParameter(this, "BenchlingSecretArn", {
  type: "String",
  description: "ARN of Secrets Manager secret with Benchling credentials",
  default: config.benchling.secretArn,
});

// REMOVED: QuiltStackARN parameter no longer needed
```

**Updated Fargate Service Call**:

```typescript
this.fargateService = new FargateService(this, "FargateService", {
  vpc,
  bucket: this.bucket,
  config: config,
  ecrRepository: ecrRepo,
  imageTag: imageTagValue,
  stackVersion: stackVersion,

  // NEW: Pass resolved service values
  packagerQueueUrl: packagerQueueUrlParam.valueAsString,
  athenaUserDatabase: athenaUserDatabaseParam.valueAsString,
  quiltWebHost: quiltWebHostParam.valueAsString,
  icebergDatabase: icebergDatabaseParam.valueAsString,

  // Existing parameters
  benchlingSecretArn: benchlingSecretParam.valueAsString,
  packageBucket: packageBucketValue,
  logLevel: logLevelValue,

  // REMOVED: stackArn parameter
});
```

---

### Component 4: Updated Fargate Service

**Purpose**: Create environment variables from explicit parameters

**Location**: `lib/fargate-service.ts`

#### Changes

**Updated Props Interface**:

```typescript
export interface FargateServiceProps {
  readonly vpc: ec2.IVpc;
  readonly bucket: s3.IBucket;
  readonly config: ProfileConfig;
  readonly ecrRepository: ecr.IRepository;
  readonly imageTag?: string;
  readonly stackVersion?: string;

  // NEW: Explicit service parameters
  readonly packagerQueueUrl: string;
  readonly athenaUserDatabase: string;
  readonly quiltWebHost: string;
  readonly icebergDatabase: string;  // Empty string if not available

  // Existing parameters
  readonly benchlingSecretArn: string;
  readonly packageBucket: string;
  readonly logLevel?: string;

  // REMOVED: stackArn parameter
}
```

**Updated Environment Variables**:

```typescript
const environmentVars: { [key: string]: string } = {
  // AWS Infrastructure
  AWS_REGION: region,
  AWS_DEFAULT_REGION: region,

  // NEW: Explicit service configuration
  PACKAGER_SQS_URL: props.packagerQueueUrl,
  ATHENA_USER_DATABASE: props.athenaUserDatabase,
  QUILT_WEB_HOST: props.quiltWebHost,
  ICEBERG_DATABASE: props.icebergDatabase,  // May be empty string

  // Benchling Configuration
  BENCHLING_SECRET_ARN: props.benchlingSecretArn,
  BENCHLING_TENANT: config.benchling.tenant,
  PACKAGE_BUCKET: props.packageBucket,
  PACKAGE_PREFIX: config.packages.prefix,
  PACKAGE_METADATA_KEY: config.packages.metadataKey,

  // Application Configuration
  FLASK_ENV: "production",
  LOG_LEVEL: props.logLevel || config.logging?.level || "INFO",
  ENABLE_WEBHOOK_VERIFICATION: config.security?.enableVerification !== false ? "true" : "false",
  BENCHLING_WEBHOOK_VERSION: props.stackVersion || props.imageTag || "latest",

  // REMOVED: QuiltStackARN, BenchlingSecret (renamed)
};
```

**Updated IAM Permissions**:

```typescript
// REMOVED: CloudFormation permissions (Lines 85-93)
// taskRole.addToPolicy(
//   new iam.PolicyStatement({
//     actions: [
//       "cloudformation:DescribeStacks",
//       "cloudformation:DescribeStackResources",
//     ],
//     resources: [props.stackArn],
//   }),
// );

// UPDATED: SQS permissions with explicit queue ARN
const queueArn = queueArnFromUrl(props.packagerQueueUrl, region, account);
taskRole.addToPolicy(
  new iam.PolicyStatement({
    actions: [
      "sqs:SendMessage",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
    ],
    resources: [queueArn],
  }),
);

// UPDATED: Glue permissions with explicit database
taskRole.addToPolicy(
  new iam.PolicyStatement({
    actions: [
      "glue:GetDatabase",
      "glue:GetTable",
      "glue:GetPartitions",
    ],
    resources: [
      `arn:aws:glue:${region}:${account}:catalog`,
      `arn:aws:glue:${region}:${account}:database/${props.athenaUserDatabase}`,
      `arn:aws:glue:${region}:${account}:table/${props.athenaUserDatabase}/*`,
    ],
  }),
);

// NEW: If Iceberg database provided, add permissions
if (props.icebergDatabase) {
  taskRole.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "glue:GetDatabase",
        "glue:GetTable",
        "glue:GetPartitions",
      ],
      resources: [
        `arn:aws:glue:${region}:${account}:database/${props.icebergDatabase}`,
        `arn:aws:glue:${region}:${account}:table/${props.icebergDatabase}/*`,
      ],
    }),
  );
}
```

**Helper Function for Queue ARN**:

```typescript
/**
 * Extract queue ARN from SQS URL
 * Format: https://sqs.{region}.amazonaws.com/{account}/{queue-name}
 */
function queueArnFromUrl(url: string, region: string, account: string): string {
  const match = url.match(/\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid SQS URL format: ${url}`);
  }
  const queueName = match[1];
  return `arn:aws:sqs:${region}:${account}:${queueName}`;
}
```

---

### Component 5: Type Definition Updates

**Purpose**: Update configuration interfaces

**Location**: `lib/types/config.ts`

#### Changes

**Updated QuiltConfig Interface**:

```typescript
export interface QuiltConfig {
  /**
   * Quilt CloudFormation stack ARN (optional, for deployment-time resolution)
   *
   * This field is used by the deployment command to resolve service endpoints
   * from CloudFormation stack outputs. It is NOT passed to the container.
   *
   * If not provided, all service fields (catalog, database, queueUrl) must be
   * specified explicitly in the configuration.
   *
   * @example "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-stack/..."
   */
  stackArn?: string;

  /**
   * Quilt catalog domain (without protocol)
   *
   * Resolved from stack Catalog/CatalogDomain output or specified explicitly.
   * Passed to container as QUILT_WEB_HOST environment variable.
   *
   * @example "quilt.example.com"
   */
  catalog: string;

  /**
   * Athena/Glue database name for catalog metadata
   *
   * Resolved from stack UserAthenaDatabaseName output or specified explicitly.
   * Passed to container as ATHENA_USER_DATABASE environment variable.
   *
   * @example "quilt_catalog"
   */
  database: string;

  /**
   * SQS queue URL for package creation jobs
   *
   * Resolved from stack PackagerQueueUrl output or specified explicitly.
   * Passed to container as PACKAGER_SQS_URL environment variable.
   *
   * @example "https://sqs.us-east-1.amazonaws.com/123456789012/quilt-package-queue"
   */
  queueUrl: string;

  /**
   * AWS region for Quilt resources
   *
   * @example "us-east-1"
   */
  region: string;

  /**
   * (Optional) Iceberg database name
   *
   * Resolved from stack IcebergDatabase output if available.
   * Passed to container as ICEBERG_DATABASE environment variable (empty if not available).
   *
   * @example "quilt_iceberg_catalog"
   */
  icebergDatabase?: string;
}
```

**No Schema Changes**: JSON schema remains the same (backward compatible)

---

## Data Flow

### Deployment Flow

```
1. User runs: npm run deploy:prod -- --profile sales

2. deploy.ts loads profile config
   ├─ Profile: ~/.config/benchling-webhook/sales/config.json
   └─ Extract: stackArn, benchlingSecret, etc.

3. deploy.ts resolves services
   ├─ Call: resolveQuiltServices({ stackArn, region })
   ├─ Query: CloudFormation DescribeStacks
   ├─ Extract: PackagerQueueUrl, UserAthenaDatabaseName, Catalog
   └─ Return: ResolvedServices object

4. deploy.ts displays deployment plan
   ├─ Show: Resolved service endpoints
   └─ Confirm: User approval (unless --yes)

5. deploy.ts calls CDK deploy
   ├─ Pass: CloudFormation parameters
   │   ├─ PackagerQueueUrl=https://sqs...
   │   ├─ AthenaUserDatabase=quilt_catalog
   │   ├─ QuiltWebHost=quilt.example.com
   │   ├─ IcebergDatabase=quilt_iceberg
   │   └─ BenchlingSecretArn=arn:aws:secretsmanager...
   └─ Execute: npx cdk deploy

6. CDK synthesizes stack
   ├─ Create: CloudFormation parameters
   ├─ Pass: Parameters to Fargate service
   └─ Generate: Task definition with environment variables

7. CloudFormation deploys stack
   ├─ Create/Update: ECS task definition
   ├─ Set: Environment variables from parameters
   └─ Update: ECS service

8. ECS starts container
   ├─ Load: Environment variables
   ├─ Validate: Required variables present
   ├─ Start: Flask application
   └─ Ready: No AWS API calls needed
```

### Runtime Flow

```
1. Container starts
   ├─ Read: Environment variables
   └─ No CloudFormation API calls

2. Validate configuration
   ├─ Check: Required variables present
   │   ├─ PACKAGER_SQS_URL (required)
   │   ├─ ATHENA_USER_DATABASE (required)
   │   ├─ QUILT_WEB_HOST (required)
   │   └─ BENCHLING_SECRET_ARN (required)
   ├─ Validate: Format (URLs, ARNs)
   └─ Log: Configuration summary

3. Initialize application
   ├─ Connect: Secrets Manager (fetch Benchling creds)
   └─ Start: Flask server

4. Health check
   ├─ /health: Basic liveness
   └─ /health/ready: Service connectivity checks
       ├─ Can send to SQS? (optional check)
       ├─ Can query Athena? (optional check)
       └─ Secrets accessible? (required check)

5. Process webhooks
   ├─ Receive: Benchling webhook
   ├─ Send: Message to SQS (using PACKAGER_SQS_URL)
   └─ Return: Success response
```

## Testing Strategy

### Unit Tests

**New Tests for service-resolver.ts**:

```typescript
describe("resolveQuiltServices", () => {
  test("resolves all required services", async () => {
    const mockCfn = mockCloudFormationClient({
      PackagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      UserAthenaDatabaseName: "quilt_db",
      Catalog: "quilt.example.com",
      IcebergDatabase: "iceberg_db"
    });

    const services = await resolveQuiltServices({
      stackArn: "arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/id",
      mockCloudFormation: mockCfn
    });

    expect(services.packagerQueueUrl).toBe("https://sqs.us-east-1.amazonaws.com/123/queue");
    expect(services.athenaUserDatabase).toBe("quilt_db");
    expect(services.quiltWebHost).toBe("quilt.example.com");
    expect(services.icebergDatabase).toBe("iceberg_db");
  });

  test("handles missing optional Iceberg database", async () => {
    const mockCfn = mockCloudFormationClient({
      PackagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      UserAthenaDatabaseName: "quilt_db",
      Catalog: "quilt.example.com"
      // No IcebergDatabase
    });

    const services = await resolveQuiltServices({
      stackArn: "arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/id",
      mockCloudFormation: mockCfn
    });

    expect(services.icebergDatabase).toBeUndefined();
  });

  test("normalizes catalog URL from ApiGatewayEndpoint", async () => {
    const mockCfn = mockCloudFormationClient({
      PackagerQueueUrl: "https://sqs.us-east-1.amazonaws.com/123/queue",
      UserAthenaDatabaseName: "quilt_db",
      ApiGatewayEndpoint: "https://abc123.execute-api.us-east-1.amazonaws.com/prod/"
    });

    const services = await resolveQuiltServices({
      stackArn: "arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/id",
      mockCloudFormation: mockCfn
    });

    expect(services.quiltWebHost).toBe("abc123.execute-api.us-east-1.amazonaws.com");
  });

  test("throws error for missing required output", async () => {
    const mockCfn = mockCloudFormationClient({
      UserAthenaDatabaseName: "quilt_db",
      Catalog: "quilt.example.com"
      // Missing PackagerQueueUrl
    });

    await expect(
      resolveQuiltServices({
        stackArn: "arn:aws:cloudformation:us-east-1:123:stack/QuiltStack/id",
        mockCloudFormation: mockCfn
      })
    ).rejects.toThrow("Missing required output: PackagerQueueUrl");
  });
});
```

**Updated Tests for deploy.ts**:
- Test service resolution integration
- Test deployment plan display
- Test parameter passing to CDK
- Test error handling for resolution failures

**Updated Tests for Fargate Service**:
- Test environment variable creation
- Test IAM permission updates
- Test queue ARN extraction
- Test Iceberg database permissions (conditional)

### Integration Tests

**Docker Compose Test**:

Update `docker-compose.yml` to use explicit environment variables:

```yaml
services:
  app-dev:
    environment:
      # NEW: Explicit service configuration
      - PACKAGER_SQS_URL=${PACKAGER_SQS_URL}
      - ATHENA_USER_DATABASE=${ATHENA_USER_DATABASE}
      - QUILT_WEB_HOST=${QUILT_WEB_HOST}
      - ICEBERG_DATABASE=${ICEBERG_DATABASE:-}

      # Existing configuration
      - BENCHLING_SECRET_ARN=${BENCHLING_SECRET_ARN}
      - AWS_REGION=${AWS_REGION}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}

      # REMOVED: QuiltStackARN
```

**Local Test Script**:

Update `scripts/run_local.py` to load explicit env vars from profile.

**Deployment Tests**:
1. Deploy to dev environment
2. Verify container starts successfully
3. Check CloudWatch logs for no CloudFormation API calls
4. Verify health check passes
5. Test webhook processing end-to-end

### Performance Tests

**Startup Time Measurement**:
- Record ECS task start timestamp
- Record health check ready timestamp
- Calculate difference
- Compare with baseline (current: ~7s, target: <5s)

**Load Test**:
- Concurrent container starts (scale up event)
- Measure time to all healthy
- Verify no CloudFormation throttling

## Security Considerations

### IAM Permission Reduction

**Before** (Current):
- `cloudformation:DescribeStacks` on stack ARN
- `cloudformation:DescribeStackResources` on stack ARN
- Broad SQS permissions (wildcard)

**After** (New):
- ❌ No CloudFormation permissions
- ✅ Specific SQS queue ARN
- ✅ Specific Glue database ARNs
- ✅ Specific Secrets Manager ARN

**Security Improvement**:
- Reduced attack surface
- Principle of least privilege
- No access to CloudFormation API
- Explicit resource-level permissions

### Secrets Handling

**No Changes**: Secrets Manager integration remains the same
- Benchling credentials stored in Secrets Manager
- Container fetches at startup
- Secrets not logged or exposed

### Configuration Visibility

**Trade-off**: Service URLs visible in ECS console

**Assessment**:
- ✅ Non-sensitive information (service endpoints)
- ✅ Improves debugging and transparency
- ✅ Audit trail of configuration
- ⚠️ Internal URLs exposed (acceptable risk)

## Operational Considerations

### Deployment Updates

**Configuration Change Scenarios**:

1. **Queue URL Changes**:
   - Update profile config or stack outputs
   - Redeploy (not just stack update)
   - Container gets new queue URL

2. **Database Name Changes**:
   - Update profile config or stack outputs
   - Redeploy
   - Container gets new database name

3. **Catalog URL Changes**:
   - Update profile config or stack outputs
   - Redeploy
   - Container gets new catalog URL

**Redeployment Required**: Yes, for any service endpoint change

### Monitoring

**New Metrics to Track**:
- Service resolution success/failure rate
- Deployment time (should be similar)
- Container startup time (should decrease)
- CloudFormation API call count (should be zero in container)

**Existing Metrics**:
- Continue monitoring webhook processing
- Continue monitoring package creation
- Continue monitoring error rates

### Rollback Procedure

If issues discovered after deployment:

1. **Git Rollback**:
   ```bash
   git revert <commit-hash>
   npm run deploy:prod -- --yes
   ```

2. **CloudFormation Rollback**:
   - Use AWS Console or CLI
   - Stack will revert to previous parameters
   - Old task definition restored

3. **Manual Rollback**:
   - Update CloudFormation parameters to old values
   - Update task definition manually
   - Force new deployment

## Next Steps

After design approval:
1. Create episodes document (atomic implementation steps)
2. Create checklist document (detailed task tracking)
3. Begin implementation following episodes
4. Test after each episode
5. Update documentation
