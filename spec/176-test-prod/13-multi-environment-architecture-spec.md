# Multi-Environment Architecture Specification: API Gateway Stages + Profiles

**Status**: Proposed
**Date**: 2025-11-04
**Issue**: #176 - Test Production Deployments
**Author**: Analysis based on user requirements and existing architecture

---

## Executive Summary

This specification proposes a **multi-environment architecture** that uses:
1. **API Gateway Stages** (`dev` and `prod`) for runtime environment separation
2. **XDG Config Profiles** (`default` and `dev`) for configuration management
3. **Shared Infrastructure** (ALB, ECS Cluster, Secrets Manager) to reduce costs
4. **Isolated Runtime** (separate ECS Services and Target Groups per environment)

**Key Benefits:**
- ✅ Cost-effective: Shared ALB, NAT Gateway, and cluster
- ✅ Secure: Separate containers and target groups per environment
- ✅ Simple: Single CloudFormation stack
- ✅ Flexible: Different Benchling apps per environment via profiles
- ✅ Production-ready: Proper isolation without account boundaries

---

## Current State Analysis

### Current Architecture (v0.6.3)

```
Single Stack: BenchlingWebhookStack
├── VPC
├── ECS Cluster (benchling-webhook-cluster)
├── ECS Service (single service)
│   └── Task Definition (uses one image tag)
├── ALB (Application Load Balancer)
│   └── Target Group (single group)
└── API Gateway
    └── Stage: "prod" (hardcoded)
```

**Problems:**
1. ❌ No true dev environment - dev/prod distinction exists only in deploy.json
2. ❌ Both `deploy:dev` and `deploy:prod` deploy to the same stack, overwriting each other
3. ❌ Cannot test different Benchling apps side-by-side
4. ❌ Cannot have different image tags for dev vs prod simultaneously

### Current Profile System

**Location**: `~/.config/benchling-webhook/`

```
default.json         # Primary profile (intended for prod)
deploy.json          # Deployment tracking
```

**Profiles support:**
- ✅ Multiple named configurations (e.g., `default`, `dev`, `prod`)
- ✅ Environment-specific secrets (different `benchlingAppDefinitionId`)
- ✅ Already implemented in `XDGConfig` class

---

## Proposed Architecture

### High-Level Design

```
Single Stack: BenchlingWebhookStack
├── VPC (shared)
├── ECS Cluster (shared: benchling-webhook-cluster)
│
├── ECS Service: benchling-webhook-dev
│   ├── Task Definition: dev (latest image)
│   ├── Container: benchling-webhook
│   ├── Secret: quiltdata/benchling-webhook/dev/tenant
│   └── Environment: STAGE=dev
│
├── ECS Service: benchling-webhook-prod
│   ├── Task Definition: prod (versioned image)
│   ├── Container: benchling-webhook
│   ├── Secret: quiltdata/benchling-webhook/default/tenant
│   └── Environment: STAGE=prod
│
├── ALB (shared)
│   ├── Listener: Port 80
│   ├── Target Group: dev-targets
│   │   └── Routes to: benchling-webhook-dev service
│   └── Target Group: prod-targets
│       └── Routes to: benchling-webhook-prod service
│
└── API Gateway: BenchlingWebhookAPI
    ├── Stage: dev
    │   └── URL: https://xxx.execute-api.us-east-1.amazonaws.com/dev/*
    │       └── Routes to: ALB → dev-targets
    │
    └── Stage: prod
        └── URL: https://xxx.execute-api.us-east-1.amazonaws.com/prod/*
            └── Routes to: ALB → prod-targets
```

### URL Structure

| Environment | Endpoint Example |
|-------------|------------------|
| **Dev** | `https://abc123.execute-api.us-east-1.amazonaws.com/dev/event` |
| **Prod** | `https://abc123.execute-api.us-east-1.amazonaws.com/prod/event` |

Both environments use the **same API Gateway**, different **stages**.

---

## Profile-Based Configuration

### Profile Strategy

```
~/.config/benchling-webhook/
├── default.json    # Production profile (end users)
├── dev.json        # Development profile (maintainers, optional)
└── deploy.json     # Deployment tracking (both environments)
```

### Profile: default.json (Production)

```json
{
  "profile": "default",
  "benchlingTenant": "my-company",
  "benchlingAppDefinitionId": "app_PROD_12345",
  "benchlingClientId": "client_xyz",
  "benchlingClientSecret": "secret_abc",
  "quiltStackArn": "arn:aws:cloudformation:us-east-1:123456789012:stack/quilt-prod/...",
  "benchlingSecret": "quiltdata/benchling-webhook/default/my-company",
  "imageTag": "0.6.3"
}
```

