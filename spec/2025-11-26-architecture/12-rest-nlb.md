# Migration Checklist: HTTP API v2 → REST API v1 (with NLB)

**Date**: 2025-11-30
**Status**: Implementation Checklist
**Target**: Revert to REST API v1 with Resource Policies, keep NLB from v0.9.0

---

## Overview

Migrate from current **HTTP API v2 + NLB + WAF** architecture back to **REST API v1 + NLB + Resource Policies** architecture.

**Key benefit**: Save $5.10/month by replacing WAF ($7.60/mo) with free Resource Policies, while keeping NLB reliability improvements from v0.9.0.

---

## Architecture Change

### Current (v0.9.0)
```
HTTP API v2 → [Optional WAF] → VPC Link → NLB → ECS Fargate
```

### Target (v1.0.0)
```
REST API v1 + Resource Policy → VPC Link → NLB → ECS Fargate
```

**Preserved**: NLB, ECS Fargate, VPC configuration
**Changed**: API Gateway type (HTTP v2 → REST v1), IP filtering (WAF → Resource Policy)

---

## Code Changes

### 1. Create REST API Gateway Construct

**File**: `lib/rest-api-gateway.ts` (new file)

**Requirements**:
- REST API v1 (`apigateway.RestApi`)
- VPC Link to NLB (HTTP integration)
- Resource Policy for IP allowlisting
- CloudWatch access logs
- Health endpoint exempt from IP filtering
- Stage-based routing (`/prod/webhook`, `/dev/webhook`)

**Key differences from `http-api-gateway.ts`**:
- Use `apigateway` package (not `apigatewayv2`)
- Resource policy instead of WAF
- Explicit stage deployment
- HTTP integration (not HTTP proxy)

---

### 2. Update Stack Orchestration

**File**: `lib/benchling-webhook-stack.ts`

**Changes**:
```diff
- import { HttpApiGateway } from "./http-api-gateway";
+ import { RestApiGateway } from "./rest-api-gateway";

- private readonly api: HttpApiGateway;
+ private readonly api: RestApiGateway;

- this.api = new HttpApiGateway(this, "HttpApiGateway", {
+ this.api = new RestApiGateway(this, "RestApiGateway", {
      vpc,
      networkLoadBalancer: this.nlb.loadBalancer,
      nlbListener: this.nlb.listener,
      serviceSecurityGroup: this.fargateService.serviceSecurityGroup,
      config,
+     stage: process.env.STAGE || "prod",
  });

- this.webhookEndpoint = `${this.api.api.url}webhook`;
+ this.webhookEndpoint = `${this.api.api.url}${stage}/webhook`;
```

**Remove**:
- All WAF-related imports
- WAF Web ACL instantiation
- WAF log group references

---

### 3. Update NLB Integration

**File**: `lib/rest-api-gateway.ts`

**NLB Integration**:
```typescript
// VPC Link (same as HTTP API)
const vpcLink = new apigateway.VpcLink(this, "VpcLink", {
    targets: [props.networkLoadBalancer],
    description: "VPC Link to Network Load Balancer for private ECS integration",
});

// HTTP Integration to NLB
const integration = new apigateway.Integration({
    type: apigateway.IntegrationType.HTTP_PROXY,
    integrationHttpMethod: "ANY",
    uri: `http://${props.networkLoadBalancer.loadBalancerDnsName}`,
    options: {
        connectionType: apigateway.ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
        requestParameters: {
            "integration.request.path.proxy": "method.request.path.proxy",
        },
    },
});
```

---

### 4. Implement Resource Policy

**File**: `lib/rest-api-gateway.ts`

**Resource Policy Logic**:
```typescript
// Parse IP allowlist from config
const webhookAllowList = props.config.security?.webhookAllowList || "";
const allowedIps = webhookAllowList
    .split(",")
    .map(ip => ip.trim())
    .filter(ip => ip.length > 0);

// Build policy document
const policyDoc = new iam.PolicyDocument({
    statements: [
        // Allow health checks from anywhere
        new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: [`execute-api:/*/${props.stage}/GET/health`],
        }),
        // Allow webhook requests only from allowlist
        ...(allowedIps.length > 0 ? [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.AnyPrincipal()],
                actions: ["execute-api:Invoke"],
                resources: ["execute-api:/*/*/*"],
                conditions: {
                    IpAddress: {
                        "aws:SourceIp": allowedIps,
                    },
                },
            }),
        ] : [
            // No IP filtering - allow all
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                principals: [new iam.AnyPrincipal()],
                actions: ["execute-api:Invoke"],
                resources: ["execute-api:/*/*/*"],
            }),
        ]),
    ],
});

