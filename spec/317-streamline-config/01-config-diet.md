# Refactor: Decouple Stack from ProfileConfig

## Problem

The CDK stack constructor currently requires the entire `ProfileConfig` object, which includes wizard metadata, deployment tracking, and optional test fields.

**The current flow is absurdly convoluted:**

1. `bin/commands/deploy.ts` reads `ProfileConfig` from XDG config
2. Converts to environment variables via `buildCdkEnv()` (lossy transformation!)
3. Spawns `npx cdk deploy` with env vars
4. `bin/benchling-webhook.ts` reads env vars and reconstructs `ProfileConfig`
5. Immediately converts `ProfileConfig` to `ProfileConfig` again (identity transformation at line 88-127)
6. Passes bloated `ProfileConfig` to `BenchlingWebhookStack`

**This creates several issues:**

1. **Unnecessary round-trip**: ProfileConfig → env vars → ProfileConfig reconstruction
2. **Testing pain**: Must mock entire ProfileConfig with irrelevant fields
3. **Tight coupling**: Stack depends on wizard-specific configuration format
4. **Poor separation of concerns**: Stack shouldn't know about wizard metadata
5. **Data loss**: Some ProfileConfig fields can't be serialized to env vars

## Solution

**Keep XDG config files unchanged** - The setup wizard continues to read/write full `ProfileConfig` to `~/.config/benchling-webhook/{profile}/config.json`.

**Create minimal stack interface** - Extract only what the CDK stack actually needs into a new `StackConfig` interface.

**Transform at call site** - Convert `ProfileConfig` → `StackConfig` in [bin/benchling-webhook.ts](../../bin/benchling-webhook.ts) before passing to stack.

## What the Stack Actually Uses

Based on analysis of [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts), [lib/fargate-service.ts](../../lib/fargate-service.ts), and [lib/rest-api-gateway.ts](../../lib/rest-api-gateway.ts):

### Required Fields

- `benchling.secretArn` - CloudFormation parameter
- `benchling.tenant` - Console logging only
- `benchling.clientId` - Passed to Fargate environment
- `benchling.appDefinitionId` - Passed to Fargate environment
- `quilt.catalog` - CloudFormation parameter (validation required)
- `quilt.database` - CloudFormation parameter (validation required)
- `quilt.queueUrl` - CloudFormation parameter (validation required)
- `quilt.region` - Passed to Fargate environment
- `packages.bucket` - CloudFormation parameter + IAM permissions
- `packages.prefix` - Passed to Fargate environment
- `packages.metadataKey` - Passed to Fargate environment
- `deployment.region` - Stack environment
- `deployment.vpc` - VPC configuration (if specified)
- `deployment.ecrRepository` - ECR image URI construction
- `deployment.imageTag` - Docker image tag (default: "latest")

### Optional Fields

- `logging.level` - CloudFormation parameter (default: "INFO")
- `security.webhookAllowList` - Resource policy IP filtering
- `security.enableVerification` - Passed to Fargate environment (default: true)
- `quilt.athenaUserWorkgroup` - CloudFormation parameter (optional)
- `quilt.athenaResultsBucket` - CloudFormation parameter (optional)
- `quilt.writeRoleArn` - IAM role assumption (optional)

### NOT Used by Stack

- `benchling.clientSecret` - Only for local testing
- `benchling.testEntryId` - Only for setup wizard validation
- `quilt.stackArn` - Only for setup wizard to resolve outputs
- `quilt.athenaUserPolicy` - Not referenced in stack code
- `quilt.athenaResultsBucketPolicy` - Not referenced in stack code
- `deployment.account` - Auto-detected by CDK if not provided
- `deployment.stackName` - Used by CLI, not by stack constructor
- `integratedStack` - Used by setup wizard, not stack
- `_metadata.*` - Wizard provenance tracking only
- `_inherits` - Profile inheritance, not stack concern

## Implementation Plan

### 1. Create `StackConfig` Interface

