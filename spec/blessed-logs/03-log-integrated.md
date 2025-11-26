# Benchling Integration Log Resources - Quilt Stack Deployment

## Overview

This document analyzes the **expected** loggable resources for Benchling webhook integration when deployed as part of a Quilt stack, based on the CloudFormation template in `~/GitHub/deployment/t4/template/benchling.py`.

**Verification Stack:** `quilt-staging` in `us-east-1` (account `712023778557`)

**Key Finding:** ⚠️ **Benchling integration is NOT currently enabled in quilt-staging stack**

## Template Analysis

### Source Template

**File:** `/Users/ernest/GitHub/deployment/t4/template/benchling.py`

**Architecture Pattern:** HTTP API Gateway → VPC Link → Cloud Map Service Discovery → ECS Fargate (2 containers)

### Conditional Deployment

The template uses CloudFormation conditions to enable/disable Benchling:

```python
Parameter(
    "BenchlingWebhook",
    Type="String",
    AllowedValues=["Enabled", "Disabled"],
    Default="Disabled",  # ← Disabled by default
)

cft.add_condition("BenchlingEnabled", Equals(param.ref(), "Enabled"))
```

**All Benchling resources have `Condition="BenchlingEnabled"`** - they only exist if parameter is set to `"Enabled"`.

### Verification: quilt-staging Stack

**Stack Status:** UPDATE_COMPLETE (created 2023-06-22)

**Benchling Parameter Status:**
- ❌ `BenchlingWebhook` parameter NOT present in stack parameters
- ❌ No Benchling-related resources found in stack
- ❌ No Benchling outputs in stack
- ❌ No Benchling ECS service running

**Evidence:**
```bash
# No Benchling resources
aws cloudformation list-stack-resources --stack-name quilt-staging | grep -i benchling
# (no output)

# No Benchling ECS service
aws ecs list-services --cluster quilt-staging | grep -i benchling
# (no output)

# No Benchling API Gateway
aws apigatewayv2 get-apis | jq '.Items[] | select(.Name | contains("benchling"))'
# (no output)
```

**Existing Secrets (But Unused by Stack):**
- `BenchlingClientSecret-QWmlBzGBT2Df` - Orphaned secret
- `benchling-webhook-dev` - Standalone deployment secret
- `@quiltdata/benchling-webhook` - Standalone deployment secret
- Multiple `quiltdata/benchling-webhook/*` secrets - Standalone deployment secrets

These secrets exist but are **NOT attached to any quilt-staging resources**.

## Expected Log Resources (When Enabled)

Based on the CloudFormation template, if `BenchlingWebhook=Enabled`, the following log resources would be created:

### 1. ECS Container Logs (Primary)

**Log Group:** Shared with other Quilt services - `quilt-staging` (or whatever the stack LogGroup is)

**Log Stream Naming:**
```python
LogConfiguration(
    LogDriver="awslogs",
    Options={
        "awslogs-group": Ref("LogGroup"),
        "awslogs-region": Ref("AWS::Region"),
        "awslogs-stream-prefix": "benchling",
    }
)
```

**Expected Stream Pattern:**
```
benchling/{containerName}/{taskId}
```

**Two Containers per Task:**

#### Container 1: Benchling Flask Application
```python
container = ecs.ContainerDefinition(
    Name="benchling",
    Image=container_factory.image_url("benchling"),
    LogConfiguration=containers.make_log_configuration("LogGroup", prefix="benchling"),
    PortMappings=[],  # No exposed port
    HealthCheck=ecs.HealthCheck(
        Command=["CMD-SHELL", f"curl -f --max-time 5 http://localhost:{BENCHLING_APP_PORT}/health || exit 1"],
        Interval=10,
        Timeout=5,
        Retries=2,
        StartPeriod=60,
    ),
)
```

**Log Stream:** `benchling/benchling/{taskId}`

**Content:**
- Flask application logs (werkzeug)
- Webhook processing
- Python exceptions
- Health check responses
- Quilt catalog API calls
- S3/Athena/Glue operations

#### Container 2: Nginx Sidecar Proxy
```python
nginx_container = ecs.ContainerDefinition(
    Name="nginx",
    Image="nginx:1.25-alpine",
    LogConfiguration=containers.make_log_configuration("LogGroup", prefix="benchling-nginx"),
    PortMappings=[ecs.PortMapping(ContainerPort=8080)],
    HealthCheck=ecs.HealthCheck(
        Command=["CMD-SHELL", f"wget -q --spider http://localhost:8080/health || exit 1"],
        Interval=10,
        Timeout=5,
        Retries=2,
        StartPeriod=30,
    ),
    DependsOn=[{"ContainerName": "benchling", "Condition": "HEALTHY"}],
)
```