// Apply policy to REST API
this.api = new apigateway.RestApi(this, "RestApi", {
    restApiName: "BenchlingWebhookRestAPI",
    description: "REST API v1 for Benchling webhook integration with IP filtering",
    policy: policyDoc,
    deployOptions: {
        stageName: props.stage,
        accessLogDestination: new apigateway.LogGroupLogDestination(this.logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
    },
});
```

---

### 5. Update Route Definitions

**File**: `lib/rest-api-gateway.ts`

**Routes**:
```typescript
// Root resource for stage-based routing
const stageResource = this.api.root.addResource(props.stage);

// POST /webhook
const webhookResource = stageResource.addResource("webhook");
webhookResource.addMethod("POST", integration);

// GET /health
const healthResource = stageResource.addResource("health");
healthResource.addMethod("GET", integration);
```

---

### 6. Update CloudWatch Logs

**File**: `lib/rest-api-gateway.ts`

**Log Group**:
```typescript
this.logGroup = new logs.LogGroup(scope, "ApiGatewayAccessLogs", {
    logGroupName: "/aws/apigateway/benchling-webhook-rest",
    retention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
});
```

**Remove**:
- WAF log group (`/aws/waf/benchling-webhook`)

---

### 7. Update Stack Outputs

**File**: `lib/benchling-webhook-stack.ts`

**Outputs**:
```diff
  new cdk.CfnOutput(this, "ApiGatewayLogGroup", {
-     value: this.api.logGroup.logGroupName,
+     value: "/aws/apigateway/benchling-webhook-rest",
      description: "CloudWatch log group for API Gateway access logs",
  });

+ new cdk.CfnOutput(this, "ApiType", {
+     value: "REST API v1",
+     description: "API Gateway type",
+ });

- // Remove WAF-related outputs
```

---

### 8. Update Tests

**File**: `test/benchling-webhook-stack.test.ts`

**Changes**:
```diff
- import { HttpApiGateway } from "../lib/http-api-gateway";
+ import { RestApiGateway } from "../lib/rest-api-gateway";

  // Verify REST API created
- const httpApiTemplate = Template.fromStack(stack);
- httpApiTemplate.hasResourceProperties("AWS::ApiGatewayV2::Api", {
-     ProtocolType: "HTTP",
- });
+ const restApiTemplate = Template.fromStack(stack);
+ restApiTemplate.hasResourceProperties("AWS::ApiGateway::RestApi", {
+     Name: "BenchlingWebhookRestAPI",
+ });

  // Verify resource policy (no WAF)
+ restApiTemplate.hasResourceProperties("AWS::ApiGateway::RestApi", {
+     Policy: Match.objectLike({
+         Statement: Match.arrayWith([
+             Match.objectLike({
+                 Condition: {
+                     IpAddress: {
+                         "aws:SourceIp": Match.anyValue(),
+                     },
+                 },
+             }),
+         ]),
+     }),
+ });

- // Remove WAF tests
```

**New file**: `test/rest-api-gateway.test.ts`

**Test coverage**:
- REST API creation
- Resource policy with IP allowlist
- Health endpoint exemption
- VPC Link to NLB
- Stage deployment
- CloudWatch logging

---

### 9. Update Deployment Scripts

**File**: `bin/commands/deploy.ts`

**Remove**:
- `detectLegacyRestApi()` function and all calls to it
- `promptLegacyMigration()` function
- Legacy detection logic block (lines 509-523)
- WAF stack cleanup logic
- WAF-related status checks

---

### 10. Update Integration Tests

**File**: `test/integration/*.test.ts`

**Endpoint format**:
```diff
- const webhookUrl = `${apiEndpoint}/webhook`;
+ const webhookUrl = `${apiEndpoint}/${stage}/webhook`;
- const healthUrl = `${apiEndpoint}/health`;
+ const healthUrl = `${apiEndpoint}/${stage}/health`;
```

---

### 11. Update Documentation

**Files to update**:
- `CLAUDE.md` - Architecture section
- `README.md` - Architecture diagram
- `spec/2025-11-26-architecture/` - Add migration notes

**Key updates**:
```diff
  ## Architecture (v1.0.0)

- HTTP API Gateway v2 → Optional WAF → VPC Link → NLB → ECS Fargate
+ REST API Gateway v1 + Resource Policy → VPC Link → NLB → ECS Fargate

  ### Components

- - **HTTP API Gateway v2** → Public HTTPS endpoint
- - **Optional WAF** → IP allowlisting ($7/month when configured)
+ - **REST API Gateway v1** → Public HTTPS endpoint with resource policy
+ - **Resource Policy** → IP allowlisting (free)
  - **VPC Link** → Private connection to VPC
  - **Network Load Balancer** → Internal load balancer with health checks
  - **ECS Fargate** → FastAPI application (auto-scales 2-10 tasks)
```

**Cost analysis**:
```diff
  ### Monthly Costs (1M requests/month)

  | Component | Cost |
  |-----------|------|
- | HTTP API v2 | $1.00 |
- | WAF (optional) | $7.00 |
+ | REST API v1 | $3.50 |
+ | Resource Policy | $0.00 |
  | NLB | $16.20 |
  | ECS Fargate | $14.50 |
  | NAT Gateway | $32.40 |
- | **Total (with WAF)** | **$71.71** |
+ | **Total** | **$66.61** |
```

---

### 12. Update Setup Wizard

**File**: `scripts/install-wizard.ts`

**Changes**:
- IP allowlist configuration unchanged (existing prompts work)
- Update explanation text:
  ```diff
  - "IPs will be enforced via AWS WAF ($7/month when configured)"
  + "IPs will be enforced via REST API resource policy (free)"
  ```

---

### 13. Update Configuration Schema

**File**: `lib/types/config.ts`

**No schema changes required** - `security.webhookAllowList` already exists.

**Documentation update**:
```diff
  export interface SecurityConfig {
      /**
-      * Comma-separated list of allowed source IPs/CIDRs for webhooks (enforced by WAF)
+      * Comma-separated list of allowed source IPs/CIDRs for webhooks (enforced by resource policy)
       */
      webhookAllowList?: string;

      /**
       * Enable HMAC signature verification (always recommended)
       */
      enableVerification?: boolean;
  }