**File:** [lib/types/stack-config.ts](../../lib/types/stack-config.ts) (new file)

```typescript
/**
 * Minimal configuration interface for CDK stack construction
 *
 * This interface contains ONLY the fields required by BenchlingWebhookStack.
 * It is intentionally decoupled from ProfileConfig to simplify testing and
 * reduce coupling to the XDG configuration format.
 */
export interface StackConfig {
    benchling: {
        secretArn: string;
        tenant: string;
        clientId: string;
        appDefinitionId: string;
    };

    quilt: {
        catalog: string;
        database: string;
        queueUrl: string;
        region: string;
        athenaUserWorkgroup?: string;
        athenaResultsBucket?: string;
        writeRoleArn?: string;
    };

    packages: {
        bucket: string;
        prefix: string;
        metadataKey: string;
    };

    deployment: {
        region: string;
        vpc?: VpcConfig;  // Reuse existing VpcConfig interface
        ecrRepository?: string;
        imageTag?: string;
    };

    logging?: {
        level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
    };

    security?: {
        webhookAllowList?: string;
        enableVerification?: boolean;
    };
}

/**
 * Convert ProfileConfig to StackConfig
 *
 * Extracts only the fields needed by the CDK stack, providing defaults
 * where appropriate.
 */
export function toStackConfig(profile: ProfileConfig): StackConfig {
    return {
        benchling: {
            secretArn: profile.benchling.secretArn || "",
            tenant: profile.benchling.tenant,
            clientId: profile.benchling.clientId,
            appDefinitionId: profile.benchling.appDefinitionId,
        },
        quilt: {
            catalog: profile.quilt.catalog,
            database: profile.quilt.database,
            queueUrl: profile.quilt.queueUrl,
            region: profile.quilt.region,
            athenaUserWorkgroup: profile.quilt.athenaUserWorkgroup,
            athenaResultsBucket: profile.quilt.athenaResultsBucket,
            writeRoleArn: profile.quilt.writeRoleArn,
        },
        packages: {
            bucket: profile.packages.bucket,
            prefix: profile.packages.prefix,
            metadataKey: profile.packages.metadataKey,
        },
        deployment: {
            region: profile.deployment.region,
            vpc: profile.deployment.vpc,
            ecrRepository: profile.deployment.ecrRepository,
            imageTag: profile.deployment.imageTag,
        },
        logging: profile.logging,
        security: profile.security,
    };
}
```

### 2. Update Stack Props Interface

**File:** [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts)

```typescript
import { StackConfig } from "./types/stack-config";

export interface BenchlingWebhookStackProps extends cdk.StackProps {
    /**
     * Stack configuration containing only fields required for deployment
     * (previously used ProfileConfig which included wizard metadata)
     */
    readonly config: StackConfig;
}
```

### 3. Update FargateService Props

**File:** [lib/fargate-service.ts](../../lib/fargate-service.ts)

```typescript
import { StackConfig } from "./types/stack-config";

export interface FargateServiceProps {
    readonly vpc: ec2.IVpc;
    readonly config: StackConfig;  // Changed from ProfileConfig
    readonly ecrRepository: ecr.IRepository;
    readonly targetGroup: elbv2.INetworkTargetGroup;
    readonly imageTag?: string;
    readonly stackVersion?: string;

    // ... rest unchanged
}
```

### 4. Update RestApiGateway Props

**File:** [lib/rest-api-gateway.ts](../../lib/rest-api-gateway.ts)

```typescript
import { StackConfig } from "./types/stack-config";

export interface RestApiGatewayProps {
    readonly vpc: ec2.IVpc;
    readonly networkLoadBalancer: elbv2.INetworkLoadBalancer;
    readonly nlbListener: elbv2.INetworkListener;
    readonly serviceSecurityGroup: ec2.ISecurityGroup;
    readonly config: StackConfig;  // Changed from ProfileConfig
    readonly stage: string;
}
```