### Profile: dev.json (Development, Optional)

```json
{
  "profile": "dev",
  "benchlingTenant": "my-company",
  "benchlingAppDefinitionId": "app_DEV_67890",
  "benchlingClientId": "client_xyz",
  "benchlingClientSecret": "secret_abc",
  "quiltStackArn": "arn:aws:cloudformation:us-east-1:712023778557:stack/quilt-staging/...",
  "benchlingSecret": "quiltdata/benchling-webhook/dev/my-company",
  "imageTag": "latest"
}
```

**Key Differences:**
- `benchlingAppDefinitionId`: Different app IDs allow side-by-side Benchling apps
- `quiltStackArn`: Can point to different Quilt environments
- `benchlingSecret`: Different secrets in Secrets Manager
- `imageTag`: Dev uses `latest`, prod uses semantic versions

---

## Deployment Flow

### Profile → Environment Mapping

| Command | Profile | API Gateway Stage | ECS Service | Image Tag |
|---------|---------|-------------------|-------------|-----------|
| `npm run deploy:dev` | `dev` | `dev` | `benchling-webhook-dev` | `latest` |
| `npm run deploy:prod` | `default` | `prod` | `benchling-webhook-prod` | `v0.6.3` |

### Example: Deploy Dev Environment

```bash
# 1. Create dev profile (one-time)
npm run setup:profile dev

# 2. Edit ~/.config/benchling-webhook/dev.json
#    - Set benchlingAppDefinitionId: "app_DEV_67890"
#    - Set imageTag: "latest"

# 3. Deploy to dev stage
npm run deploy:dev --profile dev

# 4. Test dev deployment
npm run test:dev
```

### Example: Deploy Prod Environment

```bash
# 1. Use default profile (already exists from npm run setup)

# 2. Deploy to prod stage
npm run deploy:prod

# 3. Test prod deployment
npm run test:prod
```

---

## CDK Implementation Changes

### 1. Update `AlbApiGateway` to Support Multiple Stages

**File**: `lib/alb-api-gateway.ts`

```typescript
export interface AlbApiGatewayProps {
    readonly loadBalancer: elbv2.ApplicationLoadBalancer;
    readonly webhookAllowList?: string;
    readonly environments: Array<{
        stageName: string;           // "dev" or "prod"
        targetGroup: elbv2.ApplicationTargetGroup;
    }>;
}

export class AlbApiGateway {
    public readonly api: apigateway.RestApi;
    public readonly stages: Map<string, apigateway.Stage>;

    constructor(scope: Construct, id: string, props: AlbApiGatewayProps) {
        // Create API Gateway (no default stage)
        this.api = new apigateway.RestApi(scope, "BenchlingWebhookAPI", {
            restApiName: "BenchlingWebhookAPI",
            deploy: false,  // Manual deployment
        });

        // Create stages
        this.stages = new Map();
        for (const env of props.environments) {
            const stage = new apigateway.Stage(scope, `${env.stageName}Stage`, {
                stageName: env.stageName,
                deployment: new apigateway.Deployment(scope, `${env.stageName}Deployment`, {
                    api: this.api,
                }),
            });
            this.stages.set(env.stageName, stage);
        }
    }
}
```

### 2. Update `FargateService` to Create Multiple Services

**File**: `lib/fargate-service.ts`