**Log Stream:** `benchling-nginx/nginx/{taskId}`

**Content:**
- Nginx access logs
- Proxy requests to Flask (localhost:5001)
- HTTP 200 health checks
- Connection errors
- Upstream timeout errors

**Key Difference from Standalone:**
- **Shared log group** with other Quilt services (registry, s3-proxy, bulk_loader, etc.)
- **No dedicated log group** like standalone deployment

### 2. Shared Log Group Structure

**Actual Log Group:** `quilt-staging`

**Current Stats:**
- Size: 690,642,156 bytes (~659 MB)
- Retention: 90 days
- Total Streams: Unknown (many)

**Stream Prefixes (Current, No Benchling):**
```
audit-trail/s3-delivery
bulk_loader/bucket_scanner/{taskId}
ecs-execute-command-{sessionId}
registry/nginx/{taskId}
registry/nginx-catalog/{taskId}
registry/registry/{taskId}
registry/registry-tmp-volume-chmod/{taskId}
registry/registry_migration/{taskId}
registry/stack_status/{taskId}
s3-proxy/s3-proxy/{taskId}
voila/nginx/{taskId}
voila/nginx-conf-init/{taskId}
voila/voila/{taskId}
```

**Expected with Benchling Enabled:**
```
benchling/benchling/{taskId}          ← Flask app
benchling-nginx/nginx/{taskId}         ← Nginx proxy
```

### 3. HTTP API Gateway Logs

**Resource:** `BenchlingApi` (apigatewayv2.Api)

```python
api = apigatewayv2.Api(
    "BenchlingApi",
    Name=Sub("${AWS::StackName}-benchling"),
    ProtocolType="HTTP",
    Description="API Gateway for Benchling webhook integration",
)
```

**Stage:** `$default` (auto-deploy enabled)

```python
stage = apigatewayv2.Stage(
    "BenchlingStage",
    ApiId=Ref(api),
    StageName="$default",
    AutoDeploy=True,
)
```

**Expected Endpoint:**
```
https://{apiId}.execute-api.us-east-1.amazonaws.com
```

**Logging Configuration:** NOT EXPLICITLY CONFIGURED IN TEMPLATE

**Potential Log Groups:**
- `/aws/apigatewayv2/{apiId}/$default` - Access logs (if enabled)
- No execution logs by default in HTTP API Gateway

**Note:** HTTP API Gateway has different logging than REST API Gateway:
- No execution logs available (unlike REST APIs)
- Access logs must be explicitly configured
- Template does NOT configure access logging

### 4. VPC Link (No Logs)

```python
vpc_link = apigatewayv2.VpcLink(
    "BenchlingVpcLink",
    Name=Sub("${AWS::StackName}-benchling-vpclink"),
    SubnetIds=subnet_ids,
    SecurityGroupIds=[Ref("ElbPrivateSecurityGroup")],
)
```

**Logging:** VPC Links do not generate logs directly.

**Debugging:** VPC Link connection issues appear in API Gateway logs (if enabled).

### 5. Service Discovery (Cloud Map)

```python
service_discovery_service = dns.make_service_discovery_service(
    prefix="Benchling",
    Condition="BenchlingEnabled",
)
```

**Expected Service:** `benchling.quilt-staging` (private DNS)

**Logging:** Cloud Map does not generate application logs. Health checks logged in ECS container logs.

**Verification:**
```bash
aws servicediscovery list-services --region us-east-1
# Expected: Service named "benchling" in namespace "quilt-staging"
# Actual: NOT FOUND (because BenchlingWebhook=Disabled)
```

### 6. Secrets Manager (No Logs)

```python
benchling_secret = secretsmanager.Secret("BenchlingSecret")
```

**Expected Secret Name:** Auto-generated by CloudFormation (e.g., `BenchlingSecret-AbCdEfGh1234`)

**Logging:** Secrets Manager API calls logged in CloudTrail, not CloudWatch Logs.

**Current Secrets (Orphaned):**
- `BenchlingClientSecret-QWmlBzGBT2Df` - Likely from previous test
- Multiple standalone deployment secrets exist but are unrelated

### 7. IAM Roles and Policies (CloudTrail Only)

**Task Execution Role:**
```python
task_execution_role = make_assumable_role(
    name="BenchlingTaskExecutionRole",
    assuming_service_list=["ecs-tasks.amazonaws.com"],
    managed_policy_arn_list=[
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    ],
)
```

**Task Role:** Uses shared `ecs_role` from registry