### 5. Simplify bin/benchling-webhook.ts

**File:** [bin/benchling-webhook.ts](../../bin/benchling-webhook.ts)

The current `createStack(config: Config)` function does an unnecessary ProfileConfig reconstruction. Replace this with direct StackConfig construction from environment variables.

**Before:**

```typescript
// Lines 88-127: Reconstructs ProfileConfig from env vars
const profileConfig: ProfileConfig = { /* massive object */ };

// Line 134-140: Passes ProfileConfig to stack
const stack = new BenchlingWebhookStack(app, stackName, {
    config: profileConfig,
    // ...
});
```

**After:**

```typescript
import { StackConfig } from "../lib/types/stack-config";

export function createStack(config: Config): DeploymentResult {
    const app = new cdk.App();

    // Build minimal StackConfig directly from legacy Config
    const stackConfig: StackConfig = {
        benchling: {
            secretArn: config.benchlingSecret,
            tenant: config.benchlingTenant,
            clientId: config.benchlingClientId,
            appDefinitionId: config.benchlingAppDefinitionId,
        },
        quilt: {
            catalog: config.quiltCatalog,
            database: config.quiltDatabase,
            queueUrl: config.queueUrl,
            region: config.cdkRegion,
        },
        packages: {
            bucket: config.quiltUserBucket,
            prefix: config.pkgPrefix || "benchling",
            metadataKey: config.pkgKey || "experiment_id",
        },
        deployment: {
            region: config.cdkRegion,
            ecrRepository: config.ecrRepositoryName || "quiltdata/benchling",
            imageTag: config.imageTag || "latest",
        },
        logging: {
            level: (config.logLevel as "DEBUG" | "INFO" | "WARNING" | "ERROR") || "INFO",
        },
        security: {
            webhookAllowList: config.webhookAllowList || "",
            enableVerification: config.enableWebhookVerification !== "false",
        },
    };

    const stackName = getStackName("default", config.stackName);

    const stack = new BenchlingWebhookStack(app, stackName, {
        env: {
            account: config.cdkAccount,
            region: config.cdkRegion,
        },
        config: stackConfig,  // Pass StackConfig instead of ProfileConfig
    });

    return { app, stack, stackName: stack.stackName, stackId: stack.stackId };
}
```

**Direct execution path (lines 153-233):**

Similarly, when `bin/benchling-webhook.ts` is executed directly (by CDK CLI), build StackConfig directly from environment variables instead of reconstructing ProfileConfig:

```typescript
if (require.main === module) {
    const app = new cdk.App();

    const stackConfig: StackConfig = {
        benchling: {
            secretArn: process.env.BENCHLING_SECRET || "",
            tenant: process.env.BENCHLING_TENANT || "",
            clientId: process.env.BENCHLING_CLIENT_ID || "",
            appDefinitionId: process.env.BENCHLING_APP_DEFINITION_ID || "",
        },
        quilt: {
            catalog: process.env.QUILT_CATALOG || "",
            database: process.env.QUILT_DATABASE || "",
            queueUrl: process.env.QUEUE_URL || "",
            region: process.env.CDK_DEFAULT_REGION || "us-east-1",
            athenaUserWorkgroup: process.env.ATHENA_USER_WORKGROUP,
            athenaResultsBucket: process.env.ATHENA_RESULTS_BUCKET,
            writeRoleArn: process.env.QUILT_WRITE_ROLE_ARN,
        },
        packages: {
            bucket: process.env.QUILT_USER_BUCKET || "",
            prefix: process.env.PKG_PREFIX || "benchling",
            metadataKey: process.env.PKG_KEY || "experiment_id",
        },
        deployment: {
            region: process.env.CDK_DEFAULT_REGION || "us-east-1",
            ecrRepository: process.env.ECR_REPOSITORY_NAME || "quiltdata/benchling",
            imageTag: process.env.IMAGE_TAG || "latest",
            vpc: process.env.VPC_ID ? {
                vpcId: process.env.VPC_ID,
                privateSubnetIds: JSON.parse(process.env.VPC_PRIVATE_SUBNET_IDS || "[]"),
                publicSubnetIds: JSON.parse(process.env.VPC_PUBLIC_SUBNET_IDS || "[]"),
                availabilityZones: JSON.parse(process.env.VPC_AVAILABILITY_ZONES || "[]"),
                vpcCidrBlock: process.env.VPC_CIDR_BLOCK,
            } : undefined,
        },
        logging: {
            level: (process.env.LOG_LEVEL as "DEBUG" | "INFO" | "WARNING" | "ERROR") || "INFO",
        },
        security: {
            webhookAllowList: process.env.WEBHOOK_ALLOW_LIST || "",
            enableVerification: process.env.ENABLE_WEBHOOK_VERIFICATION !== "false",
        },
    };

    const profile = process.env.PROFILE || "default";
    const stackName = getStackName(profile, process.env.STACK_NAME);

    new BenchlingWebhookStack(app, stackName, {
        env: {
            account: process.env.CDK_DEFAULT_ACCOUNT,
            region: process.env.CDK_DEFAULT_REGION,
        },
        config: stackConfig,
    });
}
```