```

---

### 14. Update Logging Scripts

**File**: `scripts/check-logs.ts`

**Log group names**:
```diff
  const LOG_GROUPS = {
-     api: "/aws/apigateway/benchling-webhook-http",
+     api: "/aws/apigateway/benchling-webhook-rest",
      ecs: "/ecs/benchling-webhook",
-     waf: "/aws/waf/benchling-webhook",
  };
```

---

### 15. Clean Up Obsolete Files

**Files to remove**:
- `lib/http-api-gateway.ts` - Replaced by `rest-api-gateway.ts`
- `lib/waf-web-acl.ts` - No longer needed
- `test/http-api-gateway.test.ts` - Replaced by `rest-api-gateway.test.ts`
- `test/waf-web-acl.test.ts` - No longer needed

**Files to keep**:
- `lib/network-load-balancer.ts` - Preserved from v0.9.0
- `lib/fargate-service.ts` - Unchanged
- `lib/benchling-webhook-stack.ts` - Updated

---

## Deployment Migration

### Step 1: Pre-Migration

```bash
# Backup current configuration
cp ~/.config/benchling-webhook/default/config.json /tmp/config-backup.json

# Note current endpoint URL
aws cloudformation describe-stacks \
    --stack-name BenchlingWebhookStack \
    --query 'Stacks[0].Outputs[?OutputKey==`WebhookEndpoint`].OutputValue' \
    --output text
```

### Step 2: Destroy v0.9.0 Stack

```bash
# Destroy existing HTTP API stack
npm run destroy -- --profile default --yes
```

**Reason**: REST API and HTTP API are incompatible resource types.

### Step 3: Deploy v1.0.0 Stack

```bash
# Deploy new REST API stack
npm run deploy:prod -- --profile default --yes
```

### Step 4: Update Benchling Configuration

**New endpoint format**:
```
https://{api-id}.execute-api.{region}.amazonaws.com/prod/webhook
```

**Note**: Stage is now part of URL path.

### Step 5: Verify

```bash
# Check logs
npx ts-node scripts/check-logs.ts --profile default --type=api