**Inline Policy:**
```python
benchling_policy = iam.PolicyType(
    "BenchlingPolicy",
    PolicyName="benchling-integration",
    Roles=[Ref(ecs_role)],
    PolicyDocument={
        # Permissions for Secrets Manager, SQS, S3, Athena, Glue
    }
)
```

**Logging:** IAM operations logged in CloudTrail only (not CloudWatch Logs).

### 8. Load Balancer (Shared, No Benchling-Specific Logs)

**ALB:** `quilt--LoadB-VVIevgwHvgj7`

**Benchling Integration:** Uses VPC Link + Cloud Map, **NOT directly connected to ALB**

**ALB Logging Status:**
```
access_logs.s3.enabled=false
health_check_logs.s3.enabled=false
connection_logs.s3.enabled=false
```

**Note:** Benchling does NOT use the shared ALB. It uses HTTP API Gateway → VPC Link → Cloud Map → ECS direct.

## Architecture Comparison

### Standalone Deployment (BenchlingWebhookStack)

```
Internet → API Gateway (REST) → ALB → ECS Fargate (2 containers)
                    ↓                    ↓
            Access Logs (CW)    Container Logs (CW)
                                         ↓
                            BenchlingWebhookStack log group
```

**Dedicated Resources:**
- Dedicated API Gateway (REST API)
- Dedicated ALB
- Dedicated ECS Cluster
- Dedicated Log Group

### Integrated Deployment (Quilt Stack)

```
Internet → API Gateway (HTTP) → VPC Link → Cloud Map → ECS Fargate (2 containers)
                    ↓                                           ↓
            Access Logs (N/A)                    Container Logs (CW)
                                                          ↓
                                            Shared quilt-staging log group
```

**Shared Resources:**
- Shared ECS Cluster (`quilt-staging`)
- Shared Log Group (`quilt-staging`)
- Shared Task Role (`ecs_role`)
- Shared VPC/Subnets/Security Groups

**Dedicated Resources:**
- Dedicated HTTP API Gateway
- Dedicated VPC Link
- Dedicated Cloud Map Service
- Dedicated Task Definition

## Log Volume Estimation

### If Benchling Enabled in quilt-staging

**Assumptions:**
- 2 ECS tasks running continuously
- ~6-8 health checks per minute per container
- ~10 webhook requests per day
- Similar log patterns to standalone deployment

**Expected Daily Volume:**

| Component | Daily Volume | Reasoning |
|-----------|--------------|-----------|
| Flask Container Logs | ~500 KB | Health checks + webhooks |
| Nginx Container Logs | ~300 KB | Proxy logs + health checks |
| API Gateway Access Logs | ~50 KB | If enabled, webhook requests only |
| **Total (Both Containers)** | **~850 KB/day** | |

**90-Day Retention Impact:**
- Expected: ~76.5 MB additional to quilt-staging log group
- Current quilt-staging size: ~659 MB
- New total: ~735 MB (+11.6%)

**Note:** Much smaller impact than standalone because:
- No ALB access logs (uses VPC Link)
- Shared log group with 90-day retention (vs 7-day in standalone)
- No API Gateway execution logs (HTTP API vs REST API)

## Current State Summary

### What EXISTS in quilt-staging

✅ **Quilt Services Running:**
- `quilt-staging-registry` (ECS)
- `quilt-staging-nginx_catalog` (ECS)
- `quilt-staging-VoilaService-aRngdIiPksez` (ECS)
- `quilt-staging-bulk-scanner` (ECS)
- `quilt-staging-s3-proxy` (ECS)

✅ **Shared Infrastructure:**
- ECS Cluster: `quilt-staging`
- Log Group: `quilt-staging` (~659 MB, 90-day retention)
- ALB: `quilt--LoadB-VVIevgwHvgj7` (no logging enabled)
- Cloud Map Namespace: `quilt-staging`

✅ **Orphaned Secrets (from previous tests):**
- `BenchlingClientSecret-QWmlBzGBT2Df`
- Various standalone deployment secrets

### What DOES NOT EXIST (But Would if Enabled)

❌ **Benchling ECS Service**
❌ **Benchling HTTP API Gateway**
❌ **Benchling VPC Link**
❌ **Benchling Cloud Map Service**
❌ **Log streams with `benchling/` or `benchling-nginx/` prefixes**

### Evidence from Logs

**Recent Quilt Staging Log Activity:**

```bash
aws logs tail "quilt-staging" --region us-east-1 --since 1h | grep -i benchling
```

**Found ONE match:**
```
2025-11-25T23:41:25 10.0.219.145 - - [25/Nov/2025:23:41:25 +0000]
  "GET /config.json HTTP/1.1" 200 849 "-"
  "benchling-webhook-config-tool/1.0" "208.82.100.85"
```