This eliminates the ProfileConfig reconstruction entirely.

### 6. Update All Deploy Scripts

Transform ProfileConfig → StackConfig before passing to createStack:

**Files to update:**

- [bin/commands/deploy.ts](../../bin/commands/deploy.ts)
- [bin/dev-deploy.ts](../../bin/dev-deploy.ts)
- Any other scripts calling `createStack()`

Pattern:

```typescript
import { toStackConfig } from "../lib/types/stack-config";

// Load profile config
const profileConfig = xdgConfig.readProfile(profile);

// Transform to stack config
const stackConfig = toStackConfig(profileConfig);

// Create stack
const result = createStack({
    // ... convert to legacy Config format with stack config ...
});
```

## Benefits

1. **Eliminates unnecessary round-trip**: No more ProfileConfig → env vars → ProfileConfig reconstruction
2. **Simpler testing**: Mock only 6 required nested objects instead of 15+ ProfileConfig fields
3. **Clear interface**: Stack declares exactly what it needs via StackConfig
4. **Decoupling**: Stack independent of wizard metadata and profile inheritance
5. **Type safety**: Compiler enforces minimal surface area
6. **Backwards compatible**: XDG config files unchanged, wizard unchanged
7. **Less code**: Removes ~40 lines of ProfileConfig reconstruction in bin/benchling-webhook.ts

## Migration Notes

- **XDG config format**: NO CHANGES - remains ProfileConfig
- **Setup wizard**: NO CHANGES - continues to use ProfileConfig
- **Deployment tracking**: NO CHANGES - continues to use ProfileConfig
- **Only change**: Internal stack interface (not exposed to users)

## Files to Modify

1. **New file**: [lib/types/stack-config.ts](../../lib/types/stack-config.ts) - New StackConfig interface + converter
2. [lib/benchling-webhook-stack.ts](../../lib/benchling-webhook-stack.ts) - Use StackConfig instead of ProfileConfig
3. [lib/fargate-service.ts](../../lib/fargate-service.ts) - Update props interface
4. [lib/rest-api-gateway.ts](../../lib/rest-api-gateway.ts) - Update props interface
5. [bin/benchling-webhook.ts](../../bin/benchling-webhook.ts) - Transform ProfileConfig → StackConfig
6. [bin/commands/deploy.ts](../../bin/commands/deploy.ts) - Transform at call site
7. [bin/dev-deploy.ts](../../bin/dev-deploy.ts) - Transform at call site

## Testing Strategy

1. **Unit tests**: Mock StackConfig with minimal fields
2. **Integration tests**: Verify ProfileConfig → StackConfig transformation
3. **E2E tests**: Existing deployment tests should pass unchanged