```typescript
export interface FargateServiceProps {
    // ... existing props
    readonly environments: Array<{
        name: string;           // "dev" or "prod"
        imageTag: string;       // "latest" or "v0.6.3"
        secretName: string;     // Secrets Manager secret name
        minCapacity?: number;   // Default: 1
        maxCapacity?: number;   // Default: 3
    }>;
}

export class FargateService extends Construct {
    public readonly services: Map<string, ecs.FargateService>;
    public readonly targetGroups: Map<string, elbv2.ApplicationTargetGroup>;

    constructor(scope: Construct, id: string, props: FargateServiceProps) {
        // Create shared cluster
        const cluster = new ecs.Cluster(this, "Cluster", { ... });

        // Create shared ALB
        const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", { ... });

        this.services = new Map();
        this.targetGroups = new Map();

        // Create service + target group for each environment
        for (const env of props.environments) {
            // Task definition
            const taskDef = new ecs.FargateTaskDefinition(this, `${env.name}TaskDef`, {
                cpu: 512,
                memoryLimitMiB: 1024,
            });

            taskDef.addContainer(`${env.name}Container`, {
                image: ecs.ContainerImage.fromEcrRepository(
                    props.ecrRepository,
                    env.imageTag
                ),
                secrets: {
                    BENCHLING_SECRETS: ecs.Secret.fromSecretsManager(
                        secretsmanager.Secret.fromSecretNameV2(
                            this,
                            `${env.name}Secret`,
                            env.secretName
                        )
                    ),
                },
                environment: {
                    STAGE: env.name,
                },
            });

            // Target group
            const targetGroup = new elbv2.ApplicationTargetGroup(this, `${env.name}TargetGroup`, {
                vpc: props.vpc,
                port: 5000,
                protocol: elbv2.ApplicationProtocol.HTTP,
                targetType: elbv2.TargetType.IP,
                healthCheck: {
                    path: "/health",
                    interval: cdk.Duration.seconds(30),
                },
            });

            // ECS Service
            const service = new ecs.FargateService(this, `${env.name}Service`, {
                cluster,
                taskDefinition: taskDef,
                desiredCount: 1,
                minHealthyPercent: 50,
                maxHealthyPercent: 200,
            });

            // Register with target group
            service.attachToApplicationTargetGroup(targetGroup);

            // Auto-scaling
            const scaling = service.autoScaleTaskCount({
                minCapacity: env.minCapacity || 1,
                maxCapacity: env.maxCapacity || 3,
            });

            scaling.scaleOnCpuUtilization(`${env.name}CpuScaling`, {
                targetUtilizationPercent: 70,
            });

            this.services.set(env.name, service);
            this.targetGroups.set(env.name, targetGroup);
        }
    }
}
```

### 3. Update Stack Constructor

**File**: `lib/benchling-webhook-stack.ts`

```typescript
export interface BenchlingWebhookStackProps extends cdk.StackProps {
    readonly quiltStackArn: string;
    readonly devProfile?: {
        secretName: string;
        imageTag: string;
    };
    readonly prodProfile: {
        secretName: string;
        imageTag: string;
    };
}

export class BenchlingWebhookStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: BenchlingWebhookStackProps) {
        super(scope, id, props);

        // Determine which environments to deploy
        const environments = [
            {
                name: "prod",
                imageTag: props.prodProfile.imageTag,
                secretName: props.prodProfile.secretName,
            },
        ];

        if (props.devProfile) {
            environments.push({
                name: "dev",
                imageTag: props.devProfile.imageTag,
                secretName: props.devProfile.secretName,
            });
        }

        // Create Fargate services
        const fargate = new FargateService(this, "Fargate", {
            vpc: this.vpc,
            environments,
            // ... other props
        });

        // Create API Gateway with stages
        const api = new AlbApiGateway(this, "Api", {
            loadBalancer: fargate.loadBalancer,
            environments: environments.map(env => ({
                stageName: env.name,
                targetGroup: fargate.targetGroups.get(env.name)!,
            })),
        });

        // Outputs
        for (const env of environments) {
            const stage = api.stages.get(env.name)!;
            new cdk.CfnOutput(this, `${env.name}Endpoint`, {
                value: stage.urlForPath(),
                description: `${env.name} webhook endpoint`,
            });
        }
    }
}
```

---

## CLI Implementation Changes

### 1. Add Profile Support to Deploy Commands

**File**: `bin/commands/deploy.ts`

```typescript
export async function deployCommand(options: {
    yes?: boolean;
    profile?: string;           // NEW: Profile name
    environment?: "dev" | "prod";  // NEW: Target environment
    // ... existing options
}): Promise<void> {
    // Determine profile
    const profileName = options.profile || (options.environment === "dev" ? "dev" : "default");

    // Load profile config
    const xdg = new XDGConfig();
    const config = xdg.readConfig("user", profileName);

    // Extract parameters from profile
    const quiltStackArn = config.quiltStackArn;
    const benchlingSecret = config.benchlingSecret;
    const imageTag = config.imageTag || "latest";

    // Pass environment to CDK
    process.env.DEPLOY_ENV = options.environment || "prod";

    // Deploy
    await deploy(quiltStackArn, benchlingSecret, { ...options, imageTag });
}
```

### 2. Update npm Scripts

**File**: `package.json`

```json
{
  "scripts": {
    "deploy:dev": "ts-node bin/cli.ts deploy --environment dev --profile dev",
    "deploy:prod": "ts-node bin/cli.ts deploy --environment prod --profile default",
    "test:dev": "make -C docker test-deployed-dev",
    "test:prod": "make -C docker test-deployed-prod",
    "setup:profile": "ts-node bin/cli.ts setup-profile"
  }
}
```