**Analysis:**
- This is an nginx access log from the **registry** service
- User-Agent: `benchling-webhook-config-tool/1.0`
- Request: `GET /config.json` (Quilt catalog config endpoint)
- This is the **standalone benchling-webhook CLI** querying the Quilt catalog
- NOT evidence of integrated Benchling service running

## Log Discovery Strategy

### For Standalone Deployment

**Primary Log Group:** `BenchlingWebhookStack`

**Stream Prefixes:**
```
benchling-webhook/BenchlingWebhookContainer/{taskId}
```

**Discovery Command:**
```bash
aws logs describe-log-streams \
  --log-group-name "BenchlingWebhookStack" \
  --log-stream-name-prefix "benchling-webhook/" \
  --region us-east-1
```

### For Integrated Deployment

**Primary Log Group:** `{stackName}` (e.g., `quilt-staging`)

**Stream Prefixes:**
```
benchling/benchling/{taskId}
benchling-nginx/nginx/{taskId}
```

**Discovery Command:**
```bash
aws logs describe-log-streams \
  --log-group-name "quilt-staging" \
  --log-stream-name-prefix "benchling/" \
  --region us-east-1
```

**Challenge:** Must filter in SHARED log group with many other services.

### Detection Algorithm

To detect if Benchling is enabled in a Quilt stack:

```python
def is_benchling_enabled(stack_name: str, region: str) -> bool:
    # Method 1: Check CloudFormation parameters
    params = get_stack_parameters(stack_name, region)
    if params.get("BenchlingWebhook") == "Enabled":
        return True

    # Method 2: Check for Benchling ECS service
    services = list_ecs_services(f"{stack_name}", region)
    if any("benchling" in s.lower() for s in services):
        return True

    # Method 3: Check for Benchling log streams
    streams = describe_log_streams(stack_name, "benchling/", region)
    if len(streams) > 0:
        return True

    # Method 4: Check for Benchling API Gateway
    apis = get_http_apis(region)
    if any(f"{stack_name}-benchling" in api.name for api in apis):
        return True

    return False
```

## Configuration Differences

### Environment Variables

**Standalone Deployment:**
```typescript
{
  "QUILT_STACK_ARN": "arn:aws:cloudformation:...",  // ← Stack ARN
  "BENCHLING_SECRET_ARN": "arn:aws:secretsmanager:...",
  "PORT": "5001",
}
```

**Integrated Deployment (v0.8.0+):**
```python
{
  # Per-service variables (NO stack ARN!)
  "QUILT_WEB_HOST": Ref("QuiltWebHost"),
  "ATHENA_USER_DATABASE": Ref("UserAthenaDatabase"),
  "ATHENA_USER_WORKGROUP": Ref("UserAthenaNonManagedRoleWorkgroup"),
  "ATHENA_RESULTS_BUCKET": Ref("UserAthenaResultsBucket"),
  "ICEBERG_DATABASE": Ref("IcebergDatabase"),
  "ICEBERG_WORKGROUP": Ref("IcebergWorkGroup"),
  "PACKAGER_SQS_URL": PackagerQueueUrl,
  "AWS_REGION": Ref("AWS::Region"),
  "BenchlingSecret": benchling_secret.ref(),
  "PORT": "5001",
  "QUILT_WRITE_ROLE_ARN": If(
      "BenchlingUseCustomRole",
      benchling_role_param.ref(),
      GetAtt("T4BucketWriteRole", "Arn"),
  ),
}
```

**Key Differences:**
- ✅ No `QUILT_STACK_ARN` in integrated (v0.8.0+)
- ✅ Direct service references (URLs, buckets, databases)
- ✅ Configurable write role (custom or default `T4BucketWriteRole`)

### Health Checks

**Standalone:**
- ALB Target Group health check → `/health/ready`
- ECS Container health check → `/health`

**Integrated:**
- No ALB (uses VPC Link)
- ECS Container health check → `/health` (Flask)
- ECS Container health check → `/health` (Nginx proxy)
- Cloud Map health check (automatic based on ECS health)

## Recommendations for Integrated Deployment

### 1. Enable API Gateway Access Logging

**Current Status:** NOT configured in template

