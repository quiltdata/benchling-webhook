# Stage-Based Deployment Timing Configuration

**Date:** 2025-11-13
**Status:** Proposed
**Context:** User wants faster dev deployments without impacting prod safety

## Problem

ECS Fargate deployments take 2-3 minutes even for trivial version bumps. This is appropriate for production (zero-downtime, safety checks), but unnecessarily slow for development environments where rapid iteration is more important than ultra-high availability.

### Current Deployment Timeline

```
[0:00] CloudFormation detects change → triggers ECS deployment
[0:10] Pull image from ECR (fast - 125MB image is well-optimized)
[0:15] Start 2 new tasks with new version
[0:45] Health check grace period (60 seconds)
[1:15] First health check passes (30s interval)
[1:45] Second health check passes (needs 2 consecutive successes)
[1:45] Begin draining old tasks (30 second deregistration delay)
[2:15] Stop old tasks
[2:20] Deployment complete ✅
```

**Total: ~2-3 minutes** (image size is NOT the issue - it's the safety mechanisms)

### Current Configuration

#### Target Group Health Checks ([fargate-service.ts:286-295](lib/fargate-service.ts#L286-L295))
```typescript
healthCheck: {
    path: "/health/ready",
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(10),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
    healthyHttpCodes: "200",
},
deregistrationDelay: cdk.Duration.seconds(30),
```

#### ECS Service Configuration ([fargate-service.ts:319-332](lib/fargate-service.ts#L319-L332))
```typescript
this.service = new ecs.FargateService(this, "Service", {
    desiredCount: 2,
    healthCheckGracePeriod: cdk.Duration.seconds(60),
    minHealthyPercent: 50,
    maxHealthyPercent: 200,
    circuitBreaker: {
        rollback: true,
    },
});
```

## Solution

Add `stage` field to `DeploymentConfig` and conditionally apply faster settings for dev environments.

### 1. Add `stage` to Config Types

```typescript
export interface DeploymentConfig {
    region: string;
    account?: string;

    /**
     * Deployment stage (dev, prod, etc.)
     *
     * @example "dev"
     * @example "prod"
     * @default "prod"
     */
    stage?: string;

    ecrRepository?: string;
    imageTag?: string;
}
```

### 2. Apply Stage-Based Settings in Fargate Service

```typescript
// Determine if this is a dev deployment
const isDev = config.deployment.stage === "dev";

// Create ALB Target Group with stage-appropriate settings
const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
    vpc: props.vpc,
    port: 5000,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
    healthCheck: {
        path: "/health/ready",
        // Dev: faster checks, Prod: safer checks
        interval: cdk.Duration.seconds(isDev ? 15 : 30),
        timeout: cdk.Duration.seconds(isDev ? 5 : 10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: isDev ? 2 : 3,
        healthyHttpCodes: "200",
    },
    // Dev: faster drain, Prod: safer drain
    deregistrationDelay: cdk.Duration.seconds(isDev ? 10 : 30),
});

// Create Fargate Service with stage-appropriate settings
this.service = new ecs.FargateService(this, "Service", {
    cluster: this.cluster,
    taskDefinition: taskDefinition,
    desiredCount: isDev ? 1 : 2,  // Dev: single task (no HA needed)
    serviceName: "benchling-webhook-service",
    assignPublicIp: true,
    securityGroups: [fargateSecurityGroup],
    // Dev: shorter grace period
    healthCheckGracePeriod: cdk.Duration.seconds(isDev ? 30 : 60),
    // Dev: allow downtime, Prod: rolling update
    minHealthyPercent: isDev ? 0 : 50,
    maxHealthyPercent: isDev ? 100 : 200,
    circuitBreaker: {
        rollback: true,
    },
});

// Auto-scaling: only for prod
if (!isDev) {
    const scaling = this.service.autoScaleTaskCount({
        minCapacity: 2,
        maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
        targetUtilizationPercent: 70,
        scaleInCooldown: cdk.Duration.seconds(300),
        scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization("MemoryScaling", {
        targetUtilizationPercent: 80,
        scaleInCooldown: cdk.Duration.seconds(300),
        scaleOutCooldown: cdk.Duration.seconds(60),
    });
}
```

## Expected Results

### Dev Stage (`stage: "dev"`)
- **Deployment time: ~45-60 seconds** (saves 60-90 seconds)
- Single task (no HA requirement)
- Faster health checks (15s interval vs 30s)
- Shorter timeouts (5s vs 10s)
- Faster drain (10s vs 30s)
- No auto-scaling
- Allows brief downtime during deployment

### Prod Stage (`stage: "prod"` or not set)
- **Deployment time: ~2-3 minutes** (unchanged)
- 2+ tasks with rolling updates
- Conservative health checks
- Zero-downtime deployments
- Auto-scaling enabled
- Circuit breaker with rollback

## Configuration Examples

### Dev Profile
```json
{
  "deployment": {
    "region": "us-east-1",
    "stage": "dev",
    "imageTag": "latest"
  }
}
```

### Prod Profile
```json
{
  "deployment": {
    "region": "us-east-1",
    "stage": "prod",
    "imageTag": "0.7.6"
  }
}
```

## Migration

This is **backward compatible**:
- If `stage` is not specified, defaults to prod behavior
- Existing deployments continue to work unchanged
- Users can opt-in to dev mode by adding `"stage": "dev"` to their config

## Trade-offs

| Aspect | Dev Stage | Prod Stage |
| -------- | ----------- | ------------ |
| Deploy Speed | ⚡ Fast (~1 min) | 🐢 Safe (~2-3 min) |
| Availability | ⚠️ Brief downtime OK | ✅ Zero downtime |
| Cost | 💰 Lower (1 task) | 💰💰 Higher (2+ tasks) |
| Auto-scaling | ❌ Disabled | ✅ Enabled |
| Risk | ⚠️ Higher | ✅ Lower |

## Recommended Usage

- **Dev stage:** Use for rapid iteration, testing, demos, non-critical environments
- **Prod stage:** Use for production, staging, any environment requiring HA

## Files to Modify

1. `lib/types/config.ts` - Add `stage?` field to `DeploymentConfig`
2. `lib/fargate-service.ts` - Apply conditional settings based on stage
3. `bin/commands/setup-wizard.ts` - Prompt for stage during setup (optional)

## Docker Image Optimization (Already Done ✅)

The user initially suspected the 125 MB Docker image was the problem. Analysis showed:
- **Image size: 125 MB** (excellent for Python app)
- **Layer breakdown:**
  - Python 3.14-slim base
  - Dependencies via `uv sync`: ~116 MB
  - Application code: ~786 KB
  - System packages: minimal

The image is already well-optimized using:
- Slim Python base image
- `uv` for fast dependency installation
- Minimal system dependencies
- Non-root user
- Multi-stage build practices

**Conclusion:** Image size is NOT the bottleneck. The delay is purely from ECS safety mechanisms.

## References

- AWS ECS Rolling Updates: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html
- ALB Target Group Health Checks: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html
- ECS Circuit Breaker: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html