# Test endpoint
curl -X POST https://{api-id}.execute-api.{region}.amazonaws.com/prod/webhook \
    -H "Content-Type: application/json" \
    -H "X-Benchling-Signature: ..." \
    -d '{"test": "data"}'

# Verify IP filtering (if configured)
# Should return 403 from unknown IP
```

---

## Verification Checklist

After migration, verify:

- [ ] REST API v1 deployed (check AWS Console → API Gateway)
- [ ] Resource policy visible in REST API settings
- [ ] Network Load Balancer still exists (preserved from v0.9.0)
- [ ] No WAF Web ACL exists (check AWS Console → WAF)
- [ ] Endpoint URL includes stage: `/{stage}/webhook`
- [ ] Health endpoint accessible from anywhere
- [ ] Webhook endpoint blocked from non-allowlisted IPs (if configured)
- [ ] HMAC verification still works in FastAPI
- [ ] CloudWatch logs appear in `/aws/apigateway/benchling-webhook-rest`
- [ ] Monthly cost reduced by ~$5/month

---

## Cost Impact

### Before (v0.9.0 with IP filtering)

| Component | Cost |
|-----------|------|
| HTTP API v2 | $1.00 |
| WAF | $7.60 |
| NLB | $16.21 |
| ECS + NAT | $46.90 |
| **Total** | **$71.71** |

### After (v1.0.0 with IP filtering)

| Component | Cost |
|-----------|------|
| REST API v1 | $3.50 |
| Resource Policy | $0.00 |
| NLB | $16.21 |
| ECS + NAT | $46.90 |
| **Total** | **$66.61** |

**Savings**: $5.10/month (7% reduction)

---

## Rollback Plan

If issues occur, rollback to v0.9.0:

```bash
# Checkout v0.9.0 code
git checkout v0.9.0-20251130T062440Z

# Rebuild
npm run build

# Deploy
npm run deploy:prod -- --profile default --yes
```

**Note**: Endpoint URL format will change back (removes stage prefix).

---

## Breaking Changes

1. **Endpoint URL format changes**
   - Old: `https://{api-id}.execute-api.{region}.amazonaws.com/webhook`
   - New: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/webhook`

2. **CloudWatch log group changes**
   - Old: `/aws/apigateway/benchling-webhook-http`
   - New: `/aws/apigateway/benchling-webhook-rest`

3. **No WAF logs**
   - Old: `/aws/waf/benchling-webhook`
   - New: N/A (IP filtering in API Gateway)

4. **Stack must be destroyed and recreated**
   - Incompatible resource types (HTTP API vs REST API)

---

## Timeline

**Estimated effort**: 4-6 hours

- [ ] Create `rest-api-gateway.ts` construct (2 hours)
- [ ] Update `benchling-webhook-stack.ts` (30 minutes)
- [ ] Write tests for REST API Gateway (1 hour)
- [ ] Update integration tests (30 minutes)
- [ ] Update documentation (1 hour)
- [ ] Test migration in dev environment (30 minutes)
- [ ] Production migration (30 minutes)

---

## Success Criteria

- ✅ REST API v1 deployed with resource policy
- ✅ IP allowlist enforced at edge (403 for unknown IPs)
- ✅ Health endpoint exempt from IP filtering
- ✅ NLB preserved from v0.9.0 (no Cloud Map regression)
- ✅ Valid HMAC signatures return 200 OK
- ✅ Invalid HMAC signatures return 403 Forbidden
- ✅ No WAF deployed (cost savings confirmed)
- ✅ Total cost reduced vs v0.9.0 ($66.61 vs $71.71)
- ✅ All tests passing
- ✅ Documentation updated

---

## References

- [11-arch-30.md](./11-arch-30.md) - Target architecture specification
- [10-arch-29.md](./10-arch-29.md) - HTTP API v2 analysis
- AWS Docs: [REST API Resource Policies](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies.html)
- AWS Docs: [VPC Links for REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-private-integration.html)

---

**Version**: 1.0.0
**Date**: 2025-11-30
**Status**: Ready for Implementation