### 3. Add Profile Setup Command

**File**: `bin/commands/setup-profile.ts`

```typescript
export async function setupProfileCommand(profileName: string): Promise<void> {
    const xdg = new XDGConfig();

    // Copy default config if it exists
    const defaultConfig = xdg.readConfig("user", "default");

    // Prompt for profile-specific values
    const responses = await prompt([
        {
            type: "input",
            name: "benchlingAppDefinitionId",
            message: `Benchling App Definition ID (${profileName}):`,
            initial: defaultConfig.benchlingAppDefinitionId,
        },
        {
            type: "input",
            name: "imageTag",
            message: "Docker image tag:",
            initial: profileName === "dev" ? "latest" : "0.6.3",
        },
    ]);

    // Create profile config
    const profileConfig = {
        ...defaultConfig,
        profile: profileName,
        benchlingAppDefinitionId: responses.benchlingAppDefinitionId,
        imageTag: responses.imageTag,
        benchlingSecret: `quiltdata/benchling-webhook/${profileName}/${defaultConfig.benchlingTenant}`,
    };

    // Save profile
    xdg.writeConfig("user", profileConfig, profileName);

    console.log(`✅ Created profile: ~/.config/benchling-webhook/${profileName}.json`);
}
```

---

## Secrets Manager Strategy

### Secret Naming Convention

```
quiltdata/benchling-webhook/<profile>/<tenant>
```

**Examples:**
- `quiltdata/benchling-webhook/default/my-company` → Production
- `quiltdata/benchling-webhook/dev/my-company` → Development

### Secret Contents

**Structure** (same for all profiles):
```json
{
  "BENCHLING_APP_DEFINITION_ID": "app_...",
  "BENCHLING_CLIENT_ID": "client_...",
  "BENCHLING_CLIENT_SECRET": "secret_...",
  "BENCHLING_TENANT": "my-company",
  "BENCHLING_PKG_BUCKET": "s3://bucket",
  "BENCHLING_PKG_KEY": "experiment_id",
  "BENCHLING_PKG_PREFIX": "benchling",
  "BENCHLING_ENABLE_WEBHOOK_VERIFICATION": "true",
  "BENCHLING_LOG_LEVEL": "INFO"
}
```

**Key Difference**: Only `BENCHLING_APP_DEFINITION_ID` varies between profiles.

---

## Migration Path

### Phase 1: Add Multi-Stage Support (Non-Breaking)

1. Update CDK constructs to create both stages
2. Deploy stack (creates both dev and prod stages)
3. Both stages point to the same backend initially

**Result**: Existing deployments continue working on `prod` stage.

### Phase 2: Add Profile Support

1. Implement profile-based deployment
2. Add `deploy:dev` with `--profile dev`
3. Keep `deploy:prod` using default profile

**Result**: Users can optionally use dev profile.

### Phase 3: Separate ECS Services

1. Update Fargate construct to create multiple services
2. Route stages to respective services
3. Update deployment tracking

**Result**: True environment isolation.

---

## Cost Analysis

### Current (Single Environment)

| Resource | Monthly Cost |
|----------|-------------|
| ALB | ~$23 |
| NAT Gateway | ~$32 |
| ECS Fargate (1-3 tasks) | ~$15-45 |
| **Total** | **~$70-100** |

### Proposed (Dual Environment)

| Resource | Monthly Cost | Change |
|----------|-------------|--------|
| ALB | ~$23 | No change (shared) |
| NAT Gateway | ~$32 | No change (shared) |
| ECS Fargate (2-6 tasks) | ~$30-90 | +$15-45 (2x containers) |
| **Total** | **~$85-145** | **+$15-45** |

**Cost Increase**: ~15-45% for true dev/prod isolation within same stack.

**Alternative** (separate accounts): +100% (duplicate all infrastructure).

---

## Testing Strategy

### Test Commands

```bash
# Local development
npm run test              # Unit tests
npm run test:local        # Local Docker

# Deployed environments
npm run test:dev          # Test dev stage
npm run test:prod         # Test prod stage
```

### Test Execution

**Makefile targets** (no changes needed):
```makefile
test-deployed-dev: check-xdg
	@DEV_ENDPOINT=$$(jq -r '.dev.endpoint // empty' $(XDG_CONFIG)/deploy.json)
	uv run python scripts/test_webhook.py "$$DEV_ENDPOINT"

test-deployed-prod: check-xdg
	@PROD_ENDPOINT=$$(jq -r '.prod.endpoint // empty' $(XDG_CONFIG)/deploy.json)
	uv run python scripts/test_webhook.py "$$PROD_ENDPOINT"
```