**Recommended Addition to `benchling.py`:**
```python
# Create CloudWatch log group for API Gateway
api_log_group = logs.LogGroup(
    "BenchlingApiLogGroup",
    template=cft,
    Condition="BenchlingEnabled",
    LogGroupName=Sub("/aws/apigateway/${AWS::StackName}-benchling"),
    RetentionInDays=7,
)

# Configure stage with access logging
stage = apigatewayv2.Stage(
    "BenchlingStage",
    template=cft,
    Condition="BenchlingEnabled",
    ApiId=Ref(api),
    StageName="$default",
    AutoDeploy=True,
    AccessLogSettings=apigatewayv2.AccessLogSettings(
        DestinationArn=api_log_group.get_att("Arn"),
        Format='$context.requestId $context.error.message $context.error.messageString',
    ),
)
```

### 2. Add Structured Logging

**Current:** Werkzeug default logs (plain text)

**Recommended:** JSON structured logs with correlation IDs

```python
Environment(
    Name="LOG_FORMAT",
    Value="json",
),
```

### 3. Add Log Metric Filters

**Recommended:**
```python
# Error count metric
logs.MetricFilter(
    "BenchlingErrorMetric",
    template=cft,
    Condition="BenchlingEnabled",
    FilterPattern='[time, request_id, level = ERROR*, ...]',
    LogGroupName=Ref("LogGroup"),
    MetricTransformations=[
        logs.MetricTransformation(
            MetricName="BenchlingErrors",
            MetricNamespace=Sub("${AWS::StackName}/Benchling"),
            MetricValue="1",
        )
    ],
)
```

### 4. Add CloudWatch Alarms

**Recommended:**
```python
cloudwatch.Alarm(
    "BenchlingErrorAlarm",
    template=cft,
    Condition="BenchlingEnabled",
    AlarmName=Sub("${AWS::StackName}-benchling-errors"),
    MetricName="BenchlingErrors",
    Namespace=Sub("${AWS::StackName}/Benchling"),
    Statistic="Sum",
    Period=300,  # 5 minutes
    EvaluationPeriods=1,
    Threshold=5,
    AlarmActions=[Ref("CanaryNotificationsTopic")],
)
```

## Summary: Expected vs Actual

### Expected Loggable Resources (If Enabled)

1. ✅ ECS Container Logs (Flask) → `{stackName}` log group, `benchling/benchling/` prefix
2. ✅ ECS Container Logs (Nginx) → `{stackName}` log group, `benchling-nginx/nginx/` prefix
3. ❌ HTTP API Gateway Access Logs → NOT CONFIGURED (but could be)
4. ❌ HTTP API Gateway Execution Logs → NOT AVAILABLE (HTTP API limitation)
5. ❌ VPC Link Logs → NOT AVAILABLE (no direct logging)
6. ❌ Cloud Map Logs → NOT AVAILABLE (no direct logging)
7. ✅ CloudTrail (IAM/Secrets) → Account-level, not service-specific

### Actual State in quilt-staging

**Benchling Deployment Status:** ❌ **NOT ENABLED**

**Evidence:**
- No `BenchlingWebhook` parameter in stack
- No Benchling ECS service running
- No Benchling log streams
- No Benchling API Gateway
- No Benchling Cloud Map service

**Why Disabled:**
- Template default: `Default="Disabled"`
- Must explicitly set `BenchlingWebhook=Enabled` during deployment
- No indication quilt-staging ever had Benchling enabled

### Key Differences: Standalone vs Integrated

| Feature | Standalone | Integrated |
|---------|------------|------------|
| Log Group | Dedicated `BenchlingWebhookStack` | Shared `{stackName}` |
| API Gateway Type | REST API | HTTP API |
| API Gateway Logs | Access + Execution | None (not configured) |
| Load Balancer | Dedicated ALB | None (VPC Link) |
| ALB Logs | S3 (enabled) | N/A |
| Log Retention | 7 days | 90 days (shared) |
| Container Count | 1 (Flask only) | 2 (Flask + Nginx) |
| Stream Prefix | `benchling-webhook/` | `benchling/` + `benchling-nginx/` |
| Cluster | Dedicated | Shared with Quilt services |

### Impact on Log Tooling

**For `benchling-webhook logs` CLI:**

1. **Detection Required:** Must detect standalone vs integrated deployment
2. **Different Log Groups:** `BenchlingWebhookStack` vs `{stackName}`
3. **Different Stream Prefixes:** `benchling-webhook/` vs `benchling/` + `benchling-nginx/`
4. **Shared Log Group:** Must filter out other services in integrated mode
5. **Multiple Containers:** Must query both Flask and Nginx streams in integrated mode

**Recommended Approach:**
```typescript
// Detect deployment type from config
if (config.deployment.type === "integrated") {
  logGroup = config.deployment.stackName;
  streamPrefixes = ["benchling/", "benchling-nginx/"];
} else {
  logGroup = "BenchlingWebhookStack";
  streamPrefixes = ["benchling-webhook/"];
}
```