**deploy.json** structure:
```json
{
  "dev": {
    "endpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/dev",
    "imageTag": "latest",
    "deployedAt": "2025-11-04T12:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "stage": "dev"
  },
  "prod": {
    "endpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/prod",
    "imageTag": "0.6.3",
    "deployedAt": "2025-11-04T12:00:00.000Z",
    "stackName": "BenchlingWebhookStack",
    "stage": "prod"
  }
}
```

---

## User Experience

### End Users (Simple)

```bash
# Setup (one-time)
npm run setup

# Deploy production
npm run deploy:prod

# Test production
npm run test:prod
```

**No profile awareness needed!**

### Maintainers (Advanced)

```bash
# Create dev profile (one-time)
npm run setup:profile dev
# Edit ~/.config/benchling-webhook/dev.json

# Deploy dev
npm run deploy:dev

# Deploy prod
npm run deploy:prod

# Both environments running simultaneously
npm run test:dev      # Tests dev stage
npm run test:prod     # Tests prod stage
```

---

## Security Considerations

### Benefits

1. **Least Privilege**: Each ECS service has separate IAM roles
2. **Secret Isolation**: Different Secrets Manager secrets per environment
3. **Network Isolation**: Separate target groups prevent cross-environment traffic
4. **Audit Trail**: CloudWatch logs separated by service

### Limitations

1. **Same VPC**: Both environments share VPC (acceptable for cost)
2. **Same Account**: Not as isolated as multi-account (addressed by profile system)
3. **Same Cluster**: Cluster-level metrics are aggregated

### Recommendations

1. ✅ Use profiles for different Benchling apps
2. ✅ Monitor per-service metrics in CloudWatch
3. ✅ Set different auto-scaling policies (dev: 1-2, prod: 2-10)
4. ⚠️ For maximum isolation, use separate AWS accounts (existing approach)

---

## Implementation Checklist

### Phase 1: Multi-Stage API Gateway
- [ ] Update `AlbApiGateway` to create multiple stages
- [ ] Add stage-based routing to target groups
- [ ] Update CloudFormation outputs
- [ ] Test both stages route to same backend

### Phase 2: Profile System
- [ ] Add `--profile` parameter to deploy commands
- [ ] Implement `setup:profile` command
- [ ] Update secret name generation
- [ ] Document profile usage

### Phase 3: Multi-Service ECS
- [ ] Update `FargateService` to create multiple services
- [ ] Create separate target groups
- [ ] Configure stage → target group routing
- [ ] Update deployment tracking

### Phase 4: Testing & Documentation
- [ ] Update test scripts
- [ ] Add end-to-end tests
- [ ] Update CLAUDE.md
- [ ] Update README.md
- [ ] Create migration guide

---

## Alternatives Considered

### Alternative 1: Separate Stacks per Environment

```
BenchlingWebhookStack-dev
BenchlingWebhookStack-prod
```

**Rejected because:**
- ❌ Breaking change (existing stack name)
- ❌ Duplicate infrastructure costs (+100%)
- ❌ More complex to manage

### Alternative 2: Multi-Account (Current Approach)

**Status**: Keep as option for maximum isolation

**Use when:**
- Customer requires strict compliance separation
- Need separate billing/cost tracking
- Want production in isolated AWS organization

### Alternative 3: Single Service with Environment Variable

**Rejected because:**
- ❌ Cannot run different image tags simultaneously
- ❌ Requires downtime to switch environments
- ❌ No isolation between dev/prod containers

---

## Success Criteria

### Must Have
- [ ] Both dev and prod stages accessible via API Gateway
- [ ] Separate ECS services per environment
- [ ] Profile-based configuration working
- [ ] `npm run deploy:dev` and `npm run deploy:prod` work independently
- [ ] `npm run test:dev` and `npm run test:prod` test correct endpoints
- [ ] No breaking changes for existing users

### Nice to Have
- [ ] Auto-scaling policies differ by environment
- [ ] CloudWatch dashboards per environment
- [ ] Cost allocation tags by environment

### Non-Goals
- Multi-account support (already exists)
- Multi-region support (out of scope)
- Blue/green deployments (future enhancement)

---

## References

- Issue: #176 - Test Production Deployments
- Previous Analysis: [11-multi-environment-analysis.md](./11-multi-environment-analysis.md)
- XDG Config: [lib/xdg-config.ts](../../lib/xdg-config.ts)
- API Gateway CDK Docs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigateway-readme.html
- ECS Fargate Docs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs-readme.html
